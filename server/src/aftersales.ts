import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { t, type Lang } from "./i18n.js";
import type { Pack, Product } from "./pack.js";

/** After the sale: what delivery and installation cost, what the installer needs on site, and the
 *  check-backs. The store visits watched an installer leave because the wall needed a hole nobody had
 *  asked about, and nobody check that the AC worked; the best associate kept the charges on paper. */

export type Charge = {
  id: string;
  title: string;
  amount_rupees: number;
  default?: boolean;
  note?: string;
  /** Sold by the metre past this many metres included, such as an AC's copper pipe. */
  per_metre_beyond?: number;
};
export type Category = {
  kind: string;
  match: string;
  /** The word resQ's care plans use for this kind, as in "… Extended Warranty - Refrigerator …". */
  plan?: string;
  charges: Charge[];
  site: Record<string, string[]>;
};
type File = { sample?: boolean; categories: Category[] };

let loaded: File | null = null;
export function afterSalesData(): File {
  if (!loaded) {
    try {
      loaded = JSON.parse(readFileSync(resolve(process.env.AFTERSALES_PATH || "data/aftersales.json"), "utf8"));
    } catch {
      loaded = { categories: [] };
    }
  }
  return loaded!;
}

/** The heavy-product category this is, by its catalogue shelf first and its name after. */
export function categoryOf(product: Pick<Product, "name" | "categories">): Category | null {
  const shelf = (product.categories ?? []).join(" ");
  for (const where of [shelf, product.name])
    for (const category of afterSalesData().categories)
      if (where && new RegExp(category.match, "i").test(where)) return category;
  return null;
}

/** The categories' charges and site needs, added for the products in this pack. A pack that brings
 *  its own charges (the file pack's televisions) keeps them, so two price lists never mix. */
export function withAfterSales(pack: Pack): Pack {
  if (pack.charges.length) return pack;
  const categories = [...new Set(pack.products.map(categoryOf).filter((found) => !!found))];
  if (!categories.length) return pack;
  return {
    ...pack,
    charges: categories.flatMap((category) => category.charges),
    install_requirements: Object.assign({}, pack.install_requirements, ...categories.map((category) => category.site)),
  };
}

/** The charges every sale of this kind carries, as far as this pack prices them. */
export function defaultCharges(pack: Pack, product: Product): string[] {
  const category = categoryOf(product);
  if (!category) return [];
  return category.charges
    .filter((charge) => charge.default && pack.charges.some((other) => other.id === charge.id))
    .map((charge) => charge.id);
}

const rupees = (amount: number): string => (amount ? `Rs ${amount.toLocaleString("en-IN")}` : "free");

/** The charges that are not on the bill yet, but are if the home needs them. */
export function extrasLine(pack: Pack, product: Product, picked: string[], lang: Lang): string {
  const category = categoryOf(product);
  const extras = (category?.charges ?? []).filter(
    (charge) => !picked.includes(charge.id) && pack.charges.some((other) => other.id === charge.id),
  );
  if (!extras.length) return "";
  return t(lang, "as.extras", {
    body: extras
      .slice(0, 3)
      .map((charge) => `${charge.title} ${rupees(charge.amount_rupees)}`)
      .join(" · "),
  });
}

/** Every charge for this kind that today's data prices, in one reply: the list the best associate
 *  wrote on paper. A pack with its own charges lists those; the sample list says it is one. */
export function chargesList(pack: Pack, product: Product, lang: Lang): string {
  const category = categoryOf(product);
  const ours = (category?.charges ?? []).filter((charge) => pack.charges.some((other) => other.id === charge.id));
  const listed: Record<string, any>[] = ours.length ? ours : pack.charges;
  if (!listed.length) return t(lang, "as.nocharges");
  const priced = (charge: Record<string, any>): string =>
    typeof charge.amount_rupees === "number"
      ? rupees(charge.amount_rupees)
      : typeof charge.percent_of_price === "number"
        ? `${charge.percent_of_price}%`
        : "";
  return [
    t(lang, "as.charges", {
      kind: category?.kind ?? product.name.split(/[,(]/)[0]!.trim(),
      body: listed.map((charge) => `${charge.title} ${priced(charge)}`.trim()).join(" · "),
    }),
    ...(ours.length && afterSalesData().sample ? [`↳ ${t(lang, "as.sample")}`] : []),
  ].join("\n");
}

export type FollowUp = { days: number; what: string; short: string };

/** The check-backs after a sale, from the day it was sold: delivery, the installer's call, and that
 *  it works. A product with nothing to install skips the installer. */
export function followUpPlan(product: Product, customer: string | undefined, lang: Lang): FollowUp[] {
  const who = customer || t(lang, "as.thecustomer");
  const installs = !!categoryOf(product);
  const name = product.name.split(/[,(]/)[0]!.trim().slice(0, 60);
  return [
    { days: 1, what: t(lang, "fu.delivery", { who, name }), short: t(lang, "fu.s.delivery") },
    ...(installs
      ? [{ days: 2, what: t(lang, "fu.installer", { who, name }), short: t(lang, "fu.s.installer", { d: 2 }) }]
      : []),
    {
      days: installs ? 3 : 2,
      what: t(lang, "fu.working", { who, name }),
      short: t(lang, "fu.s.working", { d: installs ? 3 : 2 }),
    },
  ];
}

/** Today's date in the store's own time zone, as YYYY-MM-DD: a check-back is due on a store day. */
export function storeDay(offsetDays = 0, now = Date.now()): string {
  return new Date(now + 5.5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** The pipe run the associate said, in metres: "outdoor unit is 5 metres away", "pipe 6 m". Only
 *  with a word about the pipe or the outdoor unit, so a room's size is never read as one. */
export function pipeMetres(said: string | undefined): number | null {
  if (!said || !/pipe|outdoor|copper|bahar ka unit|distance between/i.test(said)) return null;
  const found = said.match(/(\d+(?:\.\d+)?)\s*(?:m|mtrs?|metres?|meters?|meter|मीटर)(?![a-z])/i);
  const metres = found ? Number(found[1]) : NaN;
  return Number.isFinite(metres) && metres > 0 && metres < 100 ? metres : null;
}

/** The selection's charge sold by the metre, set to what this run needs past what is included.
 *  Returns the sum for the associate to read, or null when this product has no such charge. */
export function priceRun(
  pack: Pack,
  product: Product,
  selection: { charges: string[]; qty?: Record<string, number> },
  metres: number,
): { id: string; extra: number; rate: number; included: number } | null {
  const charge = (categoryOf(product)?.charges ?? []).find(
    (candidate) =>
      typeof candidate.per_metre_beyond === "number" && pack.charges.some((other) => other.id === candidate.id),
  );
  if (!charge) return null;
  const included = charge.per_metre_beyond!;
  const extra = Math.max(0, Math.ceil(metres - included));
  selection.charges = selection.charges.filter((id) => id !== charge.id);
  if (extra) {
    selection.charges.push(charge.id);
    selection.qty = { ...selection.qty, [charge.id]: extra };
  }
  return { id: charge.id, extra, rate: charge.amount_rupees, included };
}

/** The words that mean the deal is done, as a whole message. */
const SOLD_WORDS =
  /^\s*(sold|sold it|deal done|deal closed|done deal|closed|closed it|sale done|order done|(he|she|they|customer|the customer)?\s*(bought|took|purchased) it|bik gaya|le liya|liya|ho gaya deal|deal ho gayi)\s*[.!🎉✅]*\s*$/i;

export function wantsSold(text: string | undefined, action: string | undefined): boolean {
  return action === "sold" || (!!text && SOLD_WORDS.test(text));
}

const FOLLOW_UP_WORDS = /^\s*(my\s+)?(follow[\s-]?ups?|tasks?|pending|reminders?)\s*(today|due)?\s*[?.!]*\s*$/i;

export function wantsFollowUps(text: string | undefined, action: string | undefined): boolean {
  return action === "followups" || (!!text && FOLLOW_UP_WORDS.test(text));
}
