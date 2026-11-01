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
import { startingPack } from "../server/src/pack.js";

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
    assert.ok(live.pack.offers.length, "and the pack's offers, when the store is running none");

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
