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
  startingPack,
  searchPack,
  narrow,
  terms,
  words,
  aboutTheWords,
  categoryByWords,
  type Pack,
} from "../server/src/pack.js";

/** This talks to a production store. The tests below are the proof that it cannot write to one,
 *  rather than a promise that it will not: every call it is capable of making is a GET, to one of
 *  the listed paths, on one host. */

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
  // /service/platform/ is the surface that can write. Nothing here is on it.
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
  // A value that tries to climb out of the path, and one that tries to change the host.
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
  // Authorization: Bearer base64(applicationID:applicationToken), as the public client does it.
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
  // The pair is enough, and the host is Jio's own Fynd tenant, read off the partner panel at
  // platform.jioretailer.com. Fynd's generic api.fynd.com answers 401 for a Reliance Digital pair,
  // which is exactly what the first live attempt did.
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

/** One page of the live catalogue, in the shape getProducts returns it. */
function store(body: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL) =>
    new Response(JSON.stringify(String(url).includes("available-promotions") ? { available_promotions: [] } : body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const LIVE = {
  items: [
    {
      uid: 1,
      name: 'Sony Bravia 2 55" 4K LED Google TV',
      slug: "sony-bravia-2-55",
      item_code: "SON-K55S30",
      brand: { name: "Sony" },
      price: { marked: { min: 79900 }, effective: { min: 62990 } },
      attributes: { display_type: "LED", peak_nits: 400 },
      sellable: true,
    },
  ],
  page: { item_total: 1 },
};

test("the server serves the live catalogue the moment the credentials are set", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    CATALOG_HOST: "https://api.example.com",
    CATALOG_APPLICATION_ID: "app",
    CATALOG_APPLICATION_TOKEN: "token",
  });
  try {
    const live = await startingPack(store(LIVE));
    assert.match(live.source, /live catalogue · 1 product/);
    assert.equal(live.pack.products[0]!.sku, "SON-K55S30");
    assert.equal(live.pack.products[0]!.price_rupees, 62990);
    // Everything the two methods do not carry stays from the file.
    assert.ok(live.pack.finance.length, "finance terms are ours");
    assert.ok(live.pack.charges.length, "so are the charges");
    // And NOT the pack's own offers. The stub's HDFC discount and exchange bonus are not running on
    // this channel, and an offer quoted that does not exist is worse than no offer at all.
    assert.deepEqual(live.pack.offers, [], "nothing running is the honest answer");

    // A bad key must not kill the number: say so and serve the file.
    const broken = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const fallen = await startingPack(broken);
    assert.match(fallen.source, /live catalogue failed/);
    assert.equal(fallen.pack.version, "stub-1");
  } finally {
    for (const key of ["CATALOG_HOST", "CATALOG_APPLICATION_ID", "CATALOG_APPLICATION_TOKEN"])
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

/** The `filters` block the v1.9.5 reference documents, in the shape the live store returns it:
 *  the counts below are the real ones for q=sony and q=washing machine on 1 Nov 2026. */
test("the store's own facets choose the filter, in the documented f= syntax", async () => {
  const { narrow } = await import("../server/src/pack.js");
  const facet = (name: string, values: [string, number][]) => ({
    key: { name },
    values: values.map(([value, count]) => ({ value, count })),
  });

  // "sony" returns a camera pouch first out of 294 rows. Its own category facet says 110 are
  // televisions, and sony is 194 of the 294, so both join the filter with `:::` between them.
  assert.equal(
    narrow(
      [
        facet("category", [
          ["led-televisions", 110],
          ["gaming-controller", 22],
        ]),
        facet("brand", [
          ["sony", 194],
          ["tcl", 36],
        ]),
      ],
      294,
    ),
    "brand:sony:::category:led-televisions",
  );

  // "washing machine": extended-warranty out-counts nothing here, but resq (74 of 241) is the top
  // brand and is Reliance's service brand. A protection plan is not a product, and no real brand
  // holds half the rows, so the category alone is the filter.
  assert.equal(
    narrow(
      [
        facet("category", [
          ["extended-warranty", 74],
          ["washing-machines", 164],
        ]),
        facet("brand", [
          ["resq", 74],
          ["lg", 39],
        ]),
      ],
      241,
    ),
    "category:washing-machines",
  );

  // "fridge" is the case that proves the exclusion: 150 extended warranties against 122 fridges.
  assert.equal(
    narrow(
      [
        facet("category", [
          ["extended-warranty", 150],
          ["frost-free", 122],
        ]),
      ],
      423,
    ),
    "category:frost-free",
  );

  // Nothing to narrow to is not an error: the loose query's own rows stand.
  assert.equal(narrow([], 12), undefined);
  assert.equal(narrow([facet("category", [["extended-warranty", 9]])], 9), undefined);
});

test("the last word left after the brand names the kind, so a smart watch is not a phone", () => {
  const facet = (name: string, values: [string, number][]) => ({
    key: { name },
    values: values.map(([value, count]) => ({ value, count })),
  });
  // "smart watch" is the case that proves the head: the store's own facet counts put
  // smart-phones (970) above sports-fitness-watches (466), the word "smart" opens both, and the
  // associate may have named the brand too ("smart watch noise"). What is said is a watch, and
  // the brand the associate named joins even when it holds a small share of the rows.
  assert.equal(
    narrow(
      [
        facet("category", [
          ["smart-phones", 970],
          ["sports-fitness-watches", 466],
          ["led-televisions", 194],
          ["fitness-bands-trackers", 141],
        ]),
        facet("brand", [["noise", 210]]),
      ],
      3105,
      ["smart", "watch", "noise"],
    ),
    "brand:noise:::category:sports-fitness-watches",
  );
  // "smart watch" without the brand reads the same way on the kind: watch is the head of the
  // phrase, and no brand is said, so none is narrowed to even if one holds a third of the rows.
  assert.equal(
    narrow(
      [
        facet("category", [
          ["smart-phones", 970],
          ["sports-fitness-watches", 466],
        ]),
        facet("brand", [["fire-boltt", 180]]),
      ],
      3105,
      ["smart", "watch"],
    ),
    "category:sports-fitness-watches",
  );
  // "soundbar sony" — Sony thin in the soundbar shelf — is still Sony's answer, not the more
  // popular JBLs.
  assert.equal(
    narrow(
      [
        facet("category", [
          ["tv-speakers-soundbars", 11],
          ["led-televisions", 25],
        ]),
        facet("brand", [
          ["jbl", 4],
          ["sony", 3],
        ]),
      ],
      38,
      ["soundbar", "sony"],
    ),
    "brand:sony:::category:tv-speakers-soundbars",
  );
});

test("an accessory shelf is not the kind named, until an accessory is asked for", () => {
  const shelfFacet = (name: string, values: [string, number][]) => ({
    key: { name },
    values: values.map(([value, count]) => ({ value, count })),
  });
  // The store's own counts put the accessories shelf above the watches it serves: with the shelf
  // counted, "smart watch" refined into a shelf of straps.
  const shelf = shelfFacet("category", [
    ["smart-watch-accessories", 2400],
    ["smart-phones", 970],
    ["sports-fitness-watches", 466],
  ]);
  assert.equal(
    narrow([shelf], 3836, ["smart", "watch"]),
    "category:sports-fitness-watches",
    "the straps never answer a watch question by their shelf's big count",
  );
  // Asked for the accessory itself, the shelf is the right answer again.
  assert.equal(narrow([shelf], 3836, ["strap", "smart", "watch"]), "category:smart-watch-accessories");
  assert.equal(categoryByWords([shelf], ["smart", "watch", "strap"]), "smart-watch-accessories");
});

/** "iphone" is the case that killed the count pick. The store's own facets for q=iphone put
 *  sports-fitness-watches (142) above smart-phones (117), and the count pick refined the search
 *  into Apple Watches. The kind said — iphone is a phone — is inside smart-phones, and that is
 *  the category that counts. */
test("the kind a brand name is, said against the facets, reaches the f= filter", () => {
  const facet = (name: string, values: [string, number][]) => ({
    key: { name },
    values: values.map(([value, count]) => ({ value, count })),
  });
  assert.equal(
    narrow(
      [
        facet("category", [
          ["sports-fitness-watches", 142],
          ["mobile-cases", 133],
          ["smart-phones", 117],
          ["premium-laptops", 38],
        ]),
        facet("brand", [["apple", 406]]),
      ],
      547,
      ["iphone"],
    ),
    "brand:apple:::category:smart-phones",
  );
});

const base: Pack = {
  version: "stub-1",
  store: { id: "1", name: "Reliance Digital", city: "Mumbai" },
  shift_brief: {},
  products: [],
  offers: [],
  finance: [],
  charges: [],
  accessories: [],
  experts: [],
  electricity: { tariff_rupees_per_unit: 8, note: "" },
  labels: [],
  myths: [],
  install_requirements: {},
};

/** The store's real answer to q="iphone" and to the category the facets pick, on 1 Nov 2026: the
 *  loose search ranks a MagSafe wallet first out of 547, and the phones sit behind the refine. */
test("an iphone question finds iphones, on the associate's own sentence", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    CATALOG_HOST: "https://api.example.com",
    CATALOG_APPLICATION_ID: "app",
    CATALOG_APPLICATION_TOKEN: "token",
  });
  try {
    const calls: string[] = [];
    const phones = {
      items: [
        {
          uid: 1,
          name: "Apple iPhone 16 128 GB, Pink",
          slug: "apple-iphone-16",
          item_code: "AP16",
          brand: { name: "Apple" },
          price: { marked: { min: 64900 }, effective: { min: 52990 } },
          sellable: true,
        },
        {
          uid: 2,
          name: "Apple iPhone 17 256 GB, Black",
          slug: "apple-iphone-17",
          item_code: "AP17",
          brand: { name: "Apple" },
          price: { marked: { min: 79900 }, effective: { min: 67990 } },
          sellable: true,
        },
      ],
      page: { item_total: 117 },
    };
    const loose = {
      items: [
        {
          uid: 9,
          name: "Apple iPhone Fine Woven MagSafe Mobile Wallet, Burgundy",
          slug: "apple-wallet",
          item_code: "WAL1",
          brand: { name: "Apple" },
          price: { marked: { min: 3900 }, effective: { min: 2999 } },
          sellable: true,
        },
      ],
      page: { item_total: 547 },
      filters: [
        {
          key: { name: "category" },
          values: [
            { value: "sports-fitness-watches", count: 142 },
            { value: "mobile-cases", count: 133 },
            { value: "smart-phones", count: 117 },
          ],
        },
        { key: { name: "brand" }, values: [{ value: "apple", count: 406 }] },
      ],
    };
    const fake = (async (url: string | URL) => {
      calls.push(String(url));
      const u = new URL(String(url));
      const body = u.pathname.includes("available-promotions")
        ? { available_promotions: [] }
        : u.searchParams.get("f")
          ? phones
          : loose;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    // The full sentence the associate sends, not a product name: the question words must fall
    // away, because "asking iphone" was a query the store answered with smart glasses.
    assert.deepEqual(terms("customer is asking about the iphone which i can see at the store"), ["iphone"]);

    const pack = await searchPack(base, "customer is asking about the iphone which i can see at the store", fake);
    assert.deepEqual(
      pack.products.map((product) => product.name),
      ["Apple iPhone 16 128 GB, Pink", "Apple iPhone 17 256 GB, Black"],
      "the wallet is not the answer to an iphone question",
    );
    assert.match(calls[0]!, /q=iphone/, "the search is the product, not the sentence around it");
    assert.match(calls[0]!, /sort_on=popular/, "the store's own popularity order");
    assert.ok(
      calls.some((call) => call.includes("f=brand%3Aapple%3A%3A%3Acategory%3Asmart-phones")),
      calls.join("\n"),
    );
    assert.equal(pack.offers.length, 0, "nothing running is still the honest offer list");
  } finally {
    for (const key of ["CATALOG_HOST", "CATALOG_APPLICATION_ID", "CATALOG_APPLICATION_TOKEN"])
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

test("a search that matches nothing refuses the catalogue's first page", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    CATALOG_HOST: "https://api.example.com",
    CATALOG_APPLICATION_ID: "app",
    CATALOG_APPLICATION_TOKEN: "token",
  });
  try {
    const fake = (async () =>
      new Response(JSON.stringify({ items: [], page: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    await assert.rejects(searchPack(base, "paper plane model", fake), /matched nothing/);
    assert.equal(terms("paper plane model").length > 0, true);
  } finally {
    for (const key of ["CATALOG_HOST", "CATALOG_APPLICATION_ID", "CATALOG_APPLICATION_TOKEN"])
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

/** The fuzzy storefront answers any string with something: the first candidate a sentence leaves
 *  behind ("printer office") can be USB adapters while the product noun alone ("printer") stands
 *  in the catalogue. The search has to keep trying. */
/** The store refines a brand into a thin shelf by popularity: the loose "soundbar sony" answered
 *  with Sony bars, the category page beneath it answered with the more popular JBLs. The refine
 *  has to keep the brand the associate said — and the words, in the rows the reply is built
 *  from. */
test("a refine keeps the brand and the words the loose rows carried", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    CATALOG_HOST: "https://api.example.com",
    CATALOG_APPLICATION_ID: "app",
    CATALOG_APPLICATION_TOKEN: "token",
  });
  const row = (uid: number, brand: string, name: string) => ({
    uid,
    name,
    slug: `slug-${uid}`,
    item_code: `CODE${uid}`,
    brand: { name: brand },
    price: { marked: { min: 9999 }, effective: { min: 8999 } },
    sellable: true,
  });
  const sonyBars = {
    items: [
      row(1, "Sony", "Sony Bravia Theatre Bar 8 (HT-A8000) PRM 11.0 CH 495 Watt Soundbar"),
      row(2, "Sony", "Sony Bravia Theatre Bar 9 (HT-A9000) PRM 13.0 CH 585 Watt Soundbar"),
      row(3, "Sony", "Sony A7100 5.1 Channel Soundbar, Black"),
    ],
    page: { item_total: 15 },
    filters: [{ key: { name: "category" }, values: [{ value: "tv-speakers-soundbars", count: 15 }] }],
  };
  // The store's own category page answers by popularity, and no Sony facet is on the loose
  // response for this query — the refused refine is the only thing standing between the two.
  const jblPage = {
    items: [
      row(4, "JBL", "JBL Sound Bar 2.1 Essential (440W) Soundbar with Dolby Digital"),
      row(5, "JBL", "JBL 3.1 CH 440 W Soundbar, SB595"),
      row(6, "Bose", "Bose Wireless Bluetooth Smart Ultra Soundbar, White"),
    ],
    page: { item_total: 200 },
    filters: [{ key: { name: "category" }, values: [{ value: "tv-speakers-soundbars", count: 200 }] }],
  };
  try {
    const fake = (async (url: string | URL) => {
      const u = new URL(String(url));
      const body = u.pathname.includes("available-promotions")
        ? { available_promotions: [] }
        : u.searchParams.get("f")
          ? jblPage
          : sonyBars;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const pack = await searchPack(base, "soundbar sony", fake);
    assert.deepEqual(
      pack.products.map((product) => product.brand),
      ["Sony", "Sony", "Sony"],
      "the more popular other brand is not the answer to a Sony question",
    );
  } finally {
    for (const key of ["CATALOG_HOST", "CATALOG_APPLICATION_ID", "CATALOG_APPLICATION_TOKEN"])
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

test("a candidate whose rows do not carry the words said waits for the next one", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    CATALOG_HOST: "https://api.example.com",
    CATALOG_APPLICATION_ID: "app",
    CATALOG_APPLICATION_TOKEN: "token",
  });
  try {
    const calls: string[] = [];
    const adapters = {
      items: [
        {
          uid: 1,
          name: "TP-Link UB500 Bluetooth 5.0 Nano USB Adapter for PC, 5.0",
          slug: "tplink-ub500",
          item_code: "TPL500",
          brand: { name: "TP-Link" },
          price: { marked: { min: 1299 }, effective: { min: 999 } },
          sellable: true,
        },
      ],
      page: { item_total: 7082 },
      filters: [{ key: { name: "category" }, values: [{ value: "multi-utility-adapters", count: 7082 }] }],
    };
    const printers = {
      items: [
        {
          uid: 2,
          name: "HP DeskJet 2729 All-in-One Inkjet Printer",
          slug: "hp-deskjet-2729",
          item_code: "HPDJ2729",
          brand: { name: "HP" },
          price: { marked: { min: 8500 }, effective: { min: 6499 } },
          sellable: true,
        },
      ],
      page: { item_total: 68 },
      filters: [
        { key: { name: "category" }, values: [{ value: "multi-function-inkjet-printers", count: 68 }] },
        { key: { name: "brand" }, values: [{ value: "hp", count: 21 }] },
      ],
    };
    const fake = (async (url: string | URL) => {
      const u = new URL(String(url));
      calls.push(u.searchParams.get("q") ?? `f=${u.searchParams.get("f")}`);
      const q = u.searchParams.get("q");
      const hit = u.pathname.includes("available-promotions")
        ? { available_promotions: [] }
        : u.searchParams.get("f")?.includes("printer") || q === "printer"
          ? printers
          : adapters;
      return new Response(JSON.stringify(hit), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const pack = await searchPack(base, "printer for office", fake);
    assert.deepEqual(
      pack.products.map((product) => product.name),
      ["HP DeskJet 2729 All-in-One Inkjet Printer"],
      "the adapters the first candidate reached are not the answer",
    );
    assert.equal(calls[0], "printer office", "the sentence's own pair goes first");
    assert.ok(calls.slice(1).includes("printer"), "the product noun alone follows it");
  } finally {
    for (const key of ["CATALOG_HOST", "CATALOG_APPLICATION_ID", "CATALOG_APPLICATION_TOKEN"])
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

test("search prefers the exact product and keeps named brand out of accessory results", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    CATALOG_HOST: "https://api.example.com",
    CATALOG_APPLICATION_ID: "app",
    CATALOG_APPLICATION_TOKEN: "token",
  });
  const row = (uid: number, name: string, brand = "Lloyd") => ({
    uid,
    name,
    slug: `slug-${uid}`,
    item_code: `CODE${uid}`,
    brand: { name: brand },
    price: { marked: { min: 19999 }, effective: { min: 17999 } },
    sellable: true,
  });
  try {
    const fake = (async (url: string | URL) => {
      const u = new URL(String(url));
      const q = u.searchParams.get("q");
      const hit = u.pathname.includes("available-promotions")
        ? { available_promotions: [] }
        : q === "washing machine front"
          ? {
              items: [
                row(2, "Lloyd Front Fully Automatic Washing Machine 8 Kg"),
                row(3, "Lloyd Front Loading Washing Machine 8 Kg"),
              ],
              page: { item_total: 2 },
            }
          : {
              items: [
                row(1, "Lloyd Top Load Washing Machine 8 Kg"),
                row(2, "Lloyd Front Fully Automatic Washing Machine 8 Kg"),
              ],
              page: { item_total: 2 },
            };
      return new Response(JSON.stringify(hit), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const pack = await searchPack(base, "washing machine front load", fake);
    assert.equal(pack.products[0]!.name, "Lloyd Front Loading Washing Machine 8 Kg");

    const sonySearch = (async (url: string | URL) => {
      const u = new URL(String(url));
      const q = u.searchParams.get("q");
      const rows =
        q === "sony 85" || q === "sony 85 inch"
          ? [
              row(4, "Sony Bravia Theatre Quad Home Theatre", "Sony"),
              row(5, "TCL 85 inch Mini LED TV", "TCL"),
              row(6, "Sony Bravia 85 inch TV", "Sony"),
            ]
          : [row(4, "Sony Bravia Theatre Quad Home Theatre", "Sony")];
      return new Response(
        JSON.stringify(u.pathname.includes("available-promotions") ? { available_promotions: [] } : { items: rows }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const sony = await searchPack(base, "sony 85 inch", sonySearch);
    assert.equal(sony.products[0]!.name, "Sony Bravia 85 inch TV");
    assert.ok(sony.products.every((product) => product.brand === "Sony"));

    const cameraSearch = (async (url: string | URL) => {
      const u = new URL(String(url));
      const result = u.pathname.includes("available-promotions")
        ? { available_promotions: [] }
        : {
            items: [
              row(7, "Sony Camera Pouch for Sony Camcorder", "Sony"),
              row(8, "Sony Alpha Mirrorless Digital Camera", "Sony"),
            ],
          };
      return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const camera = await searchPack(base, "camera sony", cameraSearch);
    assert.equal(camera.products[0]!.name, "Sony Alpha Mirrorless Digital Camera");

    const laptopSearch = (async (url: string | URL) => {
      const u = new URL(String(url));
      const result = u.pathname.includes("available-promotions")
        ? { available_promotions: [] }
        : u.searchParams.has("f")
          ? {
              items: [row(11, "Asus TUF Gaming Laptop", "Asus"), row(12, "Samsung Standard Laptop", "Samsung")],
            }
          : {
              items: [
                row(9, "Asus Backpack for TUF Gaming Laptop", "Asus"),
                row(10, "Dell Alienware Gaming Laptop", "Dell"),
              ],
              filters: [{ key: { name: "category" }, values: [{ value: "premium-laptops", count: 2 }] }],
            };
      return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const laptop = await searchPack(base, "gaming laptop", laptopSearch);
    assert.equal(laptop.products[0]!.name, "Dell Alienware Gaming Laptop");
  } finally {
    for (const key of ["CATALOG_HOST", "CATALOG_APPLICATION_ID", "CATALOG_APPLICATION_TOKEN"])
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

test("a short change of subject is adopted only when the products found carry the words", () => {
  const iphones = [{ brand: "Apple", name: "Apple iPhone 16 128 GB, Pink" }];
  const watches = [{ brand: "Apple", name: "Apple Watch Ultra 4 GPS + Cellular 49 mm Black Titanium Case" }];
  assert.equal(aboutTheWords(words("what about iphone"), watches), false);
  assert.equal(aboutTheWords(words("what about iphone"), iphones), true);
  assert.equal(aboutTheWords(words("8 feet"), watches), false, "a distance is not a kind of product");
});
