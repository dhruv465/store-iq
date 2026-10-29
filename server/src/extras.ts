import { randomInt } from "node:crypto";
import { isAssessed } from "./brain.js";
import type { Pack } from "./pack.js";
import { GUIDE, MAX_SCORE, score, SCORED, type Scored } from "./steps.js";
import { t, type Lang } from "./i18n.js";
import type { HomeCard, Reply, Session, Step } from "./types.js";

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

export type Rostered = { phone: string; name: string; lastSeen?: string };

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
  /** On the manager's roster, rather than a number that simply turned up. */
  onRoster: boolean;
  lastSeen?: string;
  /** Step marks breakdown (0 to 2) averaged across their conversations. */
  stepMarks?: Record<Scored, number>;
};

/** One row per associate, which is what a manager is looking at: how many customers they took, how
 *  many of those they actually learned the home for, and the number out of 14 that follows from it. */
export function perAssociate(sessions: Session[], roster: Rostered[] = []): AssociateRow[] {
  const byPhone = new Map<string, Session[]>();
  // Every rostered associate starts with no conversations, so the one who did nothing today is in
  // the table rather than missing from it. That absence is the thing a manager is looking for.
  for (const person of roster) byPhone.set(person.phone, []);
  for (const session of sessions) byPhone.set(session.phone, [...(byPhone.get(session.phone) ?? []), session]);
  const listed = new Map(roster.map((person) => [person.phone, person]));
  const rows = [...byPhone.entries()].map(([phone, all]) => {
    const points = all.map((session) => score(session).points).sort((a, b) => a - b);
    const stepMarks: Record<Scored, number> = {
      assess: 0,
      validate: 0,
      translate: 0,
      demonstrate: 0,
      complete: 0,
      close: 0,
      follow_through: 0,
    };
    if (all.length) {
      const scoredList = all.map((session) => score(session));
      for (const st of SCORED) {
        const sum = scoredList.reduce((acc, card) => acc + card.marks[st], 0);
        stepMarks[st] = Number((sum / all.length).toFixed(1));
      }
    }
    return {
      phone,
      // The roster is the manager's own spelling, so it wins over a WhatsApp profile name.
      name: listed.get(phone)?.name ?? all.find((session) => session.associate)?.associate ?? phone,
      onRoster: listed.has(phone),
      ...(listed.get(phone)?.lastSeen ? { lastSeen: listed.get(phone)!.lastSeen } : {}),
      conversations: all.length,
      homeCards: all.filter((session) => isAssessed(session.card)).length,
      readBack: all.filter((session) => session.card_confirmed).length,
      median: points[Math.floor(points.length / 2)] ?? 0,
      best: points[points.length - 1] ?? 0,
      guide: points.filter((value) => value >= GUIDE).length,
      homeBeforePrice: all.filter((session) => !session.priced_before_home).length,
      stepMarks,
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

export type ObjectionInsight = {
  claim: string;
  count: number;
  confirm?: string | undefined;
  correct?: string | undefined;
  associates: string[];
};

/** Aggregates customer objections / myths raised during conversations today. */
export function objectionInsights(sessions: Session[], pack?: Pack): ObjectionInsight[] {
  const counts = new Map<string, { count: number; associates: Set<string> }>();
  for (const session of sessions) {
    const name = session.associate ?? session.phone;
    for (const claim of session.objections ?? []) {
      const existing = counts.get(claim) ?? { count: 0, associates: new Set<string>() };
      existing.count++;
      existing.associates.add(name);
      counts.set(claim, existing);
    }
  }
  const packMyths = new Map(pack?.myths?.map((m) => [m.claim, m]) ?? []);
  const results: ObjectionInsight[] = [...counts.entries()].map(([claim, data]) => ({
    claim,
    count: data.count,
    confirm: packMyths.get(claim)?.confirm,
    correct: packMyths.get(claim)?.correct,
    associates: [...data.associates],
  }));
  for (const myth of pack?.myths ?? []) {
    if (!counts.has(myth.claim)) {
      results.push({
        claim: myth.claim,
        count: 0,
        confirm: myth.confirm,
        correct: myth.correct,
        associates: [],
      });
    }
  }
  return results.sort((a, b) => b.count - a.count);
}

export type ProductInsight = {
  sku: string;
  name: string;
  brand: string;
  price: number;
  stock: number;
  shortlistedCount: number;
  selectedCount: number;
};

/** Tracks SKU recommendation and selection distribution across today's sessions. */
export function productInsights(sessions: Session[], pack?: Pack): ProductInsight[] {
  if (!pack?.products?.length) return [];
  const shortlisted = new Map<string, number>();
  const selected = new Map<string, number>();
  for (const session of sessions) {
    for (const sku of session.shortlist ?? []) {
      shortlisted.set(sku, (shortlisted.get(sku) ?? 0) + 1);
    }
    if (session.selection?.sku) {
      selected.set(session.selection.sku, (selected.get(session.selection.sku) ?? 0) + 1);
    }
  }
  return pack.products
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      price: p.price_rupees,
      stock: p.stock_units,
      shortlistedCount: shortlisted.get(p.sku) ?? 0,
      selectedCount: selected.get(p.sku) ?? 0,
    }))
    .sort((a, b) => b.selectedCount - a.selectedCount || b.shortlistedCount - a.shortlistedCount);
}

export type FeedItem = {
  interactionId: string;
  phone: string;
  associate: string;
  step: Step;
  score: number;
  homeFactsCount: number;
  room?: string | undefined;
  distance?: string | undefined;
  budget?: number | undefined;
  shortlist: string[];
  selectionSku?: string | undefined;
  pricedBeforeHome: boolean;
  consent: boolean;
  siteChecked: boolean;
  startedAt: string;
  turnsCount: number;
  lastLine?: string | undefined;
};

/** Live stream of recent customer interactions on the shop floor. */
export function floorFeed(sessions: Session[], limit = 25): FeedItem[] {
  const real = sessions.filter(
    (session) => session.steps_done.length > 0 || session.shortlist.length > 0 || session.history.length > 0,
  );
  const items: FeedItem[] = real.map((session) => {
    const scored = score(session);
    const card = session.card;
    const factsCount = Object.keys(card).filter(
      (k) => card[k as keyof HomeCard] !== undefined && card[k as keyof HomeCard] !== "",
    ).length;
    const distance = card.distance_m
      ? `${card.distance_m} m`
      : card.distance_feet
        ? `${card.distance_feet} ft`
        : undefined;
    const lastTurn = session.history[session.history.length - 1];
    return {
      interactionId: session.interaction_id,
      phone: session.phone,
      associate: session.associate ?? session.phone,
      step: session.step,
      score: scored.points,
      homeFactsCount: factsCount,
      room: card.room,
      distance,
      budget: card.budget_rupees,
      shortlist: session.shortlist ?? [],
      selectionSku: session.selection?.sku,
      pricedBeforeHome: session.priced_before_home === true,
      consent: session.consent,
      siteChecked: session.site_checked === true,
      startedAt: session.interaction_started,
      turnsCount: session.history.length,
      lastLine: lastTurn ? `${lastTurn.who}: ${lastTurn.text.slice(0, 100)}` : undefined,
    };
  });
  return items.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, limit);
}
