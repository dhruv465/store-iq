import { t, type Lang } from "./i18n.js";
import type { Reply } from "./types.js";

// No \b: in JavaScript a word boundary only knows ASCII, so "नमस्ते\b" never matched and a Hindi
// hello fell through to the model — which then answered in Hindi with an English reason line.
const GREETING =
  /^\s*(hi|hey|hello|yo|hii+|namaste|namaskar|salaam|good (morning|afternoon|evening)|नमस्ते|नमस्कार|नमस्कारम्|हाय|हॅलो)[\s!.।]*$/i;

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
export function greetingReply(lang: Lang, hasBrief = false): Reply {
  return {
    text: [t(lang, "greet.back"), `↳ ${t(lang, "greet.reason")}`].filter(Boolean).join("\n"),
    buttons: [
      ...(hasBrief ? [{ id: "brief", title: t(lang, "btn.brief") }] : []),
      { id: "new_customer", title: t(lang, "btn.new") },
    ],
  };
}
