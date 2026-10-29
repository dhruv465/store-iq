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
 *     mistake or a clever suggestion could reach them. Two hand-written GETs cannot.
 *  2. The path is checked against a list of exactly two, taken from the method reference the
 *     judges supplied. Both are on /service/application/, which is the storefront surface; the
 *     writable surface is /service/platform/ and nothing here can reach it.
 *  3. The final URL is re-checked after the query is built, so no parameter can steer the path. */

/** The only two endpoints this product is allowed to call, from the FDK method reference. */
export const ALLOWED_PATHS = [
  "/service/application/catalog/v1.0/products",
  "/service/application/cart/v1.0/available-promotions",
] as const;

export type CatalogConfig = {
  host: string;
  applicationId: string;
  applicationToken: string;
};

export function catalogConfig(env = process.env): CatalogConfig | null {
  // The FDK client defaults to https://api.fynd.com; a Jio Commerce application has its own.
  const host = env.CATALOG_HOST?.trim();
  const applicationId = env.CATALOG_APPLICATION_ID?.trim();
  const applicationToken = env.CATALOG_APPLICATION_TOKEN?.trim();
  if (!host || !applicationId || !applicationToken) return null;
  return { host, applicationId, applicationToken };
}

/** A GET, to one of two paths, on the configured host. Anything else throws before a socket opens.
 *
 *  The token is never put in the URL and never appears in a thrown message, because an error from
 *  here is logged and a logged credential is a leaked credential. */
export async function read(
  config: CatalogConfig,
  path: (typeof ALLOWED_PATHS)[number],
  params: Record<string, string | number | boolean | undefined> = {},
  request: typeof fetch = fetch,
): Promise<unknown> {
  if (!ALLOWED_PATHS.includes(path)) throw Error(`Refusing to call ${path}: not one of the two readable endpoints`);
  const url = new URL(path, config.host.startsWith("http") ? config.host : `https://${config.host}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  // A parameter cannot steer the path, and a host cannot be swapped in: both are checked after the
  // URL is assembled rather than before.
  if (!ALLOWED_PATHS.includes(url.pathname as (typeof ALLOWED_PATHS)[number]))
    throw Error(`Refusing to call ${url.pathname}: not one of the two readable endpoints`);
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
  options: { q?: string; f?: string; sort_on?: string; page_no?: number; page_size?: number } = {},
  request: typeof fetch = fetch,
): Promise<{ items: Record<string, unknown>[]; page: Record<string, unknown> }> {
  const body = (await read(
    config,
    "/service/application/catalog/v1.0/products",
    { page_size: 12, page_type: "number", ...options },
    request,
  )) as { items?: Record<string, unknown>[]; page?: Record<string, unknown> };
  return { items: body.items ?? [], page: body.page ?? {} };
}

/** Cart · getPromotionOffers. The offers actually running on one product today. */
export async function getPromotionOffers(
  config: CatalogConfig,
  options: { slug?: string; store_id?: number; page_size?: number; promotion_group?: string } = {},
  request: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const body = (await read(config, "/service/application/cart/v1.0/available-promotions", options, request)) as {
    available_promotions?: Record<string, unknown>[];
  };
  return body.available_promotions ?? [];
}
