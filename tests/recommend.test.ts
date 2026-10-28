import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack, allowedNumbers } from "../server/src/pack.js";
import { rank, recommendReply, targetInches } from "../server/src/recommend.js";
import { unsupportedNumbers } from "../server/src/brain.js";
import type { HomeCard } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");
const allowed = allowedNumbers(pack);

test("distance converts from either unit the associate used", () => {
  assert.equal(targetInches({ distance_feet: 8 }), 60);
  assert.equal(targetInches({ distance_m: 2.4 }), 59, "2.4 m is about 8 feet");
  assert.equal(targetInches({}), null);
});

test("a bright room with a console puts the high-nits 144 Hz set first", () => {
  const card: HomeCard = { distance_feet: 8, light: "strong afternoon sun", content: ["cricket"], devices: ["PS5"] };
  const options = rank(pack, card);
  assert.equal(options[0]!.product.sku, "TCL-55C6KS");
  assert.match(options[0]!.reason, /144 Hz and 2 HDMI 2.1 for the console/);
});

test("a dim room with no console ranks on size and apps instead", () => {
  const card: HomeCard = { distance_feet: 8, light: "dim, curtains closed", content: ["OTT"] };
  const options = rank(pack, card);
  assert.equal(options.length, 3);
  assert.ok(options.every((o) => Math.abs(o.product.size_inch - 60) <= 12));
});

test("a budget demotes anything above it rather than hiding it", () => {
  const card: HomeCard = { distance_feet: 8, content: ["OTT"], budget_rupees: 60000 };
  const options = rank(pack, card);
  assert.ok(options[0]!.product.price_rupees <= 60000, "the top pick is inside the budget");
  assert.equal(options.length, 3, "dearer sets still appear, they just rank lower");
});

test("an out of stock product is never offered", () => {
  const thin = structuredClone(pack);
  thin.products = thin.products.map((p) => (p.sku === "TCL-55C6KS" ? { ...p, stock_units: 0 } : p));
  assert.ok(!rank(thin, { distance_feet: 8, devices: ["PS5"] }).some((o) => o.product.sku === "TCL-55C6KS"));
});

test("ranking is stable: the same card always gives the same order", () => {
  const card: HomeCard = { distance_feet: 8, light: "bright", content: ["cricket"] };
  const once = rank(pack, card).map((o) => o.product.sku);
  const twice = rank(pack, card).map((o) => o.product.sku);
  assert.deepEqual(once, twice);
});

test("the reply is three lines, each with a reason and a cue, under the body limit", () => {
  const reply = recommendReply(pack, { distance_feet: 8, light: "bright sun", content: ["cricket"], devices: ["PS5"] });
  const lines = reply.text.split("\n");
  assert.equal(lines.length, 3);
  for (const line of lines) assert.match(line, / — .+\. Show: .+/);
  assert.ok(reply.text.length <= 1024, `body is ${reply.text.length} chars`);
  assert.equal(reply.buttons?.length, 3);
  assert.ok(reply.buttons!.every((b) => b.id.startsWith("select:")));
});

test("every figure in a recommendation is one the pack can vouch for", () => {
  for (const card of [
    { distance_feet: 8, light: "bright sun", content: ["cricket"], devices: ["PS5"] },
    { distance_m: 3, content: ["OTT"], priorities: ["sound"] },
    { distance_feet: 10, light: "dim", content: ["news"], budget_rupees: 70000 },
  ] as HomeCard[]) {
    const reply = recommendReply(pack, card);
    assert.deepEqual(unsupportedNumbers(reply.text, allowed, ""), [], `invented figure for ${JSON.stringify(card)}`);
  }
});

test("a card answered in metres counts as assessed, same as feet", async () => {
  const { isAssessed } = await import("../server/src/brain.js");
  const inMetres = { distance_m: 3, light: "bright", mount: "wall", content: ["cricket"] };
  const inFeet = { distance_feet: 10, light: "bright", mount: "wall", content: ["cricket"] };
  assert.equal(isAssessed(inMetres), true, "the brief's own example asks in metres");
  assert.equal(isAssessed(inFeet), true);
  assert.equal(isAssessed({ light: "bright", mount: "wall", content: ["cricket"], family: "four" }), false,
    "no distance in either unit is not assessed");
});

test("a size that is not the fit is not described as the fit", () => {
  // 3 m suggests about 74 inch; nothing in the pack is that big.
  const reply = recommendReply(pack, { distance_m: 3, content: ["news"] });
  assert.doesNotMatch(reply.text, /\d+ inch is the fit/,
    "no product is within 3 inches of 74, so none may claim to be the fit");
  assert.match(reply.text, /closest we stock to the 74 inch/);
});

test("a size that genuinely fits still says so", () => {
  // 8 feet suggests 60 inch; the 65 is within three.
  const options = rank(pack, { distance_feet: 8, content: ["news"] });
  assert.ok(options.some((o) => /is the fit at that distance/.test(o.reason)));
});

test("three options never give the same reason twice", () => {
  for (const card of [
    { distance_feet: 8, light: "dim", content: ["news"] },
    { distance_feet: 8, light: "bright sun", content: ["cricket"], devices: ["PS5"] },
    { distance_m: 3, content: ["OTT"] },
  ] as HomeCard[]) {
    const reasons = recommendReply(pack, card).text.split("\n").map((line) => line.split(" — ")[1]);
    assert.equal(new Set(reasons).size, reasons.length, `duplicate reason for ${JSON.stringify(card)}`);
  }
});

test("a distinguishing reason is still a fact from the pack", () => {
  const reply = recommendReply(pack, { distance_feet: 8, light: "dim", content: ["news"] });
  assert.deepEqual(unsupportedNumbers(reply.text, allowed, ""), []);
});
