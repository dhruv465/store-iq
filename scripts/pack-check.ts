import { adaptPack, fromFdk } from "../server/src/adapt.js";
import { catalogConfig, getProducts } from "../server/src/catalog.js";
import { allowedNumbers, readSource, type Pack } from "../server/src/pack.js";

/** Point this at a candidate catalogue before the number ever serves it:
 *    npm run pack:check -- data/pack.json
 *    npm run pack:check -- https://feed.example.com/catalogue.json
 *    npm run pack:check -- live          one search of the real store, read and nothing else
 *  It says what loaded and what it cannot serve and why. */

const source = process.argv[2] ?? process.env.PACK_PATH ?? "data/pack.json";
const say = (line: string): void => console.log(line);
let raw: Record<string, any>;
if (source === "live") {
  const config = catalogConfig();
  if (!config) {
    console.error("Set CATALOG_APPLICATION_ID and CATALOG_APPLICATION_TOKEN in .env first.");
    process.exit(1);
  }
  const q = process.argv[3] ?? "television";
  const { items, page } = await getProducts(config, { q, page_size: 12, page_no: 1, page_type: "number" });
  say(`\nLive, for "${q}": ${items.length} of ${Number(page.item_total) || 0} products.`);
  if (items.length) say(`Keys the adapter saw on the first row: ${Object.keys(items[0]!).sort().join(", ")}`);
  raw = { ...JSON.parse(await readSource("data/pack.json")), products: items.map(fromFdk) };
} else raw = JSON.parse(await readSource(source));
const { pack, problems } = adaptPack(raw as never);

say(`\nSource: ${source}`);
say(`Products: ${pack.products.length} · offers ${pack.offers?.length ?? 0}`);

if (problems.length) {
  say(`\nCANNOT BE SERVED:`);
  for (const problem of problems) say(`  ${problem}`);
  process.exitCode = 1;
} else say(`\nServable. ${allowedNumbers(pack as Pack).size} figures are quotable from it.`);
say("");
