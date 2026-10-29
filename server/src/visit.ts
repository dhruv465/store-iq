import { randomInt } from "node:crypto";
import type { Pack } from "./pack.js";
import { t, type Lang } from "./i18n.js";
import type { Reply, Session } from "./types.js";

/** The last of the contest's extra points: a store visit, logged by voice note.
 *
 *  The visits of 10 and 11 October are the reason this product exists, and they were written up by
 *  hand after the fact. Somebody standing in a competitor's shop cannot write; they can speak. A
 *  voice note is transcribed by the same path a customer note takes, and this files the words. */

const START = /^\s*(store visit|visit log|log a visit|visit|dukaan dekhi|store dekha)\b/i;

export function wantsVisitLog(text: string | undefined, action: string | undefined): boolean {
  return action === "visit" || (!!text && START.test(text));
}

export function newVisitReference(): string {
  return `SIV-${randomInt(1000, 9999)}`;
}

/** The competitors the store visits actually went to, plus our own stores. A visit that names none
 *  of them is still a visit: the note is what matters, and "unnamed store" is honest. */
const KNOWN = [
  "Croma",
  "Vijay Sales",
  "Reliance Digital",
  "Reliance Smart",
  "Amazon",
  "Flipkart",
  "Sony Center",
  "Samsung Smart Plaza",
  "LG Best Shop",
];

/** Where they were, taken from their own words rather than asked for in a second question. */
export function storeNamed(text: string, pack?: Pack): string {
  const known = [...KNOWN, ...(pack?.store?.name ? [pack.store.name] : [])];
  const found = known.find((name) => new RegExp(`\\b${name.replace(/[^A-Za-z ]/g, "")}\\b`, "i").test(text));
  if (!found) return "unnamed store";
  // "Croma CBD Belapur" is more use to a manager than "Croma", so keep what follows the name.
  const where = text.match(new RegExp(`\\b${found}\\b[\\s,]*([A-Z][A-Za-z]*(?:\\s+[A-Z][A-Za-z]*){0,2})`));
  return where?.[1] ? `${found} ${where[1]}`.trim().slice(0, 60) : found;
}

/** Filed, with a reference the visitor can quote and the store it was about. */
export function visitFiled(reference: string, store: string, lang: Lang): Reply {
  return {
    text: [t(lang, "visit.filed", { reference, store }), t(lang, "visit.more"), `↳ ${t(lang, "visit.reason")}`].join(
      "\n",
    ),
  };
}

/** The prompt that opens the log, so the next thing they say is filed rather than read as a home. */
export function visitOpened(lang: Lang): Reply {
  return {
    text: [t(lang, "visit.open"), `↳ ${t(lang, "visit.openreason")}`].join("\n"),
  };
}

/** A visit note is only worth filing if there is something in it. */
export function worthFiling(text: string | undefined): boolean {
  return !!text && text.trim().split(/\s+/).length >= 4;
}

export function startVisitLog(session: Session): void {
  session.logging_visit = true;
}

export function endVisitLog(session: Session): void {
  delete session.logging_visit;
}
