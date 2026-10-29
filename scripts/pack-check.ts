import { adaptPack } from "../server/src/adapt.js";
import { allowedNumbers, readSource, type Pack } from "../server/src/pack.js";
import { rank } from "../server/src/recommend.js";

/** Point this at a candidate catalogue before the number ever serves it:
 *    npm run pack:check -- data/pack.json
 *    npm run pack:check -- https://feed.example.com/catalogue.json
 *  It says what loaded, what it had to default, what it cannot serve and why, and then runs one
 *  real recommendation off it so the answer is proven, not assumed. */

const source = process.argv[2] ?? process.env.PACK_PATH ?? "data/pack.json";
const raw = JSON.parse(await readSource(source));
const { pack, problems } = adaptPack(raw);
const say = (line: string): void => console.log(line);

say(`\nSource: ${source}`);
say(
  `Products: ${pack.products.length} · offers ${pack.offers?.length ?? 0} · finance ${pack.finance?.length ?? 0} · charges ${pack.charges?.length ?? 0} · myths ${pack.myths?.length ?? 0}`,
);

const defaulted = new Map<string, string[]>();
for (const product of pack.products) {
  const note = (field: string): void => defaulted.set(field, [...(defaulted.get(field) ?? []), product.sku || "?"]);
  if (product.demo_cue.startsWith("Show it beside")) note("demo_cue (the demonstrate step is 2 of 14)");
  if (!product.good_for.length) note("good_for");
  if (!product.energy.typical_watts) note("energy");
  for (const spec of ["peak_nits", "refresh_hz", "hdmi_21_ports", "speaker_watts", "os"])
    if (product.specs[spec] === undefined) note(`specs.${spec}`);
}
if (defaulted.size) {
  say(`\nDefaulted, which means a rule can never fire on it:`);
  for (const [field, skus] of defaulted)
    say(`  ${field} — ${skus.slice(0, 6).join(", ")}${skus.length > 6 ? ` +${skus.length - 6}` : ""}`);
} else say(`\nNothing defaulted.`);

if (problems.length) {
  say(`\nCANNOT BE SERVED:`);
  for (const problem of problems) say(`  ${problem}`);
  process.exitCode = 1;
} else {
  say(`\nServable. ${allowedNumbers(pack as Pack).size} figures are quotable from it.`);
  const options = rank(pack as Pack, {
    distance_m: 3,
    light: "bright afternoon sun",
    content: ["cricket"],
    devices: ["PS5"],
  });
  say(`\nA bright hall at 3 m with a console would be offered:`);
  for (const option of options) say(`  ${option.product.brand} ${option.product.size_inch}" — ${option.reason}`);
  if (!options.length) say(`  nothing, which means no product is in stock or none fits that distance`);
}
say("");
