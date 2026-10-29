import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_PATHS, catalogConfig, getProducts, getPromotionOffers, read } from "../server/src/catalog.js";

/** This talks to a production store. The tests below are the proof that it cannot write to one,
 *  rather than a promise that it will not: every call it is capable of making is a GET, to one of
 *  two paths, on one host. */

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

test("only the two endpoints the judges documented can be called", async () => {
  assert.deepEqual(
    [...ALLOWED_PATHS],
    ["/service/application/catalog/v1.0/products", "/service/application/cart/v1.0/available-promotions"],
  );
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
  assert.equal(calls.length, 2);
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

test("the token is sent as a header and never put in the URL", async () => {
  const { fetch: fake, calls } = spy();
  await getProducts(config, { q: "tv" }, fake);
  assert.doesNotMatch(calls[0]!.url, /app-token/, "a URL ends up in logs and proxies");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["x-application-token"], "app-token");
  assert.equal(headers["x-application-id"], "app-id");
});

test("a refusal never names the token", async () => {
  const { fetch: fake } = spy();
  const problem = await read(config, "/service/platform/anything" as never, {}, fake).catch((error: Error) => error);
  assert.ok(problem instanceof Error);
  assert.doesNotMatch(problem.message, /app-token|app-id/, "an error is logged, and a logged credential is leaked");
});

test("the catalogue stays off unless all three settings are present", () => {
  assert.equal(catalogConfig({} as never), null);
  assert.equal(catalogConfig({ CATALOG_HOST: "x" } as never), null);
  assert.equal(catalogConfig({ CATALOG_HOST: "x", CATALOG_APPLICATION_ID: "y" } as never), null);
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
