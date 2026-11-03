import { randomUUID } from "node:crypto";
import { modelRequest, providerRequest, readLimited } from "./http.js";
import {
  allowedNumbers,
  canonUnit,
  factsFor,
  pairsIn,
  readSearch,
  searchPack,
  spellOut,
  type Pack,
  type Search,
} from "./pack.js";
import { catalogConfig } from "./catalog.js";
import { falConfig, falText, falTranscribe, readJson, shapeInstruction } from "./fal.js";
import { greetingReply, isGreeting } from "./ask.js";
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
import { askedToSwitchLanguage, INDIAN_SCRIPT, INDIAN_WORDS, languageFrom, t, type Lang } from "./i18n.js";
import { expertReply, managerView, newReference, wantsExpert, wantsManagerView } from "./extras.js";
import {
  briefAnswer,
  cardSummary,
  followThrough,
  reviewReply,
  shiftBrief,
  siteNeeds,
  wantsBrief,
  wantsFollowThrough,
  newCustomerRest,
  wantsNewCustomer,
  wantsReview,
} from "./steps.js";
import type { Event, Reply, Session, Step } from "./types.js";
import { STEPS } from "./types.js";

const SYSTEM = `You are Store IQ. Think of yourself as the floor manager of a Reliance Digital store, on WhatsApp. The person messaging you is one of your associates, on the shop floor, holding their phone in one hand.

They come to you for whatever they do not know. Sometimes that is a customer standing in front of them. Sometimes it is a question about a product, a price, an offer, what is available, or what to say to someone who is wavering. Sometimes they are just starting their shift and say hello. Answer whichever it is, like a manager who knows the floor — not like a form.

FACTS is what the live Reliance Digital catalogue returned just now for what they said. You are connected to it. Never say you have no access, no catalogue, no live data or no system.

How to be:
- Talk to the associate the way a good manager talks: short, plain, direct, no greeting rituals and no selling at them. If they say hello, ask what is going on with them, the way you would in the aisle.
- Answer the question they actually asked, about the exact thing they asked about. The search is loose, so FACTS can hold neighbours of what they named: an iPhone 18 Pro is not an iPhone 18 Pro Max, and a case is not a phone. If what they named is in FACTS, talk about that. If it is not, say plainly that this one is not coming up, set "unknown" true, and only then name the nearest thing, as a different product.
- A direct question gets its answer FIRST, in the same reply, out of FACTS: what it costs, whether it is available, what the spec is, whether an offer is running. Asked what there is, which are good, to show something, or for the details or current data on something, name up to three from FACTS, each with its price and one reason. "We have several Samsung phones, what will they use it for?" is wrong, because it names nothing and costs the customer a turn; "Samsung A27 5G, Rs 36,595, 50 MP camera. M17e 5G, Rs 19,990, 6000 mAh battery." is right, and a question can follow it. Never answer a direct question with only a question.
- A customer who has decided gets served, not interviewed. "I want to buy an iPhone 18 Pro 256 GB" gets the price, whether it is available or on pre-order, and the one choice left to make from FACTS, such as the colour. Do not gather anything else, and offer the "select:" button so the associate can close it.
- Ask a question only if its answer would change what you show this customer, and ask about the product in front of them. For a phone that is what they will use it for most, games, camera, battery, storage or budget. How many people will use a phone, whether it is for the family or the kids, and which phone they had before change nothing, so never ask them. A question about the room or the wall is only for something that goes in a room or on a wall. One question at a time, and stop as soon as you have enough to be useful.
- With a customer who has not decided, the order that works is: find out what they need from this kind of product, correct a wrong belief kindly, turn a spec into something about their use, show three options with one reason and one difference each, give the full cost, close with consent, then the follow-up. Keep them in that order when it is slipping, but as a nudge, not a script.
- Hand them words to say out loud, in their words, not instructions about selling. A question for the customer is prefixed "Ask:" — Ask: "Which colour would you like?"
- Everything you say is to the ASSOCIATE. The customer is standing in front of them and never talks to you.
- Each product in FACTS has offers_on_it: everything running on that product today, discount, card and bank offers and free gifts together. Asked about offers on a product, say what its own offers_on_it says. Only when that list is empty is the answer that none is showing on it today, and then say that plainly. Never say none and name one in the same reply. Never mention an offer, an exchange or an EMI that is not on the list, not even as something you could go and check.

Hard rules, never bent:
- Never invent a figure. Not a price, not an offer, not stock, not a finance term, not a specification, and not a warranty length, a delivery time, a today's target or a count of anything. FACTS says whether something is available (in_stock), not how many: never state a number of units. Installation, delivery, a wall mount or a service is not free, not included and not charged separately unless FACTS says so: when it does not, say the installation charge is not showing and the service desk has it. A feature FACTS does not mention is not a feature the product lacks: say it is not listed, never "it does not have one". If it is not in FACTS, say this is not showing and tell them who has it — the shelf tag, the ASM, the service desk. Set "unknown" true on any turn where you could not answer what they asked, and they will be offered a human who can.
- Plenty of what they bring you is not a sale at all: a customer losing their temper, a set that came back faulty, a shift, a leave, something they have forgotten how to do, a bad morning. Answer that as their manager, in their words. Do not file anything about a customer from it, do not steer it back to a product, and "unknown" stays false.
- Never OPEN offers, discounts, exchange or finance yourself before you know what the customer needs and a difference has been shown. Our associates led with price in 6 of 6 store visits; that is the habit you exist to break. But when the associate asks you outright whether something is running, answer them from FACTS. Refusing a question you were asked is not coaching.
- Never guess a customer's wealth or level from how they look. The associate sets that.
- At most 2 short lines, except three options which take three lines. At most 3 buttons. They read this at a glance, out loud, with a customer waiting.
- "reason" is one short line the associate reads silently: why this question, option, correction or demo fits this customer, or why it comes now. It starts from something this customer said or does, and ends with what it means for what to say or show: "They said the kids watch cartoons all day, so the panel matters more than the sound." and "Dad watches cricket, so a fast-moving ball is the thing to show." are right. It never describes the conversation, what the customer has given or asked, or what you are doing: "Customer has given a budget, so showing options in range", "The customer has a wrong belief" and "The customer has decided and is asking about offers" are all wrong. No figures in it. When the turn is not about a customer, or there is nothing to explain, reason is null.
- A button is what the associate would really tap next in THIS conversation: an answer to the question you just asked, or the next thing to do. Its title is at most 20 characters, counted, and is the words tapping it says, so it must make sense on its own as their next message to you: "Any offers on it?" and "Show more" work, and a question you would be asking them, such as "What's their budget?", does not. After a question, each button is a real answer the customer could give, not a topic: for "What will they use it for most?" that is "Gaming", "Camera", "Battery life", and never "Budget", "Usage", "Brand". To pick a product to sell, its id is "select:<sku>" with a sku from FACTS and its title tells it apart from the others, such as "Silver" or "LG 7 Kg", with no price. Every other button leaves the id empty. Never a specification, a price, or a fact you have just stated. If no button would really be tapped, send none: no buttons is better than filler. Buttons must be different from each other.
- Write money as "Rs 54,990", never the rupee sign: it does not survive JSON mode. Group it the Indian way — "Rs 3,14,900" and "Rs 1,79,900", never "Rs 314,900".
- Answer in the same language and script they just used. Latin script in, Latin script out. Never switch them to Devanagari on your own.`;

/** One search of the store out of what was said. Understanding the message is the model's job: a
 *  list of filler words was what searched "current data" for a question about an iPhone. */
const SEARCH_SYSTEM = `You turn a message from a Reliance Digital store associate into one search of the store's product catalogue. You write no reply to anyone.

q is the words of the product only: brand, model, size, capacity, variant, as the store would name it, in English. "iphone 18 pro 256 gb", "sony 85 inch tv", "samsung double door fridge", "front load washing machine". The store searches product names, not sentences, so words like want, buy, price, offer, stock, current, latest, today, customer and data never go in q. Keep every word that narrows the product: leaving out "256 gb" finds the wrong one.
kind is what the thing is, as one plain singular noun a shop would use: phone, television, refrigerator, washing machine, air conditioner, laptop, tablet, watch, soundbar. It is null if the message does not say.
sort_on is "price_asc" only when they ask for the cheapest, "price_dsc" only for the most expensive, "discount_dsc" only for which has the biggest discount, "latest" only for the newest, otherwise null. "What do they cost", "what is the price", "any offers on it" and "is there a discount" are not any of those: null.
max_price is a budget in rupees they stated for this product, otherwise null.
page_no is only for asking to see more of the same search: the last page_no plus one.

LAST SEARCH is what the conversation is on. A message about the same thing — "it", "this one", its price, colours, warranty, offers — repeats LAST SEARCH exactly. A message that narrows it ("the 512 GB one", "the silver one") adds those words to its q. What the customer will use it for or wants from it ("gaming", "good camera", "for my mother") is not in a product's name, so it never goes in q: that message repeats LAST SEARCH too. A message naming a different product is a new search. A message that is not about any product, and has no LAST SEARCH to stay on, has q null. Hindi, Marathi and Hinglish are understood the same way.`;

export type Decision = {
  step: Step;
  card: Record<string, unknown>;
  shortlist: string[];
  demonstrated: boolean;
  lines: string[];
  buttons: { id: string; title: string }[];
  /** Set when the answer is not in the pack. A manager who does not know says they will find out,
   *  so the reply carries the button that puts the question to a human. */
  unknown?: boolean;
  objection?: string | null;
  /** Why this is the right thing to say to this customer now: the contest scores a reason in each answer. */
  reason?: string | null;
};

const schema = {
  type: "OBJECT",
  // "unknown" is required or the model simply leaves it out: it said "I do not have that"
  // in prose and reported nothing, so no human was ever offered.
  required: ["step", "card", "shortlist", "demonstrated", "lines", "buttons", "unknown"],
  properties: {
    step: { type: "STRING", enum: [...STEPS] },
    card: {
      type: "OBJECT",
      properties: {
        budget_rupees: { type: "NUMBER", nullable: true },
        facts: {
          type: "ARRAY",
          nullable: true,
          description:
            "what the customer said they need from this product, such as main use or capacity. Not the product they named, not its colour or storage.",
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
      description: "true when this turn turned a spec into a line about this customer's use",
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
    unknown: {
      type: "BOOLEAN",
      description: "true when FACTS do not hold what they asked for, so a human has to answer it",
    },
    objection: {
      type: "STRING",
      nullable: true,
      description: "a doubt or wrong belief the customer raised this turn, in plain words, for the manager's report",
    },
    reason: {
      type: "STRING",
      nullable: true,
      description:
        "one short line on why this fits THIS customer or why to do it now, no figures. null when there is no customer move to explain",
    },
  },
} as const;

const searchSchema = {
  type: "OBJECT",
  required: ["q"],
  properties: {
    q: { type: "STRING", nullable: true },
    kind: { type: "STRING", nullable: true },
    sort_on: { type: "STRING", nullable: true },
    max_price: { type: "NUMBER", nullable: true },
    page_no: { type: "NUMBER", nullable: true },
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
  // fal where there is a key, because Gemini's free tier is 20 requests a day and a voice note is
  // the one thing an associate sends when their hands are full. It returns the words and nothing else, which is all the rest of this file wants: the card is then read from
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

// No \b on the Devanagari: in JavaScript a word boundary only knows ASCII, so a question in Hindi was
// never an offer question, and the model was told not to bring offers up while being asked for them.
const OFFER_WORDS =
  /\b(offer|discount|exchange|emi|finance|cashback|instant|no.cost|bonus|scheme|deal|sale|chhoot)s?\b|ऑफ\u093c?र|छूट|डिस्काउंट|ईएमआई|एक्सचेंज|कैशबैक/i;
/** A figure beside the offer word is the difference between quoting a deal and declining to. */
const A_FIGURE = /₹|\d+\s?%|\b\d{3,}\b/;

/** Whether the associate asked about an offer in their own words. A question deserves its answer:
 *  the gate exists to stop the product LEADING with price, which the store visits found in 6 of 6
 *  conversations, not to refuse a manager who was asked outright. Decided by the user 2 Nov 2026,
 *  after a customer who had decided was asked five more questions instead of being told. */
export function askedAboutOffers(said: string | undefined): boolean {
  return !!said && OFFER_WORDS.test(said);
}

/** Saying there is NO offer is not opening one. "The iPhone 17 256 GB is Rs 99,900. There are no
 *  offers running on it today." was replaced with "Offers come after the home": the gate read the
 *  price as the offer's figure and the honest denial as the leak. */
const DENIES_OFFER =
  /\b(no|not|none|nothing|never|nahi)\b(?![\s-]*cost)[^.!?]{0,40}\b(offer|discount|exchange|emi|finance|cashback|bonus|scheme|deal|sale)s?\b|\b(offer|discount|deal|scheme)s?\b[^.!?]{0,40}\b(no|not running|none|nothing|nahi)\b|(ऑफ\u093c?र|छूट)[^।.!?]{0,40}(नहीं|नाही)/i;

export function offerLeaked(text: string, assessed: boolean, demonstrated: boolean, asked = false): boolean {
  if (asked || DENIES_OFFER.test(text)) return false;
  return !(assessed && demonstrated) && OFFER_WORDS.test(text) && A_FIGURE.test(text);
}

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
  // A fact the model had to name itself counts as much as one we thought of in advance.
  filled.push(...Object.keys(card.facts ?? {}));
  return filled.length >= 4;
}

/** Every number a text states, as exact tokens. */
export function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const token of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) found.add(Number(token[0].replace(/,/g, "")));
  // "30 to 40 thousand" is how a budget is said, and quoting it back as Rs 40,000 was refused.
  for (const [, low, high, scale] of text.matchAll(
    /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to|se|से)\s*(\d+(?:\.\d+)?))?\s*(k|thousand|hazaa?r|ह[ज\u095b]\u093c?ार|lakhs?|lacs?|लाख)(?![a-z])/gi,
  )) {
    const by = /^(lakh|lac|लाख)/i.test(scale!) ? 100_000 : 1000;
    for (const figure of [low, high]) if (figure) found.add(Number(figure) * by);
  }
  // "30 to 40,000": the thousands are only written on the second one.
  for (const [, low] of text.matchAll(/(\d{1,3})\s*(?:-|–|to|se|से)\s*\d{1,3},000\b/gi)) found.add(Number(low) * 1000);
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
  return text
    .replace(/","\s?(?=[\d₹])/g, "Rs ")
    .replace(/\bRs\s+₹/g, "Rs ")
    .replace(
      /\bRs\.?\s?(\d+(?:,\d+)*)/g,
      (_, amount: string) => `Rs ${Number(amount.replace(/,/g, "")).toLocaleString("en-IN")}`,
    );
}

export function pretty(reply: Reply): Reply {
  const money = (part: string): string => part.replace(/\bRs\s?(\d+(?:,\d+)*)/g, "*Rs $1*");
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
  // WhatsApp refuses two buttons with one title, and three Apple phones are three "Apple"s.
  const buttons = (reply.buttons ?? [])
    .filter((button, index, all) => all.findIndex((other) => other.title === button.title) === index)
    .slice(0, 3);
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

/** The ids the code acts on. Anything else a model writes is just words. */
const DOES_SOMETHING = /^(select:[A-Za-z0-9_-]+|ask_expert|new_customer|follow_through|review)$/;

export function render(decision: Decision): Reply {
  // Three, whatever step the model named: it says three TVs, names two, and the step was "complete".
  const lines = (decision.lines ?? [])
    .map((line) => moneySafe(line).trim())
    .filter(Boolean)
    .slice(0, 3);
  const said = lines.length ? lines : ["Tell me what the customer said and I will give you the next question."];
  const reason = typeof decision.reason === "string" ? moneySafe(decision.reason.replace(/^\s*↳\s*/, "")).trim() : "";
  // Only under three lines: three options already carry a reason each, and floor() would cut the third for it.
  const text = [...said, ...(reason && lines.length && lines.length < 3 ? [`↳ ${reason}`] : [])]
    .join("\n")
    .slice(0, 1000);
  // A tap carries no words, so a button the model wrote carries its own title as what was said: the
  // next turn reads it like typing, and nothing has to match an id the model made up. That makes a
  // cut title a different sentence ("What will they use"), so only a select button is ever cut, and
  // on a word, because "Haier 9 Kg (Rs 39,97" is what cutting anywhere else looks like.
  const buttons = (decision.buttons ?? [])
    .slice(0, 3)
    .map((button) => {
      const clean = String(button?.title ?? "")
        .replace(/\(?\bRs\.?\s?[\d,]+\)?/g, "")
        .trim();
      const id = String(button?.id ?? "").trim();
      const acts = DOES_SOMETHING.test(id);
      const title =
        acts && clean.length > 20
          ? clean
              .slice(0, 21)
              .replace(/\s+\S*$/, "")
              .slice(0, 20)
          : clean;
      return { id: acts ? id : `say:${title}`, title };
    })
    .filter((button) => button.title && button.title.length <= 20);
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
  "space",
  "family",
  "budget_rupees",
  "priorities",
  "site_constraints",
  "replacing",
]);

/** Told from the message in hand and said last, because a model follows the turns in front of it:
 *  told further up that the associate was writing English, it still answered six Hindi replies in a row. */
function languageNote(said: string | undefined, lang: Lang): string {
  const latin = !!said && !INDIAN_SCRIPT.test(said);
  const language =
    lang === "en"
      ? latin && INDIAN_WORDS.test(said!)
        ? "Hinglish, in Latin script, never Devanagari"
        : "English"
      : `${lang === "mr" ? "Marathi" : "Hindi"}, ${latin ? "in Latin script, never Devanagari" : "in Devanagari"}`;
  return `Write this reply and its buttons in ${language}, whatever language the recent turns are in.`;
}

/** Whether a reply came back in the script this message needs. The instruction above is not enough:
 *  with Hindi turns in front of it the model answered an English question in Hindi, told not to. */
export function wrongScript(reply: string, said: string | undefined, lang: Lang): boolean {
  const wantsDevanagari = lang !== "en" && (!said || INDIAN_SCRIPT.test(said));
  return wantsDevanagari === !/[\u0900-\u097f]/.test(reply) && !!reply.trim();
}

function prompt(event: Event, session: Session, pack: Pack, notes: string[] = []): string {
  const gate = askedAboutOffers(event.text)
    ? "They asked about offers or finance outright, so answer it from FACTS."
    : session.assessed && session.demonstrated
      ? "You know what they need and a spec has been demonstrated, so offers and finance are open."
      : "Do not bring up offers, discounts, exchange or finance yourself. A price is fine.";
  const picked = session.selection && pack.products.find((product) => product.sku === session.selection?.sku);
  return [
    `FACTS (the only source of prices, offers, availability, finance and specs):\n${factsFor(pack)}`,
    Object.keys(pack.shift_brief ?? {}).length ? `TODAY'S BRIEF:\n${JSON.stringify(pack.shift_brief)}` : "",
    Object.keys(session.card).length ? `WHAT THE CUSTOMER HAS SAID:\n${JSON.stringify(session.card)}` : "",
    picked ? `THEY HAVE PICKED: ${picked.name}.` : "",
    `STEPS DONE: ${session.steps_done.join(", ") || "none"}. CURRENT STEP: ${session.step}.`,
    gate,
    // What the code knows and the model does not: a gate just hit, a tap, a search that came back
    // empty. Nothing in here is a question; the manager asks.
    notes.length ? `JUST NOW:\n- ${notes.join("\n- ")}` : "",
    `RECENT TURNS:\n${
      session.history
        .slice(-6)
        .map((turn) => `${turn.who}: ${turn.text}`)
        .join("\n") || "none"
    }`,
    `THE ASSOCIATE ${event.action ? `tapped: ${event.action}` : ""}${event.text ? ` said: ${event.text}` : ""}`.trim(),
    languageNote(event.text, session.language),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** One model request, through fal when there is a key and Gemini otherwise. */
async function askModel(
  system: string,
  user: string,
  shape: Record<string, unknown>,
  request: typeof fetch,
): Promise<string> {
  const fal = falConfig();
  if (fal) {
    // No response schema on this endpoint, so the shape is asked for in words and read tolerantly.
    const answered = await falText(fal, `${system}\n\n${shapeInstruction(shape)}`, user, request);
    if (process.env.STOREIQ_DEBUG === "1")
      console.log(`fal ${fal.model} $${answered.cost.toFixed(6)} RAW>>>`, answered.text, "<<<RAW");
    return answered.text;
  }
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
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: shape,
          temperature: 0.3,
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
  return written;
}

/** What to ask the catalogue for this turn, or null when the message is not about a product. */
async function searchFrom(said: string, session: Session, request: typeof fetch): Promise<Search | null> {
  const asked = [
    `LAST SEARCH: ${JSON.stringify(session.search ?? null)}`,
    `RECENT TURNS:\n${
      session.history
        .slice(-4)
        .map((turn) => `${turn.who}: ${turn.text}`)
        .join("\n") || "none"
    }`,
    `THE ASSOCIATE SAID: ${said}`,
  ].join("\n\n");
  const text = await askModel(SEARCH_SYSTEM, asked, searchSchema, request);
  try {
    return readSearch(readJson(text));
  } catch {
    // An unreadable search is the same as none: the conversation stays on what it was on.
    return session.search ?? null;
  }
}

/** What is on the associate's screen goes back into FACTS, first, whatever this turn searched. */
export function withShown(pack: Pack, session: Session): Pack {
  const missing = (session.shown?.products ?? []).filter(
    (product) => !pack.products.some((other) => other.sku === product.sku),
  );
  if (!missing.length) return pack;
  const known = new Set(pack.offers.map((offer) => JSON.stringify(offer)));
  return {
    ...pack,
    products: [...missing, ...pack.products],
    offers: [...pack.offers, ...(session.shown?.offers ?? []).filter((offer) => !known.has(JSON.stringify(offer)))],
  };
}

/** Kept when this turn put products in front of them: the ones they can tap first, then the shortlist.
 *  A turn that names none, such as "any offers on these", leaves the last ones in place. */
export function rememberShown(session: Session, pack: Pack, skus: string[]): void {
  const products = [...new Set(skus)]
    .map((sku) => pack.products.find((product) => product.sku === sku))
    .filter((product) => !!product)
    .slice(0, 3);
  if (!products.length) return;
  const names = products.map((product) => product.name);
  session.shown = {
    products,
    offers: pack.offers.filter(
      (offer) => Array.isArray(offer.on) && offer.on.some((name: string) => names.includes(name)),
    ),
  };
}

/** Section 7: the card is interaction-scoped. A new customer gets an empty card, never the last one's. */
export function startInteraction(session: Session): void {
  session.interaction_id = randomUUID();
  session.interaction_started = new Date().toISOString();
  session.card = {};
  delete session.search;
  delete session.shown;
  session.card_confirmed = false;
  session.assessed = false;
  session.demonstrated = false;
  session.shortlist = [];
  session.steps_done = session.steps_done.filter((step) => step === "brief");
  session.step = "assess";
  session.history = [];
}

/** The turns that are the code's to answer, because they are a tap or a command rather than a
 *  question: the reset, the consent steps, the card read-back, the brief and the score. A command is
 *  the whole message; a sentence that merely starts with "today" or "review" is a question. */
export function deterministic(event: Event, session: Session, pack: Pack, notes: string[] = []): Reply | null {
  if (wantsNewCustomer(event.text, event.action)) {
    startInteraction(session);
    return { text: `${t(session.language, "newcustomer")}\n↳ ${t(session.language, "why.newcustomer")}` };
  }
  if (event.action === "card:confirmed") {
    session.card_confirmed = true;
    if (!session.steps_done.includes("assess")) session.steps_done.push("assess");
    notes.push("They just confirmed what you noted about this customer is right. Carry on from there.");
    return null;
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
    if (!pack.products.some((product) => product.sku === sku)) return { text: t(session.language, "ft.gone") };
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
  if (wantsFollowThrough(event.text, event.action)) {
    session.step = "follow_through";
    return followThrough(session, pack, event.name ?? session.phone);
  }
  // "what do you have" used to open this too, so "what do you have in Samsung phones?" got "I have
  // nothing on this home yet".
  if (event.action === "card:show" || /^\s*(card|home card|show the card)\s*[.!?]*\s*$/i.test(event.text ?? ""))
    return cardSummary(session);
  const answered = event.action?.match(/^brief:answer:(.+)$/);
  if (answered) {
    if (!session.steps_done.includes("brief")) session.steps_done.push("brief");
    return briefAnswer(pack, answered[1]!);
  }
  if (wantsBrief(event.text, event.action)) {
    session.step = "brief";
    if (!session.steps_done.includes("brief")) session.steps_done.push("brief");
    return shiftBrief(pack, session.language);
  }
  if (wantsReview(event.text, event.action)) {
    session.step = "review";
    const reply = reviewReply(session);
    if (!session.steps_done.includes("review")) session.steps_done.push("review");
    return reply;
  }
  return null;
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
  base: Pack,
  request: typeof fetch = fetch,
  store?: Store,
): Promise<Reply> {
  if (event.name) session.associate = event.name;
  // The words first, then everything that reads them. A voice note carries no text, and the
  // catalogue search reads text: a spoken "do we have the iPhone 18 Pro in stock" searched for
  // nothing, and the model reported what it honestly saw, as having no catalogue access.
  let heard: Partial<Session["card"]> = {};
  if (event.audio) {
    const spoken = await voiceNote(event.audio, request);
    heard = spoken.card;
    const said = [spoken.transcript, event.text].filter(Boolean).join(" ").trim();
    event = { ...event, ...(said ? { text: said } : {}) };
    delete event.audio;
  }
  // A button the model wrote says its own title, so the tap is treated exactly as typing it.
  const tappedWords = event.action?.match(/^say:(.+)$/s);
  if (tappedWords) {
    event = { ...event, text: tappedWords[1]! };
    delete event.action;
  }
  // "New customer asking for iPhone 17 model 256 gb any offers going on?" is one sentence: the card
  // has to be cleared AND the question answered.
  const started = wantsNewCustomer(event.text, event.action) ? newCustomerRest(event.text) : "";
  const notes: string[] = [];
  if (started.length > 3) {
    startInteraction(session);
    event = { ...event, text: started };
    notes.push("They have just started a new customer, so nothing is known about them yet.");
  }
  const remember = (reply: Reply): Reply => {
    session.history.push({ who: "associate", text: (event.text ?? event.action ?? "photo").slice(0, 300) });
    session.history.push({ who: "storeiq", text: reply.text.slice(0, 300) });
    session.history = session.history.slice(-12);
    return reply;
  };
  const switched = askedToSwitchLanguage(event.text);
  if (switched) session.language = switched;
  else if (event.text) session.language = languageFrom(event.text, session.language);
  // Asked for another language after an answer, they want that answer in it: "tell me in English"
  // got "Theek hai", and the question had to be asked again. With nothing to repeat, it says so.
  const repeating = !!switched && (event.text ?? "").trim().split(/\s+/).length <= 4;
  if (repeating) {
    if (!session.history.length) return { text: t(session.language, "lang.switched") };
    notes.push(
      "They asked for this language. Say your last answer again in it, in full, offers included, and add nothing else.",
    );
  }
  // Extra points: a store visit, in the visitor's own words. It comes before everything that reads
  // text as a customer, because a visit note is full of rooms, prices and brands.
  if (store && session.logging_visit && event.text) {
    if (!worthFiling(event.text)) return { text: t(session.language, "visit.tooshort") };
    const reference = newVisitReference();
    const where = storeNamed(event.text, base);
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
  if (store && wantsManagerView(event.text, event.action))
    return managerView(await store.today(), await store.openQuestions());
  if (store && wantsExpert(event.text, event.action)) {
    // A tap carries no words, and the "Find out for me" button is the usual way this is reached,
    // so what they asked is the last thing they said.
    const question = (
      event.text ??
      [...session.history].reverse().find((turn) => turn.who === "associate")?.text ??
      ""
    ).slice(0, 400);
    const reference = newReference();
    const { reply, area, owner } = expertReply(base, question, reference, session.language);
    await store.logQuestion({ reference, phone: session.phone, area, owner, question });
    return reply;
  }
  if (!event.action && !event.image && isGreeting(event.text))
    return greetingReply(session.language, Object.keys(base.shift_brief ?? {}).length > 0);
  for (const [field, value] of Object.entries(heard))
    if (value !== null && value !== undefined) (session.card as Record<string, unknown>)[field] = value;

  // The products this conversation is already on, so a tap or a command sees what the model saw.
  let failed = false;
  const fetchFor = async (search: Search): Promise<Pack> => {
    try {
      return await searchPack(base, search, request);
    } catch (error) {
      console.error(`Catalogue search failed: ${error instanceof Error ? error.message : "unknown"}`);
      failed = true;
      return { ...base, products: [], offers: [] };
    }
  };
  let pack = withShown(session.search ? await fetchFor(session.search) : base, session);
  if (store && event.action === "site:problem" && session.selection) {
    const needs = siteNeeds(pack, session.selection).join("; ");
    const reference = newReference();
    const question = `Site needs work before install: ${needs}`;
    const { reply, area, owner } = expertReply(pack, question, reference, session.language);
    await store.logQuestion({ reference, phone: session.phone, area, owner, question });
    return reply;
  }
  const free = deterministic(event, session, pack, notes);
  if (free) return remember(free);

  // A photo of a shelf tag: read what is printed, then treat it as being told the same words. The
  // reply is still written from the catalogue, so a misread tag cannot become an invented price.
  if (event.image) {
    const read = await labelText(event.image, request).catch(() => "");
    if (!read) return remember({ text: t(session.language, "p.unread") });
    event = { ...event, text: [`The shelf tag in their photo reads: ${read}.`, event.text].filter(Boolean).join(" ") };
    delete event.image;
  }

  // The turn: what they said becomes a search, the store's answer becomes FACTS, and the model
  // writes the reply from those. Nothing about a product is answered from a written line any more.
  if (event.text && catalogConfig()) {
    const search = await searchFrom(event.text, session, request);
    if (search) {
      failed = false;
      // A different kind of thing is a different subject: the televisions on screen are not "these phones".
      if (search.kind && session.search?.kind && search.kind !== session.search.kind) delete session.shown;
      const found = await fetchFor(search);
      // A store that did not answer gets nothing substituted, not even what it said a turn ago.
      pack = failed ? found : withShown(found, session);
      session.search = search;
      // Changing the product withdraws the consent, and the picked one is not on this search.
      if (session.selection && !pack.products.some((product) => product.sku === session.selection?.sku)) {
        delete session.selection;
        session.consent = false;
      }
      if (!failed && !found.products.length)
        notes.push(
          pack.products.length
            ? `The live catalogue search for ${JSON.stringify(search.q)} found nothing new, so FACTS holds only what is already on their screen. If they asked about something else, say it is not coming up and set "unknown" true.`
            : `The live catalogue search for ${JSON.stringify(search.q)} found no product. Say this one is not coming up in the catalogue, and to check the shelf tag or the ASM; do not name a different product, and set "unknown" true.`,
        );
    }
    if (failed)
      notes.push(
        'The catalogue did not answer just now, so FACTS has nothing. Say you cannot check it this second and to try again in a moment or use the shelf tag; do not name any product, and set "unknown" true. This is a hiccup, not a missing system.',
      );
  }
  const onScreen = (session.shown?.products ?? []).filter((product) =>
    pack.products.some((other) => other.sku === product.sku),
  );
  if (onScreen.length)
    notes.push(
      `On the associate's screen from earlier: ${onScreen.map((product) => product.name).join("; ")}. "These", "them", "it" and "the first one" mean those, unless they name something else.`,
    );

  const told = (card: Decision["card"]): string =>
    [
      event.text,
      event.action,
      typeof session.card.budget_rupees === "number" ? `Rs ${session.card.budget_rupees}` : "",
      typeof card?.budget_rupees === "number" ? `Rs ${card.budget_rupees}` : "",
      // The search read it from their words, spelled however they spelled it: "eighty thousand".
      session.search?.max_price ? `Rs ${session.search.max_price}` : "",
      // Anything the model filed under its own name is still something the associate said. The
      // budget went in as a fact rather than budget_rupees, and quoting it back was refused.
      ...Object.values(session.card.facts ?? {}),
    ]
      .filter(Boolean)
      .join(" ");
  const figuresIn = (decision: Decision): string[] =>
    unsupportedNumbers(render(decision).text, allowedNumbers(pack), told(decision.card));
  // The reason is extra: a figure in it costs the reason, never the answer.
  const reasonOnly = (decision: Decision): Decision =>
    figuresIn(decision).length && !figuresIn({ ...decision, reason: null }).length
      ? { ...decision, reason: null }
      : decision;
  const written = async (extra: string[] = []): Promise<Decision> =>
    reasonOnly(
      readJson<Decision>(await askModel(SYSTEM, prompt(event, session, pack, [...notes, ...extra]), schema, request)),
    );
  let decision = await written();
  // Told once what it got wrong, it usually just needed to read the figure again. The guard is
  // unchanged: what it refuses a second time still does not go out.
  const wrong = figuresIn(decision);
  if (wrong.length)
    decision = await written([
      `You wrote ${wrong.join(", ")}, which is not in FACTS and was not said by the associate. Answer again using only figures exactly as FACTS has them, or say that this one is not showing.`,
    ]);
  if (wrongScript(render(decision).text, event.text, session.language))
    decision = await written([
      `You wrote your last draft in the wrong language. ${languageNote(event.text, session.language)} Give the same answer, translated.`,
    ]);

  const extra = (decision.card as { facts?: { name?: string; value?: string }[] })?.facts;
  if (Array.isArray(extra))
    for (const fact of extra)
      if (fact?.name && fact?.value)
        session.card.facts = {
          ...session.card.facts,
          [String(fact.name).slice(0, 40)]: String(fact.value).slice(0, 80),
        };
  for (const [field, value] of Object.entries(decision.card ?? {}))
    if (CARD_FIELDS.has(field) && value !== null && value !== undefined && !(Array.isArray(value) && !value.length))
      (session.card as Record<string, unknown>)[field] = value;
  session.shortlist = (decision.shortlist ?? [])
    .filter((sku) => pack.products.some((product) => product.sku === sku))
    .slice(0, 3);
  session.assessed = isAssessed(session.card);
  if (decision.demonstrated) session.demonstrated = true;
  if (decision.objection && !session.objections?.includes(decision.objection))
    session.objections = [...(session.objections ?? []), String(decision.objection).slice(0, 120)];
  if (STEPS.includes(decision.step)) {
    session.step = decision.step;
    if (!session.steps_done.includes(decision.step)) session.steps_done.push(decision.step);
  }

  let reply = render(decision);
  // A pick has to be something that can be picked, or the tap fails with the customer waiting.
  const buttons = reply.buttons?.filter(
    (button) =>
      !button.id.startsWith("select:") || pack.products.some((product) => `select:${product.sku}` === button.id),
  );
  reply = { text: reply.text, ...(buttons?.length ? { buttons } : {}) };
  rememberShown(session, pack, [
    ...(buttons ?? []).filter((button) => button.id.startsWith("select:")).map((button) => button.id.slice(7)),
    ...session.shortlist,
  ]);
  // A manager who does not know the answer finds out. The question goes to the named expert and
  // comes back as a notice, so the associate is not left with "I do not have that".
  if (decision.unknown && store) reply = unknownReply(reply, session.language);
  const bad = figuresIn(decision);
  // Saying an answer again in another language is not opening anything: it was already asked.
  const asked = askedAboutOffers(event.text) || repeating;
  if (bad.length)
    reply = offerExpert(
      {
        text: `${t(session.language, "guard.figure")}\n↳ ${t(session.language, "guard.check", { v: bad[0]! })}`,
      },
      session.language,
      !!store,
    );
  else if (offerLeaked(reply.text, session.assessed, session.demonstrated, asked)) {
    // Asked the price, it gave the price and volunteered a discount. The price is what they asked
    // for, so only the line that opens the offer goes.
    const kept = reply.text
      .split("\n")
      .filter((line) => !offerLeaked(line, session.assessed, session.demonstrated, asked));
    reply = kept.some((line) => !line.startsWith("↳"))
      ? { ...reply, text: kept.join("\n") }
      : {
          // The gate is the code's and the words after it are the manager's.
          text: `${t(session.language, "gate.offers", { body: t(session.language, "gate.offers.ask") })}\n↳ ${t(session.language, "gate.reason")}`,
        };
  }
  return remember(reply);
}
