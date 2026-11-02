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

/** The associate relaying a question, or asking for words to say. "Customer is asking what warranty
 *  comes with the TCL" is a question about the TCL, however much it mentions the customer — and it
 *  is the most natural way an associate on the floor phrases one. */
const RELAYING =
  /\b(asking|asks|asked|wants to know|wants to understand|poochh?|puchh?|pooch raha|what do i (say|tell|do)|how do i (say|tell|explain)|kya bolun|kya bataun|क्या बताऊँ|पूछ रहा)\b/i;

/** Nobody on a shop floor writes to their manager without addressing them. "Namaste sir" was not
 *  a greeting and "boss kitne ka target hai aaj" was not a question, because both patterns are
 *  anchored and the address word sat where the anchor is. It comes off before either is tried.
 *
 *  No \b on the Devanagari words: in JavaScript a word boundary only knows ASCII. */
const ADDRESS_FIRST =
  /^(?:(?:boss|bhai|bhaiya|bro|sir|sirji|madam|ma'?am|yaar|saab|anna|ji|भाई|भैया|सर|बॉस|साहब|जी)[\s,.!]+)+/i;
const ADDRESS_LAST =
  /(?:^|[\s,])(?:boss|bhai|bhaiya|bro|sir|sirji|madam|ma'?am|yaar|saab|anna|ji|भाई|भैया|सर|बॉस|साहब|जी)[\s!.।?]*$/i;

export function plain(text: string): string {
  return text.replace(ADDRESS_FIRST, "").replace(ADDRESS_LAST, "").trim() || text.trim();
}

export function intentOf(text: string | undefined): Intent {
  if (!text?.trim()) return "customer";
  const addressed = plain(text);
  if (GREETING.test(addressed)) return "greeting";
  if (RELAYING.test(text)) return "question";
  const asks = ASKING.test(addressed) || /\?\s*$/.test(text);
  if (!asks) return "customer";
  // "Do they have WiFi?" is the associate reporting the home, not asking the shop about itself.
  // A question that is mostly about the customer is still a description.
  return DESCRIBING.test(text) ? "customer" : "question";
}

/** Asked something specific about a set that its summary does not answer: the warranty, the
 *  delivery, what the installation costs, the exchange. The sheet is the right answer to "is the
 *  TCL any good" and the wrong one to "what warranty comes with it", so these go to the model,
 *  which has the charges, the finance terms and the offers in front of it. */
const TOPIC =
  /\b(warrant\w*|guarantee|deliver\w*|install\w*|exchange|emi|finance|instal?ment|service|return|replace\w*|setup|set up|mount\w*|bracket|insurance|garanti|offers?|discounts?|deals?|scheme|cashback|ऑफर|वारंटी|डिलीवरी)\b/i;

export function asksSomethingSpecific(text: string): boolean {
  return TOPIC.test(text);
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
  // A screen says its size and panel; everything else says what it is. The live catalogue has
  // washing machines in it, and this listed them as `Foxsky 0" LED`.
  const listed = here
    .map((product) =>
      product.size_inch > 0
        ? `${product.brand} ${product.size_inch}" ${product.panel}`
        : `${product.brand} ${product.name.replace(product.brand, "").trim().slice(0, 28)}`,
    )
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
