import { randomUUID } from "node:crypto";
import { providerRequest, readLimited } from "./http.js";
import { allowedNumbers, canonUnit, factsFor, pairsIn, recommendedInches, spellOut, type Pack } from "./pack.js";
import { recommendReply } from "./recommend.js";
import { matchObjection, looksLikeAClaim, matchMyth, validateReply } from "./validate.js";
import { findProduct, productReply, translateSpec } from "./product.js";
import { asksSomethingSpecific, asksWhatWeHave, greetingReply, inStockReply, intentOf } from "./ask.js";
import {
  endVisitLog,
  newVisitReference,
  startVisitLog,
  storeNamed,
  visitFiled,
  visitOpened,
  wantsVisitLog,
  worthFiling,
} from "./visit.js";
import { describe, extractCard } from "./extract.js";
import { askedToSwitchLanguage, languageFrom, t } from "./i18n.js";
import { expertReply, managerView, newReference, wantsExpert, wantsManagerView } from "./extras.js";
import {
  briefAnswer,
  cardSummary,
  financeReply,
  followThrough,
  itemisedTotal,
  nextQuestionReply,
  reviewReply,
  shiftBrief,
  siteNeeds,
  wantsBrief,
  wantsFinance,
  wantsFollowThrough,
  wantsNewCustomer,
  wantsRecommend,
  wantsReview,
} from "./steps.js";
import type { Event, Reply, Session, Step } from "./types.js";
import { STEPS } from "./types.js";

const SYSTEM = `You are Store IQ. Think of yourself as the floor manager of a Reliance Digital store, on WhatsApp. The person messaging you is one of your associates, on the shop floor, holding their phone in one hand.

They come to you for whatever they do not know. Sometimes that is a customer standing in front of them. Sometimes it is a question about a product, a price, an offer, what arrived today, or what to say to someone who is wavering. Sometimes they are just starting their shift and say hello. Answer whichever it is, like a manager who knows the floor — not like a form.

How to be:
- Talk to the associate the way a good manager talks: short, plain, direct, no greeting rituals and no selling at them. If they say hello, ask what is going on with them, the way you would in the aisle.
- Answer the question they actually asked. Do not change the subject to a questionnaire.
- When they are with a customer and have told you about them, the order that works is: learn the home, correct a wrong belief kindly, turn a spec into something about this home, show three options with one reason and one difference each, give the full cost charge by charge, close with consent, then the follow-up. Keep them in that order when it is slipping, but as a nudge, not a script.
- Hand them words to say out loud, in their words, not instructions about selling. A question for the customer is prefixed "Ask:" — Ask: "How far will you sit from the TV?"
- Everything you say is to the ASSOCIATE. The customer is standing in front of them and never talks to you.

Hard rules, never bent:
- Never invent a figure. Not a price, not an offer, not stock, not a finance term, not a specification, and not a warranty length, a delivery time, a today's target or a count of anything. Use only the FACTS given to you. If it is not there, say you do not have it and tell them who does — the shelf tag, the ASM, the service desk. "I do not have today's target" is a real answer and a good one.
- Never open offers, discounts, exchange or finance before the home is known and a difference has been shown. Our associates led with price in 6 of 6 store visits; that is the habit you exist to break.
- Never guess a customer's wealth or level from how they look. The associate sets that.
- At most 2 short lines plus your reason, except three options which take three lines. At most 3 buttons, 20 characters each. They read this at a glance, out loud, with a customer waiting.
- A button answering something about the customer's home MUST have the id "card:<field>:<value>", for example "card:content:sports", "card:mount:wall", "card:distance_feet:8". Fields: room, distance_feet, light, mount, content, devices, family, internet, budget_rupees, start_level. Anything else gets a plain id.
- Write money as "Rs 54,990", never the rupee sign: it does not survive JSON mode.
- Answer in the same language and script they just used. Latin script in, Latin script out. Never switch them to Devanagari on your own.`;

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
    shortlist: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "SKUs from FACTS only",
    },
    demonstrated: {
      type: "BOOLEAN",
      description: "true when this turn turned a spec into a line about this home",
    },
    lines: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "1 or 2 short lines for the associate to say",
    },
    buttons: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["id", "title"],
        properties: { id: { type: "STRING" }, title: { type: "STRING" } },
      },
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
    throw Error(
      `GEMINI_MODEL=${model} is not available to this key. Listed flash models: ${names
        .filter((n) => n.includes("flash"))
        .slice(0, 8)
        .join(", ")}`,
    );
  return model;
}

const LABEL_PROMPT = `Read the shelf tag, the box or the TV label in this photo. Reply with only what is printed on it: the brand, the model number or code, the screen size and any spec figures, as one short plain line. If a QR code's text is legible, append it. If nothing is legible, reply with the single word NONE.`;

/** One small vision call, and it only reads the tag. The answer is then written from the data pack,
 *  so a misread model number can never become an invented price. */
export async function labelText(image: NonNullable<Event["image"]>, request: typeof fetch = fetch): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return "";
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  const response = await geminiRequest(
    request,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: LABEL_PROMPT },
              {
                inline_data: {
                  mime_type: image.mimeType,
                  data: Buffer.from(image.bytes).toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 128,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 64 * 1024)));
  const text = String(
    body?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text)
      .filter((value: unknown) => typeof value === "string")
      .join("") ?? "",
  ).trim();
  return /^none\b/i.test(text) ? "" : text.slice(0, 200);
}

const VOICE_PROMPT = `The associate just spoke this voice note on a shop floor. Do two things and nothing else.

1. transcript: write down what they said, in the language they said it, as plainly as you can.
2. card: whatever they said about the CUSTOMER'S HOME, and only what they actually said. Leave a
   field out rather than guessing it. distance_m and distance_feet are how far the customer sits
   from the screen, never the size of the room. budget_rupees is a number of rupees.

Write no advice, no greeting and no reply to the associate. Something else writes that.`;

/** The voice schema is deliberately small: the facts, and the words that were said. */
const voiceSchema = {
  type: "OBJECT",
  required: ["transcript", "card"],
  properties: {
    transcript: { type: "STRING" },
    card: {
      type: "OBJECT",
      properties: {
        room: { type: "STRING", nullable: true },
        distance_m: { type: "NUMBER", nullable: true },
        distance_feet: { type: "NUMBER", nullable: true },
        light: { type: "STRING", nullable: true },
        mount: { type: "STRING", nullable: true },
        content: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
        devices: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
        family: { type: "STRING", nullable: true },
        internet: { type: "STRING", nullable: true },
        budget_rupees: { type: "NUMBER", nullable: true },
        replacing: { type: "STRING", nullable: true },
        priorities: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
        site_constraints: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
      },
    },
  },
} as const;

/** A voice note, read the way a label photo is read: the model only says what it heard, and the
 *  code writes the reply.
 *
 *  Letting the model answer a voice note directly was the one surface where our floor rules were a
 *  prompt rather than code, and it showed — a real note came back as "Okay, so 5 feet viewing
 *  distance in the bedroom", which greets, carries no question and follows none of the shape every
 *  other reply obeys. Extraction only, and the deterministic path takes it from there. */
export async function voiceNote(
  audio: NonNullable<Event["audio"]>,
  request: typeof fetch = fetch,
): Promise<{ transcript: string; card: Partial<Session["card"]> }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw Error("Missing GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  const response = await geminiRequest(
    request,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: VOICE_PROMPT },
              { inline_data: { mime_type: audio.mimeType, data: Buffer.from(audio.bytes).toString("base64") } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: voiceSchema,
          temperature: 0,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 256 * 1024)));
  const text: string = (body?.candidates?.[0]?.content?.parts ?? [])
    .map((part: any) => part?.text)
    .filter((value: unknown) => typeof value === "string")
    .join("");
  if (!text.trim()) throw Error("Empty voice response");
  const heard = JSON.parse(text) as { transcript?: string; card?: Record<string, unknown> };
  const card: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(heard.card ?? {}))
    if (value !== null && value !== undefined && !(Array.isArray(value) && !value.length)) card[field] = value;
  return { transcript: String(heard.transcript ?? "").slice(0, 600), card };
}

const OFFER_WORDS = /\b(offer|discount|exchange|emi|finance|cashback|instant|no.cost|bonus|scheme|chhoot|छूट)s?\b/i;
/** A figure beside the offer word is the difference between quoting a deal and declining to. */
const A_FIGURE = /₹|\d+\s?%|\b\d{3,}\b/;

/** Fires only when a reply would put a number on an offer before the home has been earned. */
export function offerLeaked(text: string, assessed: boolean, demonstrated: boolean): boolean {
  return !(assessed && demonstrated) && OFFER_WORDS.test(text) && A_FIGURE.test(text);
}

/** Four home facts, including how far they sit, is enough to stop talking about price first. */
/** "Not sure" is an answer, and it is recorded, but it is not a fact about the home: a field the
 *  customer could not answer must not count towards having assessed it. */
export const NOT_STATED = "not stated";

export function stated(value: unknown): boolean {
  if (value === NOT_STATED) return false;
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
}

export function isAssessed(card: Session["card"]): boolean {
  const filled = [
    "room",
    "distance_m",
    "distance_feet",
    "light",
    "mount",
    "content",
    "devices",
    "family",
    "internet",
    "budget_rupees",
  ].filter((key) => stated((card as Record<string, unknown>)[key]));
  // How far they sit is what sizes the screen, so "not sure" there leaves the home unassessed.
  const hasDistance = typeof card.distance_m === "number" || typeof card.distance_feet === "number";
  return filled.length >= 4 && hasDistance;
}

/** Every number a text states, as exact tokens. */
export function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const token of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) found.add(Number(token[0].replace(/,/g, "")));
  return found;
}

/** Money, percentages and large figures must exist in the data pack or in what the associate said.
 *  Matching is on exact values: 999 is not supported by 79990 merely containing it.
 *
 *  shortcut: the allowlist is numbers without their units, so a small number that appears anywhere
 *  in the pack passes with any unit — "one year warranty" is allowed because some product has 1
 *  HDMI 2.1 port. A model did invent exactly that. Upgrade to value-and-unit pairs (the specs
 *  already carry their unit in the key name: peak_nits, refresh_hz, speaker_watts) when the real
 *  pack lands and the figures start mattering for money. */
/** The units a figure can carry. A number with one of these after it is a claim about a product,
 *  however small it is: "3 years" is as much an invention as "Rs 3,000" when the pack says neither. */
const UNITS =
  "%|percent|inch|inches|nits|hz|w\\b|watt|watts|months?|minutes?|hours?|years?|yrs?|days?|weeks?|units?|rupees|ports?|hdmi|kg|litres?|liters?|stars?|metres?|meters?|feet|foot" +
  // The same units as the replies themselves can be written in.
  "|saal|sal|varsh|mahin[aeo]|dino?|haft[ae]|saptah|ghant[ae]|pratishat|kilo" +
  "|साल|वर्षे|वर्ष|महीनों|महीने|महीना|महिने|महिना|दिनों|दिवस|दिन|हफ्ते|हफ्ता|सप्ताह|घंटे|घंटा" +
  "|इंच|फुट|फीट|वाट|यूनिट|प्रतिशत|किलो";

/** A figure that carries a unit is checked as a pair: "one year" is not in today's data because
 *  no `1 year` is, however many 1s the pack holds as HDMI ports. A rupee figure stays a check on
 *  the number, because the pack's own arithmetic produces amounts no key names. */
export function unsupportedNumbers(text: string, allowed: Set<number | string>, said: string): string[] {
  const quoted = numbersIn(said);
  const spoken = pairsIn(said);
  const bad: string[] = [];
  const scanned = spellOut(text);
  for (const match of scanned.matchAll(
    new RegExp(`(₹\\s?|\\bRs\\.?\\s?)?(\\d[\\d,]*(?:\\.\\d+)?)\\s?-?\\s?(${UNITS})?`, "gi"),
  )) {
    const raw = match[2]!.replace(/,/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const unit = match[1] ? undefined : canonUnit(match[3]);
    if (unit) {
      const pair = `${value} ${unit}`;
      if (!allowed.has(pair) && !spoken.has(pair)) bad.push(`${raw} ${unit}`);
      continue;
    }
    // A bare count is a claim too: a model announced "target is 12 TVs today" and no target of
    // any kind is in the pack. Under ten stays prose, so "three options" and "two bedsheets" are
    // left alone.
    // shortcut: a bare number below ten is not checked. Pair it with its noun to close that.
    const factLike = !!match[1] || !!match[3] || value >= 10;
    if (!factLike) continue;
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
/** The contest's floor rule — "not more than 3 lines and 3 buttons" — applied to every reply that
 *  leaves, not only to the ones a model wrote.
 *
 *  `render()` below has always enforced it on model output, but eight of the nine stages now answer
 *  deterministically and build their own text, so each of those was its own chance to break it. One
 *  gate at the exit is the only version of this rule that cannot drift. The reason line counts as a
 *  line, because on a phone it is one. */
export function floor(reply: Reply): Reply {
  const lines = reply.text.split("\n").filter((line) => line.trim());
  // When something has to go, the reason goes last and the words to say survive.
  const reason = lines.findLast((line) => line.startsWith("↳"));
  const said = lines.filter((line) => !line.startsWith("↳"));
  const kept = reason ? [...said.slice(0, 2), reason] : said.slice(0, 3);
  const buttons = (reply.buttons ?? []).slice(0, 3);
  return {
    text: kept.join("\n").slice(0, 1000),
    ...(buttons.length ? { buttons } : {}),
  };
}

export function render(decision: Decision): Reply {
  const options = decision.step === "recommend";
  const lines = decision.lines
    .map((line) => moneySafe(line).trim())
    .filter(Boolean)
    .slice(0, options ? 3 : 2);
  const reason = moneySafe(decision.reason).trim();
  // A reason on its own is not an answer. The model sometimes returns only its justification —
  // "the viewing distance is the most important factor" — and an associate reading that alone has
  // been told nothing to do, so the fallback supplies the missing instruction instead.
  const said = lines.length ? lines : ["Tell me what the customer said and I will give you the next question."];
  const text = [...said, options || !reason ? "" : `↳ ${reason}`].filter(Boolean).join("\n").slice(0, 1000);
  const buttons = decision.buttons
    .filter((button) => button?.id?.trim() && button?.title?.trim())
    .slice(0, 3)
    .map((button) => ({
      id: button.id.trim().slice(0, 256),
      title: button.title.trim().slice(0, 20),
    }));
  const unique = buttons.filter(
    (button, index) =>
      buttons.findIndex((other) => other.id === button.id) === index &&
      buttons.findIndex((other) => other.title === button.title) === index,
  );
  return {
    text,
    ...(unique.length ? { buttons: unique } : {}),
  };
}

const CARD_FIELDS = new Set([
  "room",
  "distance_m",
  "distance_feet",
  "space",
  "light",
  "mount",
  "content",
  "devices",
  "family",
  "internet",
  "budget_rupees",
  "start_level",
  "replacing",
  "priorities",
  "site_constraints",
]);
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
  const gate =
    isAssessed(session.card) && session.demonstrated
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
    `RECENT TURNS:\n${
      session.history
        .slice(-6)
        .map((turn) => `${turn.who}: ${turn.text}`)
        .join("\n") || "none"
    }`,
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
    return { text: `${t(session.language, "newcustomer")}\n↳ ${t(session.language, "why.newcustomer")}` };
  }
  if (event.action === "card:confirmed") {
    session.card_confirmed = true;
    if (!session.steps_done.includes("assess")) session.steps_done.push("assess");
    return nextQuestionReply(session, t(session.language, "card.confirmed"));
  }
  if (event.action === "card:correct") {
    session.card_confirmed = false;
    return { text: t(session.language, "card.fixwhat") };
  }
  if (event.action === "site:ok") {
    session.site_checked = true;
    return followThrough(session, pack, event.name ?? session.phone);
  }
  const picked = event.action?.match(/^select:([A-Za-z0-9_-]+)$/);
  if (picked) {
    const sku = picked[1]!;
    if (!pack.products.some((product) => product.sku === sku))
      return { text: "That product is not in today's data pack." };
    session.selection = {
      sku,
      accessories: [],
      charges: session.selection?.charges ?? [],
    };
    session.consent = false;
    return followThrough(session, pack, event.name ?? session.phone);
  }
  const added = event.action?.match(/^add:([A-Za-z0-9_-]+)$/);
  if (added && session.selection) {
    const id = added[1]!;
    const known = (pack.accessories ?? []).some((a) => a.id === id) || pack.charges.some((c) => c.id === id);
    if (!known) return { text: "That line is not in today's data pack." };
    const target = (pack.accessories ?? []).some((a) => a.id === id) ? "accessories" : "charges";
    if (!session.selection[target].includes(id)) session.selection[target].push(id);
    session.consent = false;
    return followThrough(session, pack, event.name ?? session.phone);
  }
  if (event.action === "consent:yes") {
    session.consent = true;
    if (!session.steps_done.includes("close")) session.steps_done.push("close");
    if (!session.steps_done.includes("follow_through")) session.steps_done.push("follow_through");
    session.step = "follow_through";
    return followThrough(session, pack, event.name ?? session.phone);
  }
  if (event.action === "consent:no") {
    session.consent = false;
    return { text: t(session.language, "ft.noconsent") };
  }
  // Section 4C: the pack carries the confirm/correct pair, so a known claim needs no request.
  if (looksLikeAClaim(event.text, event.action) && event.text) {
    const myth = matchMyth(pack, event.text) ?? matchObjection(pack, event.text);
    const corrected = validateReply(pack, event.text, session.language);
    if (corrected) {
      session.step = "validate";
      if (!session.steps_done.includes("validate")) session.steps_done.push("validate");
      if (myth) {
        session.objections = session.objections ?? [];
        if (!session.objections.includes(myth.claim)) session.objections.push(myth.claim);
      }
      return corrected;
    }
  }
  // Section 4E: ranking the pack against a confirmed card is arithmetic, so no request is spent.
  if (wantsRecommend(event.text, event.action) && isAssessed(session.card)) {
    if (!session.card_confirmed) return cardSummary(session);
    session.step = "recommend";
    if (!session.steps_done.includes("recommend")) session.steps_done.push("recommend");
    // A cue given is a difference demonstrated, which is what opens the offer gate.
    session.demonstrated = true;
    return recommendReply(pack, session.card, session.language);
  }
  // "Which TVs are good?" from a browsing customer. The answer is still a question, not a product.
  // A home fact in the same message outranks it, so the card extractor is not robbed of the turn.
  if (
    wantsRecommend(event.text, event.action) &&
    !isAssessed(session.card) &&
    !Object.keys(extractCard(event.text ?? "")).length
  )
    return nextQuestionReply(session, t(session.language, "rec.first"));
  // Section 6: finance in one sentence with its full cost. It is arithmetic over the pack's terms,
  // and it sits behind the same gate as every other money conversation.
  if (wantsFinance(event.text, event.action)) {
    if (!(isAssessed(session.card) && session.demonstrated))
      return nextQuestionReply(session, t(session.language, "fin.gate"));
    const total = session.selection ? itemisedTotal(pack, session.selection)?.total : undefined;
    if (!total) return followThrough(session, pack, event.name ?? session.phone);
    session.step = "complete";
    if (!session.steps_done.includes("complete")) session.steps_done.push("complete");
    return financeReply(pack, total, session.language);
  }
  if (wantsFollowThrough(event.text, event.action)) {
    session.step = "follow_through";
    return followThrough(session, pack, event.name ?? session.phone);
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

/** One set named, or one label figure quoted: the pack answers both without a request.
 *  A quoted figure is section 4D's demonstration, which is half of what opens the offer gate. */
function packAnswer(pack: Pack, said: string, session: Session, wants: "set" | "spec" = "spec"): Reply | null {
  const product = findProduct(pack, said);
  // Photographing a tag means "tell me about this set"; the tag carries figures too, and answering
  // one of those instead would answer a question the associate never asked. Typing a figure is the
  // opposite case: there the figure IS the question.
  if (wants === "set" && product) {
    if (!session.shortlist.includes(product.sku)) session.shortlist = [product.sku, ...session.shortlist].slice(0, 3);
    return productReply(product, session.language, isAssessed(session.card));
  }
  const translated = translateSpec(pack, said, product, session.language);
  if (translated) {
    session.step = "translate";
    if (!session.steps_done.includes("translate")) session.steps_done.push("translate");
    session.demonstrated = true;
    return translated;
  }
  if (!product) return null;
  if (!session.shortlist.includes(product.sku)) session.shortlist = [product.sku, ...session.shortlist].slice(0, 3);
  return productReply(product, session.language, isAssessed(session.card));
}

export type Store = {
  today(): Promise<Session[]>;
  logVisit(row: { reference: string; phone: string; associate?: string; store: string; body: string }): Promise<void>;
  openQuestions(): Promise<{ reference: string; area: string; owner: string }[]>;
  logQuestion(row: { reference: string; phone: string; area: string; owner: string; question: string }): Promise<void>;
};

export async function decide(
  event: Event,
  session: Session,
  pack: Pack,
  request: typeof fetch = fetch,
  store?: Store,
): Promise<Reply> {
  return floor(await answer(event, session, pack, request, store));
}

async function answer(
  event: Event,
  session: Session,
  pack: Pack,
  request: typeof fetch = fetch,
  store?: Store,
): Promise<Reply> {
  if (event.name) session.associate = event.name;
  // A voice note becomes the words that were said, so everything below treats it exactly as it
  // treats typing: the same extraction, the same objections and products, the same floor shape.
  let heard: Partial<Session["card"]> = {};
  if (event.audio) {
    const spoken = await voiceNote(event.audio, request);
    heard = spoken.card;
    const said = [spoken.transcript, event.text].filter(Boolean).join(" ").trim();
    event = { ...event, ...(said ? { text: said } : {}) };
    delete event.audio;
  }
  const switched = askedToSwitchLanguage(event.text);
  if (switched) session.language = switched;
  else if (event.text) session.language = languageFrom(event.text, session.language);
  const tapped = applyAction(session, event.action);
  if (tapped && !deterministic(event, session, pack)) {
    session.assessed = isAssessed(session.card);
    const reply =
      session.assessed && !session.card_confirmed
        ? cardSummary(session)
        : nextQuestionReply(session, t(session.language, "noted", { body: tapped }));
    session.history.push({
      who: "associate",
      text: String(event.action).slice(0, 300),
    });
    session.history.push({ who: "storeiq", text: reply.text.slice(0, 300) });
    return reply;
  }
  // "Not sure" is a real answer: it fills nothing and moves on.
  const skipped = event.action?.match(/^skip:([a-z_]+)$/);
  if (skipped) {
    (session.card as Record<string, unknown>)[skipped[1]!] = NOT_STATED;
    return nextQuestionReply(session, t(session.language, "noted.notsure"));
  }
  // A request to switch language is a whole turn on its own.
  if (switched && (event.text ?? "").trim().split(/\s+/).length <= 4)
    return nextQuestionReply(session, t(session.language, "lang.switched"));
  // Extra points: a store visit, in the visitor's own words. It comes before everything that reads
  // text as a customer, because a visit note is full of rooms, prices and brands and would
  // otherwise be read as somebody's home.
  if (store && session.logging_visit && event.text) {
    if (!worthFiling(event.text)) return { text: t(session.language, "visit.tooshort") };
    const reference = newVisitReference();
    const where = storeNamed(event.text, pack);
    await store.logVisit({
      reference,
      phone: session.phone,
      ...(session.associate ? { associate: session.associate } : {}),
      store: where,
      body: event.text.slice(0, 2000),
    });
    endVisitLog(session);
    return visitFiled(reference, where, session.language);
  }
  if (store && wantsVisitLog(event.text, event.action)) {
    startVisitLog(session);
    return visitOpened(session.language);
  }
  // Extra points: both read from the pack and the database, so neither spends a request.
  if (store && wantsManagerView(event.text, event.action))
    return managerView(await store.today(), await store.openQuestions());
  if (store && event.action === "site:problem" && session.selection) {
    const needs = siteNeeds(pack, session.selection).join("; ");
    const reference = newReference();
    const question = `Site needs work before install: ${needs}`;
    const { reply, area, owner } = expertReply(pack, question, reference, session.language);
    await store.logQuestion({ reference, phone: session.phone, area, owner, question });
    return reply;
  }
  if (store && wantsExpert(event.text, event.action)) {
    const question = (event.text ?? "").slice(0, 400);
    const reference = newReference();
    const { reply, area, owner } = expertReply(pack, question, reference, session.language);
    await store.logQuestion({
      reference,
      phone: session.phone,
      area,
      owner,
      question,
    });
    return reply;
  }
  // A question is not a description of the customer's home. Until this, every sentence was read as
  // one, so "is the Sony good for a dark room" was filed as light = dim and "what TVs do we have"
  // was answered with "how far will you sit from the TV?".
  const intent = event.action ? "customer" : intentOf(event.text);
  if (intent === "greeting" && !deterministic(event, session, pack)) return greetingReply(session.language);
  if (intent === "question" && event.text && !deterministic(event, session, pack)) {
    // Asked about one set, or about a figure on a label: both are already answered from the pack.
    // But a summary of the set is the wrong answer to "what warranty comes with it", so a question
    // about something specific goes on to the model, which has the charges and terms in front of it.
    if (!asksSomethingSpecific(event.text)) {
      const named = packAnswer(pack, event.text, session, "set");
      if (named) return named;
    }
    if (asksWhatWeHave(event.text)) return inStockReply(pack, session.card, session.language, isAssessed(session.card));
    // Anything else falls through to the model, which answers from the facts and is still held to
    // the floor's shape and to the figures in the pack.
  }
  // Read what we confidently can from the words before spending a request on them.
  if (intent !== "question" && event.text && !event.image && !event.audio && !deterministic(event, session, pack)) {
    // What the model heard, with what the extractor can read from the same words on top: the
    // extractor only takes what it is sure of, so where both spoke, the stricter one wins.
    const read = { ...heard, ...extractCard(event.text) };
    const fields = Object.entries(read).filter(
      ([, value]) => value !== undefined && !(Array.isArray(value) && !value.length),
    );
    if (fields.length) {
      for (const [field, value] of fields) (session.card as Record<string, unknown>)[field] = value;
      session.assessed = isAssessed(session.card);
      if (!session.steps_done.includes("assess") && session.assessed) session.steps_done.push("assess");
      const reply =
        session.assessed && !session.card_confirmed
          ? cardSummary(session)
          : nextQuestionReply(
              session,
              t(session.language, "noted", {
                body: describe(Object.fromEntries(fields)),
              }),
            );
      session.history.push({
        who: "associate",
        text: event.text.slice(0, 300),
      });
      session.history.push({ who: "storeiq", text: reply.text.slice(0, 300) });
      session.history = session.history.slice(-12);
      return reply;
    }
  }
  // The customer is standing at one set, or asked what a figure on its label means. Both are pack
  // facts, and both run after the card extractor so a home fact in the same message still wins.
  if (intent !== "question" && event.text && !event.image && !event.audio) {
    const reply = packAnswer(pack, event.text, session);
    if (reply) {
      session.history.push({
        who: "associate",
        text: event.text.slice(0, 300),
      });
      session.history.push({ who: "storeiq", text: reply.text.slice(0, 300) });
      session.history = session.history.slice(-12);
      return reply;
    }
  }
  // A photo of a shelf tag: read the tag, then answer from the pack.
  if (event.image) {
    const read = await labelText(event.image, request).catch(() => "");
    const said = [read, event.text].filter(Boolean).join(" ");
    const reply = packAnswer(pack, said, session, "set");
    session.history.push({
      who: "associate",
      text: `photo: ${read || "unreadable"}`.slice(0, 300),
    });
    const answer = reply ?? {
      text: read ? t(session.language, "p.notfound", { v: read.slice(0, 60) }) : t(session.language, "p.unread"),
    };
    session.history.push({ who: "storeiq", text: answer.text.slice(0, 300) });
    session.history = session.history.slice(-12);
    return answer;
  }
  const free = deterministic(event, session, pack);
  if (free) {
    session.history.push({
      who: "associate",
      text: (event.text ?? event.action ?? "").slice(0, 300),
    });
    session.history.push({ who: "storeiq", text: free.text.slice(0, 300) });
    session.history = session.history.slice(-12);
    return free;
  }
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw Error("Missing GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  // Text only, now. A voice note became the words that were said before anything below ran, and a
  // photo is answered from the pack and never reaches here, so this call is the last resort for a
  // sentence no deterministic path could read.
  const parts: Record<string, unknown>[] = [{ text: prompt(event, session, pack, tapped) }];
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
    throw Error(
      `Empty Gemini response${body?.promptFeedback?.blockReason ? `: ${body.promptFeedback.blockReason}` : ""}`,
    );
  if (process.env.STOREIQ_DEBUG === "1") console.log("RAW>>>", text, "<<<RAW");
  const decision = JSON.parse(text) as Decision;

  // Merge the card before the gate: this turn's answers count towards being assessed.
  for (const [field, value] of Object.entries(decision.card ?? {}))
    if (value !== null && value !== undefined && !(Array.isArray(value) && !value.length))
      (session.card as Record<string, unknown>)[field] = value;
  session.shortlist = (decision.shortlist ?? [])
    .filter((sku) => pack.products.some((product) => product.sku === sku))
    .slice(0, 3);
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
      text: `${t(session.language, "gate.offers", { body: nextQuestionReply(session).text.split("\n").pop() ?? "" })}\n↳ Our associates led with price in 6 of 6 visits; the home has to come first.`,
    };
  session.history.push({
    who: "associate",
    text: (event.text ?? event.action ?? (event.audio ? "voice note" : "photo")).slice(0, 300),
  });
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
