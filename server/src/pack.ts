import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { HomeCard } from "./types.js";
import { adaptPack, adaptProduct, fromFdk, fromPromotion, running } from "./adapt.js";
import { catalogConfig, getProducts, getPromotionOffers, type CatalogConfig, type Facet } from "./catalog.js";

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

/** The live store, read-only, in the shape the rest of this reads.
 *
 *  getProducts for the catalogue, getPromotionOffers for what is running on the few we would
 *  actually recommend — the endpoint is per slug, so this is not a crawl. Everything those two
 *  methods do not carry — finance terms, charges, myths, labels, install requirements — stays from
 *  `base`, which is data/pack.json, because no endpoint this product may call has them.
 *
 *  shortcut: read once, at startup. Stock moves during a shift and this will not notice until the
 *  server restarts. Add a refresh when the floor is live all day rather than for a demo. */
export async function livePack(
  config: CatalogConfig,
  base: Record<string, any>,
  request: typeof fetch = fetch,
): Promise<Record<string, any>> {
  // No search term: the associate can be asked about anything the store sells, so the catalogue
  // comes as the catalogue. What bounds the prompt is factsFor, not what we fetch.
  const { items } = await getProducts(config, { page_size: 24, page_no: 1, page_type: "number" }, request);
  if (!items.length) throw Error("The catalogue answered with no products");
  const offers = new Map<string, Record<string, unknown>>();
  for (const row of items.slice(0, 5)) {
    const slug = (row as { slug?: string }).slug;
    if (!slug) continue;
    for (const promotion of await getPromotionOffers(config, { slug }, request)) {
      const offer = fromPromotion(promotion);
      if (running(offer)) offers.set(String(offer.id ?? offer.title), offer);
    }
  }
  return {
    ...base,
    version: `live-${new Date().toISOString().slice(0, 10)}`,
    products: items.map(fromFdk),
    // Never the pack's own offers once the live catalogue is on: they are a stub's, this channel
    // runs neither of them, and an offer quoted that does not exist is the worst thing this
    // product can do. An empty list is the honest answer.
    offers: [...offers.values()],
  };
}

/** The catalogue, asked a question.
 *
 *  The store holds 8,383 products on the storefront surface and the panel counts 52,016 on the
 *  channel. None of that can be loaded, and loading the first page of it is worse than useless:
 *  it answered a television conversation with a refrigerator and a laptop. So the catalogue is
 *  searched for what this conversation is actually about, and the promotions are fetched for what
 *  the search returned rather than for whatever happened to be first.
 *
 *  Cached by query, because an associate asks about the same thing for several turns running and
 *  a WhatsApp reply has five seconds to arrive. */
const searched = new Map<string, Pack>();

/** What to ask the catalogue for, out of what the associate said.
 *
 *  `q` does not take a sentence: "customer wants a washing machine, family of four, balcony is
 *  small" matched nothing at all, so the pack silently stayed the four stub televisions and every
 *  later turn asked a washing machine customer about viewing distance. Two or three words of the
 *  thing itself is what the endpoint answers. */
const FILLER =
  /\b(customer|customers|wants?|needs?|looking|for|a|an|the|is|are|was|were|we|us|they|their|them|he|she|his|her|and|with|in|on|at|of|to|my|our|about|show|me|please|sir|madam|asking|asked|ask|store|shop|shelf|aisle|counter|new|some|good|best|today|buy|buying|want|have|has|got|ek|chahiye|hai|hain|ka|ke|ki|liye|mein|kuch|grahak|lena|dikhao|batao|bhai|boss|ko|se|par|bhi|wala|wali|kya|koi|iske|uske|kaunsa|konsa|kaun|kitna|kitne|dikhau|dikhaun|hamare|apne|offer|offers|offerings|running|discount|deal|deals|scheme|price|prices|cost|costs|stock|available|availability|any|tell|know|say|said|give|think|see|find|get|what|which|who|whose|how|much|many|does|do|did|can|could|should|would|there|here|that|this|these|those|something|anything|options?|model|models|range)\b/gi;

/** Two words the catalogue does not use for the thing the associate means. "ac" on its own
 *  matches TP-Link AC1900 routers, which is a different kind of AC entirely. */
const MEANS: Record<string, string> = { ac: "air conditioner", washer: "washing machine" };

/** The catalogue is written in English and the associate is not always. Nine words, because a
 *  Devanagari sentence otherwise reduces to nothing and the pack silently stays the stub's. */
const SAID_IN_HINDI: Record<string, string> = {
  टीवी: "tv",
  "टीवी।": "tv",
  फ्रिज: "fridge",
  फ़्रिज: "fridge",
  रेफ्रिजरेटर: "refrigerator",
  वाशिंग: "washing machine",
  मशीन: "washing machine",
  एसी: "ac",
  कूलर: "cooler",
  लैपटॉप: "laptop",
  मोबाइल: "mobile",
  फोन: "mobile",
};

/** A brand the associate names, written the way the catalogue writes the kind. "iphone" shares no
 *  token with the store's own category "smart-phones", and the count-based pick answered an iPhone
 *  question with Apple Watches. So the associate's word is mapped to the kind it is: a phone. */
const KIND_OF: Record<string, string> = { iphone: "phone", ipad: "tablet", macbook: "laptop" };

/** Units of measurement. An inch runs country-wide stock, not a kind: the TV refine for
 *  "sony bravia 85 inch" handed back the most popular screens — Samsung 85s — and they were
 *  adopted on the word "inch" alone. A unit never names what the product is. */
const UNIT = /inch|inches|kg|gram|litre|liter|ton|gb|tb|mm|cm|watt|watts|star|feet|foot/;
export function words(text: string): string[] {
  const lowered = text.toLowerCase();
  const named = Object.entries(SAID_IN_HINDI).find(([hindi]) => lowered.includes(hindi));
  if (named) return [named[1]];
  return [
    ...new Set(
      lowered
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(FILLER, " ")
        .split(/\s+/)
        // Two letters, because "tv" is the word an associate actually types and dropping it left the
        // query as "hall", which matched desert coolers.
        // Numbers stay: "sony 85" is a better query than "sony", which returns camera pouches.
        .filter((word) => word.length > 1)
        .map((word) => MEANS[word] ?? word),
    ),
  ];
}

export function terms(text: string): string[] {
  const said = words(text);
  // Shortest first. The endpoint answers a product noun and returns nothing for a description:
  // "washing machine" finds machines, "fridge small" finds nothing at all.
  return [...new Set([said.slice(0, 2).join(" "), said[0] ?? "", said.slice(0, 3).join(" ")])].filter(Boolean);
}

/** resQ is Reliance's own service brand and extended-warranty its category. A protection plan is
 *  not a product to put in front of a customer, and it out-counts the real thing on a plain query:
 *  "fridge" returns 150 extended warranties against 122 refrigerators. Dropped before the counts
 *  are read, which is also where `resQ 0"` came from being offered as one of three televisions. */
const SERVICE = /resq|warranty|protection|insurance|installation/i;

/** Whether what was found is actually the thing named. The store's own search ranks an
 *  accessory named after the product above the product, and it answers nearly any string with
 *  something ("paper plane" reached karaoke speakers), so the words have to be in what came
 *  back: this is what keeps a short "what about iphone" from adopting watches and "8 feet" from
 *  dragging a washing machine pack away. */
export function aboutTheWords(said: string[], products: { brand: string; name: string }[]): boolean {
  const kinds = said.filter((word) => word.length > 2 && !/^\d/.test(word) && !UNIT.test(word));
  if (!kinds.length) return false;
  return products.some((product) =>
    kinds.some((kind) => `${product.brand} ${product.name}`.toLowerCase().includes(kind)),
  );
}

/** What the associate's words call the kind, out of the store's own category facet values. A word
 *  that names a brand ("apple", "noise") is not a kind — the brand facet knows it. And after
 *  brands are removed the last word left is the head of what was said: "smart watch" is a watch,
 *  even though "smart" also opens the store's smart-phones. */
/** The accessory shelves the store keeps beside the products. Their facet counts sit above the
 *  products they serve — q="smart watch" answered with a "smart-watch-accessories" shelf of
 *  straps — so they are never the kind the words name, unless the associate asked for one. */
const ACCESSORY_SHELF = /accessor|cover|case|strap|band|pouch|sleeve|holder|adapter|charger|cable/;
const ACCESSORY_WORD = /\b(accessor|cover|case|strap|band|pouch|sleeve|holder|adapter|charger|cable)/;

export function categoryByWords(filters: Facet[], said: string[]): string | undefined {
  const brands = (filters.find((facet) => facet.key?.name === "brand")?.values ?? []).map((value) =>
    String(value?.value ?? "").toLowerCase(),
  );
  const of = (word: string) => KIND_OF[word] ?? word;
  const kinds = [
    ...new Set(
      said
        .map(of)
        .filter(
          (word) =>
            word.length > 2 &&
            !/^\d/.test(word) &&
            !UNIT.test(word) &&
            !brands.some((brand) => brand.includes(word) || word.includes(brand)),
        ),
    ),
  ];
  if (!kinds.length) return undefined;
  const head = kinds[kinds.length - 1]!;
  // Dash and space are the same separator as far as matching goes: the store writes
  // "multi-function-inkjet-printers" for "printer".
  const tidy = (text: string) => text.replace(/[^a-z0-9]+/g, " ").toLowerCase();
  // The store's own facet counts put the accessory shelves above the products they serve —
  // q="smart watch" answered with a "smart-watch-accessories" shelf of straps — so an accessory
  // shelf is never the kind the words name, unless the associate asked for an accessory itself.
  const wantsAccessory = said.some((word) => ACCESSORY_WORD.test(word));
  const named =
    filters
      .find((facet) => facet.key?.name === "category")
      ?.values?.filter(
        (value) =>
          value.value &&
          !SERVICE.test(String(value.value)) &&
          (wantsAccessory || !ACCESSORY_SHELF.test(String(value.value))),
      )
      .map((value) => {
        const text = tidy(String(value.value));
        const hits = kinds.reduce((total, kind) => total + (text.includes(kind) ? (kind === head ? 2 : 1) : 0), 0);
        return { value, hits };
      })
      .filter((hit) => hit.hits > 0)
      .sort((a, b) => b.hits - a.hits || (b.value.count ?? 0) - (a.value.count ?? 0))[0]?.value ?? undefined;
  return named ? String(named.value) : undefined;
}

/** The brand facet values the associate's own words name — "sony" in "soundbar sony", "apple" in
 *  "apple iphone". Whatever else the store's search suggests, these words are in the question. */
export function namedBrands(filters: Facet[], said: string[]): string[] {
  return (filters.find((facet) => facet.key?.name === "brand")?.values ?? [])
    .filter((value) =>
      value.value
        ? said.some((word) => {
            const text = String(value.value).toLowerCase();
            const bare = (part: string) => part.replace(/[^a-z0-9]/g, "");
            return text === word || (text.length > 1 && bare(text) === bare(word));
          })
        : false,
    )
    .map((value) => String(value.value).toLowerCase());
}

/** The narrowest filter the store's own facets support for this query.
 *
 *  The method reference documents `filters` on the same response and `f` as the way to use it:
 *  `brand:Guerra:::l3_categories:Carter`, where `:::` is AND. So which of the associate's words
 *  matter is not ours to guess — the catalogue answers it. "sony" lists a camera pouch first out
 *  of 294 rows, and its own category facet says 110 of them are televisions. */
export function narrow(filters: Facet[], items: number, said: string[] = []): string | undefined {
  const top = (name: string) =>
    (filters.find((facet) => facet.key?.name === name)?.values ?? [])
      .filter((value) => value.value && !SERVICE.test(String(value.value)))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
  // A category the words themselves name wins over the one with the biggest count: the counts are
  // holdings of the whole catalogue, and for q="iphone" that counted Apple Watches above the
  // phones. What nothing said names is the count's answer.
  const values = (filters.find((facet) => facet.key?.name === "category")?.values ?? []).filter(
    (value) => value.value && !SERVICE.test(String(value.value)),
  );
  const wanted = categoryByWords(filters, said);
  const named = wanted ? values.find((value) => String(value.value) === wanted) : undefined;
  const category = named ?? top("category");
  if (!category) return undefined;
  // A brand joins the filter only when the query was about that brand. "sony" is 194 of 294 rows
  // and belongs; "washing machine" has no brand above a third of the rows and must not be
  // narrowed to one, or we would answer it with whichever brand happens to stock the most. What
  // the associate named joins even when it is thin: "soundbar sony" — four of eleven — came back
  // as the more popular JBLs, which answered a Sony question with someone else's products.
  const brandValues = (filters.find((facet) => facet.key?.name === "brand")?.values ?? []).filter(
    (value) => value.value && !SERVICE.test(String(value.value)),
  );
  brandValues.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const topBrand = brandValues[0];
  // Whatever the associate named joins even when it is thin in the shelf; absent that, the brand
  // only joins when it is the majority — one that holds under half the rows is a guess.
  const majority = topBrand && (topBrand.count ?? 0) * 2 >= items ? String(topBrand.value) : undefined;
  const chosen = namedBrands(filters, said)[0] ?? majority;
  const joined = chosen ? `brand:${chosen}:::` : "";
  return `${joined}category:${category.value}`;
}

export async function searchPack(base: Pack, query: string, request: typeof fetch = fetch): Promise<Pack> {
  const config = catalogConfig();
  const asked = query.trim().toLowerCase().slice(0, 60);
  if (!config || asked.length < 3) return base;
  const hit = searched.get(asked);
  if (hit) return hit;

  // A fuzzy storefront answers almost any string with something — "paper plane" reached karaoke
  // speakers — so a candidate's rows are only adopted when the catalogue named a category after
  // the words said, or the rows themselves carry them. The first rows the store hands over wait
  // as the fallback until a later candidate ("printer" after "printer office") answers for real.
  const said = words(asked);
  const kinds = said.filter((word) => word.length > 2 && !/^\d/.test(word) && !UNIT.test(word));
  let won: Record<string, unknown>[] | undefined;
  let fallback: Record<string, unknown>[] | undefined;
  for (const q of terms(asked)) {
    // `filters: true` is the reference's own default and costs nothing extra: the store returns
    // its brand and category facets for this query alongside the rows. `sort_on: popular` is the
    // response's own sort list and the only documented order that puts the product above the
    // accessories named after it: a plain q="iphone" ranked Apple wallets above the iPhone 15s.
    const found = await getProducts(
      config,
      { q, sort_on: "popular", filters: true, page_size: 12, page_no: 1, page_type: "number" },
      request,
    );
    if (!found.items.length) continue;
    const wanted = namedBrands(found.filters, said);
    // What the associate named as a brand has to stay in the answer: a refine that swallows it is
    // the more popular other brand answering a Sony question, and stays just a suggestion.
    const carrying = (rows: Record<string, unknown>[]) =>
      !wanted.length ||
      rows.some((row) => {
        const text = adaptProduct(fromFdk(row)).product.brand.toLowerCase();
        return wanted.every((brand) => text.includes(brand) || text.replace(/[^a-z0-9]/g, " ").includes(brand));
      });
    // How much of what the associate said lives in the first rows of a candidate — the rows the
    // reply would actually be built from. The popular soundbar page held one Sony row too, but
    // behind three JBLs: a Sony somewhere on the page is not the Sony answer. A refine is only
    // taken when its first rows keep at least as much of what was said as the loose ones had.
    const coverage = (rows: Record<string, unknown>[]) => {
      if (!kinds.length) return 0;
      const hits = new Set<string>();
      for (const row of rows.slice(0, 3)) {
        const product = adaptProduct(fromFdk(row)).product;
        const text = `${product.brand} ${product.name}`.toLowerCase();
        for (const kind of kinds) if (text.includes(kind)) hits.add(kind);
      }
      return hits.size;
    };
    let rows = found.items;
    const f = narrow(found.filters, Number(found.page.item_total) || found.items.length, said);
    if (f) {
      const refined = await getProducts(
        config,
        { f, sort_on: "popular", page_size: 12, page_no: 1, page_type: "number" },
        request,
      ).catch(() => null);
      // Only when it answers with at least as much of the question: nothing at all, another
      // brand, a narrower slice of the words said — each is a worse answer than the loose rows.
      if (refined?.items.length && carrying(refined.items) && coverage(refined.items) >= coverage(rows))
        rows = refined.items;
    }
    const adapted = rows.map((row) => adaptProduct(fromFdk(row)).product);
    const fits = (categoryByWords(found.filters, said) !== undefined || aboutTheWords(said, adapted)) && carrying(rows);
    if (fits) {
      won = rows;
      break;
    }
    fallback = rows;
  }
  // What none of the candidates won: the store answered every one of them with empty pages.
  const items = won ?? fallback ?? [];
  const adapted = items.map((row) => adaptProduct(fromFdk(row)).product).filter((product) => product.sku);

  // Nothing found is said, not substituted: the loose base first page is a heap of whatever the
  // store sorted first (a fridge, a television, resQ warranty plans), and answering an iPhone
  // question from it is how the associate was told about televisions instead.
  if (!adapted.length) throw Error(`The catalogue matched nothing for ${JSON.stringify(asked)}`);

  // Promotions for the three we would actually put in front of a customer, not for the first
  // three of the catalogue: one television in twelve has one, so asking about the wrong three
  // finds nothing and the pack falls back to offers this shop is not running.
  // Five, asked at once. The endpoint is per slug, so in series this was five round trips and a
  // reply has five seconds to arrive; in parallel it costs what one costs. Three was too few: the
  // Sony with the wall-mount offer came fourth in its own search.
  const offers = new Map<string, Record<string, unknown>>();
  const slugs = items
    .slice(0, 5)
    .map((row) => (row as { slug?: string }).slug)
    .filter((slug): slug is string => !!slug);
  const answered = await Promise.all(
    slugs.map((slug) => getPromotionOffers(config, { slug }, request).catch(() => [])),
  );
  for (const promotion of answered.flat()) {
    const offer = fromPromotion(promotion);
    if (running(offer)) offers.set(String(offer.id ?? offer.title), offer);
  }
  // No fallback to the pack's own offers. Those are a stub's HDFC discount and exchange bonus, and
  // this channel runs neither: an associate told "HDFC 7.5% off" on a washing machine would be
  // quoting an offer that does not exist. Nothing running is a true answer; the stub's is a lie.
  const pack: Pack = { ...base, products: adapted, offers: [...offers.values()] };
  // A handful of queries per shift; this is a cap against a loop, not a cache policy.
  if (searched.size > 64) searched.clear();
  searched.set(asked, pack);
  return pack;
}

/** The pack the server serves: the live catalogue when it is configured, the file otherwise.
 *
 *  A bad key must not kill the number. It says so loudly and serves the file, because an associate
 *  with a customer in front of them needs an answer more than they need our configuration to be
 *  right. */
export async function startingPack(request: typeof fetch = fetch): Promise<{ pack: Pack; source: string }> {
  const config = catalogConfig();
  const file = process.env.PACK_PATH || "data/pack.json";
  if (!config) return { pack: await loadPack(file), source: file };
  try {
    const { pack, problems } = adaptPack(
      (await livePack(config, JSON.parse(await readSource(file)), request)) as never,
    );
    if (problems.length) throw Error(problems.join("; "));
    return { pack, source: `live catalogue · ${pack.products.length} products` };
  } catch (error) {
    console.error(`Live catalogue unusable, serving ${file}: ${error instanceof Error ? error.message : "unknown"}`);
    return { pack: await loadPack(file), source: `${file} (live catalogue failed)` };
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
      for (const token of value.matchAll(/\d+(?:\.\d+)?/g)) allowed.add(Number(token[0]));
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

/** Facts for this home only, so the model never sees the whole catalogue as fair game. */
export function factsFor(pack: Pack, card: HomeCard, shortlist: string[]): string {
  const picked = shortlist.length ? pack.products.filter((product) => shortlist.includes(product.sku)) : pack.products;
  const sized = card.distance_feet
    ? picked.filter((product) => Math.abs(product.size_inch - recommendedInches(card.distance_feet!)) <= 12)
    : picked;
  // A real catalogue is thousands of lines and this goes into every prompt. The shortlist and the
  // distance filter first; this is the backstop that keeps a turn affordable when neither has
  // narrowed anything yet.
  // shortcut: the first twelve, not the twelve that matter. Search the catalogue per conversation
  // when the pack stops being one category.
  return JSON.stringify({
    store: pack.store,
    products: (sized.length ? sized : picked)
      .slice(0, 12)
      .map((product) => ({ ...product, in_stock: product.stock_units > 0 })),
    offers: pack.offers,
    finance: pack.finance,
    charges: pack.charges,
    accessories: pack.accessories,
    electricity: pack.electricity,
    labels: pack.labels,
    myths: pack.myths,
    install_requirements: pack.install_requirements,
  });
}

/** Industry rule of thumb for 4K: screen diagonal is about 1.6 times the viewing distance. */
export function recommendedInches(distanceFeet: number): number {
  return Math.round((distanceFeet * 12) / 1.6);
}
