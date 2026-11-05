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
  /** Set on a category the manager uploaded: the store's own list, not the sample. */
  sample?: boolean;
};
export type File = { note?: string; sample?: boolean; categories: Category[] };

let loaded: File | null = null;
let uploaded: File | null = null;
/** The store's own list from the portal, kept in the database and set again at start; null goes back to the file. */
export function setAfterSalesData(data: File | null): void {
  uploaded = data;
}
export function afterSalesData(): File {
  if (uploaded) return uploaded;
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

const DELIVERY = /deliver/i;

/** This kind's delivery charges that today's data prices, cheapest first: within 5 km, beyond 5 km. */
export function deliveryCharges(pack: Pack, product: Product): Charge[] {
  return (categoryOf(product)?.charges ?? [])
    .filter((charge) => DELIVERY.test(charge.title) && pack.charges.some((other) => other.id === charge.id))
    .sort((a, b) => a.amount_rupees - b.amount_rupees);
}

/** The kilometres the associate said: "4 km", "2.5 kilometre", "6 kms door". */
export function kmIn(said: string | undefined): number | null {
  const found = said?.match(/(\d+(?:\.\d+)?)\s*(?:km|kms|kilomet(?:er|re)s?|किमी|किलोमीटर)(?![a-z])/i);
  const km = found ? Number(found[1]) : NaN;
  return Number.isFinite(km) && km >= 0 && km < 500 ? km : null;
}

/** The delivery charge a distance falls under, read off the charges' own names ("within 5 km",
 *  "beyond 5 km"), so the store's uploaded list decides it. Null when no name says. */
export function deliveryFor(charges: Charge[], km: number): Charge | null {
  for (const charge of charges) {
    const within = charge.title.match(/(?:within|up ?to|under|upto)\s*(\d+(?:\.\d+)?)\s*km/i);
    if (within && km <= Number(within[1])) return charge;
    const beyond = charge.title.match(/(?:beyond|above|over|more than|after)\s*(\d+(?:\.\d+)?)\s*km/i);
    if (beyond && km > Number(beyond[1])) return charge;
  }
  return null;
}

/** Sets the bill's delivery line to this one charge, or to none when the customer takes it. */
export function setDelivery(
  pack: Pack,
  product: Product,
  selection: { charges: string[]; delivery?: "carry" | "deliver" },
  charge: Charge | null,
): void {
  const ids = new Set(deliveryCharges(pack, product).map((one) => one.id));
  selection.charges = selection.charges.filter((id) => !ids.has(id));
  if (charge) selection.charges.unshift(charge.id);
  selection.delivery = charge ? "deliver" : "carry";
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
  // Delivery is settled by "take it or deliver", so it is never an extra.
  const extras = (category?.charges ?? []).filter(
    (charge) =>
      !picked.includes(charge.id) &&
      !DELIVERY.test(charge.title) &&
      pack.charges.some((other) => other.id === charge.id),
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
    ...(ours.length && category && isSample(category) ? [`↳ ${t(lang, "as.sample")}`] : []),
  ].join("\n");
}

export const isSample = (category: Category): boolean => category.sample ?? afterSalesData().sample ?? false;

const CSV_HEAD = ["category", "charge", "amount", "on every bill", "per metre beyond"];

/** Cells of a CSV as Excel and Sheets write it: quoted fields, doubled quotes, CRLF. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') ((cell += '"'), i++);
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") (row.push(cell.trim()), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      (row.push(cell.trim()), rows.push(row), (row = []), (cell = ""));
    } else cell += ch;
  }
  (row.push(cell.trim()), rows.push(row));
  return rows;
}

/** The charges as the CSV the manager downloads, edits and uploads again. */
export function chargesCsv(data = afterSalesData()): string {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = data.categories.flatMap((category) =>
    category.charges.map((charge) => [
      category.kind,
      charge.title,
      String(charge.amount_rupees),
      charge.default ? "yes" : "no",
      typeof charge.per_metre_beyond === "number" ? String(charge.per_metre_beyond) : "",
    ]),
  );
  return [CSV_HEAD, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n";
}

/** The store's list, read from the manager's CSV onto the current data. A category in the file is
 *  replaced whole and is no longer sample; one not in the file keeps what it had. Nothing is saved
 *  while any row is wrong, because half a price list on the floor is worse than the old one. */
export function readChargesCsv(csv: string, base = afterSalesData()): { data: File } | { errors: string[] } {
  const rows = csvRows(csv.replace(/^\uFEFF/, ""));
  const errors: string[] = [];
  const read = new Map<Category, Charge[]>();
  const kinds = base.categories.map((category) => category.kind).join(", ");
  rows.forEach((row, index) => {
    const at = `Row ${index + 1}`;
    if (!row.some(Boolean) || (index === 0 && row[0]?.toLowerCase() === "category")) return;
    const [kind = "", title = "", amount = "", every = "", perMetre = ""] = row;
    const category = base.categories.find(
      (known) => known.kind.toLowerCase() === kind.toLowerCase() || (!!kind && new RegExp(known.match, "i").test(kind)),
    );
    if (!category) return void errors.push(`${at}: "${kind}" is not a category Store IQ knows (${kinds}).`);
    if (!title || title.length > 80) return void errors.push(`${at}: the charge needs a name of up to 80 letters.`);
    const rupees = amount.replace(/rs\.?|₹|,|\s/gi, "");
    if (!/^\d{1,7}$/.test(rupees)) return void errors.push(`${at}: "${amount}" is not an amount in whole rupees.`);
    const yes = /^(yes|y|true|1)$/i.test(every);
    if (!yes && !/^(no|n|false|0|)$/i.test(every)) return void errors.push(`${at}: "on every bill" is yes or no.`);
    if (perMetre && !(/^\d+(\.\d+)?$/.test(perMetre) && Number(perMetre) > 0 && Number(perMetre) < 100))
      return void errors.push(`${at}: "per metre beyond" is the metres included, such as 3, or empty.`);
    const list = read.get(category) ?? [];
    if (list.some((charge) => charge.title.toLowerCase() === title.toLowerCase()))
      return void errors.push(`${at}: "${title}" is in ${category.kind} twice.`);
    // A charge keeps its id when its name is unchanged, so a customer's open bill still finds it.
    const prefix = category.charges[0]?.id.split("-")[0] ?? category.kind.slice(0, 3).toUpperCase();
    let id =
      category.charges.find((charge) => charge.title.toLowerCase() === title.toLowerCase())?.id ??
      `${prefix}-${title
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 24)}`;
    while (list.some((charge) => charge.id === id)) id += "-2";
    list.push({
      id,
      title,
      amount_rupees: Number(rupees),
      ...(yes ? { default: true } : {}),
      ...(perMetre ? { per_metre_beyond: Number(perMetre) } : {}),
    });
    read.set(category, list);
  });
  if (!errors.length && !read.size) errors.push("No charges in the file.");
  if (errors.length) return { errors };
  return {
    data: {
      ...base,
      categories: base.categories.map((category) => {
        const charges = read.get(category);
        if (!charges) return category;
        const ids = new Set(charges.map((charge) => charge.id));
        const site = Object.fromEntries(Object.entries(category.site).filter(([id]) => ids.has(id)));
        return { ...category, charges, site, sample: false };
      }),
    },
  };
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
