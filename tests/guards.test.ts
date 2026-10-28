import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNumbers, loadPack, recommendedInches } from "../server/src/pack.js";
import { applyAction, isAssessed, languageOf, moneySafe, nextQuestion, numbersIn, offerLeaked, render, unsupportedNumbers } from "../server/src/brain.js";
import { newSession } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");
const allowed = allowedNumbers(pack);

test("a price from the pack passes, an invented one does not", () => {
  assert.deepEqual(unsupportedNumbers("The TCL is ₹54990 today.", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("I can do ₹49000 for you.", allowed, ""), ["49000"]);
});

test("a derived total passes: price plus wall mount", () => {
  assert.deepEqual(unsupportedNumbers("All in ₹56489 with the wall mount.", allowed, ""), []);
});

test("an invented specification does not pass", () => {
  assert.deepEqual(unsupportedNumbers("That panel is 1200 nits.", allowed, ""), ["1200"]);
  assert.deepEqual(unsupportedNumbers("That panel is 800 nits.", allowed, ""), []);
});

test("small counts and distances are not treated as facts", () => {
  assert.deepEqual(unsupportedNumbers("Three options, they sit 8 feet away.", allowed, ""), []);
});

test("a figure the associate said themselves is allowed back", () => {
  assert.deepEqual(unsupportedNumbers("₹45000 is below every TV here.", allowed, "budget is 45000"), []);
});

test("the reply is capped at two lines plus a reason and three buttons", () => {
  const reply = render({
    step: "complete",
    card: {},
    shortlist: [],
    demonstrated: false,
    lines: ["one", "two", "three", "four"],
    buttons: [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
      { id: "d", title: "D" },
    ],
    reason: "because the room decides",
  });
  assert.equal(reply.text.split("\n").length, 3);
  assert.ok(reply.text.endsWith("↳ because the room decides"));
  assert.equal(reply.buttons?.length, 3);
});

test("duplicate buttons are dropped", () => {
  const reply = render({
    step: "assess", card: {}, shortlist: [], demonstrated: false,
    lines: ["ask"], buttons: [{ id: "a", title: "A" }, { id: "a", title: "B" }], reason: "r",
  });
  assert.equal(reply.buttons?.length, 1);
});

test("assessed needs four home facts including the viewing distance", () => {
  assert.equal(isAssessed({ room: "hall", light: "bright", mount: "wall" }), false);
  assert.equal(isAssessed({ distance_feet: 8, light: "bright", mount: "wall" }), false);
  assert.equal(isAssessed({ distance_feet: 8, light: "bright", mount: "wall", content: ["cricket"] }), true);
});

test("the next question follows the floor order and runs out cleanly", () => {
  const session = newSession("919999999999");
  assert.match(nextQuestion(session), /feet/);
  session.card = { distance_feet: 8, light: "bright", mount: "wall", content: ["ott"], devices: ["set-top box"], room: "hall", internet: "yes", family: "four" };
  assert.doesNotMatch(nextQuestion(session), /feet/);
});

test("the 4K size rule of thumb matches the floor answer", () => {
  assert.equal(recommendedInches(8), 60);
  assert.equal(recommendedInches(6), 45);
});

test("a tapped card button fills the card without the model's help", () => {
  const session = newSession("919999999999");
  assert.equal(applyAction(session, "card:content:sports"), "content = sports");
  assert.deepEqual(session.card.content, ["sports"]);
  applyAction(session, "card:content:ott");
  assert.deepEqual(session.card.content, ["sports", "ott"]);
  assert.equal(applyAction(session, "card:distance_feet:8"), "distance_feet = 8");
  assert.equal(session.card.distance_feet, 8);
});

test("a plain button or a bad field changes nothing", () => {
  const session = newSession("919999999999");
  assert.equal(applyAction(session, "show_options"), undefined);
  assert.equal(applyAction(session, "card:price_i_invented:1"), undefined);
  assert.equal(applyAction(session, "card:distance_feet:nonsense"), undefined);
  assert.deepEqual(session.card, {});
});

test("the reply language follows the associate's script, not the topic", () => {
  assert.equal(languageOf("customer wants a TV for the hall"), "en");
  assert.equal(languageOf("ग्राहक को हॉल के लिए टीवी चाहिए"), "hi");
  assert.equal(languageOf("customer ko hall ke liye TV chahiye"), "en");
  assert.equal(languageOf(undefined), "en");
});

test("the offer gate catches a quoted deal, plural wording included", () => {
  assert.equal(offerLeaked("The HDFC offer is 7.5%, capped at ₹8000.", true, false), true);
  assert.equal(offerLeaked("Exchange bonus is worth 3000 today.", false, true), true);
  assert.equal(offerLeaked("No-cost EMI runs 9 months at ₹6110.", false, false), true);
  assert.equal(offerLeaked("The HDFC offer is 7.5%, capped at ₹8000.", true, true), false);
});

test("declining to talk about offers is not a leak", () => {
  assert.equal(offerLeaked("Let's find the right TV before discussing discounts.", false, false), false);
  assert.equal(offerLeaked("We can look at offers after the demo.", false, false), false);
});

test("the rupee artifact Gemini emits is repaired", () => {
  assert.equal(moneySafe('The TCL is ","54,990.'), "The TCL is Rs 54,990.");
  assert.equal(moneySafe('discount of ","4,124 brings it to ","50,866.'), "discount of Rs 4,124 brings it to Rs 50,866.");
  assert.equal(moneySafe("Ask: how far do they sit?"), "Ask: how far do they sit?");
});

test("an Rs figure is checked against the pack just like a rupee sign", () => {
  assert.deepEqual(unsupportedNumbers("Wall mount is Rs 1499.", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("Wall mount is Rs 999.", allowed, ""), ["999"]);
});

test("a number inside a bigger pack number is not permission to say it", () => {
  // 999 sits inside 79990 and 4990 inside 54990; neither is a real figure.
  assert.deepEqual(unsupportedNumbers("Yours for Rs 999.", allowed, ""), ["999"]);
  assert.deepEqual(unsupportedNumbers("Yours for Rs 4990.", allowed, ""), ["4990"]);
  assert.deepEqual(unsupportedNumbers("Yours for Rs 54990.", allowed, ""), []);
});

test("figures written into label prose stay quotable", () => {
  assert.deepEqual(unsupportedNumbers("2 PM sunlight on that wall, 8 kg in one wash.", allowed, ""), []);
});

test("numbersIn reads thousands separators", () => {
  assert.deepEqual([...numbersIn("Rs 54,990 after a 7.5% cut")], [54990, 7.5]);
});

test("the recommend step keeps all three options", () => {
  const reply = render({
    step: "recommend", card: {}, shortlist: [], demonstrated: true,
    lines: ["TCL at Rs 54,990 — brightest for your sun", "Samsung at Rs 71,990 — brand plus brightness", "Sony at Rs 62,990 — best for OTT"],
    buttons: [], reason: "three sized for 8 feet",
  });
  assert.equal(reply.text.split("\n").length, 3);
  assert.ok(reply.text.includes("Sony"));
  assert.ok(!reply.text.includes("↳"));
});

test("every other step still shows the reason line", () => {
  const reply = render({
    step: "assess", card: {}, shortlist: [], demonstrated: false,
    lines: ["Ask how far they sit.", "Then ask about the light."], buttons: [], reason: "the room decides the size",
  });
  assert.equal(reply.text.split("\n").length, 3);
  assert.ok(reply.text.endsWith("↳ the room decides the size"));
});
