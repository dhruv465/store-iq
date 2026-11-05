import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_PATHS,
  catalogConfig,
  getLocations,
  getProducts,
  getPromotionOffers,
  getStock,
  read,
} from "../server/src/catalog.js";
import {
  allowedNumbers,
  carriesKind,
  factsFor,
  readSearch,
  searchPack,
  shelvesOf,
  startingPack,
  type Pack,
  type Search,
} from "../server/src/pack.js";
import { decide, unsupportedNumbers } from "../server/src/brain.js";
import { t } from "../server/src/i18n.js";
import { newSession, type Event, type Session } from "../server/src/types.js";
import "./model.js";

const config = { host: "https://api.example.com", applicationId: "app-id", applicationToken: "app-token" };

function spy(body: unknown = { items: [], page: {} }): {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: fake, calls };
}

test("only the five readable endpoints can be called, and all are on the storefront surface", async () => {
  assert.equal(ALLOWED_PATHS.length, 5);
  for (const path of ALLOWED_PATHS) assert.match(path, /^\/service\/application\//, path);
  const { fetch: fake, calls } = spy();
  for (const path of [
    "/service/platform/catalog/v1.0/products",
    "/service/application/cart/v1.0/checkout",
    "/service/application/catalog/v1.0/products/delete",
    "/",
  ]) {
    await assert.rejects(read(config, path as never, {}, fake), /Refusing to call/, path);
  }
  assert.deepEqual(calls, [], "nothing reached the network");
});

test("every request it can make is a GET", async () => {
  const { fetch: fake, calls } = spy();
  await getProducts(config, { q: "television" }, fake);
  await getPromotionOffers(config, { slug: "sony-55", store_id: 1 }, fake);
  await getStock(config, { sku_code: "SON-K55S30" }, fake);
  await getLocations(config, { city: "mumbai" }, fake);
  assert.equal(calls.length, 4);
  for (const call of calls) assert.equal(call.init.method, "GET", call.url);
});

test("a parameter cannot steer the path or the host", async () => {
  const { fetch: fake, calls } = spy();
  await assert.rejects(read(config, "../../platform/products" as never, {}, fake), /Refusing to call/);
  await getProducts(config, { q: "../../../service/platform/products" }, fake);
  const called = new URL(calls[0]!.url);
  assert.equal(called.pathname, "/service/application/catalog/v1.0/products", "the path is untouched");
  assert.equal(called.host, "api.example.com");
  assert.equal(called.searchParams.get("q"), "../../../service/platform/products", "it is only ever a search term");
});

test("the application pair is the credential, sent the way the FDK client sends it", async () => {
  const { fetch: fake, calls } = spy();
  await getProducts(config, { q: "tv" }, fake);
  assert.doesNotMatch(calls[0]!.url, /app-token/, "a URL ends up in logs and proxies");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${Buffer.from("app-id:app-token").toString("base64")}`);
});

test("a refusal never names the token", async () => {
  const { fetch: fake } = spy();
  const problem = await read(config, "/service/platform/anything" as never, {}, fake).catch((error: Error) => error);
  assert.ok(problem instanceof Error);
  assert.doesNotMatch(problem.message, /app-token|app-id/, "an error is logged, and a logged credential is leaked");
});

test("the catalogue stays off until the application pair is present", () => {
  assert.equal(catalogConfig({} as never), null);
  assert.equal(catalogConfig({ CATALOG_HOST: "x" } as never), null);
  assert.equal(catalogConfig({ CATALOG_APPLICATION_ID: "y" } as never), null);
  assert.deepEqual(catalogConfig({ CATALOG_APPLICATION_ID: "y", CATALOG_APPLICATION_TOKEN: "z" } as never), {
    host: "https://api.jioretailer.com",
    applicationId: "y",
    applicationToken: "z",
  });
  assert.deepEqual(
    catalogConfig({ CATALOG_HOST: "x", CATALOG_APPLICATION_ID: "y", CATALOG_APPLICATION_TOKEN: "z" } as never),
    { host: "x", applicationId: "y", applicationToken: "z" },
  );
});

test("products and promotions come back in the shape the reference describes", async () => {
  const products = spy({ items: [{ uid: 1, name: "Sony Bravia" }], page: { item_total: 1 } });
  assert.deepEqual((await getProducts(config, {}, products.fetch)).items, [{ uid: 1, name: "Sony Bravia" }]);
  assert.equal(new URL(products.calls[0]!.url).searchParams.get("page_size"), "12");

  const offers = spy({ available_promotions: [{ id: "p1", offer_text: "10% off" }] });
  assert.deepEqual(await getPromotionOffers(config, { slug: "x" }, offers.fetch), [
    { id: "p1", offer_text: "10% off" },
  ]);

  const empty = spy({});
  assert.deepEqual(await getPromotionOffers(config, {}, empty.fetch), [], "no offers is not an error");
});

test("every parameter the v1.9.5 reference documents reaches the query", async () => {
  const { fetch: fake, calls } = spy();
  await getProducts(
    config,
    { q: "tv", f: "brand:Sony", filters: true, sort_on: "popular", page_id: "636a", page_type: "cursor" },
    fake,
  );
  const products = new URL(calls[0]!.url);
  assert.equal(products.searchParams.get("f"), "brand:Sony");
  assert.equal(products.searchParams.get("filters"), "true");
  assert.equal(products.searchParams.get("page_id"), "636a");
  assert.equal(products.searchParams.get("page_type"), "cursor", "the caller's paging beats the default");

  await getPromotionOffers(config, { slug: "sony-55", cart_type: "value", promotion_group: "bank" }, fake);
  const offers = new URL(calls[1]!.url);
  assert.equal(offers.searchParams.get("cart_type"), "value");
  assert.equal(offers.searchParams.get("promotion_group"), "bank");
});

/** The real thing's two sides behind one fetch: the store by its host, the model by its prompt. */
function shop(
  rows: (url: URL) => Record<string, unknown>,
  search: Record<string, unknown> = {},
  decision: Record<string, unknown> = {},
): { fetch: typeof fetch; store: URL[]; methods: string[]; asked: string[]; told: string[] } {
  const seen = { store: [] as URL[], methods: [] as string[], asked: [] as string[], told: [] as string[] };
  const reply = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fake = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.host === "api.example.com") {
      seen.store.push(url);
      seen.methods.push(String(init.method));
      return url.pathname.includes("available-promotions") ? reply({ available_promotions: [] }) : reply(rows(url));
    }
    const body = JSON.parse(String(init.body));
    const user = JSON.stringify(body.contents);
    const isSearch = JSON.stringify(body.systemInstruction).includes("one search of the store");
    (isSearch ? seen.asked : seen.told).push(user);
    const answer = isSearch
      ? search
      : {
          step: "complete",
          card: {},
          shortlist: [],
          demonstrated: false,
          lines: ["It is Rs 1,64,900."],
          buttons: [],
          unknown: false,
          ...decision,
        };
    return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  }) as unknown as typeof fetch;
  return { fetch: fake, ...seen };
}

const row = (uid: number, name: string, price: number, extra: Record<string, unknown> = {}) => ({
  uid,
  name,
  slug: `slug-${uid}`,
  item_code: `CODE${uid}`,
  brand: { name: name.split(" ")[0] },
  price: { marked: { min: price }, effective: { min: price } },
  categories: [{ name: "Smart Phones" }],
  sellable: true,
  ...extra,
});
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  items,
  page: { item_total: items.length },
  ...extra,
});
const CASE = { categories: [{ name: "Mobile Cases" }] };
const categories = (...values: string[]) => [{ key: { name: "category" }, values: values.map((value) => ({ value })) }];

Object.assign(process.env, {
  CATALOG_HOST: "https://api.example.com",
  CATALOG_APPLICATION_ID: "app",
  CATALOG_APPLICATION_TOKEN: "token",
});

let unique = 0;
/** The search is remembered for five minutes, so each test asks for its own words. */
const search = (q: string, more: Partial<Search> = {}): Search => ({ q: `${q} ${++unique}`, ...more });
const base = (await startingPack(shop(() => page([])).fetch)).pack;

test("what the model said to search is checked before it reaches the store", () => {
  assert.equal(readSearch({ q: null }), null, "not about a product");
  assert.equal(readSearch({ q: " x " }), null);
  assert.equal(readSearch(null), null);
  assert.equal(readSearch("iphone"), null);
  assert.deepEqual(
    readSearch({ q: " iphone 18 pro ", kind: "Phone", sort_on: "cheapest", max_price: 39999.6, page_no: 1 }),
    { q: "iphone 18 pro", kind: "phone", max_price: 40000 },
    "a sort the store does not document, and page one, are not sent",
  );
  assert.deepEqual(readSearch({ q: "tv", sort_on: "price_asc", page_no: 2, max_price: -1, kind: "" }), {
    q: "tv",
    sort_on: "price_asc",
    page_no: 2,
  });
  assert.equal(readSearch({ q: "a".repeat(200) })!.q.length, 80);
});

test("a row is the kind asked for by its own name or shelf, not by what it serves", () => {
  const is = (name: string, category: string, kind: string): boolean =>
    carriesKind({ name, categories: [{ name: category }] }, kind);
  assert.equal(is("Apple iPhone 18 Pro 256 GB", "Smart Phones", "phone"), true);
  assert.equal(is("Silicone Case with iPhone 18 Pro", "Mobile Cases", "phone"), false, "phone is not inside iPhone");
  assert.equal(is("Sony Bravia 55 inch", "LED Televisions", "television"), true);
  assert.equal(is("Wall Bracket", "Television Mounts & Stands", "television"), false);
  assert.equal(is("Trolley for Washing Machine", "Appliance Stands", "washing machine"), false);
  assert.equal(is("Gimbal for Phone", "Camera Accessories", "phone"), false);
  assert.equal(is("LG 7 Kg Washing Machine", "Front Load", "washing machine"), true);
  assert.equal(is("JBL Tune 770NC", "Headphones", "phone"), false, "a headphone is not a phone");
});

test("the store's own shelf for a kind comes out of its facet, and a service is not one", () => {
  const facet = categories("smart-phones", "phone-cases", "extended-warranty-phones", "basic-phones", "headphones");
  assert.deepEqual(shelvesOf(facet, "phone"), ["smart-phones", "basic-phones"]);
  assert.deepEqual(shelvesOf([], "phone"), []);
});

test("a search goes out in the documented getProducts parameters, as a GET", async () => {
  const store = shop(() => page([row(1, "Apple iPhone", 100)]));
  const asked = search("iphone 18 pro 256 gb");
  await searchPack(base, asked, store.fetch);
  const first = store.store[0]!;
  assert.equal(first.pathname, "/service/application/catalog/v1.0/products");
  assert.deepEqual(Object.fromEntries(first.searchParams), {
    q: asked.q,
    sort_on: "popular",
    page_size: "12",
    page_no: "1",
    page_type: "number",
    filters: "true",
  });
  assert.ok(store.methods.every((method) => method === "GET"));
  assert.equal(store.store[1]!.pathname, "/service/application/cart/v1.0/available-promotions");
  assert.equal(store.store[1]!.searchParams.get("slug"), "slug-1");
});

test("paging and a sort the associate asked for reach the store", async () => {
  const store = shop(() => page([row(1, "Sony TV", 100)]));
  await searchPack(base, search("tv", { sort_on: "latest", page_no: 3 }), store.fetch);
  assert.equal(store.store[0]!.searchParams.get("sort_on"), "latest");
  assert.equal(store.store[0]!.searchParams.get("page_no"), "3");
});

test("cases named after the phone send the same words to the store's phone shelf", async () => {
  const store = shop((url) =>
    url.searchParams.get("f")
      ? page([row(2, "Apple iPhone 18 Pro 256 GB, Silver", 164900)])
      : page([row(3, "Case with iPhone 18 Pro", 999, CASE), row(4, "Strap with iPhone 18 Pro", 499, CASE)], {
          filters: categories("smart-phones", "mobile-cases"),
        }),
  );
  const pack = await searchPack(base, search("iphone 18 pro", { kind: "phone" }), store.fetch);
  assert.deepEqual(
    pack.products.map((product) => product.price_rupees),
    [164900],
  );
  assert.equal(store.store[1]!.searchParams.get("f"), "category:smart-phones");
});

test("a laptop stand is named after a laptop and is not one: the shelf decides", async () => {
  const stand = { categories: [{ name: "Laptop Stands" }] };
  const store = shop((url) =>
    url.searchParams.get("f")?.startsWith("category")
      ? page([row(7, "Acer Aspire 3 Laptop", 36990, { categories: [{ name: "Mid End Laptops" }] })])
      : page([row(8, "Aluminium Laptop Stand", 707, stand), row(9, "Laptop Messenger Bag", 999, stand)], {
          filters: categories("entry-level-laptops", "mid-end-laptops", "laptop-stands"),
        }),
  );
  const pack = await searchPack(base, search("laptop", { kind: "laptop", max_price: 40000 }), store.fetch);
  assert.deepEqual(
    pack.products.map((product) => product.price_rupees),
    [36990],
  );
  assert.equal(
    store.store[1]!.searchParams.get("f"),
    "category:entry-level-laptops||mid-end-laptops:::min_price_effective:[1,INR TO 40000,INR]",
  );
});

test("a budget uses the price facet's own format, and joins a shelf with :::", async () => {
  const seen: string[] = [];
  const store = shop((url) => {
    seen.push(String(url.searchParams.get("f")));
    return url.searchParams.get("f")?.startsWith("category")
      ? page([row(5, "LG 7 Kg Washing Machine", 31990)])
      : page([row(6, "Trolley for Washing Machine", 999, CASE)], { filters: categories("washing-machine") });
  });
  await searchPack(base, search("front load", { kind: "washing machine", max_price: 40000 }), store.fetch);
  assert.deepEqual(seen, [
    "min_price_effective:[1,INR TO 40000,INR]",
    "category:washing-machine:::min_price_effective:[1,INR TO 40000,INR]",
  ]);
});

test("a warranty is not a fridge, until a warranty is what was asked for", async () => {
  const rows = () =>
    page([
      row(7, "resQ Extended Warranty", 999, { brand: { name: "resQ" } }),
      row(8, "LG Double Door Fridge, 2 Years Warranty", 39990),
    ]);
  const fridge = await searchPack(base, search("fridge"), shop(rows).fetch);
  assert.deepEqual(
    fridge.products.map((product) => product.sku),
    ["CODE8"],
    "the warranty in a real fridge's name does not drop it",
  );
  const warranty = await searchPack(base, search("extended warranty"), shop(rows).fetch);
  assert.equal(warranty.products.length, 2);
});

test("cheapest is the cheapest of what matched, not of everything the loose search touched", async () => {
  const carrying = shop(() =>
    page([
      row(9, "Zebronics 24 inch LED", 7000),
      row(10, "LG 42 inch OLED TV", 119990),
      row(11, "LG 55 OLED TV", 150000),
    ]),
  );
  const named = await searchPack(base, { q: "lg oled", sort_on: "price_asc" }, carrying.fetch);
  assert.equal(named.products[0]!.price_rupees, 119990);
  assert.equal(named.products.length, 2);

  // No row carries the words, so the most relevant rows are sorted here.
  const none = shop((url) =>
    url.searchParams.get("sort_on") === "popular"
      ? page([row(12, "Big TV", 90000), row(13, "Small TV", 20000)])
      : page([row(14, "Cable", 100)]),
  );
  const fallen = await searchPack(base, search("gigantic tv", { sort_on: "price_asc" }), none.fetch);
  assert.deepEqual(
    fallen.products.map((product) => product.price_rupees),
    [20000, 90000],
  );
});

test("a discount sort does not turn a phone into its cases", async () => {
  const store = shop((url) =>
    url.searchParams.get("sort_on") === "discount_dsc"
      ? page([row(15, "Case 90% off", 99, CASE), row(16, "Apple iPhone 18 Pro 256 GB, Silver", 164900)])
      : page([]),
  );
  const pack = await searchPack(base, { q: "iphone 18 pro", sort_on: "discount_dsc" }, store.fetch);
  assert.deepEqual(
    pack.products.map((product) => product.sku),
    ["CODE16"],
  );
  assert.equal(store.store[0]!.searchParams.get("page_size"), "48");
});

test("a search that finds nothing is no products, not the first page and not an error", async () => {
  const pack = await searchPack(base, search("paper plane"), shop(() => page([])).fetch);
  assert.deepEqual(pack.products, []);
  assert.deepEqual(pack.offers, []);
  assert.equal(pack.search?.total, 0);
});

test("a store that does not answer throws, so the turn can say so", async () => {
  const broken = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(searchPack(base, search("anything"), broken));
});

test("an offer says which product it is on, and a dead promotion call is no offer", async () => {
  let calls = 0;
  const promotion = { id: "p1", offer_text: "10% off on HDFC cards", valid_till: "2099-01-01T00:00:00Z" };
  const expired = { id: "p2", offer_text: "Gone", valid_till: "2001-01-01T00:00:00Z" };
  const fake = (async (input: string | URL) => {
    const url = new URL(String(input));
    if (!url.pathname.includes("available-promotions"))
      return Response.json(page([row(20, "Sony A", 100), row(21, "Sony B", 200), row(22, "Sony C", 300)]));
    calls += 1;
    if (url.searchParams.get("slug") === "slug-21") return new Response("nope", { status: 500 });
    return Response.json({ available_promotions: [promotion, expired] });
  }) as unknown as typeof fetch;
  const pack = await searchPack(base, search("sony"), fake);
  assert.equal(calls, 3);
  assert.equal(pack.products.length, 3, "the failed promotion did not fail the search");
  assert.deepEqual(
    pack.offers.map((offer) => [offer.title, offer.on]),
    [["10% off on HDFC cards", ["Sony A", "Sony C"]]],
  );
});

test("the same search inside five minutes is not asked twice", async () => {
  const store = shop(() => page([row(23, "Sony", 100)]));
  const asked = search("sony again");
  await searchPack(base, asked, store.fetch);
  const after = store.store.length;
  await searchPack(base, asked, store.fetch);
  assert.equal(store.store.length, after);
});

test("the live pack carries nothing of the file's: no stub television, finance, charge or brief", async () => {
  const live = await startingPack(shop(() => ({ items: [], page: { item_total: 8413 } })).fetch);
  assert.equal(live.source, "live catalogue · 8413 products");
  assert.deepEqual(live.pack.products, []);
  for (const key of ["finance", "charges", "accessories", "labels", "myths", "objections"] as const)
    assert.deepEqual(live.pack[key], [], key);
  assert.deepEqual(live.pack.shift_brief, {});
  assert.deepEqual(live.pack.experts, [], "the file's experts are made-up people");

  const logged = console.error;
  const said: string[] = [];
  console.error = (line: string) => void said.push(line);
  try {
    const broken = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const fallen = await startingPack(broken);
    assert.match(fallen.source, /live catalogue failed/);
    assert.deepEqual(fallen.pack.products, [], "a bad key never serves the stub televisions as today's");
    assert.match(said.join(" "), /Live catalogue unusable/, "and it says so loudly");
    assert.doesNotMatch(said.join(" "), /token|app:/);
  } finally {
    console.error = logged;
  }
});

test("FACTS is what the store returned, with no unit count and later rows cut to what tells them apart", async () => {
  const rows = Array.from({ length: 8 }, (_, index) =>
    row(30 + index, `Sony ${index}`, 100 + index, {
      discount: "10% OFF",
      attributes: { ram: "8 GB" },
      highlights: ["Fast"],
    }),
  );
  const facts = JSON.parse(factsFor(await searchPack(base, search("sony set"), shop(() => page(rows)).fetch)));
  assert.equal(facts.search.total, 8);
  assert.equal(facts.products.length, 8);
  assert.equal(facts.products[0].in_stock, true);
  assert.equal(facts.products[0].stock_units, undefined, "this listing only says yes or no");
  assert.equal(facts.products[0].specs.ram, "8 GB");
  assert.deepEqual(facts.products[7].specs, {});
  assert.deepEqual(facts.products[7].offers_on_it, ["10% OFF"]);
  assert.deepEqual(facts.products[7].good_for, []);
  for (const empty of ["finance", "charges", "accessories", "labels", "myths"]) assert.equal(facts[empty], undefined);
});

test("every offer on a product is on that product's own line, and one on its neighbour is not", async () => {
  const fake = (async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.includes("available-promotions"))
      return Response.json({
        available_promotions:
          url.searchParams.get("slug") === "slug-61"
            ? [{ id: "p9", offer_text: "Free wall mount", valid_till: "2099-01-01T00:00:00Z" }]
            : [],
      });
    return Response.json(
      page([
        row(60, "LG NU870", 38990, {
          discount: "15% OFF",
          _custom_meta: [
            { key: "pg_offer", value: JSON.stringify({ bank: "INDUSIND_BANK", discount: "3899" }) },
            { key: "Tag1", value: "5% Upto 1500 HDFC/ICICI CC*" },
          ],
        }),
        row(61, "LG NU885", 39990),
        row(62, "LG Plain", 29990),
      ]),
    );
  }) as unknown as typeof fetch;
  const facts = JSON.parse(factsFor(await searchPack(base, search("lg offers"), fake)));
  assert.deepEqual(facts.products[0].offers_on_it, [
    "15% OFF",
    "5% Upto 1500 HDFC/ICICI CC*",
    "INDUSIND BANK card: saves Rs 3899",
  ]);
  assert.deepEqual(facts.products[1].offers_on_it, ["Free wall mount"]);
  assert.deepEqual(facts.products[2].offers_on_it, []);
  assert.equal(facts.products[0].specs.bank_offer, undefined, "one place to read it, so two cannot disagree");
  assert.equal(facts.offers, undefined);
});

test("the guard allows what the store's row says, and nothing it does not", async () => {
  const offer = {
    _custom_meta: [
      { key: "pg_offer", value: JSON.stringify({ bank: "ICICI", subtitle: "26315.46/6", discount: "7007.24" }) },
      { key: "Tag1", value: "12.5% Upto 10,000 HDFC/ICICI CC*" },
    ],
  };
  const pack = await searchPack(
    base,
    search("iphone pro"),
    shop(() => page([row(40, "Apple iPhone 18 Pro 256 GB", 164900, offer)])).fetch,
  );
  const allowed = allowedNumbers(pack);
  assert.deepEqual(unsupportedNumbers("Rs 1,64,900, or 6 months at Rs 26,315, saving Rs 7,007.", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("12.5% off up to Rs 10,000 with HDFC.", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("It is Rs 1,79,900.", allowed, ""), ["179900"]);
  assert.deepEqual(unsupportedNumbers("Rs 54,990", allowed, ""), ["54990"], "the file pack's TCL is not in this");
});

const said = (text: string): Event => ({ id: `t${++unique}`, phone: "919820000001", modality: "text", text });

test("a turn: the sentence becomes a search, the store's rows become FACTS, the model writes the reply", async () => {
  const q = `iphone 18 pro 256 gb ${++unique}`;
  const store = shop(
    () => page([row(50, "Apple iPhone 18 Pro 256 GB, Silver", 164900)]),
    { q, kind: "phone" },
    {
      buttons: [{ id: "select:CODE50", title: "Silver" }],
    },
  );
  const session = newSession("919820000001");
  const reply = await decide(said("give me the current data for iPhone 18 Pro 256 GB"), session, base, store.fetch);
  assert.match(store.asked[0]!, /give me the current data for iPhone 18 Pro/);
  assert.equal(store.store[0]!.searchParams.get("q"), q, "the words of the product, not the sentence");
  assert.match(store.told[0]!, /Apple iPhone 18 Pro 256 GB, Silver/);
  assert.match(store.told[0]!, /164900/);
  assert.match(reply.text, /Rs 1,64,900/);
  assert.doesNotMatch(reply.text, /I heard|access/);
  assert.deepEqual(reply.buttons, [{ id: "select:CODE50", title: "Silver" }]);
  assert.deepEqual(session.search, { q, kind: "phone" });
  assert.deepEqual(session.card, {}, "a decided customer has no home card");
});

test("the reply is written in the language of this message, whatever came before", async () => {
  const text = `lg set ${++unique}`;
  const store = shop(() => page([row(70, "LG set", 38990)]), { q: text }, { lines: ["It is Rs 38,990."] });
  const session = newSession("919820000001");
  session.language = "hi";
  const last = () => store.told.at(-1)!;
  await decide(said("Are there any offers running on this TV?"), session, base, store.fetch);
  assert.equal(session.language, "en");
  assert.match(last(), /Write this reply and its buttons in English/);
  await decide(said("इस पर कोई ऑफर है?"), session, base, store.fetch);
  assert.match(last(), /in Hindi, in Devanagari/);
  await decide(said("iske baare mein batao kitne ka hai"), session, base, store.fetch);
  assert.match(last(), /in Hindi, in Latin script/);
  session.language = "en";
  await decide(said("iske baare mein batao kitne ka hai"), session, base, store.fetch);
  assert.match(last(), /in Hinglish, in Latin script/);
  session.language = "mr";
  await decide(said("याची किंमत किती आहे"), session, base, store.fetch);
  assert.match(last(), /in Marathi, in Devanagari/);
});

test("a reply in the wrong script is written again once, and is not sent like that", async () => {
  const q = `lg script ${++unique}`;
  let wrote = 0;
  const store = shop(() => page([row(73, "LG script", 38990)]), { q });
  const lines = ["इस पर Rs 38,990 है।", "It is Rs 38,990."];
  const fake = (async (url: string | URL, init: RequestInit = {}) => {
    const body = init.body ? String(init.body) : "";
    if (!String(url).includes("generativelanguage") || body.includes("one search of the store"))
      return store.fetch(url, init);
    const answer = {
      step: "complete",
      card: {},
      shortlist: [],
      demonstrated: false,
      lines: [lines[wrote++]],
      buttons: [],
    };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  }) as unknown as typeof fetch;
  const session = newSession("919820000001");
  session.language = "hi";
  const reply = await decide(said("Are there any offers running on this TV?"), session, base, fake);
  assert.equal(wrote, 2);
  assert.match(reply.text, /It is/);
});

test("asked for English after an answer, it says that answer again in English", async () => {
  const q = `lg repeat ${++unique}`;
  const store = shop(
    () => page([row(71, "LG repeat", 38990, { discount: "15% OFF" })]),
    { q },
    { lines: ["It is Rs 38,990 and 15% off."] },
  );
  const session = newSession("919820000001");
  await decide(said("LG टीवी दिखाओ"), session, base, store.fetch);
  const reply = await decide(said("tell me in English"), session, base, store.fetch);
  assert.match(store.told.at(-1)!, /Say your last answer again/, "it went to the model");
  assert.match(reply.text, /Rs 38,990/, "an offer already asked for is not gated when it is said again");
  assert.equal(session.language, "en");

  const fresh = newSession("919820000002");
  const before = store.told.length;
  const ack = await decide(said("hindi please"), fresh, base, store.fetch);
  assert.equal(store.told.length, before, "with nothing to repeat, it only says so");
  assert.equal(ack.text, t("hi", "lang.switched"));
});

test("a budget the search read from the words is one the associate said, however it was spelled", async () => {
  const q = `iphone budget ${++unique}`;
  const store = shop(
    () => page([row(72, "Apple iPhone 15", 69900)]),
    { q, kind: "phone", max_price: 80000 },
    { lines: ["Under Rs 80,000 there is the iPhone 15 at Rs 69,900."] },
  );
  const reply = await decide(
    said("someone wants an iPhone under eighty thousand"),
    newSession("919820000001"),
    base,
    store.fetch,
  );
  assert.match(reply.text, /Rs 80,000/);
  assert.doesNotMatch(reply.text, /not in the catalogue/);
});

test("a follow-up is searched with the last search in front of the model, and stays on it", async () => {
  const q = `sony 85 inch tv ${++unique}`;
  const store = shop(
    () => page([row(51, "Sony 85 inch TV", 289990)]),
    { q, kind: "television" },
    {
      lines: ["It is Rs 2,89,990."],
    },
  );
  const session = newSession("919820000001");
  session.search = { q, kind: "television" };
  await decide(said("any offer on it?"), session, base, store.fetch);
  assert.match(store.asked[0]!, /LAST SEARCH: /);
  assert.ok(store.asked[0]!.includes(q));
  assert.match(store.told[0]!, /Sony 85 inch TV/);
  assert.match(store.told[0]!, /asked about offers or finance outright/);
});

test("a message about no product asks the store nothing", async () => {
  const store = shop(() => page([]), { q: null }, { lines: ["Take five, then come back."] });
  const reply = await decide(said("a customer shouted at me"), newSession("919820000001"), base, store.fetch);
  assert.equal(store.store.length, 0);
  assert.match(reply.text, /Take five/);
});

test("a miss is told to the model as a miss, and the reply is not an invention", async () => {
  const store = shop(
    () => page([]),
    { q: `paper plane ${++unique}` },
    { lines: ["That is not coming up."], unknown: true },
  );
  await decide(said("paper plane"), newSession("919820000001"), base, store.fetch);
  assert.match(store.told[0]!, /found no product/);
  assert.doesNotMatch(store.told[0]!, /TCL/);
});

test("a store that does not answer is said to be a hiccup, and the number stays up", async () => {
  const logged = console.error;
  console.error = () => {};
  try {
    const model = shop(() => page([]), { q: `iphone ${++unique}` }, { lines: ["Cannot check this second."] });
    const flaky = (async (input: string | URL, init?: RequestInit) =>
      new URL(String(input)).host === "api.example.com"
        ? new Response("nope", { status: 503 })
        : model.fetch(input as never, init)) as unknown as typeof fetch;
    const reply = await decide(said("iphone price"), newSession("919820000001"), base, flaky);
    assert.match(model.told[0]!, /did not answer just now/);
    assert.match(reply.text, /Cannot check/);
  } finally {
    console.error = logged;
  }
});

test("moving to another product withdraws the pick and its consent", async () => {
  const q = `lg washing machine ${++unique}`;
  const store = shop(() => page([row(60, "LG 7 Kg Washing Machine", 31990)]), { q }, { lines: ["It is Rs 31,990."] });
  const session: Session = newSession("919820000001");
  session.selection = { sku: "CODE50", accessories: [], charges: [] };
  session.consent = true;
  await decide(said("now show me an LG washing machine"), session, base, store.fetch);
  assert.equal(session.selection, undefined);
  assert.equal(session.consent, false);
});

test("a pick from this conversation's search shows the breakdown at once, on the store's price", async () => {
  const q = `iphone pick ${++unique}`;
  const store = shop(() => page([row(70, "Apple iPhone 18 Pro 256 GB, Silver", 164900)]));
  const session = newSession("919820000001");
  session.search = { q };
  const reply = await decide(
    { id: "p1", phone: session.phone, modality: "interactive", action: "select:CODE70" },
    session,
    base,
    store.fetch,
  );
  assert.equal(store.told.length, 0, "a tap is the code's");
  assert.equal(session.selection?.sku, "CODE70");
  assert.match(reply.text, /1,64,900/);
  assert.doesNotMatch(reply.text, /charge|delivery/i);
  assert.deepEqual(
    reply.buttons?.map((button) => button.id),
    ["sold"],
  );
});
