import { offerAmount, type Pack, type Product } from "./pack.js";
import { isAssessed, stated } from "./brain.js";
import type { Reply, Session, Step } from "./types.js";
import { t, v, type Lang } from "./i18n.js";
import { STEPS } from "./types.js";

/** The brief and the review are facts about the pack and the shift, so they never reach the model:
 *  no request spent, no figure invented, and an answer in milliseconds rather than seconds. */

const NEW_CUSTOMER_WORDS = /^\s*(new customer|next customer|naya customer|new client|reset|done with)\b/i;

/** The card belongs to one customer on the floor; the associate says when the next one walks up. */
export function wantsNewCustomer(text: string | undefined, action: string | undefined): boolean {
  return action === "new_customer" || (!!text && NEW_CUSTOMER_WORDS.test(text));
}

/** What the associate said AFTER announcing the new customer. "New customer asking for iPhone 17
 *  model 256 gb any offers going on?" is one sentence: the card has to be cleared AND the question
 *  answered. It was answered with "new customer, clean card" twice, and the question thrown away
 *  both times, because the command matched the first two words and took the whole turn. */
export function newCustomerRest(text: string | undefined): string {
  if (!text) return "";
  const rest = text.replace(NEW_CUSTOMER_WORDS, "").trim();
  // "new customer" and "new customer." are the command and nothing else.
  return rest.replace(/^[,.:;\-\s]+/, "").trim();
}

/** Plain words for what Store IQ believes about this home, in the brief's "I heard" shape. */
export function cardSummary(session: Session): Reply {
  const card = session.card;
  const lang = session.language;
  const parts: string[] = [];
  // A field the customer could not answer is not read back as if it were one: "sits not stated m
  // away" is what printing it anyway looks like.
  const has = <K extends keyof typeof card>(key: K): boolean => stated(card[key]);
  if (has("room")) parts.push(v(lang, String(card.room)));
  if (has("space")) parts.push(String(card.space));
  if (typeof card.distance_m === "number") parts.push(t(lang, "sits.m", { n: card.distance_m }));
  else if (typeof card.distance_feet === "number") parts.push(t(lang, "sits.ft", { n: card.distance_feet }));
  if (has("light")) parts.push(v(lang, String(card.light)));
  if (has("mount")) parts.push(t(lang, "mount.of", { v: v(lang, String(card.mount)) }));
  if (card.content?.length) parts.push(card.content.map((entry) => v(lang, entry)).join(", "));
  if (has("family")) {
    const people = String(card.family).match(/(\d+)/);
    parts.push(people ? t(lang, "people.n", { n: people[1]! }) : String(card.family));
  }
  if (card.devices?.length) parts.push(t(lang, "has", { v: card.devices.map((entry) => v(lang, entry)).join(", ") }));
  if (has("replacing")) parts.push(String(card.replacing));
  if (card.priorities?.length)
    parts.push(t(lang, "cares", { v: card.priorities.map((entry) => v(lang, entry)).join(", ") }));
  if (card.site_constraints?.length) parts.push(card.site_constraints.join(", "));
  if (has("internet")) parts.push(String(card.internet));
  if (typeof card.budget_rupees === "number") parts.push(t(lang, "budget.of", { v: card.budget_rupees }));
  // What this product needed that a television did not, in the words the model filed it under.
  // Not translated: these are the associate's own words coming back, like a free-text room is.
  for (const [name, said] of Object.entries(card.facts ?? {})) parts.push(`${name}: ${said}`);
  return {
    text: [
      parts.length
        ? t(session.language, "card.heard", { body: parts.join("; ") })
        : t(session.language, "card.nothing"),
      parts.length ? t(session.language, "card.right") : t(session.language, "card.tellme"),
      `↳ ${t(session.language, parts.length ? "why.readback" : "why.nocard")}`,
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

// The whole message, not its first word: "review of the Sony" is about a Sony.
const BRIEF_WORDS = /^\s*(brief|today'?s brief|shift|start shift|shift brief|aaj|shuru)\s*[.!?]*\s*$/i;
const REVIEW_WORDS = /^\s*(review|score|how did i do|kaisa raha)\s*[.!?]*\s*$/i;

export function wantsBrief(text: string | undefined, action: string | undefined): boolean {
  return action === "brief" || (!!text && BRIEF_WORDS.test(text));
}

export function wantsReview(text: string | undefined, action: string | undefined): boolean {
  return action === "review" || (!!text && REVIEW_WORDS.test(text));
}

/** Before the shift: today's stock, the changed offers, one short video and one question. */
export function shiftBrief(pack: Pack, lang: Lang = "en"): Reply {
  const brief = pack.shift_brief ?? {};
  if (!Object.keys(brief).length) return { text: t(lang, "brief.none") };
  const stock: string[] = Array.isArray(brief.stock_changes) ? brief.stock_changes : [];
  const offers: string[] = Array.isArray(brief.offer_changes) ? brief.offer_changes : [];
  const video = brief.video ?? {};
  const question = brief.question ?? {};
  const options: string[] = Array.isArray(question.options) ? question.options.slice(0, 3) : [];
  // Four things to carry onto the floor, inside the three lines the floor allows: the question is
  // the reason line because the buttons below it are the answer.
  const lines = [
    `${pack.store?.name ?? "Your store"} · ${stock.length ? `Stock: ${stock.join(" · ")}` : "Stock: no changes"}`,
    [
      offers.length ? `Offers: ${offers.join(" · ")}` : "Offers: no changes",
      video.title ? `Watch ${video.minutes ?? "?"} min: ${video.title}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    question.text ? `↳ ${question.text}` : "",
  ];
  return {
    text: lines.filter(Boolean).join("\n"),
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

/** The judges' own scorecard, from the store-visit findings of 27 October: seven steps, 0 to 2
 *  each, maximum 14. Brief, recommend and review are ours and are not on it; what the findings call
 *  "Demonstrate" is the difference each recommended option carries, which the session tracks as a
 *  flag rather than a step. */
export const SCORED = [
  "validate",
  "assess",
  "translate",
  "demonstrate",
  "complete",
  "close",
  "follow_through",
] as const;
export type Scored = (typeof SCORED)[number];

/** Guide is the findings' own name for a conversation at 11 or more. Two of six reached it. */
export const GUIDE = 11;

/** 2 is the step done with its evidence, 1 is started, 0 is not done. The evidence is what the
 *  session can prove, never what a reply claimed. */
function mark(session: Session, step: Scored): 0 | 1 | 2 {
  const done = (name: Step): boolean => session.steps_done.includes(name);
  const anything = Object.values(session.card).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "",
  );
  switch (step) {
    // Four of the customer's needs on the card is the whole step. It used to need the card read back
    // and confirmed as well, but since 2 Nov the card is only read back on asking, so 2 was out of reach.
    case "assess":
      return isAssessed(session.card) ? 2 : anything ? 1 : 0;
    case "validate":
      return done("validate") ? 2 : 0;
    case "translate":
      return done("translate") ? 2 : 0;
    case "demonstrate":
      return session.demonstrated ? 2 : 0;
    // The findings' "Complete" is the full cost, charge by charge, not just a product picked.
    // A pick read out with its itemised total from the store's data is the full cost; the live
    // catalogue has no other charge lines to add for most products, so requiring one made 2 rare.
    // Options shown with their prices is half of it.
    case "complete":
      return session.selection ? 2 : session.shortlist.length ? 1 : 0;
    case "close":
      return session.consent ? 2 : done("close") ? 1 : 0;
    case "follow_through":
      return done("follow_through") ? (session.consent ? 2 : 1) : 0;
  }
}

export function score(session: Session): {
  points: number;
  missing: Scored[];
  marks: Record<Scored, 0 | 1 | 2>;
} {
  const marks = Object.fromEntries(SCORED.map((step) => [step, mark(session, step)])) as Record<Scored, 0 | 1 | 2>;
  return {
    points: SCORED.reduce((total, step) => total + marks[step], 0),
    missing: SCORED.filter((step) => marks[step] === 0),
    marks,
  };
}

/** A score for the steps, and one thing to try next time. */
export function reviewReply(session: Session): Reply {
  const { points, missing, marks } = score(session);
  const covered = SCORED.filter((step) => marks[step] > 0);
  const next = missing[0];
  return {
    text: [
      `${t(session.language, "rev.score", { points, max: MAX_SCORE })} ${points >= GUIDE ? t(session.language, "rev.guide") : t(session.language, "rev.toguide", { n: GUIDE })}`,
      covered.length
        ? t(session.language, "rev.covered", {
            body: covered.map((step) => `${step.replace(/_/g, " ")} ${marks[step]}`).join(", "),
          })
        : t(session.language, "rev.none"),
      next
        ? `↳ ${t(session.language, "rev.next", { body: t(session.language, `adv.${next}`) })}`
        : `↳ ${t(session.language, "rev.perfect")}`,
    ]
      .join("\n")
      .slice(0, 1000),
  };
}

const FOLLOW_WORDS = /^\s*(summary|follow.?through|prepare the summary|close it|consent|summary bhejo)\s*[.!?]*\s*$/i;

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
  const needs = siteNeeds(pack, selection);
  // The offer gate holds here too: no MRP saving, offer figure or net total until the home is
  // assessed and a difference has been demonstrated — the same test the model is held to.
  const gateOpen = isAssessed(session.card) && session.demonstrated;

  if (!session.consent)
    return {
      text: [
        t(session.language, "ft.read", {
          name: itemised.lines.length > 1 ? itemised.lines.join("; ") : product.name,
          total: itemised.total.toLocaleString("en-IN"),
        }),
        // The saving off MRP is the first figure the close hangs on, and it is pack arithmetic.
        ...(gateOpen && product.mrp_rupees - product.price_rupees > 0
          ? [
              t(session.language, "off.save", {
                save: (product.mrp_rupees - product.price_rupees).toLocaleString("en-IN"),
                mrp: product.mrp_rupees.toLocaleString("en-IN"),
                price: product.price_rupees.toLocaleString("en-IN"),
              }),
            ]
          : []),
        // "Tap once they agree" is what the buttons already say, so the last line carries the
        // reason instead and the whole close fits the floor's three.
        `↳ ${t(session.language, "why.consent")}`,
      ].join("\n"),
      buttons: [
        { id: "consent:yes", title: t(session.language, "btn.agreed") },
        { id: "consent:no", title: t(session.language, "btn.declined") },
      ],
    };

  // The store visits watched an install fail because nobody asked about the wall first, and watched
  // nobody check afterwards that the thing worked. So the site is a question asked now, out loud,
  // and the last task is the check-back.
  // The close: the pack's offers with their conditions, then the net payable after them, so the
  // associate reads the two figures in order — the big number, then the number they pay.
  const closing = closeLines(pack, product, itemised.total, session.language, gateOpen);

  // The closing figures are deliberately not here. With them this turn ran to four lines and the
  // floor's limit dropped the last one — which was the site question itself, the whole point of the
  // turn: the associate saw two buttons and the reason for asking, and never the thing to ask. The
  // offers and the net payable arrive on the next turn, once the wall has been checked.
  if (needs.length && !session.site_checked)
    return {
      text: [
        t(session.language, "ft.send", {
          body: `${itemised.lines.join("; ")}. Total Rs ${itemised.total.toLocaleString("en-IN")}.`,
        }),
        t(session.language, "ft.sitecheck", { body: needs.slice(0, 3).join(", ") }),
        `↳ ${t(session.language, "why.sitecheck")}`,
      ].join("\n"),
      buttons: [
        { id: "site:ok", title: t(session.language, "btn.sitefine") },
        { id: "site:problem", title: t(session.language, "btn.siteproblem") },
      ],
    };

  return {
    text: [
      // The first itemised line already names the product; do not say it twice.
      t(session.language, "ft.send", {
        body: `${itemised.lines.join("; ")}. Total Rs ${itemised.total.toLocaleString("en-IN")}.`,
      }),
      ...closing,
      t(session.language, "ft.task", { owner: associate }),
      `↳ ${t(session.language, "ft.verify", { owner: associate })}`,
    ].join("\n"),
  };
}

/** What the installer will need on site, from the charges the customer is actually paying for. */
export function siteNeeds(pack: Pack, selection: NonNullable<Session["selection"]>): string[] {
  return [...new Set(selection.charges.flatMap((id) => pack.install_requirements?.[id] ?? []))];
}

/** Offers from today's pack that could apply to this set, read off its own applies_to line. An
 *  applies_to the code cannot parse is skipped: an invented applicability is an invented saving. */
export function applicableOffers(pack: Pack, product: Product): Pack["offers"] {
  return pack.offers.filter((offer) => {
    const applies = String(offer.applies_to ?? "").trim();
    if (/^all/i.test(applies)) return true;
    const above = applies.match(/(?:above|over|larger than)\s+(\d+)/i);
    if (above) return product.size_inch > Number(above[1]);
    const below = applies.match(/(?:below|under|smaller than)\s+(\d+)/i);
    if (below) return product.size_inch < Number(below[1]);
    return !applies;
  });
}

/** One line per applicable offer: the pack's figure and the pack's own conditions, out loud.
 *  This is what closing sounds like — not "there are offers", but what they take off. */
export function offerLines(pack: Pack, product: Product, lang: Lang): string[] {
  const lines: string[] = [];
  for (const offer of applicableOffers(pack, product)) {
    const amount = offerAmount(product, offer);
    if (amount <= 0) continue;
    const needs = String(offer.needs ?? "").trim();
    lines.push(
      t(lang, "off.line", {
        title: String(offer.title ?? "").trim() || "Offer",
        v: amount.toLocaleString("en-IN"),
        needs,
      }),
    );
  }
  return lines;
}

/** The itemised total after every applicable offer — the number the deal actually closes on. */
export function netPayable(pack: Pack, product: Product, total: number): number {
  return Math.max(
    0,
    total - applicableOffers(pack, product).reduce((sum, offer) => sum + offerAmount(product, offer), 0),
  );
}

/** The pack's offers with the net payable, as lines an associate can read straight out, or nothing
 *  if the offer gate is still shut. The gate here is the same test the model's replies are judged
 *  by: the home assessed, and a difference demonstrated. */
export function closeLines(pack: Pack, product: Product, total: number, lang: Lang, gateOpen: boolean): string[] {
  if (!gateOpen) return [];
  const offers = offerLines(pack, product, lang);
  if (!offers.length) return [];
  return [...offers, t(lang, "off.net", { v: netPayable(pack, product, total).toLocaleString("en-IN") })];
}
