import { randomInt } from "node:crypto";
import { isAssessed } from "./brain.js";
import type { Pack } from "./pack.js";
import { score } from "./steps.js";
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
  const area =
    /\b(install|wall|mount|site|bracket|socket)\b/.test(lower) ? "installation and site survey"
    : /\b(emi|finance|loan|instal?ment|card|interest)\b/.test(lower) ? "finance and EMI"
    : /\b(stock|deliver|when|date|available)\b/.test(lower) ? "stock and delivery dates"
    : "product and specifications";
  const expert = pack.experts?.find((candidate) => candidate.area === area) ?? pack.experts?.[0];
  return expert ?? { area, name: "the department manager" };
}

export function newReference(): string {
  return `SIQ-${randomInt(1000, 9999)}`;
}

/** Logs the question against a named owner and gives the associate a line to hold the customer with. */
export function expertReply(pack: Pack, question: string, reference: string, lang: Lang = "en"): { reply: Reply; area: string; owner: string } {
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

/** What the department manager sees: today's conversations, the weak step, and open questions. */
export function managerView(sessions: Session[], open: { reference: string; area: string; owner?: string }[]): Reply {
  const real = sessions.filter((session) => session.steps_done.length > 0);
  if (!real.length) return { text: "No conversations yet today.\n↳ The view fills as associates use the number." };
  const scores = real.map((session) => score(session).points).sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)]!;
  const missed = new Map<string, number>();
  for (const session of real) for (const step of score(session).missing) missed.set(step, (missed.get(step) ?? 0) + 1);
  const weakest = [...missed.entries()].sort((a, b) => b[1] - a[1])[0];
  const assessedFirst = real.filter((session) => isAssessed(session.card)).length;
  return {
    text: [
      `Today: ${real.length} conversations, median ${median} of 14. Home assessed in ${assessedFirst} of ${real.length}.`,
      weakest ? `Most skipped step: ${weakest[0].replace(/_/g, " ")}, missed in ${weakest[1]}.` : "",
      open.length ? `Open expert questions: ${open.length} · ${open.slice(0, 2).map((q) => q.reference).join(", ")}` : "No open expert questions.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1000),
  };
}
