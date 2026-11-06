import { t, type Lang } from "./i18n.js";
import type { Reply } from "./types.js";

// No \b: in JavaScript a word boundary only knows ASCII, so "नमस्ते\b" never matched and a Hindi
// hello fell through to the model — which then answered in Hindi with an English reason line.
const HELLO =
  "(?:hi|hey|hello|yo|hii+|namaste|namaskar|salaam|good (?:morning|afternoon|evening)|नमस्ते|नमस्कार|नमस्कारम्|हाय|हॅलो)";
/** What a voice note adds around a hello: "Hello, good morning.", "Good morning, Store IQ.", "Hi, how are
 *  you?". Each went to the model, which answered without the brief and offered a home card for nobody. */
const HELLO_TAIL =
  "(?:store ?iq|there|team|everyone|all|how are you|how r u|how's it going|what'?s up|wh?ass?up|sup|kaise ho|kya haal hai|kya chal raha hai|कैसे हो|क्या हाल है)";
const GREETING = new RegExp(`^\\s*${HELLO}(?:[\\s,!.।?]+(?:${HELLO}|${HELLO_TAIL}))*[\\s!.।?]*$`, "i");

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

export function isGreeting(text: string | undefined): boolean {
  return !!text?.trim() && GREETING.test(plain(text));
}

/** Hello is answered the way a manager answers it in the aisle: by asking what is going on. Not a
 *  menu of what this thing can do, and not the first question of a questionnaire. It stays written
 *  rather than generated because a greeting is not worth one of the day's model requests. */
export function greetingReply(lang: Lang, hasBrief = false, due = 0): Reply {
  return {
    text: [t(lang, "greet.back"), due ? t(lang, "fu.due", { n: due }) : "", `↳ ${t(lang, "greet.reason")}`]
      .filter(Boolean)
      .join("\n"),
    buttons: [
      // The first message of the day is usually hello: the check-backs due today ride on it.
      ...(due ? [{ id: "followups", title: t(lang, "btn.followups") }] : []),
      ...(hasBrief ? [{ id: "brief", title: t(lang, "btn.brief") }] : []),
      { id: "new_customer", title: t(lang, "btn.new") },
    ],
  };
}
