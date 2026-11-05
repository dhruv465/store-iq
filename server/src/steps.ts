import { offerAmount, type Pack, type Product } from "./pack.js";
import { isAssessed, stated } from "./brain.js";
import type { Reply, Session, Step } from "./types.js";
import { t, v, type Lang } from "./i18n.js";
import { STEPS } from "./types.js";
import { applicableCharges, categoryOf, deliveryCharges, extrasLine, followUpPlan, isSample } from "./aftersales.js";

/** The brief and the review are facts about the pack and the shift, so they never reach the model:
 *  no request spent, no figure invented, and an answer in milliseconds rather than seconds. */

/** What the card holds, one phrase each, in the associate's language. */
export function cardParts(session: Session): string[] {
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
  if (typeof card.budget_rupees === "number")
    parts.push(t(lang, "budget.of", { v: card.budget_rupees.toLocaleString("en-IN") }));
  // What this product needed that a television did not, in the words the model filed it under.
  // Not translated: these are the associate's own words coming back, like a free-text room is.
  for (const [name, said] of Object.entries(card.facts ?? {})) parts.push(`${name.replace(/[_-]+/g, " ")}: ${said}`);
  return parts;
}

/** Plain words for what Store IQ believes about this home, in the brief's "I heard" shape. */
export function cardSummary(session: Session): Reply {
  const parts = cardParts(session);
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
    // Since 6 Nov every pitch turns the catalogue's features into what they do for this customer, so a
    // pick shown against a known home is the step even when the model called the turn "recommend".
    case "translate":
      return done("translate") || (session.demonstrated && isAssessed(session.card)) ? 2 : 0;
    case "demonstrate":
      return session.demonstrated ? 2 : 0;
    // The findings' "Complete" is the full cost, charge by charge, not just a product picked.
    // A pick read out with its itemised total from the store's data is the full cost; the live
    // catalogue has no other charge lines to add for most products, so requiring one made 2 rare.
    // Options shown with their prices is half of it.
    case "complete":
      return session.selection ? 2 : session.shortlist.length ? 1 : 0;
    // Sold is the close. The customer summary's yes is no longer the close: the breakdown is the
    // associate's own, and a customer standing there needs no message to agree to buy.
    case "close":
      return session.sold ? 2 : done("close") ? 1 : 0;
    case "follow_through":
      return done("follow_through") ? (session.sold ? 2 : 1) : 0;
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
/** "Yes, share summary of breakdown" was answered "tap They agreed": the associate wanted the cost
 *  sheet in front of them, with the customer standing right there. A short message asking for the
 *  breakdown, the summary or the full cost is that. */
const BREAKDOWN_WORDS =
  /\b(breakdown|break-up|breakup|summary|full cost|total cost|cost sheet|itemi[sz]ed|charges sheet)\b/i;

/** The loose words only count once something is picked: "total cost of the LG fridge?" before a
 *  pick is a question about a product, not a request for the breakdown. */
export function wantsFollowThrough(text: string | undefined, action: string | undefined, picked = false): boolean {
  return (
    action === "follow_through" ||
    (!!text &&
      (FOLLOW_WORDS.test(text) || (picked && BREAKDOWN_WORDS.test(text) && text.trim().split(/\s+/).length <= 8)))
  );
}

/** Section 6.6: the total is computed here, never by the model, so it cannot be wrong. */
export function itemisedTotal(
  pack: Pack,
  selection: NonNullable<Session["selection"]>,
): { lines: string[]; total: number } | null {
  const product = pack.products.find((candidate) => candidate.sku === selection.sku);
  if (!product) return null;
  // The catalogue's spec list in brackets is for the website; the name and model code are for the floor.
  const lines = [`${product.name.split("(")[0]!.trim()} — Rs ${product.price_rupees.toLocaleString("en-IN")}`];
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
    const qty = selection.qty?.[id] ?? 1;
    lines.push(
      `${charge.title}${qty > 1 ? ` × ${qty}` : ""} — ${amount ? `Rs ${(amount * qty).toLocaleString("en-IN")}` : "free"}`,
    );
    total += amount * qty;
  }
  return { lines, total };
}

const priced = (amount: number, lang: Lang): string =>
  amount ? `Rs ${amount.toLocaleString("en-IN")}` : t(lang, "dl.free");

/** "We deliver": what delivery costs by distance and what installation costs, for the associate to tell
 *  the customer, and the distance to ask. Each rate is a tap that puts it on the bill. */
export function deliveryRates(session: Session, pack: Pack): Reply | null {
  const lang = session.language;
  const product = pack.products.find((candidate) => candidate.sku === session.selection?.sku);
  const rates = product ? deliveryCharges(pack, product) : [];
  if (!product || !rates.length) return null;
  const category = categoryOf(product)!;
  const rest = category.charges.filter(
    (charge) => !rates.includes(charge) && pack.charges.some((other) => other.id === charge.id),
  );
  return {
    text: [
      t(lang, "dl.rates", {
        body: rates.map((charge) => `${charge.title} ${priced(charge.amount_rupees, lang)}`).join(" · "),
        rest: rest
          .slice(0, 4)
          .map((charge) => `${charge.title} ${priced(charge.amount_rupees, lang)}`)
          .join(" · "),
      }),
      t(lang, "dl.far"),
      `↳ ${isSample(category) ? t(lang, "as.sample") : t(lang, "why.far")}`,
    ].join("\n"),
    buttons: rates.slice(0, 3).map((charge) => {
      const said = charge.title.replace(/^(home\s+)?delivery\s*,?\s*/i, "").trim() || charge.title;
      return { id: `deliver:${charge.id}`, title: (said[0]!.toUpperCase() + said.slice(1)).slice(0, 20) };
    }),
  };
}

/** A product's name as said on the floor: the part before its spec list. */
export function shortName(product: Product): string {
  return product.name.split(/[,(]/)[0]!.trim().slice(0, 60);
}

/** The associate's own first name, or nothing when all we have is their number. */
function firstName(associate: string): string {
  const first = associate.trim().split(/\s+/)[0] ?? "";
  return /\d/.test(first) ? "" : first;
}

/** Sections 4F to 4H. A pick puts the whole cost in front of the associate at once, with nothing to
 *  agree to: the customer is standing there, and the breakdown is for the associate. Sold closes it,
 *  says well done, checks the site and sets the follow-ups. The customer summary is its own tap, and
 *  only it waits for the customer's yes. */
export function followThrough(session: Session, pack: Pack, associate: string, cheer = false): Reply {
  const lang = session.language;
  const selection = session.selection;
  if (!selection) {
    const options = session.shortlist.length ? session.shortlist : pack.products.map((product) => product.sku);
    return {
      text: t(lang, "ft.which"),
      buttons: options.slice(0, 3).map((sku) => ({
        id: `select:${sku}`,
        title: (pack.products.find((product) => product.sku === sku)?.brand ?? sku).slice(0, 20),
      })),
    };
  }
  const itemised = itemisedTotal(pack, selection);
  if (!itemised) return { text: "That selection is not in today's data pack, so I cannot total it." };
  const product = pack.products.find((candidate) => candidate.sku === selection.sku)!;
  const total = itemised.total.toLocaleString("en-IN");
  const needs = siteNeeds(pack, selection);

  // A heavy product goes home in a van or in their arms: asked before the total, since it changes it.
  const delivery = deliveryCharges(pack, product);
  if (!session.sold && delivery.length && !selection.delivery)
    return {
      text: [
        t(lang, "bd.total", { body: itemised.lines.join("; "), total }),
        t(lang, "dl.ask"),
        `↳ ${t(lang, "why.deliver")}`,
      ].join("\n"),
      buttons: [
        { id: "deliver:yes", title: t(lang, "btn.deliver") },
        { id: "deliver:carry", title: t(lang, "btn.carry") },
        { id: "charges", title: t(lang, "btn.charges") },
      ],
    };

  if (!session.sold) {
    // The offer gate holds here too: no MRP saving, offer figure or net total until the home is
    // assessed and a difference has been demonstrated — the same test the model is held to.
    const gateOpen = isAssessed(session.card) && session.demonstrated;
    const saving =
      gateOpen && product.mrp_rupees - product.price_rupees > 0
        ? t(lang, "off.save", {
            save: (product.mrp_rupees - product.price_rupees).toLocaleString("en-IN"),
            mrp: product.mrp_rupees.toLocaleString("en-IN"),
            price: product.price_rupees.toLocaleString("en-IN"),
          })
        : "";
    const money = [saving, ...closeLines(pack, product, itemised.total, lang, gateOpen)].filter(Boolean).join(" ");
    const extras = extrasLine(pack, product, selection.charges, lang);
    return {
      text: [
        t(lang, "bd.total", { body: itemised.lines.join("; "), total }),
        money,
        extras,
      ]
        .filter((line) => line && line !== "↳ ")
        .join("\n"),
      buttons: [
        { id: "sold", title: t(lang, "btn.sold") },
        // A care plan or mount offered with the pick, still not on the bill, stays a tap away.
        ...(selection.offered ?? [])
          .filter((line) => !selection.accessories.includes(line.id))
          .map((line) => ({
            id: `add:${line.id}`,
            title: t(lang, /mount/i.test(line.title) ? "btn.mount" : "btn.plan"),
          })),
        ...(applicableCharges(pack, product).length ? [{ id: "charges", title: t(lang, "btn.charges") }] : []),
      ].slice(0, 3),
    };
  }

  const plan = followUpPlan(product, session.customer?.name, lang, selection.delivery === "carry");
  const planLine = `↳ ${t(lang, "fu.set", { body: plan.map((step) => step.short).join(" · ") })}`;
  const said = cheer
    ? t(lang, "sold.cheer", {
        who: firstName(associate),
        name: shortName(product),
        total,
        card: session.customer?.name ? t(lang, "sold.card", { v: session.customer.name }) : "",
      })
    : t(lang, "sold.recap", { name: shortName(product), total });
  // No card yet: the sale is the moment to ask again, or what they bought is lost with the chat.
  // What the associate asks and tells at the counter once it is sold, so they do not have to come back
  // for it: where and when it goes, and every charge on the bill and off it.
  const extras = extrasLine(pack, product, selection.charges, lang);
  const handover = [
    ...(selection.delivery === "deliver" ? [t(lang, "sold.dl1"), t(lang, "sold.dl2")] : []),
    t(lang, "sold.bill", {
      body: [t(lang, "bd.total", { body: itemised.lines.join("; "), total }), extras].filter(Boolean).join(" "),
    }),
  ];
  const askCard = session.named ? t(lang, "cc.asknumber", { name: session.named }) : t(lang, "sold.askcard");
  const first = cheer && !session.customer ? `${said} ${askCard}` : said;
  // Sold before take-or-deliver was answered: asked now, and the follow-ups wait for it.
  if (delivery.length && !selection.delivery)
    return {
      text: [first, t(lang, "dl.ask"), `↳ ${t(lang, "why.deliversold")}`].join("\n"),
      buttons: [
        { id: "deliver:yes", title: t(lang, "btn.deliver") },
        { id: "deliver:carry", title: t(lang, "btn.carry") },
        { id: "summary:customer", title: t(lang, "btn.summary") },
      ],
    };
  // The store visits watched an install fail because nobody asked about the wall first, so the site
  // is asked now, out loud, while the customer is still at the counter.
  if (needs.length && !session.site_checked)
    return {
      text: [first, t(lang, "ft.sitecheck", { body: needs.slice(0, 3).join(", ") }), ...handover, planLine].join("\n"),
      long: true,
      buttons: [
        { id: "site:ok", title: t(lang, "btn.sitefine") },
        { id: "site:problem", title: t(lang, "btn.siteproblem") },
        { id: "summary:customer", title: t(lang, "btn.summary") },
      ],
    };
  return {
    text: [
      first,
      needs.length
        ? t(lang, "sold.site", { body: needs.slice(0, 3).join(", "), owner: associate })
        : t(lang, "ft.task", { owner: associate }),
      ...handover,
      planLine,
    ].join("\n"),
    long: true,
    buttons: [
      ...(applicableCharges(pack, product).length ? [{ id: "charges", title: t(lang, "btn.charges") }] : []),
      { id: "summary:customer", title: t(lang, "btn.summary") },
      { id: "new_customer", title: t(lang, "btn.new") },
    ],
  };
}

/** The customer's own copy, if they want one: read out, a yes, and then the words to forward. It is
 *  the one thing here that reaches the customer, so it is the one thing that waits for their yes. */
export function customerSummary(session: Session, pack: Pack, associate: string): Reply {
  const lang = session.language;
  const selection = session.selection;
  const itemised = selection && itemisedTotal(pack, selection);
  if (!selection || !itemised) return followThrough(session, pack, associate);
  const product = pack.products.find((candidate) => candidate.sku === selection.sku)!;
  const total = itemised.total.toLocaleString("en-IN");
  if (!session.consent)
    return {
      text: [t(lang, "ft.read", { name: shortName(product), total }), `↳ ${t(lang, "why.consent")}`].join("\n"),
      buttons: [
        { id: "consent:yes", title: t(lang, "btn.agreed") },
        { id: "consent:no", title: t(lang, "btn.declined") },
      ],
    };
  const needs = siteNeeds(pack, selection);
  return {
    text: [
      t(lang, "ft.send", {
        body: `${itemised.lines.join("; ")}. Total Rs ${total}.${needs.length ? ` ${t(lang, "sum.site", { body: needs.slice(0, 3).join(", ") })}` : ""}`,
      }),
      `↳ ${t(lang, "sum.forward")}`,
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
