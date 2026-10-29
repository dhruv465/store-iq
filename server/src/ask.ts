import type { Pack } from "./pack.js";
import { t, type Lang } from "./i18n.js";
import type { HomeCard, Reply } from "./types.js";

/** Telling a question from a fact.
 *
 *  Everything an associate typed used to be read as a description of the customer's home, so
 *  "is the Sony good for a dark room" was filed as light = dim, and "what TVs do we have in stock"
 *  was answered with "how far will you sit from the TV?". An associate who does not yet know the
 *  range has to be able to ask, and a store expert answers. */

export type Intent = "greeting" | "question" | "customer";

// No \b: in JavaScript a word boundary only knows ASCII, so "नमस्ते\b" never matched and a Hindi
// hello fell through to the model — which then answered in Hindi with an English reason line.
const GREETING =
  /^\s*(hi|hey|hello|yo|hii+|namaste|namaskar|salaam|good (morning|afternoon|evening)|नमस्ते|नमस्कार|नमस्कारम्|हाय|हॅलो)[\s!.।]*$/i;

/** A question asks for something we hold; a description tells us something about this customer. */
const ASKING =
  /^\s*(what|which|whats|what's|how|do we|do you|does|did|is|are|can|could|should|any|where|who|tell me|show me|kya|kaun|kaunsa|konsa|kitna|kitne|hai kya|batao|bata|कौन|क्या|कितन|कुठ|काय|किती)\b/i;

/** Said about the customer, not asked about the shop: "they sit", "customer wants", "he watches". */
const DESCRIBING = /\b(they|them|their|customer|grahak|he |she |his |her |family|wants|watches|sits|budget)\b/i;

export function intentOf(text: string | undefined): Intent {
  if (!text?.trim()) return "customer";
  if (GREETING.test(text)) return "greeting";
  const asks = ASKING.test(text) || /\?\s*$/.test(text);
  if (!asks) return "customer";
  // "Do they have WiFi?" is the associate reporting the home, not asking the shop about itself.
  // A question that is mostly about the customer is still a description.
  return DESCRIBING.test(text) ? "customer" : "question";
}

/** Asked what the shop has, rather than about one set. */
const STOCK = /\b(stock|available|availability|have|carry|range|options|models|choices|kya hai|maal)\b/i;

export function asksWhatWeHave(text: string): boolean {
  return STOCK.test(text);
}

/** What is on the floor today, deliberately without prices.
 *
 *  Our associates opened with price in 6 of 6 conversations, so answering "what do we have" with a
 *  price list would be the product teaching the habit it exists to break. Brand, size and panel
 *  are enough for an associate to point at a wall; the price comes after the home. */
export function inStockReply(pack: Pack, card: HomeCard, lang: Lang, assessed: boolean): Reply {
  const here = pack.products.filter((product) => product.stock_units > 0);
  if (!here.length) return { text: t(lang, "rec.nostock") };
  const listed = here
    .map((product) => `${product.brand} ${product.size_inch}" ${product.panel}`)
    .slice(0, 6)
    .join(" · ");
  return {
    text: [
      t(lang, "stock.have", { body: listed }),
      assessed ? t(lang, "stock.narrow") : t(lang, "stock.first"),
      `↳ ${t(lang, assessed ? "stock.reason.assessed" : "stock.reason")}`,
    ].join("\n"),
    buttons: assessed
      ? [{ id: "recommend", title: t(lang, "btn.three") }]
      : [{ id: "card:show", title: t(lang, "btn.showcard") }],
  };
}

/** Hello is answered the way a manager answers it in the aisle: by asking what is going on. Not a
 *  menu of what this thing can do, and not the first question of a questionnaire. It stays written
 *  rather than generated because a greeting is not worth one of the day's model requests. */
export function greetingReply(lang: Lang): Reply {
  return {
    text: [t(lang, "greet.back"), `↳ ${t(lang, "greet.reason")}`].filter(Boolean).join("\n"),
    buttons: [
      { id: "brief", title: t(lang, "btn.brief") },
      { id: "new_customer", title: t(lang, "btn.new") },
    ],
  };
}
