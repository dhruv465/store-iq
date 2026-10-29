import type { Pack } from "./pack.js";
import type { Lang } from "./i18n.js";
import { t } from "./i18n.js";
import type { Reply } from "./types.js";

/** Section 4C: the customer says something partly true. Store IQ hands the associate a line that
 *  confirms the true part first, then corrects the rest, using the supplied facts.
 *
 *  The pack already carries the confirm/correct pair for each known claim, so matching the claim is
 *  the whole job and no model request is needed. */

const STOP = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "it",
  "its",
  "this",
  "that",
  "they",
  "them",
  "he",
  "she",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "as",
  "at",
  "by",
  "from",
  "says",
  "say",
  "said",
  "thinks",
  "think",
  "customer",
  "grahak",
  "wants",
  "want",
  "much",
  "very",
  "so",
  "too",
  "my",
  "his",
  "her",
  "their",
  "you",
  "your",
  "i",
  "we",
  "me",
  "also",
  "will",
  "would",
  "can",
  "could",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "be",
  "been",
  "being",
  "not",
  "no",
  "yes",
  "always",
  "never",
]);

export function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

export type Myth = Pack["myths"][number];

/** The pack myth this claim is about, or null when the pack has nothing to say about it. */
export function matchMyth(pack: Pack, text: string): Myth | null {
  const said = contentWords(text);
  if (said.size < 2) return null;
  let best: { myth: Myth; score: number } | null = null;
  for (const myth of pack.myths ?? []) {
    const claim = contentWords(myth.claim);
    if (!claim.size) continue;
    let shared = 0;
    for (const word of claim) if (said.has(word)) shared++;
    // Share of the claim that was actually said, so a long rambling note cannot dilute a match.
    const score = shared / claim.size;
    if (shared >= 2 && score >= 0.4 && (!best || score > best.score)) best = { myth, score };
  }
  return best?.myth ?? null;
}

const TRIGGER =
  /\b(customer|he|she|they|grahak)\s+(says?|said|thinks?|believes?|told|bol)|^\s*(validate|correct this)\b/i;

export function looksLikeAClaim(text: string | undefined, action: string | undefined): boolean {
  return action === "validate" || (!!text && TRIGGER.test(text));
}

/** Confirm what is true, then correct what is not, in words the associate can say out loud. */
export function validateReply(pack: Pack, text: string, lang: Lang = "en"): Reply | null {
  const myth = matchMyth(pack, text);
  if (!myth) return null;
  return {
    text: [t(lang, "val.say", { body: `${myth.confirm} ${myth.correct}` }), t(lang, "val.reason")]
      .join("\n")
      .slice(0, 1000),
  };
}
