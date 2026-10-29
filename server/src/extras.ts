import { randomInt } from "node:crypto";
import { isAssessed } from "./brain.js";
import type { Pack } from "./pack.js";
import { GUIDE, MAX_SCORE, score, SCORED, type Scored } from "./steps.js";
import { t, type Lang } from "./i18n.js";
import type { Reply, Session } from "./types.js";

/** The contest's extra points: "ask an expert" and the department manager view.
 *  Both are facts about the pack and the database, so neither spends a model request. */

const EXPERT = /\b(ask an expert|expert|escalate|specialist|senior|poocho|poochho)\b/i;
const MANAGER = /^\s*(team|manager|floor|today|shift report|dashboard)\b/i;

export function wantsExpert(text: string | undefined, action: string | undefined): boolean {
  return action === "ask_expert" || (!!text && EXPERT.test(text));
}

export function wantsManagerView(text: string | undefined, action: string | undefined): boolean {
  return action === "manager" || (!!text && MANAGER.test(text));
}

/** Route by what the question is about, so it reaches someone who can actually answer it. */
export function routeTo(pack: Pack, question: string): { area: string; name: string } {
  const lower = question.toLowerCase();
  const area = /\b(install|wall|mount|site|bracket|socket)\b/.test(lower)
    ? "installation and site survey"
    : /\b(emi|finance|loan|instal?ment|card|interest)\b/.test(lower)
      ? "finance and EMI"
      : /\b(stock|deliver|when|date|available)\b/.test(lower)
        ? "stock and delivery dates"
        : "product and specifications";
  const expert = pack.experts?.find((candidate) => candidate.area === area) ?? pack.experts?.[0];
  return expert ?? { area, name: "the department manager" };
}

export function newReference(): string {
  return `SIQ-${randomInt(1000, 9999)}`;
}

/** Logs the question against a named owner and gives the associate a line to hold the customer with. */
export function expertReply(
  pack: Pack,
  question: string,
  reference: string,
  lang: Lang = "en",
): { reply: Reply; area: string; owner: string } {
  const { area, name } = routeTo(pack, question);
  return {
    area,
    owner: name,
    reply: {
      text: [
        `Sent to ${name} · ${reference}`,
        t(lang, "exp.say", { area }),
        "↳ Logged against an owner, so it does not get lost when you move to the next customer.",
      ].join("\n"),
    },
  };
}

export type AssociateRow = {
  phone: string;
  name: string;
  conversations: number;
  /** The gap the store visits named: how often this associate actually learned the home. */
  homeCards: number;
  readBack: number;
  median: number;
  best: number;
  guide: number;
  homeBeforePrice: number;
};

/** One row per associate, which is what a manager is looking at: how many customers they took, how
 *  many of those they actually learned the home for, and the number out of 14 that follows from it. */
export function perAssociate(sessions: Session[]): AssociateRow[] {
  const byPhone = new Map<string, Session[]>();
  for (const session of sessions) byPhone.set(session.phone, [...(byPhone.get(session.phone) ?? []), session]);
  const rows = [...byPhone.entries()].map(([phone, all]) => {
    const points = all.map((session) => score(session).points).sort((a, b) => a - b);
    return {
      phone,
      name: all.find((session) => session.associate)?.associate ?? phone,
      conversations: all.length,
      homeCards: all.filter((session) => isAssessed(session.card)).length,
      readBack: all.filter((session) => session.card_confirmed).length,
      median: points[Math.floor(points.length / 2)] ?? 0,
      best: points[points.length - 1] ?? 0,
      guide: points.filter((value) => value >= GUIDE).length,
      homeBeforePrice: all.filter((session) => !session.priced_before_home).length,
    };
  });
  // The floor's own order: the strongest associate first, so the manager reads the gap downwards.
  return rows.sort((a, b) => b.median - a.median || b.conversations - a.conversations);
}

/** What the department manager sees, in the shape of the store-visit findings' own table: the
 *  median against the judges' 14, how many reached Guide, how the floor scores on Assess — the
 *  measure the visits called our largest gap — and the step it is weakest on today. */
export function managerView(sessions: Session[], open: { reference: string; area: string; owner?: string }[]): Reply {
  // A conversation that only ever looked at one set is still a conversation, and it is exactly the
  // one where the price comes first, so it must not be invisible here.
  const real = sessions.filter((session) => session.steps_done.length > 0 || session.shortlist.length > 0);
  if (!real.length) return { text: "No conversations yet today.\n\u21b3 The view fills as associates use the number." };
  const scored = real.map((session) => score(session));
  const points = scored.map((card) => card.points).sort((a, b) => a - b);
  const median = points[Math.floor(points.length / 2)]!;
  const guides = points.filter((value) => value >= GUIDE).length;
  const average = (step: Scored): number => scored.reduce((total, card) => total + card.marks[step], 0) / real.length;
  // Assess is reported whatever it scores, because it is the gap the visits named.
  const weakest = SCORED.filter((step) => step !== "assess")
    .map((step) => [step, average(step)] as const)
    .sort((a, b) => a[1] - b[1])[0]!;
  const readBack = real.filter((session) => session.card_confirmed).length;
  return {
    text: [
      `Today: ${real.length} conversations · median ${median} of ${MAX_SCORE} · ${guides} at Guide (${GUIDE}+)`,
      `Assess ${average("assess").toFixed(1)} of 2 · home before price in ${
        real.filter((session) => !session.priced_before_home).length
      } of ${real.length} · weakest ${weakest[0].replace(/_/g, " ")} ${weakest[1].toFixed(1)} of 2`,
      `Home read back in ${readBack} of ${real.length}. ${
        open.length
          ? `Open questions: ${open.length} · ${open
              .slice(0, 2)
              .map((question) => question.reference)
              .join(", ")}`
          : "No open expert questions."
      }`,
    ]
      .join("\n")
      .slice(0, 1000),
  };
}
