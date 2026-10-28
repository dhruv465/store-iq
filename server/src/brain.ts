import { randomUUID } from "node:crypto";
import { providerRequest, readLimited } from "./http.js";
import { allowedNumbers, factsFor, recommendedInches, type Pack } from "./pack.js";
import { briefAnswer, cardSummary, reviewReply, shiftBrief, wantsBrief, wantsNewCustomer, wantsReview } from "./steps.js";
import type { Event, Reply, Session, Step } from "./types.js";
import { STEPS } from "./types.js";

const SYSTEM = `You are Store IQ, the AI partner of a Reliance Digital store associate. The associate is on the shop floor with a customer in front of them, holding the phone in one hand.

The associate owns the conversation. You hold the facts. You recommend and give the reason; the associate decides.

Work through these steps in order, one turn at a time:
1. assess - build a card of the customer's HOME from what the associate tells you, and give the single next question to ask. Room, viewing distance, light, wall or table, what they watch, devices, family, internet, budget.
2. validate - when the customer has said something partly correct, give one polite line that confirms the true part, then corrects.
3. translate - turn a spec on a label into one line about THIS home, e.g. "8 kg: two pairs of jeans and two bedsheets in one wash".
4. recommend - exactly three options. Give exactly three lines, one per option, and each line must carry that option's own reason in the same line. No separate reason line is shown for this step, so the reason has to be in the line.
5. complete - the full solution and the full cost, charge by charge. Finance with its full cost in one sentence.
6. close - a summary for the customer with consent, a task with an owner, and the installation job with its site needs.
7. review - a score for the steps and one thing to try next time.

Hard rules:
- Never invent a price, offer, stock figure, finance term or specification. Use only the FACTS given to you. If a figure is not there, say it is not in today's data and tell the associate where to check.
- Never guess the customer's wealth or level from appearance. The associate sets the start level.
- Never open the offer, discount, exchange or finance talk before the home is assessed and a spec has been demonstrated.
- Give the associate a LINE TO SAY to the customer, not instructions about selling.
- At most 2 short lines plus your reason, except the recommend step which uses three. At most 3 buttons, each title at most 20 characters. The associate reads this at a glance, out loud.
- A button that answers a question about the home MUST have the id "card:<field>:<value>", for example "card:content:sports", "card:mount:wall", "card:distance_feet:8". Fields: room, distance_feet, light, mount, content, devices, family, internet, budget_rupees, start_level. Any other button gets a plain id.
- Write money as "Rs 54,990", never the rupee sign: it does not survive JSON mode.
- Answer in the SAME language and script the associate just used, the reason line included. Latin script in, Latin script out. Never switch them to Devanagari on your own.`;

export type Decision = {
  step: Step;
  card: Record<string, unknown>;
  shortlist: string[];
  demonstrated: boolean;
  lines: string[];
  buttons: { id: string; title: string }[];
  reason: string;
};

const schema = {
  type: "OBJECT",
  required: ["step", "card", "shortlist", "demonstrated", "lines", "buttons", "reason"],
  properties: {
    step: { type: "STRING", enum: [...STEPS] },
    card: {
      type: "OBJECT",
      properties: {
        room: { type: "STRING", nullable: true },
        distance_feet: { type: "NUMBER", nullable: true },
        light: { type: "STRING", nullable: true },
        mount: { type: "STRING", nullable: true },
        content: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
        devices: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
        family: { type: "STRING", nullable: true },
        internet: { type: "STRING", nullable: true },
        budget_rupees: { type: "NUMBER", nullable: true },
        start_level: { type: "STRING", nullable: true },
      },
    },
    shortlist: { type: "ARRAY", items: { type: "STRING" }, description: "SKUs from FACTS only" },
    demonstrated: { type: "BOOLEAN", description: "true when this turn turned a spec into a line about this home" },
    lines: { type: "ARRAY", items: { type: "STRING" }, description: "1 or 2 short lines for the associate to say" },
    buttons: {
      type: "ARRAY",
      items: { type: "OBJECT", required: ["id", "title"], properties: { id: { type: "STRING" }, title: { type: "STRING" } } },
    },
    reason: { type: "STRING", description: "one short line: why this answer" },
  },
} as const;

/** Gemini answers 503 UNAVAILABLE under load and sometimes just hangs; both clear on a retry.
 *  429 is deliberately absent: the free tier's limit is per DAY (Google asked for a 19 hour delay
 *  when it was hit), so retrying only spends two more of the day's requests on a certain failure. */
const RETRYABLE = /request failed or timed out|unavailable: HTTP (404|500|502|503|504)/;
const ATTEMPT_TIMEOUT_MS = 9000;
const ATTEMPTS = 3;

/** Retries a generateContent call. Safe because generation has no side effect beyond tokens spent. */
export async function geminiRequest(
  request: typeof fetch,
  url: string,
  init: RequestInit,
  attempts = ATTEMPTS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await providerRequest(request, url, init, "Gemini", ATTEMPT_TIMEOUT_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (attempt >= attempts || !RETRYABLE.test(message)) throw error;
      console.error(`Gemini attempt ${attempt} failed (${message}); retrying`);
      await wait(250 * attempt * attempt);
    }
  }
}

/** Fails loudly for a wrong model name, but never blocks start-up just because Google is unreachable. */
export async function assertModelAvailable(request: typeof fetch = fetch): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  if (!key) throw Error("Missing GEMINI_API_KEY");
  let names: string[];
  try {
    const response = await providerRequest(
      request,
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      { headers: { "x-goog-api-key": key } },
      "Gemini models",
      8000,
    );
    const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 1024 * 1024)));
    names = (body?.models ?? []).map((entry: any) => String(entry?.name ?? "").replace("models/", ""));
  } catch {
    console.error(`Could not list Gemini models; trusting GEMINI_MODEL=${model}`);
    return model;
  }
  if (!names.includes(model))
    throw Error(`GEMINI_MODEL=${model} is not available to this key. Listed flash models: ${names.filter((n) => n.includes("flash")).slice(0, 8).join(", ")}`);
  return model;
}

const OFFER_WORDS = /\b(offer|discount|exchange|emi|finance|cashback|instant|no.cost|bonus|scheme|chhoot|छूट)s?\b/i;
/** A figure beside the offer word is the difference between quoting a deal and declining to. */
const A_FIGURE = /₹|\d+\s?%|\b\d{3,}\b/;

/** Fires only when a reply would put a number on an offer before the home has been earned. */
export function offerLeaked(text: string, assessed: boolean, demonstrated: boolean): boolean {
  return !(assessed && demonstrated) && OFFER_WORDS.test(text) && A_FIGURE.test(text);
}

/** Four home facts, including how far they sit, is enough to stop talking about price first. */
export function isAssessed(card: Session["card"]): boolean {
  const filled = ["room", "distance_feet", "light", "mount", "content", "devices", "family", "internet", "budget_rupees"]
    .filter((key) => {
      const value = (card as Record<string, unknown>)[key];
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
    });
  return filled.length >= 4 && card.distance_feet !== undefined;
}

/** Every number a text states, as exact tokens. */
export function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const token of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) found.add(Number(token[0].replace(/,/g, "")));
  return found;
}

/** Money, percentages and large figures must exist in the data pack or in what the associate said.
 *  Matching is on exact values: 999 is not supported by 79990 merely containing it. */
export function unsupportedNumbers(text: string, allowed: Set<number>, said: string): string[] {
  const quoted = numbersIn(said);
  const bad: string[] = [];
  for (const match of text.matchAll(/(₹\s?|\bRs\.?\s?)?(\d[\d,]*(?:\.\d+)?)\s?(%|percent|inch|nits|hz|w\b|watt|months?|units?|rupees)?/gi)) {
    const raw = match[2]!.replace(/,/g, "");
    const value = Number(raw);
    const factLike = !!match[1] || !!match[3] || value >= 100;
    if (!factLike || !Number.isFinite(value)) continue;
    if (allowed.has(value) || quoted.has(value)) continue;
    bad.push(raw);
  }
  return bad;
}

export function moneySafe(text: string): string {
  return text.replace(/","\s?(?=[\d₹])/g, "Rs ").replace(/\bRs\s+₹/g, "Rs ");
}

/** Three lines and three buttons is the floor limit. The recommend step spends all three lines on
 *  the three options, each carrying its own reason; every other step uses two plus a reason line. */
export function render(decision: Decision): Reply {
  const options = decision.step === "recommend";
  const lines = decision.lines.map((line) => moneySafe(line).trim()).filter(Boolean).slice(0, options ? 3 : 2);
  const reason = moneySafe(decision.reason).trim();
  const text = [...lines, options || !reason ? "" : `↳ ${reason}`].filter(Boolean).join("\n").slice(0, 1000);
  const buttons = decision.buttons
    .filter((button) => button?.id?.trim() && button?.title?.trim())
    .slice(0, 3)
    .map((button) => ({ id: button.id.trim().slice(0, 256), title: button.title.trim().slice(0, 20) }));
  const unique = buttons.filter(
    (button, index) =>
      buttons.findIndex((other) => other.id === button.id) === index &&
      buttons.findIndex((other) => other.title === button.title) === index,
  );
  return { text: text || "Tell me about the customer's room and I will give you the next question.", ...(unique.length ? { buttons: unique } : {}) };
}

const CARD_FIELDS = new Set(["room", "distance_m", "distance_feet", "space", "light", "mount", "content", "devices",
  "family", "internet", "budget_rupees", "start_level", "replacing", "priorities", "site_constraints"]);
const NUMERIC_FIELDS = new Set(["distance_m", "distance_feet", "budget_rupees"]);
const LIST_FIELDS = new Set(["content", "devices", "priorities", "site_constraints"]);

/** A tap already carries its answer, so the card is filled in code and never depends on the model repeating it. */
export function applyAction(session: Session, action: string | undefined): string | undefined {
  const match = action?.match(/^card:([a-z_]+):(.+)$/);
  if (!match) return undefined;
  const [, field, raw] = match as unknown as [string, string, string];
  if (!CARD_FIELDS.has(field)) return undefined;
  const value = raw.trim().slice(0, 60);
  if (!value) return undefined;
  if (NUMERIC_FIELDS.has(field)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return undefined;
    (session.card as Record<string, unknown>)[field] = number;
  } else if (LIST_FIELDS.has(field)) {
    const list = Array.isArray(session.card[field as "content"]) ? [...session.card[field as "content"]!] : [];
    if (!list.includes(value)) list.push(value);
    (session.card as Record<string, unknown>)[field] = list.slice(0, 6);
  } else (session.card as Record<string, unknown>)[field] = value;
  return `${field} = ${value}`;
}

/** Devanagari in the associate's own words is the only thing that selects Hindi. */
export function languageOf(text: string | undefined): "en" | "hi" {
  return text && /[\u0900-\u097F]/.test(text) ? "hi" : "en";
}

function prompt(event: Event, session: Session, pack: Pack, tapped?: string): string {
  const facts = factsFor(pack, session.card, session.shortlist);
  const sizeHint = session.card.distance_feet
    ? `At ${session.card.distance_feet} feet, about ${recommendedInches(session.card.distance_feet)} inch fits.`
    : "Viewing distance is still unknown.";
  const gate = isAssessed(session.card) && session.demonstrated
    ? "The home is assessed and a spec has been demonstrated, so offers and finance are open."
    : "The home is NOT yet assessed or nothing has been demonstrated. Do not mention offers, discounts, exchange or finance.";
  return [
    `FACTS (the only source of prices, offers, stock, finance and specs):\n${facts}`,
    `TODAY'S BRIEF:\n${JSON.stringify(pack.shift_brief)}`,
    `HOME CARD SO FAR:\n${JSON.stringify(session.card)}`,
    `STEPS DONE: ${session.steps_done.join(", ") || "none"}. CURRENT STEP: ${session.step}.`,
    sizeHint,
    gate,
    session.language === "hi"
      ? "The associate is writing in Hindi. Answer in Hindi."
      : "The associate is writing in Latin script. Answer in English or Hinglish in Latin script, never Devanagari.",
    `RECENT TURNS:\n${session.history.slice(-6).map((turn) => `${turn.who}: ${turn.text}`).join("\n") || "none"}`,
    `THE ASSOCIATE ${event.action ? `tapped: ${event.action}` : ""}${tapped ? ` (already saved to the card: ${tapped})` : ""}${event.audio ? "sent the voice note attached below" : ""}${event.image ? "sent the photo attached below" : ""}${event.text ? ` said: ${event.text}` : ""}`.trim(),
  ].join("\n\n");
}

/** The turns that are pure facts: answered from the pack, with no model request spent. */
/** Section 7: the card is interaction-scoped. A new customer gets an empty card, never the last one's. */
export function startInteraction(session: Session): void {
  session.interaction_id = randomUUID();
  session.interaction_started = new Date().toISOString();
  session.card = {};
  session.card_confirmed = false;
  session.assessed = false;
  session.demonstrated = false;
  session.shortlist = [];
  session.steps_done = session.steps_done.filter((step) => step === "brief");
  session.step = "assess";
  session.history = [];
}

export function deterministic(event: Event, session: Session, pack: Pack): Reply | null {
  if (wantsNewCustomer(event.text, event.action)) {
    startInteraction(session);
    return { text: "New customer, clean card.\nTell me what they said and I will give you the first question." };
  }
  if (event.action === "card:confirmed") {
    session.card_confirmed = true;
    if (!session.steps_done.includes("assess")) session.steps_done.push("assess");
    return { text: `Card confirmed.\n${nextQuestion(session)}` };
  }
  if (event.action === "card:correct") {
    session.card_confirmed = false;
    return { text: "Tell me what to change and I will update the card." };
  }
  if (event.action === "card:show" || /^\s*(card|home card|what do you have)\b/i.test(event.text ?? "")) {
    return cardSummary(session);
  }
  const answered = event.action?.match(/^brief:answer:(.+)$/);
  if (answered) {
    if (!session.steps_done.includes("brief")) session.steps_done.push("brief");
    return briefAnswer(pack, answered[1]!);
  }
  if (wantsBrief(event.text, event.action)) {
    session.step = "brief";
    if (!session.steps_done.includes("brief")) session.steps_done.push("brief");
    return shiftBrief(pack);
  }
  if (wantsReview(event.text, event.action)) {
    session.step = "review";
    const reply = reviewReply(session);
    if (!session.steps_done.includes("review")) session.steps_done.push("review");
    return reply;
  }
  return null;
}

export async function decide(event: Event, session: Session, pack: Pack, request: typeof fetch = fetch): Promise<Reply> {
  if (event.text) session.language = languageOf(event.text);
  const tapped = applyAction(session, event.action);
  const free = deterministic(event, session, pack);
  if (free) {
    session.history.push({ who: "associate", text: (event.text ?? event.action ?? "").slice(0, 300) });
    session.history.push({ who: "storeiq", text: free.text.slice(0, 300) });
    session.history = session.history.slice(-12);
    return free;
  }
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw Error("Missing GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  const parts: Record<string, unknown>[] = [{ text: prompt(event, session, pack, tapped) }];
  // One call carries the voice note or the label photo: no transcription hop before the answer.
  for (const media of [event.audio, event.image])
    if (media)
      parts.push({ inline_data: { mime_type: media.mimeType, data: Buffer.from(media.bytes).toString("base64") } });
  const response = await geminiRequest(
    request,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.3,
          // The floor wants an answer, not deliberation: thinking is off for the 5-second rule.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 512 * 1024)));
  const text: string | undefined = body?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text)
    .filter((value: unknown) => typeof value === "string")
    .join("");
  if (typeof text !== "string" || !text.trim())
    throw Error(`Empty Gemini response${body?.promptFeedback?.blockReason ? `: ${body.promptFeedback.blockReason}` : ""}`);
  if (process.env.STOREIQ_DEBUG === "1") console.log("RAW>>>", text, "<<<RAW");
  const decision = JSON.parse(text) as Decision;

  // Merge the card before the gate: this turn's answers count towards being assessed.
  for (const [field, value] of Object.entries(decision.card ?? {}))
    if (value !== null && value !== undefined && !(Array.isArray(value) && !value.length))
      (session.card as Record<string, unknown>)[field] = value;
  session.shortlist = (decision.shortlist ?? []).filter((sku) => pack.products.some((product) => product.sku === sku)).slice(0, 3);
  session.assessed = isAssessed(session.card);
  if (decision.demonstrated) session.demonstrated = true;
  if (STEPS.includes(decision.step)) {
    session.step = decision.step;
    if (!session.steps_done.includes(decision.step)) session.steps_done.push(decision.step);
  }

  // Section 3: show what was understood and allow correction before the card drives a recommendation.
  if (!session.card_confirmed && session.assessed && ["recommend", "complete", "close"].includes(decision.step))
    return cardSummary(session);

  let reply = render(decision);
  const said = `${event.text ?? ""} ${event.action ?? ""}`;
  const bad = unsupportedNumbers(reply.text, allowedNumbers(pack), said);
  if (bad.length)
    reply = {
      text: `That figure is not in today's data pack, so I will not say it.\n↳ Check the shelf tag or the manager before quoting ${bad[0]}.`,
    };
  else if (offerLeaked(reply.text, session.assessed, session.demonstrated))
    reply = {
      text: `Offers come after the home. ${nextQuestion(session)}\n↳ Our associates led with price in 6 of 6 visits; the home has to come first.`,
    };
  session.history.push({ who: "associate", text: (event.text ?? event.action ?? (event.audio ? "voice note" : "photo")).slice(0, 300) });
  session.history.push({ who: "storeiq", text: reply.text.slice(0, 300) });
  session.history = session.history.slice(-12);
  return reply;
}

/** The next unanswered home question, in the order that matters on the floor. */
export function nextQuestion(session: Session): string {
  const questions: [keyof Session["card"], string][] = [
    ["distance_feet", "How far do they sit from the wall, in feet?"],
    ["light", "How much light hits that wall in the afternoon?"],
    ["mount", "Wall mount or table top?"],
    ["content", "What do they watch most: cricket, OTT, news?"],
    ["devices", "Set-top box, PS5, soundbar at home?"],
    ["room", "Which room, and how big?"],
    ["internet", "Do they have WiFi at home?"],
    ["family", "Who watches together?"],
  ];
  const next = questions.find(([field]) => {
    const value = session.card[field];
    return Array.isArray(value) ? !value.length : value === undefined || value === null || value === "";
  });
  return next ? `Ask: ${next[1]}` : "Ask what they want to see on the screen first.";
}
