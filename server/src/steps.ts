import type { Pack } from "./pack.js";
import { isAssessed } from "./brain.js";
import type { Reply, Session, Step } from "./types.js";
import { t, v } from "./i18n.js";
import { STEPS } from "./types.js";

/** The brief and the review are facts about the pack and the shift, so they never reach the model:
 *  no request spent, no figure invented, and an answer in milliseconds rather than seconds. */

const NEW_CUSTOMER_WORDS = /^\s*(new customer|next customer|naya customer|new client|reset|done with)\b/i;

/** The card belongs to one customer on the floor; the associate says when the next one walks up. */
export function wantsNewCustomer(text: string | undefined, action: string | undefined): boolean {
  return action === "new_customer" || (!!text && NEW_CUSTOMER_WORDS.test(text));
}

/** Plain words for what Store IQ believes about this home, in the brief's "I heard" shape. */
export function cardSummary(session: Session): Reply {
  const card = session.card;
  const lang = session.language;
  const parts: string[] = [];
  if (card.room) parts.push(v(lang, String(card.room)));
  if (card.space) parts.push(String(card.space));
  if (card.distance_m) parts.push(t(lang, "sits.m", { n: card.distance_m }));
  else if (card.distance_feet) parts.push(t(lang, "sits.ft", { n: card.distance_feet }));
  if (card.light) parts.push(v(lang, String(card.light)));
  if (card.mount) parts.push(t(lang, "mount.of", { v: v(lang, String(card.mount)) }));
  if (card.content?.length) parts.push(card.content.map((entry) => v(lang, entry)).join(", "));
  if (card.family) {
    const people = String(card.family).match(/(\d+)/);
    parts.push(people ? t(lang, "people.n", { n: people[1]! }) : String(card.family));
  }
  if (card.devices?.length) parts.push(t(lang, "has", { v: card.devices.map((entry) => v(lang, entry)).join(", ") }));
  if (card.replacing) parts.push(String(card.replacing));
  if (card.priorities?.length) parts.push(t(lang, "cares", { v: card.priorities.map((entry) => v(lang, entry)).join(", ") }));
  if (card.site_constraints?.length) parts.push(card.site_constraints.join(", "));
  if (card.internet) parts.push(String(card.internet));
  if (card.budget_rupees) parts.push(t(lang, "budget.of", { v: card.budget_rupees }));
  return {
    text: [
      parts.length ? t(session.language, "card.heard", { body: parts.join("; ") }) : t(session.language, "card.nothing"),
      parts.length ? t(session.language, "card.right") : t(session.language, "card.tellme"),
    ].join("\n"),
    ...(parts.length
      ? {
          buttons: [
            { id: "card:confirmed", title: t(session.language, "btn.yes") },
            { id: "card:correct", title: t(session.language, "btn.fix") },
            { id: "new_customer", title: t(session.language, "btn.new") },
          ],
        }
      : {}),
  };
}

const BRIEF_WORDS = /^\s*(brief|shift|start shift|today|aaj|shuru)\b/i;
const REVIEW_WORDS = /^\s*(review|score|how did i do|kaisa raha)\b/i;

export function wantsBrief(text: string | undefined, action: string | undefined): boolean {
  return action === "brief" || (!!text && BRIEF_WORDS.test(text));
}

export function wantsReview(text: string | undefined, action: string | undefined): boolean {
  return action === "review" || (!!text && REVIEW_WORDS.test(text));
}

/** Before the shift: today's stock, the changed offers, one short video and one question. */
export function shiftBrief(pack: Pack): Reply {
  const brief = pack.shift_brief ?? {};
  const stock: string[] = Array.isArray(brief.stock_changes) ? brief.stock_changes : [];
  const offers: string[] = Array.isArray(brief.offer_changes) ? brief.offer_changes : [];
  const video = brief.video ?? {};
  const question = brief.question ?? {};
  const options: string[] = Array.isArray(question.options) ? question.options.slice(0, 3) : [];
  const lines = [
    `${pack.store?.name ?? "Your store"} · ${brief.date ?? "today"}`,
    stock.length ? `Stock: ${stock.join(" · ")}` : "Stock: no changes today.",
    offers.length ? `Offers: ${offers.join(" · ")}` : "Offers: no changes today.",
    video.title ? `Watch (${video.minutes ?? "?"} min): ${video.title}` : "",
    question.text ? `Question: ${question.text}` : "",
  ].filter(Boolean);
  return {
    text: lines.join("\n").slice(0, 1000),
    ...(options.length
      ? { buttons: options.map((option) => ({ id: `brief:answer:${option}`, title: option.slice(0, 20) })) }
      : {}),
  };
}

/** Marks the brief question without a model: the pack holds the answer and the reason. */
export function briefAnswer(pack: Pack, chosen: string): Reply {
  const question = pack.shift_brief?.question ?? {};
  const correct = String(question.answer ?? "");
  const right = chosen.trim().toLowerCase() === correct.trim().toLowerCase();
  return {
    text: [
      right ? `Right: ${correct}.` : `Not quite. The answer is ${correct}, not ${chosen}.`,
      question.reason ? `↳ ${question.reason}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1000),
  };
}

/** The brief lists nine stages (A to I) and the judges score 0 to 14, so coverage is mapped onto
 *  their scale rather than invented: all nine stages is 14, none is 0. */
export const MAX_SCORE = 14;

export function score(session: Session): { points: number; missing: Step[] } {
  const done = new Set<Step>(session.steps_done);
  // Assessing and demonstrating are what the steps are for; claiming them without the evidence is not a step.
  if (!isAssessed(session.card)) done.delete("assess");
  if (!session.demonstrated) done.delete("translate");
  const missing = STEPS.filter((step) => !done.has(step));
  return { points: Math.round((done.size / STEPS.length) * MAX_SCORE), missing };
}

const ADVICE: Record<Step, string> = {
  brief: "Read the brief before the shift; today's stock and offers changed.",
  assess: "Ask about the home before the product: distance, light, what they watch.",
  validate: "When the customer is half right, confirm the true part before correcting.",
  translate: "Turn one spec on the label into a line about their home.",
  recommend: "Give three options with a reason each, and point at one difference.",
  complete: "Give the full cost charge by charge: product, accessories, delivery, installation.",
  close: "Open the offer only after assessing and demonstrating, and state finance in one sentence with its full cost.",
  follow_through: "With consent, send the customer summary, raise the task with an owner and the installation site needs.",
  review: "Score the conversation and take one thing into the next one.",
};

/** A score for the steps, and one thing to try next time. */
export function reviewReply(session: Session): Reply {
  const { points, missing } = score(session);
  const covered = STEPS.filter((step) => !missing.includes(step));
  const next = missing.find((step) => step !== "review");
  return {
    text: [
      t(session.language, "rev.score", { points, max: MAX_SCORE }),
      covered.length ? t(session.language, "rev.covered", { body: covered.join(", ") }) : t(session.language, "rev.none"),
      next ? t(session.language, "rev.next", { body: ADVICE[next] }) : t(session.language, "rev.perfect"),
    ]
      .join("\n")
      .slice(0, 1000),
  };
}

/** The floor order of questions, each with its own answers, so a tap never needs the model. */
export function questionFlow(lang: Session["language"]): { field: string; ask: string; options: [string, string][] }[] {
  return [
    { field: "distance_m", ask: t(lang, "ask.distance"),
      options: [["2-3", "2-3 m"], ["3-4", "3-4 m"], ["", t(lang, "opt.notsure")]] },
    { field: "light", ask: t(lang, "ask.light"),
      options: [["bright afternoon sun", t(lang, "opt.bright")], ["some light", t(lang, "opt.some")], ["dim", t(lang, "opt.dim")]] },
    { field: "mount", ask: t(lang, "ask.mount"),
      options: [["wall", t(lang, "opt.wall")], ["table", t(lang, "opt.table")], ["", t(lang, "opt.notsure")]] },
    { field: "content", ask: t(lang, "ask.content"),
      options: [["cricket", t(lang, "opt.cricket")], ["OTT", t(lang, "opt.ott")], ["news", t(lang, "opt.news")]] },
    { field: "devices", ask: t(lang, "ask.devices"),
      options: [["set-top box", t(lang, "opt.settop")], ["PS5", t(lang, "opt.console")], ["none", t(lang, "opt.nothing")]] },
    { field: "family", ask: t(lang, "ask.family"),
      options: [["two people", t(lang, "opt.two")], ["four people", t(lang, "opt.four")], ["more than four", t(lang, "opt.more")]] },
  ];
}

/** The next unanswered question, with its buttons. "Not sure" carries no value, so it fills nothing. */
export function nextQuestionReply(session: Session, prefix?: string): Reply {
  const lang = session.language;
  const step = questionFlow(lang).find((entry) => {
    const value = (session.card as Record<string, unknown>)[entry.field];
    return Array.isArray(value) ? !value.length : value === undefined || value === null || value === "";
  });
  if (!step)
    return {
      text: [prefix, t(lang, "card.full")].filter(Boolean).join("\n"),
      buttons: [{ id: "card:show", title: t(lang, "btn.showcard") }, { id: "recommend", title: t(lang, "btn.three") }],
    };
  return {
    text: [prefix, step.ask].filter(Boolean).join("\n"),
    buttons: step.options.map(([value, title]) => ({
      id: value ? `card:${step.field}:${value}` : `skip:${step.field}`,
      title,
    })),
  };
}

const RECOMMEND_WORDS = /\b(three options|3 options|recommend|options to show|kaunsa|which ones?)\b/i;

export function wantsRecommend(text: string | undefined, action: string | undefined): boolean {
  return action === "recommend" || (!!text && RECOMMEND_WORDS.test(text));
}

const FOLLOW_WORDS = /^\s*(summary|follow.?through|prepare the summary|close it|consent|summary bhejo)\b/i;

export function wantsFollowThrough(text: string | undefined, action: string | undefined): boolean {
  return action === "follow_through" || (!!text && FOLLOW_WORDS.test(text));
}

/** Section 6.6: the total is computed here, never by the model, so it cannot be wrong. */
export function itemisedTotal(
  pack: Pack,
  selection: NonNullable<Session["selection"]>,
): { lines: string[]; total: number } | null {
  const product = pack.products.find((candidate) => candidate.sku === selection.sku);
  if (!product) return null;
  const lines = [`${product.name} — Rs ${product.price_rupees.toLocaleString("en-IN")}`];
  let total = product.price_rupees;
  for (const id of selection.accessories) {
    const accessory = (pack.accessories ?? []).find((candidate) => candidate.id === id);
    if (!accessory) return null;
    lines.push(`${accessory.title} — Rs ${accessory.price_rupees.toLocaleString("en-IN")}`);
    total += accessory.price_rupees;
  }
  for (const id of selection.charges) {
    const charge = pack.charges.find((candidate) => candidate.id === id);
    if (!charge) return null;
    const amount =
      typeof charge.amount_rupees === "number"
        ? charge.amount_rupees
        : typeof charge.percent_of_price === "number"
          ? Math.round((product.price_rupees * charge.percent_of_price) / 100)
          : null;
    if (amount === null) return null;
    lines.push(`${charge.title} — Rs ${amount.toLocaleString("en-IN")}`);
    total += amount;
  }
  return { lines, total };
}

/** Section 4H: the customer summary, a task with an owner, and the installation job's site needs. */
export function followThrough(session: Session, pack: Pack, associate: string): Reply {
  const selection = session.selection;
  if (!selection) {
    const options = session.shortlist.length ? session.shortlist : pack.products.map((product) => product.sku);
    return {
      text: t(session.language, "ft.which"),
      buttons: options.slice(0, 3).map((sku) => ({
        id: `select:${sku}`,
        title: (pack.products.find((product) => product.sku === sku)?.brand ?? sku).slice(0, 20),
      })),
    };
  }
  const itemised = itemisedTotal(pack, selection);
  if (!itemised) return { text: "That selection is not in today's data pack, so I cannot total it." };
  const product = pack.products.find((candidate) => candidate.sku === selection.sku)!;
  const siteNeeds = [...new Set(selection.charges.flatMap((id) => pack.install_requirements?.[id] ?? []))];

  if (!session.consent)
    return {
      text: [
        t(session.language, "ft.read", { name: product.name, total: itemised.total.toLocaleString("en-IN") }),
        t(session.language, "ft.tap"),
      ].join("\n"),
      buttons: [
        { id: "consent:yes", title: t(session.language, "btn.agreed") },
        { id: "consent:no", title: t(session.language, "btn.declined") },
      ],
    };

  return {
    text: [
      // The first itemised line already names the product; do not say it twice.
      t(session.language, "ft.send", { body: `${itemised.lines.join("; ")}. Total Rs ${itemised.total.toLocaleString("en-IN")}.` }),
      t(session.language, "ft.task", { owner: associate }),
      siteNeeds.length ? t(session.language, "ft.site", { body: siteNeeds.join("; ") }) : t(session.language, "ft.nosite"),
    ].join("\n"),
  };
}
