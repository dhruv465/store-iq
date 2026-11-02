import { randomUUID } from "node:crypto";
import { modelRequest, providerRequest, readLimited } from "./http.js";
import {
  aboutTheWords,
  allowedNumbers,
  canonUnit,
  factsFor,
  pairsIn,
  recommendedInches,
  searchPack,
  spellOut,
  words,
  type Pack,
} from "./pack.js";
import { falConfig, falText, falTranscribe, readJson, shapeInstruction } from "./fal.js";
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
import { askedToSwitchLanguage, languageFrom, t, type Lang } from "./i18n.js";
import { expertReply, managerView, newReference, wantsExpert, wantsManagerView } from "./extras.js";
import {
  briefAnswer,
  cardSummary,
  financeReply,
  followThrough,
  itemisedTotal,
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
- A direct question gets its answer FIRST, in the same reply, out of FACTS: what it costs, whether it is in stock, what the spec is, whether an offer is running. Then, if it helps, one question. Never answer a direct question with only a question. "Any offer on the iPhone 18 Pro?" is answered about the iPhone 18 Pro, not with "which model?" when FACTS already shows you which ones there are.
- If FACTS lists no offer on what they asked about, the answer is that none is running on it today. Say that plainly. Never mention a bank offer, an exchange, an EMI or any other discount that is not in FACTS — not even as something you could go and check. An offer you have not been given does not exist.
- Ask only about things that make sense for what they are buying. A phone has no viewing distance, no wall mount and no room; a washing machine has no screen size. One question at a time, and stop asking as soon as you have enough to be useful: an associate with a customer who has decided does not want five more questions.
- When they are with a customer and have told you about them, the order that works is: learn the home, correct a wrong belief kindly, turn a spec into something about this home, show three options with one reason and one difference each, give the full cost charge by charge, close with consent, then the follow-up. Keep them in that order when it is slipping, but as a nudge, not a script.
- Hand them words to say out loud, in their words, not instructions about selling. A question for the customer is prefixed "Ask:" — Ask: "How far will you sit from the TV?"
- Everything you say is to the ASSOCIATE. The customer is standing in front of them and never talks to you.
- Your reason line is for the associate, about the floor: why this question, why this set, why now. Never about yourself, your FACTS, your rules or what you are designed to do.

Hard rules, never bent:
- Never invent a figure. Not a price, not an offer, not stock, not a finance term, not a specification, and not a warranty length, a delivery time, a today's target or a count of anything. Use only the FACTS given to you. If it is not there, say you do not have it and tell them who does — the shelf tag, the ASM, the service desk. "I do not have today's target" is a real answer and a good one. Set "unknown" true on any turn where you could not answer what they asked, and they will be offered a human who can.
- Plenty of what they bring you is not a sale at all: a customer losing their temper, a set that came back faulty, a shift, a leave, something they have forgotten how to do, a bad morning. Answer that as their manager, in their words. Do not fill in a customer's home from it, and do not steer it back to a product.
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
  /** Set when the answer is not in the pack. A manager who does not know says they will find out,
   *  so the reply carries the button that puts the question to a human. */
  unknown?: boolean;
};

const schema = {
  type: "OBJECT",
  // "unknown" is required or the model simply leaves it out: it said "I do not have that"
  // in prose and reported nothing, so no human was ever offered.
  required: ["step", "card", "shortlist", "demonstrated", "lines", "buttons", "reason", "unknown"],
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
        // A television's home has nine named fields. Everything else this product needs goes
        // here, named by the model: capacity, loading type, covered balcony, water pressure.
        facts: {
          type: "ARRAY",
          nullable: true,
          description: "anything that matters for THIS product and has no field above",
          items: {
            type: "OBJECT",
            required: ["name", "value"],
            properties: { name: { type: "STRING" }, value: { type: "STRING" } },
          },
        },
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
    unknown: {
      type: "BOOLEAN",
      description: "true when FACTS do not hold what they asked for, so a human has to answer it",
    },
  },
} as const;

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
  const response = await modelRequest(
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
  // Whisper on fal where there is a key, because Gemini's free tier is 20 requests a day and a
  // voice note is the one thing an associate sends when their hands are full. Whisper returns the
  // words and nothing else, which is all the rest of this file wants: the card is then read from
  // those words exactly as it is from typed ones, by the extractor first and the manager after.
  const fal = falConfig();
  if (fal) return { transcript: await falTranscribe(fal, audio, request), card: {} };
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw Error("Missing GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  const response = await modelRequest(
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

/** Viewing distance sizes a screen. It means nothing for a washing machine, so it is required
 *  only where the thing being sold has a screen at all — which the catalogue says by carrying a
 *  size in inches. Six hardcoded questions could not know the difference; this can. */
export function needsSizing(pack: Pack, session?: Session): boolean {
  const shortlisted = session?.shortlist?.length
    ? pack.products.filter((product) => session.shortlist.includes(product.sku))
    : pack.products;
  return shortlisted.some((product) => product.size_inch > 0);
}

export function assessedFor(pack: Pack, session: Session): boolean {
  return isAssessed(session.card, needsSizing(pack, session));
}

export function isAssessed(card: Session["card"], sizing = true): boolean {
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
  // A fact the model had to name itself counts as much as one we thought of in advance.
  filled.push(...Object.keys(card.facts ?? {}));
  // How far they sit is what sizes the screen, so "not sure" there leaves the home unassessed —
  // where a screen is what is being sold.
  const hasDistance = typeof card.distance_m === "number" || typeof card.distance_feet === "number";
  return filled.length >= 4 && (hasDistance || !sizing);
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
  // Three metres is ten feet. Associates on this floor say metres and the manager answers in feet,
  // and refusing that is the guard calling a unit conversion an invention. A spoken voice note in
  // Hindi — "तीन मीटर दूर बैठते हैं" — was answered with "10 foot" and refused.
  for (const pair of [...spoken]) {
    const [value, unit] = pair.split(" ");
    const measure = Number(value);
    if (!Number.isFinite(measure)) continue;
    if (unit === "metre") for (const feet of [measure * 3.28, measure * 3.3]) spoken.add(`${Math.round(feet)} foot`);
    if (unit === "foot") spoken.add(`${Math.round((measure / 3.28) * 10) / 10} metre`);
  }
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

/** What they asked for is not in the pack: the words they can say stay, the reason becomes ours,
 *  and a human is offered. Asked for something missing, the model explains itself to the associate
 *  — "not in FACTS", "I am designed not to invent" — which is this product talking about itself to
 *  somebody holding a customer. */
export function unknownReply(reply: Reply, lang: Lang): Reply {
  const words = reply.text.split("\n").filter((line) => line.trim() && !line.startsWith("↳"));
  return offerExpert({ ...reply, text: [...words, `↳ ${t(lang, "unknown.reason")}`].join("\n") }, lang);
}

/** The same offer on every reply that could not answer: one more button, never a second copy. */
export function offerExpert(reply: Reply, lang: Lang, when = true): Reply {
  const buttons = reply.buttons ?? [];
  if (!when || buttons.some((button) => button.id === "ask_expert")) return reply;
  return { ...reply, buttons: [...buttons, { id: "ask_expert", title: t(lang, "btn.expert") }] };
}

export function moneySafe(text: string): string {
  return text.replace(/","\s?(?=[\d₹])/g, "Rs ").replace(/\bRs\s+₹/g, "Rs ");
}

export function pretty(reply: Reply): Reply {
  const money = (part: string): string => part.replace(/\bRs\s?([\d,]+)/g, "*Rs $1*");
  const text = reply.text
    .split("\n")
    .map((line) => {
      if (line.startsWith("↳")) return `_${line}_`;
      // A quote only counts as the sentence to speak where our own replies put one: straight after
      // a colon and running to the end of the line. A loose rule paired the inch marks in
      // `Sony 55" LED · LG 65" LED` and emboldened the gap between two televisions.
      const spoken = line.match(/^(.*?: )"(.+)"([\s.]*)$/);
      if (spoken) return `${spoken[1]}"*${spoken[2]}*"${spoken[3]}`;
      // One weight per line. A label and its three rupee figures all emboldened is four bold spans
      // in one line, which reads as litter rather than emphasis.
      const colon = line.indexOf(":");
      return colon > 0 && colon <= 24 ? `*${line.slice(0, colon + 1)}*${line.slice(colon + 1)}` : money(line);
    })
    .join("\n");
  return { ...reply, text };
}

export function floor(reply: Reply): Reply {
  const lines = reply.text.split("\n").filter((line) => line.trim());
  // When something has to go, the reason goes last and the words to say survive.
  const reason = lines.findLast((line) => line.startsWith("↳"));
  const said = lines.filter((line) => !line.startsWith("↳"));
  const kept = reason ? [...said.slice(0, 2), reason] : said.slice(0, 3);
  const buttons = (reply.buttons ?? []).slice(0, 3);
  // Formatted after the trim, never before: the reason is found by its ↳, and an italic marker in
  // front of it hid the line from the rule that exists to protect it.
  //
  // A blank line between each part, because WhatsApp renders one as space and three lines run
  // together is a wall of text on a phone held in one hand. The contest's limit is three lines of
  // something to read, and a blank line is not one of those.
  return pretty({
    text: kept.join("\n\n").slice(0, 1000),
    ...(buttons.length ? { buttons } : {}),
  });
}

export function render(decision: Decision): Reply {
  const options = decision.step === "recommend";
  const lines = (decision.lines ?? [])
    .map((line) => moneySafe(line).trim())
    .filter(Boolean)
    .slice(0, options ? 3 : 2);
  const reason = moneySafe(decision.reason ?? "").trim();
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

function prompt(event: Event, session: Session, pack: Pack, tapped?: string, notes: string[] = []): string {
  const facts = factsFor(pack, session.card, session.shortlist);
  // The arithmetic the model should not do in its head, and only where a screen is being sold.
  // The sizes we can actually hand over, beside the rule of thumb. Told only the rule, it answered
  // a real associate "6 फीट की दूरी के लिए 43 इंच का टीवी सही रहेगा" — and this shop has no 43.
  const sizes = [...new Set(pack.products.filter((p) => p.stock_units > 0).map((p) => p.size_inch))]
    .sort((a, b) => a - b)
    .join(", ");
  const sizeHint = !needsSizing(pack, session)
    ? ""
    : [
        session.card.distance_feet
          ? `At ${session.card.distance_feet} feet, about ${recommendedInches(session.card.distance_feet)} inch fits.`
          : "Viewing distance is still unknown, and it is what sizes a screen.",
        sizes ? `In stock today, in inches: ${sizes}. Never name a size that is not on that list.` : "",
      ]
        .filter(Boolean)
        .join(" ");
  // What is not on the card yet. Not an order to follow and not a question: the manager picks
  // which of these is worth asking this customer, and whether to ask anything at all.
  const card = session.card as Record<string, unknown>;
  // Feet or metres, it is one fact: listing "distance_feet" as blank after they said three metres
  // is how you ask somebody the same thing twice.
  // A television's blanks are not a washing machine's: asking after the mount and the set-top box
  // is noise once the thing being sold has no screen. The generic half is always worth having.
  const screenGaps = ["distance", "light", "mount", "content", "devices"];
  const gaps = ["room", "distance", "light", "mount", "content", "devices", "family", "internet", "budget_rupees"]
    .filter((field) => needsSizing(pack, session) || !screenGaps.includes(field))
    .filter((field) =>
      field === "distance" ? !stated(card.distance_feet) && !stated(card.distance_m) : !stated(card[field]),
    )
    .join(", ");
  const gate =
    assessedFor(pack, session) && session.demonstrated
      ? "The home is assessed and a spec has been demonstrated, so offers and finance are open."
      : "The home is NOT yet assessed or nothing has been demonstrated. Do not mention offers, discounts, exchange or finance.";
  return [
    `FACTS (the only source of prices, offers, stock, finance and specs):\n${facts}`,
    `TODAY'S BRIEF:\n${JSON.stringify(pack.shift_brief)}`,
    `HOME CARD SO FAR:\n${JSON.stringify(session.card)}`,
    `STEPS DONE: ${session.steps_done.join(", ") || "none"}. CURRENT STEP: ${session.step}.`,
    sizeHint,
    // Once they have confirmed the card the blanks stop being the point: a manager who has been
    // told enough moves on. Listing them had it asking about the home internet after the card was
    // agreed, with the customer standing there waiting to be shown a television.
    session.card_confirmed
      ? "The card is confirmed. Do not go back to gathering."
      : gaps
        ? `STILL BLANK ON THE CARD: ${gaps}`
        : "The card is full.",
    gate,
    // What the code knows and the model does not: a fact just filed, a gate just hit, a tap. The
    // questions used to be written here in a fixed list of six, which is a questionnaire with a
    // chat window around it. The manager asks; this only says what has just happened.
    notes.length ? `JUST NOW:\n- ${notes.join("\n- ")}` : "",
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
  delete session.subject;
  session.card_confirmed = false;
  session.assessed = false;
  session.demonstrated = false;
  session.shortlist = [];
  session.steps_done = session.steps_done.filter((step) => step === "brief");
  session.step = "assess";
  session.history = [];
}

export function deterministic(event: Event, session: Session, pack: Pack, notes: string[] = []): Reply | null {
  const note = (line: string): null => {
    if (!notes.includes(line)) notes.push(line);
    return null;
  };
  if (wantsNewCustomer(event.text, event.action)) {
    startInteraction(session);
    return { text: `${t(session.language, "newcustomer")}\n↳ ${t(session.language, "why.newcustomer")}` };
  }
  if (event.action === "card:confirmed") {
    session.card_confirmed = true;
    if (!session.steps_done.includes("assess")) session.steps_done.push("assess");
    return note("They just confirmed the home card is right. Carry on from there.");
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
  if (wantsRecommend(event.text, event.action) && assessedFor(pack, session)) {
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
    !assessedFor(pack, session) &&
    !Object.keys(extractCard(event.text ?? "")).length
  )
    return note(
      "They want the three options, but the home is not assessed yet. Ask for the one thing you most need to size this up, in your own words.",
    );
  // Section 6: finance in one sentence with its full cost. It is arithmetic over the pack's terms,
  // and it sits behind the same gate as every other money conversation.
  if (wantsFinance(event.text, event.action)) {
    if (!(assessedFor(pack, session) && session.demonstrated))
      return note(
        "They asked about EMI or finance before the home is known and a difference shown. Do not open money. Ask what you still need instead.",
      );
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
    return productReply(product, session.language, assessedFor(pack, session));
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
  return productReply(product, session.language, assessedFor(pack, session));
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
  // The catalogue is 8,383 products; the pack is whatever this conversation is about. Searched on
  // the associate's own words, cached by query, and left exactly as it was when the catalogue is
  // not configured or has nothing to say. A failure here must not cost them the turn: they are
  // standing with a customer, and yesterday's pack answers better than an apology.
  // A tap carries no words, and three taps in a row were enough to lose the conversation: the
  // pack fell back to the four stub televisions and a washing machine customer was asked how far
  // they sit from the TV, three turns running. So what the conversation is about is remembered,
  // and only replaced when new words actually find something.
  const about = (event.text ?? "").trim();
  // Notes exist before the search: a search that matched nothing is as worth telling the model as
  // a card field just filled.
  const notes: string[] = [];
  // A command is not a product. Searching "recommend" returned a USB hub, which then became what
  // the conversation was about and was offered as the one thing to show.
  const isCommand =
    wantsRecommend(about, undefined) ||
    wantsFinance(about, undefined) ||
    wantsBrief(about, undefined) ||
    wantsNewCustomer(about, undefined) ||
    wantsFollowThrough(about, undefined) ||
    wantsVisitLog(about, undefined) ||
    wantsExpert(about, undefined) ||
    wantsManagerView(about, undefined);
  // Searched once per customer, not once per sentence. Every substantive turn used to re-search
  // on its own words — "hot water tap is there, they wash cottons daily" found whatever it found,
  // and that became what the conversation was about, which put screens back in a washing machine
  // pack and left the home unassessable. A new customer clears it; nothing else needs to.
  // A greeting is not a product. "Hello" was searched, matched four Asus laptops, and became what
  // the conversation was about for every turn after it. Filler-only turns never reach the store.
  if (!session.subject && words(about).length > 0 && !isCommand) {
    try {
      const found = await searchPack(pack, about);
      if (found !== pack) {
        pack = found;
        session.subject = about;
      }
    } catch {
      // A miss is an answer, not a failure: the loose first page of the catalogue is whatever the
      // store sorted first (a fridge, a television, resQ plans), and answering an iPhone question
      // from it is how this associate was told about televisions instead.
      notes.push(
        `The catalogue search for ${JSON.stringify(about).slice(0, 70)} matched nothing. FACTS has no product for what they asked about. Do not name any other product instead: say you cannot see it in what we can search, point them to the shelf tag or the ASM, and set "unknown" true so a human finds out.`,
      );
    }
  } else if (session.subject) {
    // A few words naming something ("what about iphone") is a change of subject, not a fact for
    // the card. The pack follows only when the catalogue answered with something that carries the
    // words actually said — "8 feet" and "on the wall" must not drag the pack away. A miss keeps
    // the conversation they were already having.
    // The cap is there to stop a description of the home — "hot water tap is there, they wash
    // cottons daily" — from becoming what the conversation is about. Four words was too tight: a
    // plain question is longer than that, and "Do we have any phones right now?" is seven, so a
    // phones question was answered with the televisions from the turn before. What actually keeps
    // a home fact out is the check below, that the products found carry the words said.
    // shortcut: a word count, not an understanding of the sentence; replace it if a long home
    // description ever starts matching real products.
    const named = words(about).length > 0 && !isCommand && about.split(/\s+/).length <= 10;
    let changed = false;
    if (named) {
      try {
        const found = await searchPack(pack, about);
        if (found !== pack && aboutTheWords(words(about), found.products)) {
          pack = found;
          session.subject = about;
          changed = true;
        }
      } catch {
        // This turn's words matched nothing; the conversation keeps its subject.
      }
    }
    if (!changed)
      pack = await searchPack(pack, session.subject).catch(() => {
        // The subject stopped finding anything, so it was never a product: conversations started
        // before greetings became filler have "Hello" stored as what they are about. Forget it,
        // and the next turn is free to name the real one.
        delete session.subject;
        return pack;
      });
  }
  // What has just happened, for the model to answer around. Nothing in here is a question.
  // Set once a home fact has been filed this turn. The product sheet must not win after that: it
  // carries a price, and "they sit 3 m away and want a Samsung" is the home, not a price request.
  let filed = false;
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
  if (tapped && !deterministic(event, session, pack, notes)) {
    session.assessed = assessedFor(pack, session);
    // A filled card gets read back for correction; anything else goes on to the model, which
    // decides what is worth asking next. The tap itself is already in the prompt.
    if (session.assessed && !session.card_confirmed) {
      const reply = cardSummary(session);
      session.history.push({ who: "associate", text: String(event.action).slice(0, 300) });
      session.history.push({ who: "storeiq", text: reply.text.slice(0, 300) });
      return reply;
    }
    notes.push(`Saved to the card from their tap: ${tapped}.`);
  }
  // "Not sure" is a real answer: it fills nothing and moves on.
  const skipped = event.action?.match(/^skip:([a-z_]+)$/);
  if (skipped) {
    (session.card as Record<string, unknown>)[skipped[1]!] = NOT_STATED;
    notes.push(`They do not know the ${skipped[1]!.replace(/_/g, " ")}. It stays blank; work without it.`);
  }
  // A request to switch language is a whole turn on its own.
  if (switched && (event.text ?? "").trim().split(/\s+/).length <= 4)
    return { text: t(session.language, "lang.switched") };
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
    // A tap carries no words, and the "Find out for me" button is now the usual way this is
    // reached, so the question was being logged empty: the manager portal showed an escalation
    // with nothing in it. What they asked is the last thing they said.
    const question = (
      event.text ??
      [...session.history].reverse().find((turn) => turn.who === "associate")?.text ??
      ""
    ).slice(0, 400);
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
  if (intent === "greeting" && !deterministic(event, session, pack, notes)) return greetingReply(session.language);
  if (intent === "question" && event.text && !deterministic(event, session, pack, notes)) {
    // Asked about one set, or about a figure on a label: both are already answered from the pack.
    // But a summary of the set is the wrong answer to "what warranty comes with it", so a question
    // about something specific goes on to the model, which has the charges and terms in front of it.
    if (!asksSomethingSpecific(event.text)) {
      const named = packAnswer(pack, event.text, session, "set");
      if (named) return named;
    }
    // "do we have any offers on that" says "have", and the floor listing answered it with six
    // iPhones and a question. An offer is one of the specific topics the model holds, like the
    // warranty and the delivery, so it goes there rather than to a list of what is on the wall.
    if (asksWhatWeHave(event.text) && !asksSomethingSpecific(event.text))
      return inStockReply(pack, session.card, session.language, assessedFor(pack, session));
    // Anything else falls through to the model, which answers from the facts and is still held to
    // the floor's shape and to the figures in the pack.
  }
  // Read what we confidently can from the words before spending a request on them.
  if (
    intent !== "question" &&
    event.text &&
    !event.image &&
    !event.audio &&
    !deterministic(event, session, pack, notes)
  ) {
    // What the model heard, with what the extractor can read from the same words on top: the
    // extractor only takes what it is sure of, so where both spoke, the stricter one wins.
    const read = { ...heard, ...extractCard(event.text) };
    const fields = Object.entries(read).filter(
      ([, value]) => value !== undefined && !(Array.isArray(value) && !value.length),
    );
    if (fields.length) {
      for (const [field, value] of fields) (session.card as Record<string, unknown>)[field] = value;
      session.assessed = assessedFor(pack, session);
      if (!session.steps_done.includes("assess") && session.assessed) session.steps_done.push("assess");
      // A full card is read back for correction. Short of that the facts are filed and the turn
      // goes to the model, because what is worth asking next is a judgement, not a list.
      if (session.assessed && !session.card_confirmed) {
        const reply = cardSummary(session);
        session.history.push({ who: "associate", text: event.text.slice(0, 300) });
        session.history.push({ who: "storeiq", text: reply.text.slice(0, 300) });
        session.history = session.history.slice(-12);
        return reply;
      }
      notes.push(`Read from their own words and saved: ${describe(Object.fromEntries(fields))}.`);
      filed = true;
    }
  }
  // The customer is standing at one set, or asked what a figure on its label means. Both are pack
  // facts, and both run after the card extractor so a home fact in the same message still wins.
  if (intent !== "question" && event.text && !event.image && !event.audio && !filed) {
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
  const free = deterministic(event, session, pack, notes);
  if (free) {
    session.history.push({
      who: "associate",
      text: (event.text ?? event.action ?? "").slice(0, 300),
    });
    session.history.push({ who: "storeiq", text: free.text.slice(0, 300) });
    session.history = session.history.slice(-12);
    return free;
  }
  // Text only, now. A voice note became the words that were said before anything above ran, and a
  // photo is answered from the pack and never reaches here, so this call is for a sentence no
  // deterministic path could read — which, since the written questions went, is most turns.
  //
  // fal.ai's router when FAL_KEY is set, Gemini otherwise. The router is the paid path and costs
  // about a hundredth of a US cent a turn; Gemini's free tier is 20 requests a day, which is no
  // longer a product. Gemini keeps the voice note and the photo either way: the router takes
  // neither audio nor images.
  const asked = prompt(event, session, pack, tapped, notes);
  const fal = falConfig();
  let text: string;
  if (fal) {
    // No response schema on this endpoint, so the shape is asked for in words and read tolerantly.
    const answered = await falText(fal, `${SYSTEM}\n\n${shapeInstruction(schema)}`, asked, request);
    if (process.env.STOREIQ_DEBUG === "1")
      console.log(`fal ${fal.model} $${answered.cost.toFixed(6)} RAW>>>`, answered.text, "<<<RAW");
    text = answered.text;
  } else {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw Error("Missing GEMINI_API_KEY");
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
    const response = await modelRequest(
      request,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: asked }] }],
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
    const written: string | undefined = body?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text)
      .filter((value: unknown) => typeof value === "string")
      .join("");
    if (typeof written !== "string" || !written.trim())
      throw Error(
        `Empty Gemini response${body?.promptFeedback?.blockReason ? `: ${body.promptFeedback.blockReason}` : ""}`,
      );
    if (process.env.STOREIQ_DEBUG === "1") console.log("RAW>>>", written, "<<<RAW");
    text = written;
  }
  const decision = readJson<Decision>(text);

  // Merge the card before the gate: this turn's answers count towards being assessed.
  const extra = (decision.card as { facts?: { name?: string; value?: string }[] })?.facts;
  if (Array.isArray(extra))
    for (const fact of extra)
      if (fact?.name && fact?.value)
        session.card.facts = {
          ...session.card.facts,
          [String(fact.name).slice(0, 40)]: String(fact.value).slice(0, 80),
        };
  for (const [field, value] of Object.entries(decision.card ?? {}))
    if (field === "facts") continue;
    else if (value !== null && value !== undefined && !(Array.isArray(value) && !value.length))
      (session.card as Record<string, unknown>)[field] = value;
  session.shortlist = (decision.shortlist ?? [])
    .filter((sku) => pack.products.some((product) => product.sku === sku))
    .slice(0, 3);
  session.assessed = assessedFor(pack, session);
  if (decision.demonstrated) session.demonstrated = true;
  if (STEPS.includes(decision.step)) {
    session.step = decision.step;
    if (!session.steps_done.includes(decision.step)) session.steps_done.push(decision.step);
  }

  // Section 3: show what was understood and allow correction before the card drives a recommendation.
  if (!session.card_confirmed && session.assessed && ["recommend", "complete", "close"].includes(decision.step))
    return cardSummary(session);

  let reply = render(decision);
  // What the associate has told us, this turn and before: the card holds nothing they did not say
  // or tap, and a figure they gave in one turn is still theirs in the next.
  const told = [
    typeof session.card.distance_feet === "number" ? `${session.card.distance_feet} feet` : "",
    typeof session.card.distance_m === "number" ? `${session.card.distance_m} metre` : "",
    typeof session.card.budget_rupees === "number" ? `Rs ${session.card.budget_rupees}` : "",
    // Anything the model filed under its own name is still something the associate said. The
    // budget went in as a fact rather than budget_rupees, and quoting it back was refused.
    ...Object.values(session.card.facts ?? {}),
  ].filter(Boolean);
  const said = [event.text, event.action, ...told].filter(Boolean).join(" ");
  // A manager who does not know the answer finds out. The question goes to the named expert and
  // comes back as a notice, so the associate is not left with "I do not have that".
  //
  // The reason line is written here rather than left to the model: asked for something missing it
  // explains itself to the associate — "not in FACTS", "I am designed not to invent" — which is
  // this product talking about itself to somebody holding a customer.
  if (decision.unknown && store) reply = unknownReply(reply, session.language);
  const bad = unsupportedNumbers(reply.text, allowedNumbers(pack), said);
  if (bad.length)
    reply = offerExpert(
      {
        text: `That figure is not in today's data pack, so I will not say it.\n↳ Check the shelf tag or the manager before quoting ${bad[0]}.`,
      },
      session.language,
      !!store,
    );
  else if (offerLeaked(reply.text, session.assessed, session.demonstrated))
    reply = {
      // The gate is the code's and the words after it are the manager's: this used to borrow the
      // next written question, which put the questionnaire back in by the side door.
      text: `${t(session.language, "gate.offers", { body: t(session.language, "gate.offers.ask") })}\n↳ Our associates led with price in 6 of 6 visits; the home has to come first.`,
    };
  session.history.push({
    who: "associate",
    text: (event.text ?? event.action ?? (event.audio ? "voice note" : "photo")).slice(0, 300),
  });
  session.history.push({ who: "storeiq", text: reply.text.slice(0, 300) });
  session.history = session.history.slice(-12);
  return reply;
}
