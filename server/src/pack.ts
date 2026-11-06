import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { HomeCard } from "./types.js";
import { adaptPack, adaptProduct, fromFdk, fromPromotion, running } from "./adapt.js";
import { catalogConfig, getProducts, getPromotionOffers, type Facet } from "./catalog.js";

export type Pack = {
  version: string;
  store: { id: string; name: string; city: string };
  shift_brief: Record<string, any>;
  products: Product[];
  offers: Record<string, any>[];
  finance: Record<string, any>[];
  charges: Record<string, any>[];
  accessories: { id: string; title: string; price_rupees: number; for: string }[];
  experts: { area: string; name: string }[];
  electricity: { tariff_rupees_per_unit: number; note: string };
  labels: { spec: string; say: string }[];
  myths: { claim: string; confirm: string; correct: string }[];
  /** Closing objections in the customer's own words. `when` is how the words are matched; without
   *  it the claim's own words are counted, the way myths are. */
  objections?: { claim: string; when?: string; confirm: string; correct: string }[];
  install_requirements: Record<string, string[]>;
  /** What was searched to get these products and how many more the store holds. Live only. */
  search?: Search & { total: number; has_next: boolean };
};
export type Product = {
  sku: string;
  brand: string;
  name: string;
  size_inch: number;
  panel: string;
  mrp_rupees: number;
  price_rupees: number;
  stock_units: number;
  specs: Record<string, number | string>;
  /** What the catalogue calls it. Empty for a pack that does not say, which is every pack we
   *  wrote by hand; the live catalogue says it on every row. */
  categories: string[];
  good_for: string[];
  weak_for: string[];
  /** Section 6.5: the difference to show the customer, not just the reason to say.
   *  A pack may carry the cue per language; English is the fallback. */
  demo_cue: string;
  demo_cue_hi?: string;
  demo_cue_mr?: string;
  energy: { typical_watts: number; standby_watts: number; units_per_year_4h_day: number };
};

/** A file on disk or an http(s) feed, so pointing at the real catalogue is one environment
 *  variable. PACK_TOKEN is sent as a bearer token when the feed needs one. */
export async function readSource(source: string): Promise<string> {
  if (!/^https?:\/\//.test(source)) return readFile(resolve(source), "utf8");
  const token = process.env.PACK_TOKEN?.trim();
  const response = await fetch(source, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Error(`Data pack ${source} answered HTTP ${response.status}`);
  return response.text();
}

/** One search of the store, in the parameters of FDK getProducts. `kind` is not a parameter: it is
 *  what the thing is ("phone"), which is how an iPhone is told from the cases named after it. */
export type Search = {
  q: string;
  kind?: string;
  sort_on?: "popular" | "latest" | "price_asc" | "price_dsc" | "discount_asc" | "discount_dsc";
  max_price?: number;
  page_no?: number;
};

const SORTS = ["popular", "latest", "price_asc", "price_dsc", "discount_asc", "discount_dsc"];

/** What the model said to search, checked before any of it reaches the store. */
export function readSearch(raw: unknown): Search | null {
  const said = (raw ?? {}) as Record<string, unknown>;
  const q = typeof said.q === "string" ? said.q.trim().slice(0, 80) : "";
  if (q.length < 2) return null;
  const search: Search = { q };
  if (typeof said.kind === "string" && said.kind.trim()) search.kind = said.kind.trim().toLowerCase().slice(0, 40);
  if (SORTS.includes(String(said.sort_on))) search.sort_on = said.sort_on as NonNullable<Search["sort_on"]>;
  if (typeof said.max_price === "number" && said.max_price > 0) search.max_price = Math.round(said.max_price);
  if (Number.isInteger(said.page_no) && (said.page_no as number) > 1) search.page_no = said.page_no as number;
  return search;
}

/** Everything that does not come from the store is empty, on purpose: the file pack's finance
 *  terms, charges, myths and brief are a television stub, and this channel has none of them. */
const LIVE_PACK: Pack = {
  version: "live",
  store: { id: "", name: "Reliance Digital", city: "" },
  shift_brief: {},
  products: [],
  offers: [],
  finance: [],
  charges: [],
  accessories: [],
  experts: [],
  electricity: { tariff_rupees_per_unit: 0, note: "" },
  labels: [],
  myths: [],
  objections: [],
  install_requirements: {},
};

/** resQ is Reliance's own service brand and extended-warranty its category. "fridge" returns 150
 *  extended warranties against 122 refrigerators, so they are dropped unless asked for. Read off
 *  the brand and category, because a real washing machine's name can say "2 Years Warranty". */
const SERVICE = /resq|warranty|protection|insurance|installation/i;

type Row = Record<string, any>;
const categoriesOf = (row: Row): string => (row.categories ?? []).map((category: Row) => category?.name).join(" ");
const isService = (row: Row): boolean => SERVICE.test(`${row.brand?.name} ${categoriesOf(row)}`);

/** The kind as a pattern over words, with its plural: "phone" is not inside "iPhone". */
function kindPattern(kind: string): RegExp {
  const stem = kind.replace(/s$/, "").replace(/[^a-z0-9]+/gi, "[\\s-]*");
  return new RegExp(`\\b${stem}(s|es)?\\b`, "i");
}

/** A category IS this kind when its last word is it. "smart-phones" and "LED Televisions" are;
 *  "phone-cases" and "Television Mounts & Stands" are for one, and "Headphones" is not a phone. */
function shelfIs(category: string, kind: string): boolean {
  return new RegExp(`(?:^|[\\s-])${kindPattern(kind).source.replace(/\\b/g, "")}$`, "i").test(category);
}

/** The row's own name ends on the kind, before its colour, model code or "with …": "Godrej 180 L Direct
 *  Cool Single Door Refrigerator, Grey" is a fridge on a shelf called "Direct Cool". "Laptop Stand" and
 *  "Refrigerator Cover" go on past the word, so they are not. */
export function namedAs(row: Row, kind: string): boolean {
  const head = String(row.name).split(/\b(?:for|compatible with|fits)\b/i)[0]!;
  return new RegExp(`${kindPattern(kind).source}(?=\\s*(?:$|[,(]|with\\b|-\\s))`, "i").test(head);
}

/** Whether this row is that kind of thing, by its own name or its own category. What comes after
 *  "for" is what it serves: a "Trolley for Washing Machine" is a trolley. */
export function carriesKind(row: Row, kind: string): boolean {
  return (
    kindPattern(kind).test(String(row.name).split(/\b(?:for|compatible with|fits)\b/i)[0]!) ||
    (row.categories ?? []).some((category: Row) => shelfIs(String(category?.name), kind))
  );
}

/** The store's own shelves for this kind, out of the category facet it returned with the rows. */
export function shelvesOf(filters: Facet[], kind: string): string[] {
  return (filters.find((facet) => facet.key?.name === "category")?.values ?? [])
    .map((value) => String(value.value ?? ""))
    .filter((value) => value && !SERVICE.test(value) && shelfIs(value, kind));
}

/** The price filter, in the facet's own `query_format`. */
const priceFilter = (max: number): string => `min_price_effective:[1,INR TO ${max},INR]`;

/** Prices move, so a remembered search is good for one conversation, not for the day. */
const FRESH_MS = 5 * 60_000;
const searched = new Map<string, { at: number; pack: Pack }>();

/** A wall mount of the television's own brand, from the store's own mounts shelf, as a line the
 *  itemised total can carry at its real price. Null for anything that is not a television, or when
 *  the shelf has none in stock. Which size it fits is not in the data, so its full name is read out. */
export async function mountFor(
  product: Product,
  request: typeof fetch = fetch,
): Promise<Pack["accessories"][number] | null> {
  const config = catalogConfig();
  if (!config || !product.categories.some((category) => /television/i.test(category))) return null;
  const found = await getProducts(
    config,
    { q: `${product.brand} wall mount`, page_size: 24, page_no: 1, page_type: "number", sort_on: "popular" },
    request,
  );
  const brand = product.brand.trim().toLowerCase();
  for (const row of found.items as Row[]) {
    const mount = adaptProduct(fromFdk(row)).product;
    const shelf = (row.categories ?? []).some((category: Row) => /mount/i.test(String(category?.name)));
    if (
      shelf &&
      mount.sku &&
      mount.price_rupees > 0 &&
      mount.stock_units > 0 &&
      mount.brand.trim().toLowerCase() === brand
    )
      return { id: mount.sku, title: mount.name, price_rupees: mount.price_rupees, for: product.sku };
  }
  return null;
}

/** Whether a resQ plan's own price band, as its name writes it, holds this price: "from Rs.20000 to
 *  Rs.30000", "upto Rs.15000", "above Rs.3L", with L as a lakh. A band the code cannot read is no. */
export function bandHolds(name: string, price: number): boolean {
  const rupees = (said: string): number => {
    const [, figure, lakh] = said.match(/([\d.]+)\s*(l)?/i) ?? [];
    return Number(figure) * (lakh ? 100_000 : 1);
  };
  const from = name.match(/from\s+rs\.?\s*([\d.]+\s*l?)\s+to\s+rs\.?\s*([\d.]+\s*l?)/i);
  if (from) return price >= rupees(from[1]!) && price <= rupees(from[2]!);
  const upto = name.match(/up\s*to\s+rs\.?\s*([\d.]+\s*l?)/i);
  if (upto) return price <= rupees(upto[1]!);
  const above = name.match(/above\s+rs\.?\s*([\d.]+\s*l?)/i);
  if (above) return price > rupees(above[1]!);
  return false;
}

/** resQ's own care plan for this product's price band, from the store, the longest one it sells.
 *  The complete solution was where the store visits found us strongest, and its price is real. */
export async function carePlanFor(
  product: Product,
  planWord: string | undefined,
  request: typeof fetch = fetch,
): Promise<Pack["accessories"][number] | null> {
  const config = catalogConfig();
  if (!config || !planWord) return null;
  const found = await getProducts(
    config,
    { q: `resQ Care Plan ${planWord}`, page_size: 48, page_no: 1, page_type: "number", sort_on: "popular" },
    request,
  );
  const word = new RegExp(`\\b${planWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const plans = (found.items as Row[])
    .map((row) => adaptProduct(fromFdk(row)).product)
    .filter(
      (plan) =>
        /resq/i.test(plan.brand) &&
        plan.sku &&
        plan.price_rupees > 0 &&
        word.test(plan.name) &&
        bandHolds(plan.name, product.price_rupees),
    )
    .map((plan) => ({ plan, years: Number(plan.name.match(/(\d+)\s*year/i)?.[1] ?? 0) }))
    .sort((a, b) => b.years - a.years);
  const best = plans[0];
  if (!best) return null;
  return {
    id: best.plan.sku,
    title: best.years ? `resQ ${best.years}-year care plan` : best.plan.name.slice(0, 40),
    price_rupees: best.plan.price_rupees,
    for: product.sku,
  };
}

/** The shift brief from the store itself: televisions in stock with their prices, and the offers
 *  running on them today. The data has no stock history, no video and no quiz, so there are none. */
const briefs = new Map<string, Pack["shift_brief"]>();
export async function liveBrief(base: Pack, request: typeof fetch = fetch): Promise<Pack["shift_brief"]> {
  const day = new Date().toISOString().slice(0, 10);
  const kept = briefs.get(day);
  if (kept) return kept;
  const pack = await searchPack(base, { q: "television", kind: "television" }, request);
  const short = (product: Product): string =>
    product.size_inch > 0 ? `${product.brand} ${product.size_inch}"` : product.name.slice(0, 32);
  const offerOn = (product: Product): string =>
    String(
      ["discount", "offer_tag", "bank_offer"].map((key) => product.specs[key]).find(Boolean) ??
        pack.offers.find((offer) => Array.isArray(offer.on) && offer.on.includes(product.name))?.title ??
        "",
    );
  const stocked = pack.products.filter((product) => product.stock_units > 0);
  // Brief 4A: one question to practise, a different one each day, from the store's own list.
  const practice: Record<string, unknown>[] = JSON.parse(await readFile(resolve("data/practice.json"), "utf8"));
  const brief = {
    question: practice[Math.floor(Date.parse(day) / 86_400_000) % practice.length],
    stock_changes: stocked
      .slice(0, 3)
      .map((product) => `${short(product)} Rs ${product.price_rupees.toLocaleString("en-IN")}`),
    offer_changes: stocked
      .filter((product) => offerOn(product))
      .slice(0, 2)
      .map((product) => `${short(product)}: ${offerOn(product)}`),
  };
  if (!brief.stock_changes.length) return {};
  briefs.clear();
  briefs.set(day, brief);
  return brief;
}

/** Just a kind of product, maybe a brand: no model, size or number, no sort, no page. The store's
 *  "popular" first page for "fridge" was twelve side-by-sides from 520 L and Rs 70,590 up, so a family
 *  of four was shown nothing they would buy; the next 36 rows hold 180 L to 340 L. */
export function broad(search: Search): boolean {
  return !search.sort_on && !search.page_no && !/\d/.test(search.q) && search.q.trim().split(/\s+/).length <= 3;
}

/** n rows spread from the cheapest to the dearest, kept in the store's own order so the most popular
 *  of them still comes first (and gets its offers read). */
export function spread<T extends { price?: { effective?: { min?: unknown } } }>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  const cost = (row: T): number => Number(row.price?.effective?.min) || 0;
  const byPrice = [...rows].sort((a, b) => cost(a) - cost(b));
  const chosen = new Set(Array.from({ length: n }, (_, i) => byPrice[Math.round((i * (rows.length - 1)) / (n - 1))]!));
  return rows.filter((row) => chosen.has(row));
}

/** The live catalogue, asked for what this turn is about. Rows are the store's own answer: a miss
 *  comes back as no products, which the model is told, and a failure throws. */
export async function searchPack(base: Pack, search: Search, request: typeof fetch = fetch): Promise<Pack> {
  const config = catalogConfig();
  if (!config) return base;
  const key = JSON.stringify(search);
  const hit = searched.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.pack;

  // A sort is over more rows, because it is checked against the words below.
  const sorted = !!search.sort_on && search.sort_on !== "popular";
  const wide = broad(search);
  const params = {
    q: search.q,
    sort_on: search.sort_on ?? "popular",
    page_size: sorted || wide ? 48 : 12,
    page_no: search.page_no ?? 1,
    page_type: "number" as const,
  };
  const price = search.max_price ? priceFilter(search.max_price) : undefined;
  const filter = price ? { f: price } : {};
  const found = await getProducts(config, { ...params, filters: true, ...filter }, request);
  const keep = (rows: Row[]): Row[] => (SERVICE.test(search.q) ? rows : rows.filter((row) => !isService(row)));
  let rows = keep(found.items);
  let page = found.page;
  if (sorted) {
    // The store's sort ranks everything its loose search touched: the cheapest "oled tv" is a 24 inch
    // LED, and the biggest discount on "iphone 18 pro" is a case. Rows that carry every word win; if
    // none do, the most relevant rows are used instead, and a price order is applied to them here.
    const said = search.q.toLowerCase().split(/\s+/);
    const named = (list: Row[]): Row[] =>
      list.filter((row) => said.every((word) => String(row.name).toLowerCase().includes(word)));
    if (named(rows).length) rows = named(rows);
    else {
      const relevant = await getProducts(config, { ...params, sort_on: "popular", ...filter }, request);
      const pool = keep(relevant.items);
      const up = search.sort_on === "price_asc" ? 1 : search.sort_on === "price_dsc" ? -1 : 0;
      const cost = (row: Row): number => Number(row.price?.effective?.min) || 0;
      rows = (named(pool).length ? named(pool) : pool).sort((a, b) => (cost(a) - cost(b)) * up);
      page = relevant.page;
    }
  }
  const kind = search.kind;
  if (kind) {
    // "iphone 18 pro" comes back as cases and straps named after the phone. When most of what came
    // back is not the thing asked for, the same words are asked again on the store's own shelf for it.
    // The shelf and not the name: "Laptop Stand" has the word in it, so "laptop under 40000" was
    // answered with stands and "none under that", with an Acer at Rs 36,990 on the shelf.
    const onShelf = (row: Row): boolean =>
      (row.categories ?? []).some((category: Row) => shelfIs(String(category?.name), kind));
    // Most fridges sit on "Direct Cool" and "Frost Free", not a shelf named for fridges: by shelf alone
    // they did not count, and the search was narrowed to the one shelf that is, side-by-sides from 520 L.
    if (rows.filter((row) => onShelf(row) || namedAs(row, kind)).length * 2 < rows.length) {
      const shelves = shelvesOf(found.filters, kind);
      if (shelves.length) {
        const f = [`category:${shelves.join("||")}`, ...(price ? [price] : [])].join(":::");
        const narrowed = await getProducts(config, { ...params, f, filters: false }, request);
        if (narrowed.items.length) {
          rows = keep(narrowed.items);
          page = narrowed.page;
        }
      }
    }
    // A row that ends on the kind or sits on its shelf first; "Bottom Refrigerator Panel" only names it.
    const exact = rows.filter((row) => onShelf(row) || namedAs(row, kind));
    const carrying = exact.length ? exact : rows.filter((row) => carriesKind(row, kind));
    if (carrying.length) rows = carrying;
  }
  rows = wide ? spread(rows, 12) : rows.slice(0, 12);
  const products = rows.map((row) => adaptProduct(fromFdk(row)).product).filter((product) => product.sku);

  // getPromotionOffers is per slug, so the first five are asked at once. Each offer says which
  // product it is on: one television in twelve has one, and it is not an offer on the rest.
  const offers = new Map<string, Record<string, unknown>>();
  const answered = await Promise.all(
    rows
      .slice(0, 5)
      .filter((row) => row.slug)
      .map(async (row) => ({
        name: String(row.name),
        promotions: await getPromotionOffers(config, { slug: row.slug }, request).catch(() => []),
      })),
  );
  for (const { name, promotions } of answered)
    for (const promotion of promotions) {
      const offer = fromPromotion(promotion);
      if (!running(offer)) continue;
      const id = String(offer.id ?? offer.title);
      offers.set(id, { ...offer, on: [...((offers.get(id)?.on as string[]) ?? []), name] });
    }

  const pack: Pack = {
    ...base,
    products,
    offers: [...offers.values()],
    search: { ...search, total: Number(page.item_total) || 0, has_next: !!page.has_next },
  };
  // A cap against a loop, not a cache policy.
  if (searched.size > 64) searched.clear();
  searched.set(key, { at: Date.now(), pack });
  return pack;
}

/** The pack the server serves. With the catalogue configured that is no products at all, because
 *  each turn searches for its own. The file is only for running without catalogue credentials: its
 *  four televisions and their prices are a stub and must never reach an associate as today's data.
 *
 *  A bad key must not kill the number, so it says so loudly and keeps serving; every turn asks the
 *  store again, and the model is told when the store did not answer. */
export async function startingPack(request: typeof fetch = fetch): Promise<{ pack: Pack; source: string }> {
  const config = catalogConfig();
  const file = process.env.PACK_PATH || "data/pack.json";
  if (!config) return { pack: await loadPack(file), source: file };
  try {
    const { page } = await getProducts(
      config,
      { page_size: 1, page_no: 1, page_type: "number", filters: false },
      request,
    );
    return { pack: LIVE_PACK, source: `live catalogue · ${Number(page.item_total) || 0} products` };
  } catch (error) {
    console.error(`Live catalogue unusable: ${error instanceof Error ? error.message : "unknown"}`);
    return { pack: LIVE_PACK, source: "live catalogue failed, retrying every turn" };
  }
}

/** Single source of facts. Prices, offers, stock and finance terms exist only here.
 *
 *  The catalogue is read through the adapter, so a real export with its own field names loads
 *  without touching anything but the name lists in adapt.ts. A pack that cannot be served says
 *  every reason at once, by row, rather than failing on the first one. */
export async function loadPack(source = process.env.PACK_PATH || "data/pack.json"): Promise<Pack> {
  const raw = JSON.parse(await readSource(source));
  if (!Array.isArray(raw?.products) || !raw.products.length) throw Error(`Data pack ${source} has no products`);
  const { pack, problems } = adaptPack(raw);
  if (problems.length) throw Error(`Data pack ${source} cannot be served:\n- ${problems.join("\n- ")}`);
  return pack;
}

/** The rupee value of one offer against one product: the percent, capped, or the flat amount.
 *  One definition, so the closing lines and the allowed-figure set can never drift apart. */
export function offerAmount(product: Product, offer: Record<string, any>): number {
  if (typeof offer.percent === "number")
    return Math.max(
      0,
      Math.min(Math.round((product.price_rupees * offer.percent) / 100), Number(offer.cap_rupees ?? Infinity)),
    );
  if (typeof offer.flat_rupees === "number") return Math.max(0, Number(offer.flat_rupees));
  return 0;
}

/** A number on its own is not a fact; a number with its unit is. The pack holds `1` as an HDMI
 *  port count, which is why "the warranty is one year" passed a check on the number alone — twice,
 *  in front of a customer. So a figure that carries a unit is checked as a pair.
 *
 *  Units of money are deliberately absent: a rupee figure is checked against the numbers, because
 *  the pack's own arithmetic (price less offers, plus charges) produces amounts no key names. */
const UNIT_OF: Record<string, string> = {
  inch: "inch",
  inches: "inch",
  nits: "nits",
  hz: "hz",
  w: "watt",
  watt: "watt",
  watts: "watt",
  month: "month",
  months: "month",
  year: "year",
  years: "year",
  yr: "year",
  yrs: "year",
  day: "day",
  days: "day",
  week: "week",
  weeks: "week",
  unit: "unit",
  units: "unit",
  port: "port",
  ports: "port",
  hdmi: "port",
  percent: "percent",
  "%": "percent",
  kg: "kg",
  // The catalogue names a fridge "215 L"; said back as "215 litre" it was refused.
  l: "litre",
  ltr: "litre",
  ltrs: "litre",
  litre: "litre",
  litres: "litre",
  liter: "litre",
  liters: "litre",
  star: "star",
  stars: "star",
  metre: "metre",
  metres: "metre",
  meter: "metre",
  meters: "metre",
  foot: "foot",
  feet: "foot",
  minute: "minute",
  minutes: "minute",
  hour: "hour",
  hours: "hour",
  // Every reply can be in Hindi or Marathi, so every unit can be. A model answered "warranty 1
  // saal ki milti hai" and walked straight past an English-only table.
  saal: "year",
  sal: "year",
  varsh: "year",
  साल: "year",
  वर्ष: "year",
  वर्षे: "year",
  mahina: "month",
  mahine: "month",
  mahino: "month",
  महीना: "month",
  महीने: "month",
  महीनों: "month",
  महिना: "month",
  महिने: "month",
  din: "day",
  dino: "day",
  दिन: "day",
  दिनों: "day",
  दिवस: "day",
  hafta: "week",
  hafte: "week",
  saptah: "week",
  हफ्ता: "week",
  हफ्ते: "week",
  सप्ताह: "week",
  ghanta: "hour",
  ghante: "hour",
  घंटा: "hour",
  घंटे: "hour",
  इंच: "inch",
  फुट: "foot",
  फीट: "foot",
  वाट: "watt",
  यूनिट: "unit",
  pratishat: "percent",
  प्रतिशत: "percent",
  kilo: "kg",
  किलो: "kg",
};

/** Spelled out, a number slips past a digit scan entirely. */
const SPELLED: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

export function canonUnit(word: string | undefined): string | undefined {
  // Devanagari survives the tidy-up: stripping it left an empty string and every Hindi unit read
  // as no unit at all.
  return word ? UNIT_OF[word.toLowerCase().replace(/[^a-z%\u0900-\u097f]/g, "")] : undefined;
}

/** "one year" is a figure a digit scan never sees, so it is rewritten to "1 year" first. */
export function spellOut(text: string): string {
  return text.replace(
    new RegExp(`\\b(${Object.keys(SPELLED).join("|")})[\\s-]+(?=[a-z%"])`, "gi"),
    (whole, word: string) => `${SPELLED[word.toLowerCase()] ?? whole} `,
  );
}

/** "2-year extended warranty" and "one year" both read as the pair `2 year` / `1 year`. */
export function pairsIn(text: string): Set<string> {
  const spelled = spellOut(text);
  const pairs = new Set<string>();
  for (const match of spelled.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*-?\s*("|%|[a-z\u0900-\u097f]+)/gi)) {
    const unit = canonUnit(match[2]);
    if (unit) pairs.add(`${Number(match[1]!.replace(/,/g, ""))} ${unit}`);
  }
  return pairs;
}

/** A key name carries the unit of the number under it: size_inch, peak_nits, months. The first
 *  unit word in the key wins, so units_per_year_4h_day is units and not years. */
function unitInKey(key: string): string | undefined {
  const parts = key
    .toLowerCase()
    .split(/[^a-z%]+/)
    .filter(Boolean);
  for (const part of parts) if (UNIT_OF[part]) return UNIT_OF[part];
  return undefined;
}

/** Every figure Store IQ is allowed to say. Anything else in a reply is an invention.
 *
 *  Numbers are members; a figure that carries a unit is a member as the string "55 inch". */
export function allowedNumbers(pack: Pack): Set<number | string> {
  const allowed = new Set<number | string>();
  const walk = (value: unknown, key = ""): void => {
    if (typeof value === "number") {
      allowed.add(value);
      const unit = unitInKey(key);
      if (unit) allowed.add(`${value} ${unit}`);
    }
    // Figures inside prose, such as the "2 PM sunlight" label line, are quotable too.
    else if (typeof value === "string") {
      // "10,000" is ten thousand, not a 10 and a 0: the store's offer lines write it that way.
      for (const token of value.matchAll(/\d{1,3}(?:,\d{2,3})*,\d{3}(?:\.\d+)?|\d+(?:\.\d+)?/g))
        allowed.add(Number(token[0].replaceAll(",", "")));
      for (const pair of pairsIn(value)) allowed.add(pair);
    } else if (Array.isArray(value)) value.forEach((entry) => walk(entry, key));
    else if (value && typeof value === "object") for (const [name, entry] of Object.entries(value)) walk(entry, name);
  };
  walk({
    p: pack.products,
    o: pack.offers,
    f: pack.finance,
    c: pack.charges,
    b: pack.shift_brief,
    l: pack.labels,
    m: pack.myths,
    i: pack.install_requirements,
    s: pack.store,
    a: pack.accessories,
    e: pack.electricity,
    t: pack.search?.total,
  });
  // Derived totals an answer may legitimately state.
  for (const product of pack.products) {
    for (const offer of pack.offers) {
      const percent = offerAmount(product, offer);
      if (percent > 0) {
        allowed.add(percent);
        allowed.add(product.price_rupees - percent);
      }
    }
    allowed.add(product.mrp_rupees - product.price_rupees);
    // An itemised total may name the product with any accessory, and the yearly running cost.
    for (const accessory of pack.accessories ?? []) {
      allowed.add(product.price_rupees + accessory.price_rupees);
      for (const charge of pack.charges)
        if (typeof charge.amount_rupees === "number")
          allowed.add(product.price_rupees + accessory.price_rupees + charge.amount_rupees);
    }
    if (pack.electricity?.tariff_rupees_per_unit && product.energy?.units_per_year_4h_day)
      allowed.add(product.energy.units_per_year_4h_day * pack.electricity.tariff_rupees_per_unit);
    for (const term of pack.finance)
      if (Number(term.months) > 0) allowed.add(Math.round(product.price_rupees / Number(term.months)));
    for (const charge of pack.charges) {
      if (typeof charge.amount_rupees === "number") allowed.add(product.price_rupees + charge.amount_rupees);
      if (typeof charge.percent_of_price === "number")
        allowed.add(Math.round((product.price_rupees * charge.percent_of_price) / 100));
    }
  }
  // The closing figure: any itemised base less any subset of the pack's own offers, because the
  // deal is closed on the net payable, not on each offer in isolation.
  for (const product of pack.products) {
    const discounts = pack.offers.map((offer) => offerAmount(product, offer)).filter((amount) => amount > 0);
    if (!discounts.length) continue;
    const bases = new Set<number>([product.price_rupees]);
    for (const accessory of pack.accessories ?? [])
      for (const charge of pack.charges) {
        const extra = typeof charge.amount_rupees === "number" ? charge.amount_rupees : 0;
        bases.add(product.price_rupees + accessory.price_rupees);
        bases.add(product.price_rupees + accessory.price_rupees + extra);
        bases.add(product.price_rupees + extra);
      }
    // Subsets by folding each amount into the set of sums so far; the pack's offers are few.
    const sums = new Set<number>([0]);
    for (const discount of discounts) for (const existing of [...sums]) sums.add(existing + discount);
    for (const base of bases) for (const sum of sums) if (base - sum > 0) allowed.add(base - sum);
  }
  return allowed;
}

/** What the model is given: what the store returned for this turn, and how much more it holds.
 *  stock_units is left out because the listing only says yes or no, and a 1 here came back as
 *  "1 in stock"; a screen size and a panel are in the name where they mean anything. */
export function factsFor(pack: Pack): string {
  const skip = new Set(["stock_units", "size_inch", "panel", "energy", "weak_for"]);
  // Everything running on a product, on that product's own line. Offers used to sit in three spec
  // keys and a separate list, so an empty look at one read as "no offer" with one named right below.
  const offerSpecs = ["discount", "offer_tag", "bank_offer"];
  const onIt = (offer: Record<string, unknown>, name: string): boolean =>
    Array.isArray(offer.on) && offer.on.includes(name);
  const general = pack.offers.filter((offer) => !Array.isArray(offer.on));
  // Twelve rows with every spec is 10,000 tokens a turn, and the later ones are the same thing in
  // another colour. So the first six are in full, and the rest say what tells them apart.
  return JSON.stringify({
    ...(pack.search ? { search: pack.search } : {}),
    products: pack.products.slice(0, 12).map((product, index) => ({
      ...Object.fromEntries(Object.entries(product).filter(([key, value]) => !skip.has(key) && value !== "")),
      good_for: product.good_for.slice(0, index < 6 ? 8 : 0),
      specs: Object.fromEntries(
        Object.entries(product.specs).filter(([key]) => !offerSpecs.includes(key) && (index < 6 || key === "status")),
      ),
      offers_on_it: [
        ...offerSpecs.map((key) => (product.specs as Record<string, unknown>)[key]).filter(Boolean),
        ...pack.offers.filter((offer) => onIt(offer, product.name)).map((offer) => offer.title),
      ],
      in_stock: product.stock_units > 0,
    })),
    ...(general.length ? { offers: general } : {}),
    // Only a file pack has these: the live one is empty, and an empty list is not worth the tokens.
    ...Object.fromEntries(
      (["finance", "charges", "accessories", "labels", "myths", "install_requirements"] as const)
        .filter((key) => Object.keys(pack[key] ?? {}).length)
        .map((key) => [key, pack[key]]),
    ),
  });
}
