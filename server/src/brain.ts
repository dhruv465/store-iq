import { randomUUID } from "node:crypto";
import { modelRequest, providerRequest, readLimited } from "./http.js";
import {
  allowedNumbers,
  canonUnit,
  factsFor,
  carePlanFor,
  liveBrief,
  mountFor,
  pairsIn,
  readSearch,
  searchPack,
  spellOut,
  type Pack,
  type Search,
} from "./pack.js";
import { catalogConfig } from "./catalog.js";
import {
  applicableCharges,
  categoryOf,
  chargesList,
  defaultCharges,
  deliveryCharges,
  deliveryFor,
  followUpPlan,
  kmIn,
  setDelivery,
  pipeMetres,
  priceRun,
  storeDay,
  wantsFollowUps,
  wantsSold,
  withAfterSales,
} from "./aftersales.js";
import type { NewFollowUp, OpenFollowUp } from "./db.js";
import { falConfig, falText, falTranscribe, falVision, readJson, shapeInstruction } from "./fal.js";
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
  cardParts,
  itemisedTotal,
  cardSummary,
  customerSummary,
  deliveryRates,
  followThrough,
  reviewReply,
  shiftBrief,
  siteNeeds,
  wantsBrief,
  wantsFollowThrough,
  wantsReview,
} from "./steps.js";
import type { Event, HomeCard, Purchase, Reply, Session, Step, Turn } from "./types.js";
import { STEPS } from "./types.js";

const SYSTEM = `You are Store IQ. Think of yourself as the floor manager of a Reliance Digital store, on WhatsApp. The person messaging you is one of your associates, on the shop floor, holding their phone in one hand.

They come to you for whatever they do not know. Sometimes that is a customer standing in front of them. Sometimes it is a question about a product, a price, an offer, what is available, or what to say to someone who is wavering. Sometimes they are just starting their shift and say hello. Answer whichever it is, like a manager who knows the floor — not like a form.

FACTS is what the live Reliance Digital catalogue returned just now for what they said. You are connected to it. Never say you have no access, no catalogue, no live data or no system.

How to be:
- Talk to the associate the way a good manager talks: short, plain, direct, no greeting rituals and no selling at them. If they say hello, ask what is going on with them, the way you would in the aisle.
- Answer the question they actually asked, about the exact thing they asked about. The search is loose, so FACTS can hold neighbours of what they named: an iPhone 18 Pro is not an iPhone 18 Pro Max, and a case is not a phone. If what they named is in FACTS, talk about that. If it is not, say so plainly in the first line and name the nearest thing in FACTS that would serve this customer, as a different product: one FACTS holds, one step up from what they asked for (the same size in a double door, the next size up), not the top of the range. Set "unknown" true only when FACTS has nothing that could serve them.
- A direct question gets its answer FIRST, in the same reply, out of FACTS: what it costs, whether it is available, what the spec is, whether an offer is running. Asked what there is, which are good, to show something, or for the details or current data on something, name up to three from FACTS, each with its price and one reason. "We have several Samsung phones, what will they use it for?" is wrong, because it names nothing and costs the customer a turn; "Samsung A27 5G, Rs 36,595, 50 MP camera. M17e 5G, Rs 19,990, 6000 mAh battery." is right, and a question can follow it. Never answer a direct question with only a question.
- A customer who has decided gets served, not interviewed. "I want to buy an iPhone 18 Pro 256 GB" gets, in this order: two or three of its features from FACTS said as what they do for this customer (the associate is selling it, not reading a price tag), whether it is available or on pre-order, the price, and the one choice left to make from FACTS, such as the colour. Do not gather anything else, and offer the "select:" button so the associate can close it.
- A customer who only names a kind of product ("customer wants a TV", "LED TV dekhna hai", "washing machine dikhao", "show fridges") has not decided. Ask three questions about this customer before you show anything, one per reply, each with buttons that are its real answers, the way a good floor salesman does, because each answer changes what you will show. For a TV: how far from the screen they sit, on the wall or on a table, and what they watch most (sports, movies and OTT, serials and news, gaming). For a fridge: how many people at home, single or double door, and whether they stock up for the week. For a washing machine: how many people it washes for, top or front loading, and fully or semi automatic. For an AC: how big the room is, whether it gets the afternoon sun or is on the top floor, and how many hours a day it runs. For a phone: what they use it for most (camera, games, battery), how much they store, and the budget. For anything else, the three things that most change which one fits. The budget comes last, if at all. A question the customer has already answered is skipped, never asked again; ask the next one. Once WHAT THE CUSTOMER HAS SAID holds three things about this kind of product, your next reply shows the options, not a fourth question. If the associate asks to see options now, or says the customer is in a hurry, show them at once.
- Ask about the product in front of them. How many people will use a phone, whether it is for the family or the kids, and which phone they had before change nothing, so never ask them. A question about the room or the wall is only for something that goes in a room or on a wall. One question at a time, about one thing: never two joined by "or" ("what size, or what will they use it for?"), and never two lines that each ask something. Its buttons answer that question ("Sports", "Movies and OTT", "Gaming"), never name topics ("Screen size", "Main use", "Budget").
- With a customer who has not decided, the order that works is: find out what they need from this kind of product with three questions, correct a wrong belief kindly, show up to three options that fit what they said, each with a feature from FACTS as what it does for them and its price after it, with a "select:" button for each, give the full cost, close with consent, then the follow-up. Keep them in that order when it is slipping, but as a nudge, not a script.
- Hand them words to say out loud, in their words, not instructions about selling. A question for the customer is prefixed "Ask:" — Ask: "Which colour would you like?"
- Everything you say is to the ASSOCIATE. The customer is standing in front of them and never talks to you.
- What a customer said is kept under their mobile number, so their next visit starts where this one ended. Keep filling "card" with what they need exactly as before; the number changes nothing about that. CUSTOMER NUMBER says whether this one has given theirs. While it is "none yet" and they are serving a customer, write "ask_number": a line to the associate, not the customer, offering to make this customer's home card and asking them to send the customer's name and mobile number, such as "Shall I make a home card for this customer? Send me their name and mobile number." It goes out first, above your other lines, which still answer what they asked. When they say this customer has been in before, or CUSTOMER NUMBER says a card is saved under the name they used, ask for the number the customer gave then, in "ask_number". A message that gives the number needs no question about it. If no number comes, carry on and do not ask again. Fill "customer" whenever the message says a different customer has walked up, that one who came before is back, or gives the customer's name or number. When CUSTOMER NUMBER says what they bought before, that is their purchase history: answer any question about what they bought, when, or for how much from it, however it is asked, and never say you have no access to past purchases. For a problem with something they bought, name it and tell the associate to send what is wrong with it, so it is logged for service. The code keeps and looks up what was said and tells the associate, so never say you have saved or found anything. A name they give is the customer's: you are always talking to the associate, so never greet or address them by it ("Okay, Suresh." to the associate is wrong); speak of the customer by name, or as they and them, in the third person; him or her only after the associate has said which.
- Each product in FACTS has offers_on_it: everything running on that product today, discount, card and bank offers and free gifts together. Asked about offers on a product, say what its own offers_on_it says. Only when that list is empty is the answer that none is showing on it today, and then say that plainly. Never say none and name one in the same reply. Never mention an offer, an exchange or an EMI that is not on the list, not even as something you could go and check.

Hard rules, never bent:
- Never invent a figure. Not a price, not an offer, not stock, not a finance term, not a specification, and not a warranty length, a delivery time, a today's target or a count of anything, and not a size someone needs: "a family of 4 needs 500 to 600 litres" or "10 feet suits 55 inch" is a rule you made up; show the ones in FACTS that fit and say why. FACTS says whether something is available (in_stock), not how many: never state a number of units. Installation, delivery, a wall mount or a service is not free, not included and not charged separately unless FACTS says so: when it does not, say the installation charge is not showing and the service desk has it. A feature FACTS does not mention is not a feature the product lacks: say it is not listed, never "it does not have one". If it is not in FACTS, say this is not showing and tell them who has it — the shelf tag, the ASM, the service desk. Set "unknown" true on any turn where you could not answer what they asked, and they will be offered a human who can.
- Plenty of what they bring you is not a sale at all: a customer losing their temper, a set that came back faulty, a shift, a leave, something they have forgotten how to do, a bad morning. Answer that as their manager, in their words. Do not file anything about a customer from it, do not steer it back to a product, and "unknown" stays false.
- Never OPEN offers, discounts, exchange or finance yourself before you know what the customer needs and a difference has been shown. Our associates led with price in 6 of 6 store visits; that is the habit you exist to break. But when the associate asks you outright whether something is running, answer them from FACTS. Refusing a question you were asked is not coaching.
- Never guess a customer's wealth or level from how they look. The associate sets that.
- At most 2 short lines, except three options which take three lines. At most 3 buttons. They read this at a glance, out loud, with a customer waiting.
- The reason for an answer is two fields. "because" is the name of the one thing in WHAT THE CUSTOMER HAS SAID that this answer serves — a name under facts, or budget_rupees — exactly as it is written there or as you file it this turn. "reason" is what that means for what to say or show, in a few words, with no figures: because "main use" and reason "a fast-moving ball is the thing to show". The associate sees the customer's own words and then yours. If nothing the customer said explains this answer, both are null.
- You never send anything to a customer, and never say you are sending or have sent something. When the associate says the customer has bought it, tell them to tap "Sold": that records the sale on the customer's card and sets the follow-ups.
- After a sale, help with what comes next from what you can see: delivery, installation, the site, the charges in FACTS, and checking it works. A charge FACTS has is quoted from FACTS; one it does not have is with the service desk.
- A button is what the associate would really tap next in THIS conversation: an answer to the question you just asked, or the next thing to do. Its title is at most 20 characters, counted, and is the words tapping it says, so it must make sense on its own as their next message to you: "Any offers on it?" and "Show more" work, and a question you would be asking them, such as "What's their budget?", does not. After a question, each button is a real answer the customer could give, not a topic: for "What will they use it for most?" that is "Gaming", "Camera", "Battery life", and never "Budget", "Usage", "Brand". To pick a product to sell, its id is "select:<sku>" with a sku from FACTS and its title tells it apart from the others, such as "Silver" or "LG 7 Kg", with no price. Every other button leaves the id empty. Never a specification, a price, or a fact you have just stated. Never offer a button for something you cannot answer from FACTS or the customer's card, such as warranty details or service history. If no button would really be tapped, send none: no buttons is better than filler. Buttons must be different from each other.
- Name a product by its name, never by its sku: the sku is only for a "select:" button id.
- Write money as "Rs 54,990", never the rupee sign: it does not survive JSON mode. Group it the Indian way — "Rs 3,14,900" and "Rs 1,79,900", never "Rs 314,900".
- Answer in the same language and script they just used. Latin script in, Latin script out. Never switch them to Devanagari on your own.`;

/** One search of the store out of what was said. Understanding the message is the model's job: a
 *  list of filler words was what searched "current data" for a question about an iPhone. */
const SEARCH_SYSTEM = `You turn a message from a Reliance Digital store associate into one search of the store's product catalogue and identify whether a different customer has just arrived. You write no reply to anyone.

new_customer is true when the associate's current message means a different customer has just arrived or taken over, whatever words they use. Use the meaning of the whole message, not a required phrase. If true, ignore LAST SEARCH and RECENT TURNS when choosing q; only a product named in the current message belongs in q. It is false when they are still discussing the same customer or product.

q is the words of the product only: brand, model, size, capacity, variant, as the store would name it, in English. "iphone 18 pro 256 gb", "sony 85 inch tv", "samsung double door fridge", "front load washing machine". The store searches product names, not sentences, so words like want, buy, price, offer, stock, current, latest, today, customer and data never go in q. Keep every word that narrows the product: leaving out "256 gb" finds the wrong one.
kind is what the thing is, as one plain singular noun a shop would use: phone, television, refrigerator, washing machine, air conditioner, laptop, tablet, watch, soundbar. It is null if the message does not say.
sort_on is "price_asc" only when they ask for the cheapest, "price_dsc" only for the most expensive, "discount_dsc" only for which has the biggest discount, "latest" only for the newest, otherwise null. "What do they cost", "what is the price", "any offers on it" and "is there a discount" are not any of those: null.
max_price is a budget in rupees they stated for this product, otherwise null.
page_no is only for asking to see more of the same search: the last page_no plus one.

LAST SEARCH is what the conversation is on. A message about the same thing — "it", "this one", its price, colours, warranty, offers — repeats LAST SEARCH exactly. A message that narrows it ("the 512 GB one", "the silver one") adds those words to its q. What the customer will use it for or wants from it ("gaming", "good camera", "for my mother") is not in a product's name, so it never goes in q: that message repeats LAST SEARCH too. A message naming a different product is a new search. When storeiq's last turn said what they asked for is not here, or that another kind would suit this customer better ("a double door", "side-by-side", "a bigger size"), and the associate goes along with it or answers its question, search for that one: drop the words that ruled it out ("single door", "350 litre") and use the kind storeiq named. A message that is not about any product, and has no LAST SEARCH to stay on, has q null. Hindi, Marathi and Hinglish are understood the same way.`;

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
  /** The contest scores a reason in each answer. Told to explain itself, the model narrated the
   *  conversation, so a reason is now one of the customer's own needs (`because`, a card entry)
   *  followed by what it means (`reason`), and a need the card does not hold shows no reason. */
  because?: string | null;
  reason?: string | null;
  /** The line asking for the customer's name and number, while they have no card. */
  ask_number?: string | null;
  /** A hello or small talk with nothing in it to act on, in whatever words: the model's reading, not a
   *  keyword list. It gets the greeting with Today's brief and New customer. */
  opening?: boolean;
  /** Who is standing there, read from the words rather than a fixed phrase. */
  customer?: { arrived?: "new" | "returning" | null; name?: string | null } | null;
};

const schema = {
  type: "OBJECT",
  // "unknown" is required or the model simply leaves it out: it said "I do not have that"
  // in prose and reported nothing, so no human was ever offered.
  // "customer" too: left optional, the model left it out on "naya banda aaya hai" and the last
  // customer's card stayed on the new one.
  required: [
    "step",
    "card",
    "shortlist",
    "demonstrated",
    "lines",
    "buttons",
    "unknown",
    "customer",
    "ask_number",
    "opening",
  ],
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
    because: {
      type: "STRING",
      nullable: true,
      description: "the name of the entry in WHAT THE CUSTOMER HAS SAID that this answer serves, or null",
    },
    reason: {
      type: "STRING",
      nullable: true,
      description: "what that need means for what to say or show, a few words, no figures. null when because is null",
    },
    opening: {
      type: "BOOLEAN",
      description:
        "true when this message opens the conversation or is small talk, with no customer, product, question or task in it: a hello in any words or language, how are you, what's up, starting the shift, checking in. false when it asks or tells you anything to act on, even if it starts with a hello",
    },
    ask_number: {
      type: "STRING",
      nullable: true,
      description:
        'while CUSTOMER NUMBER is "none yet" and they are serving a customer: one line to the associate, not the customer, offering to make this customer\'s home card and asking them to send the customer\'s name and mobile number, without "Ask:", in the language of your reply. When CUSTOMER NUMBER says a card is saved under a name: one line to the associate asking for the mobile number that customer gave on their earlier visit, so their home card comes back. null when CUSTOMER NUMBER is anything else, when this message gives the number, or when this is not about a customer',
    },
    customer: {
      type: "OBJECT",
      nullable: true,
      description:
        "only when this message says a different customer has walked up, says one who came before is back, or gives the customer's name or mobile number; otherwise null",
      properties: {
        arrived: {
          type: "STRING",
          enum: ["new", "returning"],
          nullable: true,
          description:
            "new: the associate says a different person has just walked up. returning: the associate says the person who just walked up has been in before. Being told the name or number of the customer they are already serving is neither, so null",
        },
        name: { type: "STRING", nullable: true, description: "the customer's name, as the associate gave it" },
      },
    },
  },
} as const;

const searchSchema = {
  type: "OBJECT",
  required: ["q", "new_customer"],
  properties: {
    q: { type: "STRING", nullable: true },
    new_customer: { type: "BOOLEAN", description: "whether this message starts a different customer's visit" },
    kind: { type: "STRING", nullable: true },
    sort_on: { type: "STRING", nullable: true },
    max_price: { type: "NUMBER", nullable: true },
    page_no: { type: "NUMBER", nullable: true },
  },
} as const;

export function readSearchTurn(raw: unknown): { search: Search | null; newCustomer: boolean } {
  const result = (raw ?? {}) as Record<string, unknown>;
  return { search: readSearch(result), newCustomer: result.new_customer === true };
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
  const fal = falConfig();
  if (fal) {
    const read = await falVision(fal, LABEL_PROMPT, image, request);
    return /^none\b/i.test(read) ? "" : read.slice(0, 200);
  }
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
  /\b(offer|discount|exchange|emi|finance|cashback|instant|no.cost|bonus|scheme|deal|sale|chhoot)s?\b|\b(bank|hdfc|icici|sbi|axis|idfc|kotak|indusind|rbl|hsbc|amex|onecard|(credit|debit) cards?)\b|ऑफ\u093c?र|छूट|डिस्काउंट|ईएमआई|एक्सचेंज|कैशबैक/i;
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
  // A pitch (a product put up for sale) reads out its features before its price, which takes six.
  const cap = reply.long || (reply.buttons ?? []).some((button) => button.id.startsWith("select:")) ? 6 : 3;
  const kept = reason ? [...said.slice(0, cap - 1), reason] : said.slice(0, cap);
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
  // Six at most, whatever step the model named; floor() cuts anything but a pitch to three.
  const hasProductChoices = decision.buttons?.some((button) => button.id.startsWith("select:"));
  const lines = (decision.lines ?? [])
    // The store's nine-digit item codes are for the till, not for reading to a customer.
    .map((line) =>
      moneySafe(line)
        .replace(/\s*\(\s*\d{9,}\s*\)|\s*\b\d{9,}\b/g, "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 6);
  if (hasProductChoices) lines.splice(0, lines.length, ...lines.filter((line) => !/^\*?Ask:\*?\s/i.test(line)));
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
      const raw = String(button?.title ?? "").trim();
      const clean = raw.replace(/\(?\bRs\.?\s?[\d,]+\)?/g, "").trim();
      const id = String(button?.id ?? "").trim();
      const acts = DOES_SOMETHING.test(id);
      // "Under Rs 40,000" with the price taken out is "Under": an answer whose meaning was its figure goes.
      if (!acts && clean !== raw) return { id: "", title: "" };
      // "Small (up to 43 inch)" is too long for a button: its bracket goes, not the whole answer.
      const short = !acts && clean.length > 20 ? clean.replace(/\s*\([^)]*\)\s*$/, "").trim() : clean;
      const title =
        acts && short.length > 20
          ? clean
              .slice(0, 21)
              .replace(/\s+\S*$/, "")
              .slice(0, 20)
          : short;
      return { id: acts ? id : `say:${title}`, title };
    })
    .filter((button) => button.title && button.title.length <= 20);
  // A question's buttons are its answers. "Water dispenser on the door?" went out over three fridges,
  // and the spoken answer was lost under them; a pitch ends on its price, not a question.
  const last = lines.at(-1) ?? "";
  const asking =
    /\?["”']?\s*$/.test(last) &&
    !/\b(which|kaun|konsa|kaunsa)\b|कौन|कोणत/i.test(last) &&
    !lines.some((line) => /\bRs\b/.test(line));
  const unique = buttons.filter(
    (button, index) =>
      !(asking && button.id.startsWith("select:")) &&
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

function prompt(event: Event, session: Session, pack: Pack, notes: string[] = [], named: string[] = []): string {
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
    `CUSTOMER NUMBER: ${named.length ? `not given, and a card is saved under the name ${named.join(", ")}` : session.customer ? `given${session.customer.name ? `; the customer is ${session.customer.name}, and you are talking to the associate, not to ${session.customer.name}` : ""}${session.customer.bought?.length ? `; they bought before: ${session.customer.bought.map((row) => `${row.name}, Rs ${row.total.toLocaleString("en-IN")} on ${row.on}`).join("; ")}` : ""}` : session.named ? `not given yet; the customer is ${session.named}${session.customer_asked ? ", and the number was already asked for" : ", so ask only for the number"}` : session.customer_asked ? "none, already asked for" : "none yet"}.`,
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
async function searchFrom(
  said: string,
  session: Session,
  request: typeof fetch,
): Promise<{ search: Search | null; newCustomer: boolean }> {
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
    return readSearchTurn(readJson(text));
  } catch {
    // An unreadable search is the same as none: the conversation stays on what it was on.
    return { search: session.search ?? null, newCustomer: false };
  }
}

/** The customer's own words for the need, then what it means. Null when the card holds no such need:
 *  a reason the model cannot tie to something the customer said is the narration we are avoiding. */
export function reasonFrom(card: Session["card"], because: unknown, so: unknown): string | null {
  if (typeof because !== "string" || typeof so !== "string" || !so.trim()) return null;
  const key = because.trim().toLowerCase();
  const facts = Object.entries(card.facts ?? {}).find(([name]) => name.trim().toLowerCase() === key);
  const raw = facts ? facts[1] : key === "facts" ? undefined : (card as Record<string, unknown>)[key];
  const need =
    key === "budget_rupees" && typeof raw === "number"
      ? `Rs ${raw.toLocaleString("en-IN")}`
      : Array.isArray(raw)
        ? raw.join(", ")
        : typeof raw === "string" || typeof raw === "number"
          ? String(raw)
          : "";
  return need.trim() ? `${need.trim()}: ${so.replace(/^\s*↳\s*/, "").trim()}` : null;
}

/** The Sold tap first, then whatever else the reply offered, within the floor's three. */
export function awaitingSale(reply: Reply, lang: Lang): NonNullable<Reply["buttons"]> {
  const others = (reply.buttons ?? []).filter((button) => button.id !== "sold" && !button.id.startsWith("consent:"));
  return [{ id: "sold", title: t(lang, "btn.sold") }, ...others].slice(0, 3);
}

/** A line offered with the pick stays priceable on every later turn, like the pick itself. */
export function withOffered(pack: Pack, session: Session): Pack {
  const offered = (session.selection?.offered ?? []).filter(
    (line) => !pack.accessories.some((accessory) => accessory.id === line.id),
  );
  return offered.length ? { ...pack, accessories: [...pack.accessories, ...offered] } : pack;
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
  delete session.customer;
  delete session.customer_asked;
  delete session.named;
  delete session.search;
  delete session.shown;
  // The last customer's pick, and their yes, are not this customer's.
  delete session.selection;
  session.consent = false;
  delete session.sold;
  delete session.followups_set;
  delete session.reporting_problem;
  delete session.site_checked;
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
  if (event.action === "new_customer") {
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
    const product = pack.products.find((candidate) => candidate.sku === sku);
    if (!product) return { text: t(session.language, "ft.gone") };
    // Delivery and installation are on the bill from the start; a charge from the last pick stays
    // only if this pack still prices it.
    // Delivery waits for "take it or deliver", asked with the breakdown; installation does not.
    const vans = new Set(deliveryCharges(pack, product).map((charge) => charge.id));
    const defaults = defaultCharges(pack, product).filter((id) => !vans.has(id));
    session.selection = {
      sku,
      accessories: [],
      charges: defaults.length
        ? defaults
        : (session.selection?.charges ?? []).filter((id) => pack.charges.some((charge) => charge.id === id)),
    };
    session.consent = false;
    session.sold = false;
    delete session.followups_set;
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
  if (wantsSold(event.text, event.action)) {
    // A sale of nothing is not a close: it asks which one instead.
    if (!session.selection) return followThrough(session, pack, event.name ?? session.phone);
    const cheer = !session.sold;
    session.sold = true;
    if (!session.steps_done.includes("close")) session.steps_done.push("close");
    if (!session.steps_done.includes("follow_through")) session.steps_done.push("follow_through");
    session.step = "follow_through";
    recordPurchase(session, pack);
    return followThrough(session, pack, event.name ?? session.phone, cheer);
  }
  // Take it or deliver, and how far: the delivery line on the bill follows the answer.
  const chosen = session.selection && pack.products.find((p) => p.sku === session.selection?.sku);
  const vans = chosen ? deliveryCharges(pack, chosen) : [];
  if (chosen && vans.length && session.selection) {
    const lang = session.language;
    const typed = event.action ? "" : (event.text ?? "");
    const km = kmIn(typed);
    const tapped = event.action?.match(/^deliver:(.+)$/)?.[1];
    const waiting = !session.selection.delivery;
    const carry = tapped === "carry" || (waiting && CARRY_WORDS.test(typed));
    const deliver = tapped === "yes" || (waiting && km === null && DELIVER_WORDS.test(typed));
    const rate = tapped ? vans.find((charge) => charge.id === tapped) : km !== null ? deliveryFor(vans, km) : null;
    if (carry || deliver || rate) {
      if (carry) setDelivery(pack, chosen, session.selection, null);
      else if (rate) setDelivery(pack, chosen, session.selection, rate);
      else {
        session.selection.delivery = "deliver";
        return deliveryRates(session, pack)!;
      }
      session.consent = false;
      recordPurchase(session, pack);
      const bill = followThrough(session, pack, event.name ?? session.phone);
      return km !== null && rate
        ? { ...bill, text: `${t(lang, "dl.km", { km, title: rate.title })}\n${bill.text}` }
        : bill;
    }
  }
  if (event.action === "summary:customer") return customerSummary(session, pack, event.name ?? session.phone);
  if (event.action === "consent:yes") {
    // The customer's yes is to their own copy of the summary, and only that: it is not the sale.
    if (session.selection) session.consent = true;
    return customerSummary(session, pack, event.name ?? session.phone);
  }
  if (event.action === "charges") {
    const product = pack.products.find((candidate) => candidate.sku === session.selection?.sku);
    if (!product) return followThrough(session, pack, event.name ?? session.phone);
    return { text: chargesList(pack, product, session.language) };
  }
  if (event.action === "cust:serve") return { text: t(session.language, "cc.serving") };
  if (event.action === "cust:problem") {
    const last = session.customer?.bought?.at(-1);
    if (!last) return { text: t(session.language, "cc.serving") };
    session.reporting_problem = true;
    return { text: t(session.language, "prob.ask", { name: last.name.split(/[,(]/)[0]!.trim() }) };
  }
  if (event.action === "consent:no") {
    session.consent = false;
    return { text: t(session.language, "ft.noconsent") };
  }
  // "The outdoor unit is 5 metres away": the pipe past what is included, multiplied out here. The
  // model may only quote figures the data holds, so "2 × Rs 850" was refused when it did the sum.
  const metres = event.action ? null : pipeMetres(event.text);
  const running = metres && session.selection && pack.products.find((p) => p.sku === session.selection?.sku);
  const run = running && priceRun(pack, running, session.selection!, metres!);
  if (run && session.selection) {
    session.consent = false;
    recordPurchase(session, pack);
    const itemised = itemisedTotal(pack, session.selection);
    if (itemised)
      return {
        text: [
          run.extra
            ? t(session.language, "pipe.extra", {
                m: metres!,
                included: run.included,
                extra: run.extra,
                rate: run.rate.toLocaleString("en-IN"),
                amount: (run.extra * run.rate).toLocaleString("en-IN"),
              })
            : t(session.language, "pipe.none", { m: metres!, included: run.included }),
          t(session.language, "bd.total", {
            body: itemised.lines.join("; "),
            total: itemised.total.toLocaleString("en-IN"),
          }),
          `↳ ${t(session.language, "why.pipe")}`,
        ].join("\n"),
        buttons: session.sold
          ? [
              { id: "summary:customer", title: t(session.language, "btn.summary") },
              { id: "new_customer", title: t(session.language, "btn.new") },
            ]
          : [
              { id: "sold", title: t(session.language, "btn.sold") },
              { id: "charges", title: t(session.language, "btn.charges") },
            ],
      };
  }
  if (wantsFollowThrough(event.text, event.action, !!session.selection)) {
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

export type SavedCustomer = {
  id: string;
  name: string | null;
  card: HomeCard;
  history: Turn[];
  purchases?: Purchase[];
};

/** The pick and its itemised total go on the customer's home card once it is sold, so their next
 *  visit shows what they bought. Once per product a day: Sold can be tapped twice. */
export function recordPurchase(session: Session, pack: Pack): void {
  if (!session.customer || !session.sold || !session.selection) return;
  const itemised = itemisedTotal(pack, session.selection);
  const product = pack.products.find((candidate) => candidate.sku === session.selection?.sku);
  if (!itemised || !product) return;
  const on = new Date().toISOString().slice(0, 10);
  const bought = session.customer.bought ?? [];
  // Already on the card today: the total follows a line added after the sale, such as the pipe.
  const same = bought.find((row) => row.sku === product.sku && row.on === on);
  if (same) {
    same.total = itemised.total;
    return;
  }
  session.customer.bought = [...bought, { sku: product.sku, name: product.name, total: itemised.total, on }].slice(-10);
}

/** The associate saying outright that someone else is now standing there. */
const ANOTHER_CUSTOMER =
  /\b(new|another|next|different|naya|nayi|naye|dusra|dusri|doosra|doosri)\s+(customer|grahak|client)\b|नया ग्राहक|दूसरा ग्राहक|नवीन ग्राहक/i;

export type Store = {
  today(): Promise<Session[]>;
  findCustomer?(phone: string): Promise<SavedCustomer | null>;
  namesIn?(said: string): Promise<string[]>;
  addFollowUps?(rows: NewFollowUp[]): Promise<void>;
  followUps?(filter: { phone?: string; dueBy?: string; customer_id?: string }): Promise<OpenFollowUp[]>;
  doneFollowUp?(id: number, phone: string): Promise<OpenFollowUp | null>;
  logVisit(row: { reference: string; phone: string; associate?: string; store: string; body: string }): Promise<void>;
  openQuestions(): Promise<{ reference: string; area: string; owner: string }[]>;
  logQuestion(row: { reference: string; phone: string; area: string; owner: string; question: string }): Promise<void>;
};

/** "They'll take it themselves" / "deliver it": an answer to take-or-deliver, while it is being asked. */
const CARRY_WORDS =
  /\b(take it (with them|home|themselves)|they('| wi)ll take it|carry|self[- ]?pick|pick(ing)? (it )?up|khud le|le ?jayenge|saath le)\b/i;
const DELIVER_WORDS = /\b(deliver|delivery|home delivery|ghar (pe|par) (bhej|chahiye)|bhej do)\b/i;

/** Asking about a saved customer's card, what they bought or their history. */
// "What did she buy before?" and "last time" are asking what was bought; "she wants to buy a fridge" is not.
const PAST_BUY =
  "did (?:he|she|they|the customer) buy|(?:buy|bought|purchased?) (?:before|earlier|last time)|past purchases?|pichh?li baar|pehle kya";
const CARD_ASK = new RegExp(
  `\\b(home\\s?card|card|bought|purchase[sd]?|purchases|history|record|details|data|profile|kya liya|kya kharida|kharida|${PAST_BUY})\\b|कार्ड|खरीद|घेतलं`,
  "i",
);
/** Asking what they bought, rather than for the whole card. */
const PURCHASE_WORDS = new RegExp(
  `\\b(bought|purchases?|purchase history|kya liya|kya kharida|kharida|${PAST_BUY})\\b|खरीद|घेतलं`,
  "i",
);
/** About the customer whose card is already open: these words, without a name or a number. */
const OWN_HISTORY = new RegExp(
  `\\b(home\\s?card|bought|purchases?|purchase history|previous|history|kya liya|kya kharida|kharida|${PAST_BUY})\\b|खरीद|घेतलं`,
  "i",
);

/** A saved customer becomes the one being served: their card, their words and what they bought. */
export function openCard(session: Session, found: SavedCustomer, phone: string): void {
  session.customer = {
    id: found.id,
    phone,
    ...(found.name ? { name: found.name } : {}),
    ...(found.purchases?.length ? { bought: found.purchases } : {}),
  };
  session.card = { ...found.card, ...session.card };
  session.history = [...found.history, ...session.history].slice(-12);
}

/** The customer's own id, short enough to read out: the first eight of the card's unique id. */
export function customerId(id: string): string {
  return `C-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** "2026-11-05" as the floor says it: "5 Nov 2026". */
function onDay(on: string): string {
  const day = new Date(`${on}T00:00:00Z`);
  return Number.isNaN(day.getTime())
    ? on
    : day.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const productName = (name: string): string => name.split(/[,(]/)[0]!.trim();

/** A saved customer's home card: who they are (name, number, id), the last thing they bought with a
 *  count of the rest, and what they need. Not the whole history: that is a tap away. */
export function customerCard(session: Session, phone: string, open: OpenFollowUp[]): Reply {
  const lang = session.language;
  const customer = session.customer;
  const bought = customer?.bought ?? [];
  const last = bought.at(-1);
  const parts = cardParts(session);
  return {
    text: [
      t(lang, "cc.head", {
        name: customer?.name ?? t(lang, "as.thecustomer"),
        phone: `${phone.slice(0, 5)} ${phone.slice(5)}`,
        id: customerId(customer?.id ?? ""),
      }),
      last
        ? t(lang, "cc.last", {
            name: productName(last.name),
            total: last.total.toLocaleString("en-IN"),
            on: onDay(last.on),
            more: bought.length > 1 ? t(lang, "cc.more", { n: bought.length - 1 }) : "",
          })
        : t(lang, "cc.nobought"),
      parts.length ? t(lang, "cc.home", { body: parts.slice(0, 4).join("; ") }) : `↳ ${t(lang, "cc.why")}`,
    ].join("\n"),
    buttons: [
      ...(bought.length
        ? [
            { id: "cust:history", title: t(lang, "btn.history") },
            { id: "cust:problem", title: t(lang, "btn.problem") },
          ]
        : [{ id: "cust:serve", title: t(lang, "btn.serve") }]),
      open.length
        ? { id: "followups:customer", title: t(lang, "btn.followups") }
        : bought.length
          ? { id: "cust:serve", title: t(lang, "btn.serve") }
          : { id: "new_customer", title: t(lang, "btn.new") },
    ],
  };
}

/** What this customer has bought, newest first, one line each. Three fit the floor; more than that
 *  shows the two newest and says how many earlier ones are on file. */
export function purchaseHistory(session: Session): Reply {
  const lang = session.language;
  const bought = [...(session.customer?.bought ?? [])].reverse();
  if (!bought.length) return { text: t(lang, "cc.nobought") };
  const shown = bought.length > 3 ? bought.slice(0, 2) : bought;
  return {
    text: [
      ...shown.map((row, index) =>
        t(lang, "cc.row", {
          n: index + 1,
          name: productName(row.name),
          total: row.total.toLocaleString("en-IN"),
          on: onDay(row.on),
        }),
      ),
      ...(bought.length > 3 ? [`↳ ${t(lang, "cc.earlier", { n: bought.length - 2 })}`] : []),
    ].join("\n"),
    buttons: [
      { id: "cust:problem", title: t(lang, "btn.problem") },
      { id: "followups:customer", title: t(lang, "btn.followups") },
      { id: "cust:serve", title: t(lang, "btn.serve") },
    ],
  };
}

/** Digits as a voice note writes them out, in English, Hindi and Marathi. */
const DIGIT_WORDS: Record<string, string> = Object.fromEntries(
  [
    ["zero", "shunya", "शून्य", "जीरो", "झिरो"],
    ["one", "ek", "एक"],
    ["two", "do", "दो", "दोन"],
    ["three", "teen", "तीन"],
    ["four", "char", "chaar", "चार"],
    ["five", "paanch", "panch", "पांच", "पाँच", "पाच"],
    ["six", "chhe", "chhah", "छह", "छः", "सहा"],
    ["seven", "saat", "सात"],
    ["eight", "aath", "आठ"],
    ["nine", "nau", "नौ", "नऊ"],
  ].flatMap((words, digit) => words.map((word) => [word, String(digit)])),
);

/** The customer's mobile number in the associate's own words, or null. Read by the code, not the
 *  model: asked "9876543210 ka data batao", the model passed no number on and nothing was looked up.
 *  A voice note's transcript writes it however it heard it: "982 012 3456", "९८२०१२३४५६", "nine
 *  eight double two...", so the groups of digits next to each other are tried together too. */
export function mobileIn(said: string | undefined): string | null {
  const found = (said ?? "").match(/(?<!\d)(?:\+?91[\s-]?|0)?([6-9]\d{4}[\s-]?\d{5})(?!\d)/);
  if (found) return found[1]!.replace(/\D/g, "");
  const tokens = (said ?? "")
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x966))
    .toLowerCase()
    .split(/[\s,.\-+()]+/)
    .map((token) => DIGIT_WORDS[token] ?? token);
  // "double five" is 55 and "triple nine" is 999.
  const digits: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const times = { double: 2, triple: 3, डबल: 2, ट्रिपल: 3 }[tokens[i]!];
    if (times && /^\d$/.test(tokens[i + 1] ?? "")) digits.push(tokens[++i]!.repeat(times));
    else digits.push(tokens[i]!);
  }
  // The longest from each start, so "91 98 20 12 34 56" is not read as 9198201234.
  for (let start = 0; start < digits.length; start++) {
    let run = "";
    let best: string | null = null;
    for (let end = start; end < digits.length && /^\d+$/.test(digits[end]!) && run.length < 13; end++) {
      run += digits[end];
      const mobile = run.replace(/^(?:91(?=\d{10}$)|0(?=\d{10}$))/, "");
      if (/^[6-9]\d{9}$/.test(mobile)) best = mobile;
    }
    if (best) return best;
  }
  return null;
}

/** Two or three lines the associate reads out about the product just picked, written by the model from
 *  FACTS and what the customer said. A line with a figure nobody gave is dropped, never sent. */
async function pitchFor(
  product: Pack["products"][number],
  event: Event,
  session: Session,
  pack: Pack,
  request: typeof fetch,
): Promise<string[]> {
  const note = `The associate just picked ${product.name} for this customer, and its full cost goes out under your lines, so write no price, no total, no offer and no question. Write the pitch they read out to the customer: one line on why this one fits, in what the customer said, then two or three of its features from FACTS, each as what it does for this customer ("Dolby Atmos, so movies sound like a theatre"), never a bare spec. At most 3 short lines, no buttons, no ask_number.`;
  const decision = readJson<Decision>(await askModel(SYSTEM, prompt(event, session, pack, [note]), schema, request));
  const said = [
    ...session.history.filter((turn) => turn.who === "associate").map((turn) => turn.text),
    ...Object.values(session.card.facts ?? {}),
  ].join(" ");
  return (decision.lines ?? [])
    .map((line) => String(line).trim())
    .filter((line) => line && !unsupportedNumbers(line, allowedNumbers(pack), said).length)
    .slice(0, 3);
}
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
  const notes: string[] = [];
  let resetNow = false;
  let keptCard = false;
  let searchedNow = false;
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
    return greetingReply(
      session.language,
      Object.keys(base.shift_brief ?? {}).length > 0 || !!catalogConfig(),
      store?.followUps ? (await store.followUps({ phone: session.phone, dueBy: storeDay() })).length : 0,
    );
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
  // Delivery and installation are priced from the after-sales list for the heavy products in view.
  let pack = withAfterSales(
    withOffered(withShown(session.search ? await fetchFor(session.search) : base, session), session),
  );
  const applySearch = async (search: Search | null): Promise<void> => {
    if (!search) {
      if (resetNow) {
        pack = withAfterSales(base);
        failed = false;
        searchedNow = false;
      }
      return;
    }
    searchedNow = true;
    failed = false;
    if (search.kind && session.search?.kind && search.kind !== session.search.kind) delete session.shown;
    const found = await fetchFor(search);
    pack = failed ? found : withAfterSales(withOffered(withShown(found, session), session));
    session.search = search;
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
  };
  const withoutUnavailableCharges = (reply: Reply): Reply => {
    const product = pack.products.find((candidate) => candidate.sku === session.selection?.sku);
    if (!product || applicableCharges(pack, product).length) return reply;
    const buttons = (reply.buttons ?? []).filter(
      (button) => button.id !== "charges" && button.title !== t(session.language, "btn.charges"),
    );
    return { ...reply, buttons };
  };
  // No file brief on the live catalogue, so the brief is the store's own: stock and offers today.
  if (wantsBrief(event.text, event.action) && catalogConfig() && !Object.keys(base.shift_brief ?? {}).length)
    pack = { ...pack, shift_brief: await liveBrief(base, request).catch(() => ({})) };
  if (store && event.action === "site:problem" && session.selection) {
    const needs = siteNeeds(pack, session.selection).join("; ");
    const reference = newReference();
    const question = `Site needs work before install: ${needs}`;
    const { reply, area, owner } = expertReply(pack, question, reference, session.language);
    await store.logQuestion({ reference, phone: session.phone, area, owner, question });
    return reply;
  }
  // What is wrong with something this customer bought, said in the line after "Problem with it".
  if (store && session.reporting_problem && event.text && !event.action) {
    delete session.reporting_problem;
    const reference = newReference();
    const last = session.customer?.bought?.at(-1);
    const who = session.customer?.name ?? t(session.language, "as.thecustomer");
    const owner =
      base.experts?.find((expert) => /service|install/i.test(expert.area))?.name ?? t(session.language, "prob.desk");
    await store.logQuestion({
      reference,
      phone: session.phone,
      area: "after-sales service",
      owner,
      question: `${who}, ${last?.name ?? ""}: ${event.text}`.slice(0, 400),
    });
    await store.addFollowUps?.([
      {
        phone: session.phone,
        ...(session.associate ? { owner: session.associate } : {}),
        ...(session.customer
          ? {
              customer_id: session.customer.id,
              customer_phone: session.customer.phone,
              ...(session.customer.name ? { customer_name: session.customer.name } : {}),
            }
          : {}),
        product: last?.name ?? "",
        what: t(session.language, "fu.service", { who, problem: event.text.slice(0, 80) }),
        due_on: storeDay(1),
      },
    ]);
    return remember({
      text: [
        t(session.language, "prob.raised", { owner, reference }),
        t(session.language, "prob.say"),
        `↳ ${t(session.language, "prob.why")}`,
      ].join("\n"),
    });
  }

  // The associate's own check-backs: what is due, and a tap to mark one done.
  const doneId = event.action?.match(/^fu:done:(\d+)$/)?.[1];
  if (store?.doneFollowUp && doneId) {
    const row = await store.doneFollowUp(Number(doneId), session.phone);
    const left = (await store.followUps?.({ phone: session.phone, dueBy: storeDay() }))?.length ?? 0;
    return remember({
      text: [
        row ? t(session.language, "fu.done", { what: row.what }) : t(session.language, "fu.none"),
        left ? t(session.language, "fu.left", { n: left }) : "",
      ]
        .filter(Boolean)
        .join("\n"),
      ...(left ? { buttons: [{ id: "followups", title: t(session.language, "btn.followups") }] } : {}),
    });
  }
  if (store?.followUps && (wantsFollowUps(event.text, event.action) || event.action === "followups:customer")) {
    const rows =
      event.action === "followups:customer" && session.customer
        ? await store.followUps({ customer_id: session.customer.id })
        : await store.followUps({ phone: session.phone, dueBy: storeDay() });
    if (!rows.length) return remember({ text: t(session.language, "fu.none") });
    // Three lines and no reason line: the floor keeps two lines when there is a reason, and the
    // third check-back is the one that would go.
    const shown = rows.slice(0, 3);
    return remember({
      text: shown
        .map((row, index) => t(session.language, "fu.line", { n: index + 1, what: row.what, due: row.due_on }))
        .join("\n"),
      buttons: shown.map((row, index) => ({
        id: `fu:done:${row.id}`,
        title: t(session.language, "btn.done", { n: index + 1 }),
      })),
    });
  }

  // A saved customer's card is asked for by mobile number, and the code shows it: the model offered
  // "Warranty details" and "Service history" it had no data for, then could not find the purchase.
  // A name only gets the number asked for, since two customers can share one.
  const said = event.text ?? "";
  const asksCard =
    !event.action && CARD_ASK.test(said) && !/^\s*(card|home card|show the card)\s*[.!?]*\s*$/i.test(said);
  if (store?.findCustomer && (asksCard || event.action === "cust:history")) {
    const asked = asksCard ? mobileIn(said) : null;
    const found = asked ? await store.findCustomer(asked) : null;
    const named = !asked && asksCard && store.namesIn ? await store.namesIn(said) : [];
    const openName = session.customer?.name?.toLowerCase();
    // The card already open this visit, named or asked about: its number was given already.
    const aboutCurrent =
      !!session.customer &&
      !asked &&
      (event.action === "cust:history" ||
        OWN_HISTORY.test(said) ||
        named.some((name) => name.toLowerCase() === openName));
    if (!found && !aboutCurrent && (named.length || event.action === "cust:history"))
      return remember({ text: t(session.language, "cc.asknumber", { name: named[0] ?? "" }) });
    if (found || aboutCurrent) {
      if (found && asked && asked !== session.customer?.phone) {
        startInteraction(session);
        openCard(session, found, asked);
      }
      const customer = session.customer!;
      if (event.action === "cust:history" || PURCHASE_WORDS.test(said)) return remember(purchaseHistory(session));
      const open = store.followUps ? await store.followUps({ customer_id: customer.id }) : [];
      return remember(customerCard(session, customer.phone, open));
    }
  }

  const free = deterministic(event, session, pack, notes);
  // Sold: the check-backs go on the associate's list, each with its day. A heavy product's wait until
  // take-or-deliver is answered, so a customer who carries it home is never called about a delivery.
  const sold = session.sold && session.selection && pack.products.find((p) => p.sku === session.selection?.sku);
  if (
    store?.addFollowUps &&
    sold &&
    !session.followups_set &&
    (session.selection!.delivery || !deliveryCharges(pack, sold).length)
  ) {
    session.followups_set = true;
    await store.addFollowUps(
      followUpPlan(sold, session.customer?.name, session.language, session.selection!.delivery === "carry").map(
        (step) => ({
          phone: session.phone,
          ...(session.associate ? { owner: session.associate } : {}),
          ...(session.customer
            ? {
                customer_id: session.customer.id,
                customer_phone: session.customer.phone,
                ...(session.customer.name ? { customer_name: session.customer.name } : {}),
              }
            : {}),
          product: sold.name,
          what: step.what,
          due_on: storeDay(step.days),
        }),
      ),
    );
  }
  if (free && store?.followUps && wantsBrief(event.text, event.action) && (free.buttons ?? []).length < 3) {
    const due = await store.followUps({ phone: session.phone, dueBy: storeDay() });
    if (due.length)
      free.buttons = [...(free.buttons ?? []), { id: "followups", title: t(session.language, "btn.followups") }];
  }
  // A product just picked: resQ's care plan for its price band, and a television's own wall mount,
  // from the store, each a tap that adds it to the total.
  const product = event.action?.startsWith("select:") && pack.products.find((p) => p.sku === session.selection?.sku);
  // Not when the store already gives one free with it: that was a paid bracket offered for a TV
  // whose own promotion was "Free with it: Samsung Wallmount Bracket".
  const freeMount =
    !!product &&
    pack.offers.some(
      (offer) =>
        Array.isArray(offer.on) && offer.on.includes(product.name) && /mount|bracket/i.test(String(offer.title)),
    );
  if (free && product && session.selection && !session.sold) {
    const [mount, plan] = await Promise.all([
      freeMount ? null : mountFor(product, request).catch(() => null),
      carePlanFor(product, categoryOf(product)?.plan, request).catch(() => null),
    ]);
    const offered = [mount, plan].filter(
      (line): line is NonNullable<typeof line> => !!line && !session.selection!.accessories.includes(line.id),
    );
    if (offered.length) {
      session.selection.offered = offered;
      const [sold, ...rest] = free.buttons ?? [];
      free.buttons = [
        ...(sold ? [sold] : []),
        ...offered.map((line) => ({
          id: `add:${line.id}`,
          title: t(session.language, line === mount ? "btn.mount" : "btn.plan"),
        })),
        ...rest,
      ].slice(0, 3);
    }
  }
  // The pick is where the associate sells it: what it does for this customer goes above its cost, or a
  // new associate is left reading "Sony, 126 cm, Rs 70,990" to someone who has not bought it yet.
  if (free && product && !session.sold) {
    const lines = await pitchFor(product, event, session, pack, request).catch(() => []);
    if (lines.length) free.text = `${lines.join("\n\n")}\n\n${free.text}`;
  }
  if (free) return remember(withoutUnavailableCharges(free));

  // A photo of a shelf tag: read what is printed, then treat it as being told the same words. The
  // reply is still written from the catalogue, so a misread tag cannot become an invented price.
  if (event.image) {
    const read = await labelText(event.image, request).catch(() => "");
    if (!read) return remember({ text: t(session.language, "p.unread") });
    // The tag was read: that is the Translate step's evidence, whatever the model calls the turn.
    if (!session.steps_done.includes("translate")) session.steps_done.push("translate");
    event = { ...event, text: [`The shelf tag in their photo reads: ${read}.`, event.text].filter(Boolean).join(" ") };
    delete event.image;
  }

  // A number in their words is looked up before the model writes, so it answers with the old card in
  // front of it instead of "no data on that customer" under a "Welcome back" line.
  const askedBefore = !!session.customer_asked;
  const number = mobileIn(event.text);
  // The customer's own name and number, given while serving them, is this customer, not a new one. It
  // was read as "a different customer has arrived" and wiped the 32 inch TV the associate had just asked
  // about: the next reply asked "What can I help her with?", then "a TV, a tablet or a phone?".
  // Only once the card has been offered: "ek aunty aayi hai, Asha, 98765…" unasked is a new customer.
  const ownDetails =
    !!number && !session.customer && !!session.customer_asked && !ANOTHER_CUSTOMER.test(event.text ?? "");
  let customerLine = "";
  let loaded = false;
  if (number && number !== session.customer?.phone && store?.findCustomer) {
    const found = await store.findCustomer(number);
    if (found) {
      // Another customer's card was open: this number is someone else standing there.
      if (session.customer) startInteraction(session);
      openCard(session, found, number);
      loaded = true;
      const parts = cardParts(session);
      customerLine = [
        t(session.language, "customer.back", { v: found.name ?? "" }),
        parts.length ? t(session.language, "customer.last", { body: parts.join("; ") }) : "",
        found.purchases?.length
          ? t(session.language, "customer.bought", {
              body: found.purchases
                .slice(-3)
                .map((row) => `${row.name}, Rs ${row.total.toLocaleString("en-IN")} (${row.on})`)
                .join("; "),
            })
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      notes.push(
        `That number is ${found.name ?? "a customer"} from an earlier visit.${found.purchases?.length ? ` They bought ${found.purchases.map((row) => row.name).join("; ")} then.` : ""} What they said then is in WHAT THE CUSTOMER HAS SAID and RECENT TURNS, and the associate has just been shown it, so carry on from it without repeating it.`,
      );
    } else
      notes.push(
        "This message gives the customer's mobile number, and any name in it is the customer's, not the associate's. Do not greet or address the associate by that name, and say nothing about a home card: the code says it.",
      );
  }
  // Named but no number: the card is not loaded on a name, since two customers share one, but the
  // model is told it exists, so it asks for the number instead of "no record of Rahul".
  const named =
    !number && event.text && store?.namesIn
      ? (await store.namesIn(event.text)).filter(
          (saved) => saved.toLowerCase() !== session.customer?.name?.toLowerCase(),
        )
      : [];
  if (named.length)
    notes.push(
      `A card from an earlier visit is saved under the name ${named.join(", ")}. Do not say there is no record or treat them as new: it comes back when they give the mobile number that customer gave then.`,
    );

  // The turn: what they said becomes a search, the store's answer becomes FACTS, and the model
  // writes the reply from those. Nothing about a product is answered from a written line any more.
  if (event.text && catalogConfig()) {
    const turn = await searchFrom(event.text, session, request);
    // A card just opened by the number in this message is the customer who arrived: the lookup already
    // started their visit, and resetting again closed it ("9820012345 wali customer aayi hai").
    if (turn.newCustomer && !ownDetails && !loaded) {
      // A card opened by number and then "the old customer is back": the reset closed the card, and
      // "what did she buy?" was answered "I don't have access". With no new number, the open card stays
      // until the model says whether this is someone new.
      const open = number ? undefined : session.customer;
      startInteraction(session);
      if (open) {
        session.customer = open;
        keptCard = true;
      }
      resetNow = true;
      pack = withAfterSales(base);
      notes.push(
        "The associate has started a different customer's visit. Use only the current message, not earlier customer or product context.",
      );
    }
    await applySearch(turn.search);
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
  const picked = session.selection && pack.products.find((p) => p.sku === session.selection?.sku);
  if (picked)
    notes.push(
      session.sold
        ? `They sold ${picked.name} to this customer, and the follow-ups are set. Help with what comes after: delivery, installation, the site, the charges in FACTS.`
        : `The customer picked ${picked.name}, and its full cost is on the associate's screen. Nothing has been sent, and you cannot send it. When the customer buys it, the associate taps "${t(session.language, "btn.sold")}".`,
    );

  const told = (card: Decision["card"]): string =>
    [
      event.text,
      event.action,
      // What this customer bought before is on their card, not in this turn's FACTS: "82 cm" was refused.
      ...(session.customer?.bought ?? []).map(
        (item) =>
          `${item.name} Rs ${item.total} ${item.on} ${new Date(`${item.on}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
      ),
      // Said a turn ago is still said: "350 litre" asked for, then "4 people", was refused the 350.
      ...session.history.filter((turn) => turn.who === "associate").map((turn) => turn.text),
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
      readJson<Decision>(
        await askModel(SYSTEM, prompt(event, session, pack, [...notes, ...extra], named), schema, request),
      ),
    );
  let stale: Session["card"] = {};
  let decision = await written();
  if (keptCard && decision.customer?.arrived === "new") delete session.customer;
  // The model read it as a hello, however it was put: the greeting the floor knows, with the brief and
  // New customer, and no home card offered for nobody. Not a keyword list: "hey there" and "kya chal
  // raha hai" are the model's call.
  // A product named in it is not a hello, whatever the model said: "morning! any offers on samsung tv?".
  if (
    decision.opening === true &&
    !decision.shortlist?.length &&
    !event.action &&
    !(searchedNow && session.search?.kind)
  )
    return remember(
      greetingReply(
        session.language,
        Object.keys(base.shift_brief ?? {}).length > 0 || !!catalogConfig(),
        store?.followUps ? (await store.followUps({ phone: session.phone, dueBy: storeDay() })).length : 0,
      ),
    );
  if (!resetNow && !loaded && !ownDetails && decision.customer?.arrived === "new") {
    stale = session.card;
    startInteraction(session);
    resetNow = true;
    notes.push("The model recognized a different customer. Ignore earlier customer and product context.");
    if (event.text && catalogConfig()) {
      const turn = await searchFrom(event.text, session, request);
      await applySearch(turn.search);
    } else {
      pack = withAfterSales(base);
      failed = false;
      searchedNow = false;
    }
    decision = await written();
  }
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
  // Refused twice, the figure still does not go out, but only the line it is in goes with it: "for a
  // family of 4, 500 to 550 litres" above three real fridges cost the associate all three.
  if (figuresIn(decision).length) {
    const lines = decision.lines.filter(
      (line) => !unsupportedNumbers(line, allowedNumbers(pack), told(decision.card)).length,
    );
    // The reason often repeats the same rule ("a family of 4 needs 300 to 400 litres"): it goes too.
    const kept = reasonOnly({ ...decision, lines });
    if (lines.length && !figuresIn(kept).length) decision = kept;
  }

  // The customer's card. Who is standing there is the model's reading of the words; keeping the card
  // under a number the associate really said is the code's.
  const who = decision.customer;
  // The model writes this turn's card having seen the last customer's, and copies it back.
  if (
    (who?.arrived === "new" || who?.arrived === "returning") &&
    // The one coming back, with no new number, is the one whose card is open.
    !(who?.arrived === "returning" && session.customer && !number) &&
    !resetNow &&
    !loaded &&
    !ownDetails &&
    (session.history.length || session.customer)
  ) {
    const search = searchedNow ? session.search : undefined;
    stale = session.card;
    startInteraction(session);
    if (search) session.search = search;
  }
  const name = typeof who?.name === "string" && who.name.trim() ? who.name.trim().slice(0, 60) : undefined;
  if (number && !loaded && number !== session.customer?.phone && store?.findCustomer) {
    // Not on file. Asked to look it up, it says so; given as this customer's number, it is saved.
    if (who?.arrived === "returning" || !(askedBefore || name || session.named || who?.arrived === "new"))
      customerLine = t(session.language, "customer.notfound", { v: number });
    else {
      const known = name ?? session.named;
      session.customer = { id: randomUUID(), phone: number, ...(known ? { name: known } : {}) };
      recordPurchase(session, pack);
      customerLine = t(session.language, "customer.saved", { v: known ?? "" });
    }
  } else if (name && session.customer && !session.customer.name) session.customer.name = name;
  else if (name && !session.customer) session.named = name;

  const extra = (decision.card as { facts?: { name?: string; value?: string }[] })?.facts;
  if (Array.isArray(extra))
    for (const fact of extra)
      if (
        fact?.name &&
        fact?.value &&
        stale.facts?.[String(fact.name).slice(0, 40)] !== String(fact.value).slice(0, 80)
      )
        session.card.facts = {
          ...session.card.facts,
          [String(fact.name).slice(0, 40)]: String(fact.value).slice(0, 80),
        };
  for (const [field, value] of Object.entries(decision.card ?? {}))
    if (
      CARD_FIELDS.has(field) &&
      value !== null &&
      value !== undefined &&
      !(Array.isArray(value) && !value.length) &&
      JSON.stringify((stale as Record<string, unknown>)[field]) !== JSON.stringify(value)
    )
      (session.card as Record<string, unknown>)[field] = value;
  decision = { ...decision, reason: reasonFrom(session.card, decision.because, decision.reason) };
  session.shortlist = (decision.shortlist ?? [])
    .filter((sku) => pack.products.some((product) => product.sku === sku))
    .slice(0, 3);
  session.assessed = isAssessed(session.card);
  // A customer's own need tied to the products in front of them is a difference shown, flag or no flag.
  if (decision.demonstrated || (decision.reason && session.shortlist.length)) session.demonstrated = true;
  if (decision.objection && !session.objections?.includes(decision.objection))
    session.objections = [...(session.objections ?? []), String(decision.objection).slice(0, 120)];
  // A wrong belief the customer raised and this reply answered is the Validate step, whatever the
  // model named the turn: it corrected "bigger is always better" and called it assess.
  if (decision.objection && !session.steps_done.includes("validate")) session.steps_done.push("validate");
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
  // The sale is a tap. While a pick waits, the tap that closes it is always on the reply.
  if (session.selection && !session.sold) reply = { ...reply, buttons: awaitingSale(reply, session.language) };
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
  // Its own slot, because as one more line among the rest the model never wrote it: "served, not
  // interviewed" and the line limit won every time. The words are still the model's.
  const ask = typeof decision.ask_number === "string" ? decision.ask_number.trim().slice(0, 200) : "";
  // Only with a customer in play: "Hello, good morning" was answered "Shall I make a home card for this
  // customer?" with nobody standing there.
  const serving =
    /\b(customer|grahak)\b|ग्राहक|ग्राहिका/i.test(event.text ?? "") ||
    session.shortlist.length > 0 ||
    !!session.selection ||
    Object.values(session.card).some((value) =>
      Array.isArray(value)
        ? value.length > 0
        : typeof value === "object" && value
          ? Object.keys(value).length > 0
          : value !== undefined && value !== null && value !== "",
    );
  if (
    ask &&
    serving &&
    !/\d/.test(ask) &&
    !bad.length &&
    !number &&
    (named.length || (!session.customer && !session.customer_asked && who?.arrived !== "returning"))
  ) {
    session.customer_asked = true;
    // The model sometimes writes its ask among the lines as well, and it went out twice.
    const plain = (line: string) => line.replace(/\*/g, "").trim();
    const said = reply.text
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("↳") && plain(line) !== plain(ask));
    // First, not last: as the second "Ask:" under a product question it read as one more thing to
    // say to the customer, and the associate never saw it was the home card being offered.
    reply = { ...reply, text: [ask, ...said.slice(0, 5)].join("\n") };
  }
  // Given only the number, the model has nothing to add, and its empty answer became "Tell me what
  // the customer said" under "Card saved".
  // On the turn the code says the card is saved or found, the model said it again ("Welcome back,
  // Rahul…", "Meena ji ke liye home card ban gaya hai") or greeted the associate by the customer's
  // name: "Okay, Suresh." went to the associate, who is not Suresh.
  const customerName = session.customer?.name;
  if (customerLine && customerName) {
    const escaped = customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const greeting = new RegExp(
      `^(?:(?:ok(?:ay)?|got it|great|sure|theek hai|thik hai|achha|accha|haan)[,!.]?\\s*)?${escaped}(?:\\s*ji)?\\s*[,.!]\\s*`,
      "iu",
    );
    reply = {
      ...reply,
      text: reply.text
        .split("\n")
        .map((line) => line.replace(greeting, ""))
        .filter((line) => !/welcome back|home card|\bcard\b|कार्ड/i.test(line.replace(/\*/g, "")))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    };
  }
  const nothingSaid = !reply.text.trim() || !decision.lines?.some((line) => typeof line === "string" && line.trim());
  return remember(
    withoutUnavailableCharges(
      customerLine ? { ...reply, text: nothingSaid ? customerLine : `${customerLine}\n${reply.text}` } : reply,
    ),
  );
}
