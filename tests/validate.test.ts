import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack, allowedNumbers } from "../server/src/pack.js";
import { looksLikeAClaim, matchMyth, validateReply } from "../server/src/validate.js";
import { unsupportedNumbers } from "../server/src/brain.js";

const pack = await loadPack("data/pack.json");
const allowed = allowedNumbers(pack);

test("the brief's own example objection is matched", () => {
  // Section 5: "Customer says a larger screen always uses much more electricity."
  const myth = matchMyth(pack, "Customer says a larger screen always uses much more electricity");
  assert.ok(myth);
  assert.match(myth!.claim, /electricity/);
});

test("the same objection in the associate's own words still matches", () => {
  assert.ok(matchMyth(pack, "he thinks a bigger screen uses more electricity at home"));
  assert.ok(matchMyth(pack, "customer says QLED and OLED are basically the same"));
});

test("a claim the pack knows nothing about is not answered", () => {
  assert.equal(matchMyth(pack, "customer says his cousin got a free trip to Dubai"), null);
  assert.equal(validateReply(pack, "customer says the delivery van was late"), null);
});

test("one stray shared word is not a match", () => {
  assert.equal(matchMyth(pack, "screen"), null);
  assert.equal(matchMyth(pack, "customer says screen"), null);
});

test("the reply confirms before it corrects, with real figures", () => {
  const reply = validateReply(pack, "customer says a larger screen always uses much more electricity")!;
  assert.match(reply.text, /^Say: "Fair question, running cost is worth checking\./);
  assert.match(reply.text, /105 W/);
  assert.match(reply.text, /153 against 183 units a year/);
  assert.deepEqual(unsupportedNumbers(reply.text, allowed, ""), [], "every figure comes from the pack");
});

test("a claim is recognised however the associate phrases it", () => {
  assert.equal(looksLikeAClaim("Customer says bigger is better", undefined), true);
  assert.equal(looksLikeAClaim("he thinks QLED is OLED", undefined), true);
  assert.equal(looksLikeAClaim("grahak bol raha hai", undefined), true);
  assert.equal(looksLikeAClaim("give me three options", undefined), false);
  assert.equal(looksLikeAClaim(undefined, "validate"), true);
});
