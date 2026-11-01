import { providerRequest, readLimited } from "./http.js";

/** The live Jio Commerce catalogue, read and nothing else.
 *
 *  This talks to a production store. Prices, stock and promotions on it are the real ones a real
 *  shop is trading on today, so the only acceptable design is one where writing is not possible
 *  rather than one where writing is avoided.
 *
 *  Three things make that true, and each is tested:
 *
 *  1. There is no write code. No POST, PUT, PATCH or DELETE is issued anywhere in this file, and
 *     no function here takes a method. The official FDK client library is deliberately NOT used:
 *     its cart object carries addItems, updateCart and deleteCart on the same handle, and a
 *     mistake or a clever suggestion could reach them. A handful of hand-written GETs cannot.
 *  2. The path is checked against a short list, taken from the method reference the judges
 *     supplied (FDK v1.9.5). Every one is on /service/application/, which is the storefront
 *     surface; the writable surface is /service/platform/ and nothing here can reach it.
 *  3. The final URL is re-checked after the query is built, so no parameter can steer the path. */

/** The only endpoints this product is allowed to call, from the FDK method reference v1.9.5. */
export const ALLOWED_PATHS = [
  // The two the judges' method reference names, documented in full at
  //   partners.jiocommerce.io/help/docs/sdk/1.9.5/application/{catalog,cart}
  "/service/application/catalog/v1.0/products",
  "/service/application/cart/v1.0/available-promotions",
  // And the three this product cannot work without: the contest is about what is in THIS store
  // today, and a catalogue listing alone does not say that.
  "/service/application/catalog/v1.0/products/stock-status/",
  "/service/application/catalog/v2.0/locations/",
  "/service/application/catalog/v2.0/in-stock/locations/",
] as const;

export type CatalogConfig = {
  host: string;
  applicationId: string;
  applicationToken: string;
};

/** Jio Commerce runs on Fynd's platform, so the storefront API is Fynd's and the application pair
 *  is what selects the sales channel — Reliance Digital. That is why the method reference names no
 *  host: with the SDK you never type one, and `api.fynd.com` is the FDK client's own default.
 *  CATALOG_HOST stays as an override for the day that is not true. */
// Jio's own Fynd tenant, read off the partner panel at platform.jioretailer.com on 1 Nov 2026.
// Fynd's generic api.fynd.com answers 401 for a Reliance Digital application pair.
const DEFAULT_HOST = "https://api.jioretailer.com";

export function catalogConfig(env = process.env): CatalogConfig | null {
  const applicationId = env.CATALOG_APPLICATION_ID?.trim();
  const applicationToken = env.CATALOG_APPLICATION_TOKEN?.trim();
  if (!applicationId || !applicationToken) return null;
  return { host: env.CATALOG_HOST?.trim() || DEFAULT_HOST, applicationId, applicationToken };
}

/** A GET, to one of the listed paths, on the configured host. Anything else throws before a
 *  socket opens.
 *
 *  The token is never put in the URL and never appears in a thrown message, because an error from
 *  here is logged and a logged credential is a leaked credential. */
export async function read(
  config: CatalogConfig,
  path: (typeof ALLOWED_PATHS)[number],
  params: Record<string, string | number | boolean | undefined> = {},
  request: typeof fetch = fetch,
): Promise<unknown> {
  if (!ALLOWED_PATHS.includes(path)) throw Error(`Refusing to call ${path}: not a readable endpoint`);
  const url = new URL(path, config.host.startsWith("http") ? config.host : `https://${config.host}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  // A parameter cannot steer the path, and a host cannot be swapped in: both are checked after the
  // URL is assembled rather than before.
  if (!ALLOWED_PATHS.includes(url.pathname as (typeof ALLOWED_PATHS)[number]))
    throw Error(`Refusing to call ${url.pathname}: not a readable endpoint`);
  const configured = new URL(config.host.startsWith("http") ? config.host : `https://${config.host}`);
  if (url.host !== configured.host) throw Error(`Refusing to call ${url.host}: not the configured catalogue host`);

  // The application pair is the whole credential: there is no separate API key for these two
  // endpoints. Taken from the public FDK client's own application layer, which sends
  // `Authorization: Bearer base64(applicationID + ":" + applicationToken)` on every call.
  const pair = Buffer.from(`${config.applicationId}:${config.applicationToken}`).toString("base64");
  const response = await providerRequest(
    request,
    url.toString(),
    { method: "GET", headers: { authorization: `Bearer ${pair}`, accept: "application/json" } },
    "Catalogue",
    15_000,
  );
  return JSON.parse(new TextDecoder().decode(await readLimited(response, 4 * 1024 * 1024)));
}

/** Catalog · getProducts. Search, filter and page through what the store actually sells. */
export async function getProducts(
  config: CatalogConfig,
  // Every parameter the reference documents: a filter string, cursor or numbered paging, and
  // `filters`, which returns the store's own brand and category facets alongside the items.
  options: {
    q?: string;
    f?: string;
    filters?: boolean;
    sort_on?: string;
    page_id?: string;
    page_no?: number;
    page_size?: number;
    page_type?: "cursor" | "number";
  } = {},
  request: typeof fetch = fetch,
): Promise<{ items: Record<string, unknown>[]; page: Record<string, unknown>; filters: Facet[] }> {
  const body = (await read(
    config,
    "/service/application/catalog/v1.0/products",
    { page_size: 12, page_type: "number", ...options },
    request,
  )) as { items?: Record<string, unknown>[]; page?: Record<string, unknown>; filters?: Facet[] };
  return { items: body.items ?? [], page: body.page ?? {}, filters: body.filters ?? [] };
}

/** One entry of the response's documented `filters` block: the store's own facet, with every value
 *  it holds for this query and how many rows carry it. Returned when `filters` is true, which the
 *  reference gives as the default. This is the catalogue saying what it has, so it is the answer to
 *  "which of the associate's words matter" — see `narrow()` in pack.ts. */
export type Facet = {
  key?: { name?: string; display?: string };
  values?: { value?: unknown; count?: number; display?: string }[];
};

/** Catalog · getProductStockByIds. What is actually on the shelf, by SKU or item id, up to 50 at
 *  a time. A listing says what the chain sells; this says what this store can hand over today. */
export async function getStock(
  config: CatalogConfig,
  options: { item_id?: string; sku_code?: string; ean?: string; alu?: string; upc?: string },
  request: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const body = (await read(config, "/service/application/catalog/v1.0/products/stock-status/", options, request)) as {
    items?: Record<string, unknown>[];
  };
  return body.items ?? [];
}

/** Catalog · the stores themselves, and the stores that have a thing in stock. */
export async function getLocations(
  config: CatalogConfig,
  options: { q?: string; city?: string; page_size?: number; latitude?: number; longitude?: number } = {},
  request: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const body = (await read(config, "/service/application/catalog/v2.0/locations/", options, request)) as {
    items?: Record<string, unknown>[];
  };
  return body.items ?? [];
}

/** Cart · getPromotionOffers. The offers actually running on one product today. */
export async function getPromotionOffers(
  config: CatalogConfig,
  options: { slug?: string; store_id?: number; page_size?: number; promotion_group?: string; cart_type?: string } = {},
  request: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const body = (await read(config, "/service/application/cart/v1.0/available-promotions", options, request)) as {
    available_promotions?: Record<string, unknown>[];
  };
  return body.available_promotions ?? [];
}
