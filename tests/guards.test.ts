import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNumbers, loadPack, recommendedInches } from "../server/src/pack.js";
import {
  applyAction,
  isAssessed,
  languageOf,
  moneySafe,
  needsSizing,
  decide,
  numbersIn,
  offerExpert,
  askedAboutOffers,
  offerLeaked,
  unknownReply,
  render,
  unsupportedNumbers,
} from "../server/src/brain.js";
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
  assert.deepEqual(unsupportedNumbers("That panel is 1200 nits.", allowed, ""), ["1200 nits"]);
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
    step: "assess",
    card: {},
    shortlist: [],
    demonstrated: false,
    lines: ["ask"],
    buttons: [
      { id: "a", title: "A" },
      { id: "a", title: "B" },
    ],
    reason: "r",
  });
  assert.equal(reply.buttons?.length, 1);
});

test("assessed needs four home facts including the viewing distance", () => {
  assert.equal(isAssessed({ room: "hall", light: "bright", mount: "wall" }), false);
  assert.equal(isAssessed({ distance_feet: 8, light: "bright", mount: "wall" }), false);
  assert.equal(isAssessed({ distance_feet: 8, light: "bright", mount: "wall", content: ["cricket"] }), true);
});

test("the viewing distance is only required where there is a screen", () => {
  const home = { room: "hall", light: "bright", mount: "wall", content: ["cricket"] };
  assert.equal(isAssessed(home), false);
  assert.equal(isAssessed(home, false), true);
  assert.equal(needsSizing(pack), true, "this pack sells televisions");
  const washing = { ...pack, products: pack.products.map((product) => ({ ...product, size_inch: 0 })) };
  assert.equal(needsSizing(washing), false);
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
  assert.equal(
    moneySafe('discount of ","4,124 brings it to ","50,866.'),
    "discount of Rs 4,124 brings it to Rs 50,866.",
  );
  assert.equal(moneySafe("Ask: how far do they sit?"), "Ask: how far do they sit?");
});

test("an Rs figure is checked against the pack just like a rupee sign", () => {
  assert.deepEqual(unsupportedNumbers("Wall mount is Rs 1499.", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("Wall mount is Rs 999.", allowed, ""), ["999"]);
});

test("a number inside a bigger pack number is not permission to say it", () => {
  assert.deepEqual(unsupportedNumbers("Yours for Rs 999.", allowed, ""), ["999"]);
  assert.deepEqual(unsupportedNumbers("Yours for Rs 4990.", allowed, ""), ["4990"]);
  assert.deepEqual(unsupportedNumbers("Yours for Rs 54990.", allowed, ""), []);
});

test("figures written into label prose stay quotable", () => {
  assert.deepEqual(unsupportedNumbers("2 PM sunlight on that wall.", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("8 kg in one wash.", allowed, ""), ["8 kg"]);
});

test("numbersIn reads thousands separators", () => {
  assert.deepEqual([...numbersIn("Rs 54,990 after a 7.5% cut")], [54990, 7.5]);
});

test("the recommend step keeps all three options", () => {
  const reply = render({
    step: "recommend",
    card: {},
    shortlist: [],
    demonstrated: true,
    lines: [
      "TCL at Rs 54,990 — brightest for your sun",
      "Samsung at Rs 71,990 — brand plus brightness",
      "Sony at Rs 62,990 — best for OTT",
    ],
    buttons: [],
    reason: "three sized for 8 feet",
  });
  assert.equal(reply.text.split("\n").length, 3);
  assert.ok(reply.text.includes("Sony"));
  assert.ok(!reply.text.includes("↳"));
});

test("every other step still shows the reason line", () => {
  const reply = render({
    step: "assess",
    card: {},
    shortlist: [],
    demonstrated: false,
    lines: ["Ask how far they sit.", "Then ask about the light."],
    buttons: [],
    reason: "the room decides the size",
  });
  assert.equal(reply.text.split("\n").length, 3);
  assert.ok(reply.text.endsWith("↳ the room decides the size"));
});

test("every product carries a demonstration cue, as section 6.5 requires", () => {
  for (const product of pack.products) {
    assert.ok(product.demo_cue && product.demo_cue.length > 20, `${product.sku} has no usable demo cue`);
    assert.ok(product.energy?.typical_watts > 0, `${product.sku} has no energy figure`);
  }
});

test("an itemised total with an accessory and delivery is sayable", () => {
  assert.deepEqual(
    unsupportedNumbers("TCL Rs 54990 plus soundbar Rs 11990 plus delivery Rs 499 is Rs 67479.", allowed, ""),
    [],
  );
});

test("the running-cost answer to the electricity objection is sayable from facts", () => {
  assert.deepEqual(
    unsupportedNumbers(
      "The 55 inch draws 105 W against 125 W, so 153 units a year against 183, about Rs 240 apart.",
      allowed,
      "",
    ),
    [],
  );
});

test("a running cost that is not in the data is still refused", () => {
  assert.deepEqual(unsupportedNumbers("It will cost you Rs 4321 a year to run.", allowed, ""), ["4321"]);
});

test("a figure is its number and its unit, not the number alone", () => {
  assert.deepEqual(unsupportedNumbers("the warranty is 3 years", allowed, ""), ["3 year"]);
  assert.deepEqual(unsupportedNumbers("the standard warranty is one year", allowed, ""), ["1 year"]);
  assert.deepEqual(unsupportedNumbers("delivery takes 7 days", allowed, ""), ["7 day"]);
  assert.deepEqual(unsupportedNumbers("the extended warranty runs 2 years", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("it has 9 HDMI ports", allowed, ""), ["9 port"]);
  assert.deepEqual(unsupportedNumbers("it has 2 HDMI 2.1 ports", allowed, ""), [], "the TCL has two");
  assert.deepEqual(unsupportedNumbers("two pairs of jeans and two bedsheets in one wash", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("TCL 55 inch, 144 Hz, Rs 54,990", allowed, ""), []);
});

test("a unit in the associate's own language is still a unit", () => {
  assert.deepEqual(unsupportedNumbers("Warranty sab TVs par 1 saal ki milti hai.", allowed, ""), ["1 year"]);
  assert.deepEqual(unsupportedNumbers("वारंटी 1 साल की है।", allowed, ""), ["1 year"]);
  assert.deepEqual(unsupportedNumbers("डिलीवरी 7 दिन लेती है।", allowed, ""), ["7 day"]);
  assert.deepEqual(unsupportedNumbers("TCL 55 इंच, 144 Hz.", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("Extended warranty 2 saal ki hai.", allowed, ""), []);
});

test("a bare count is a claim once it is bigger than prose", () => {
  assert.deepEqual(unsupportedNumbers("Target is 47 TVs today.", allowed, ""), ["47"]);
  assert.deepEqual(unsupportedNumbers("Three options, two bedsheets in one wash.", allowed, ""), []);
  assert.deepEqual(unsupportedNumbers("9 in stock.", allowed, ""), [], "the TCL's own count");
  assert.deepEqual(unsupportedNumbers("Target is 12 TVs today.", allowed, ""), []);
});

test("a reply that could not answer carries a human who can", () => {
  const refused = offerExpert({ text: "I do not have that." }, "en");
  assert.deepEqual(refused.buttons, [{ id: "ask_expert", title: "Find out for me" }]);
  assert.deepEqual(offerExpert(refused, "en").buttons?.length, 1);
  assert.equal(offerExpert({ text: "x" }, "en", false).buttons, undefined);
  assert.equal(offerExpert({ text: "x" }, "hi").buttons![0]!.title, "पता करके बताइए");
});

test("asked for something the pack does not have, the reason is ours and a human is offered", () => {
  const reply = unknownReply({ text: 'Ask: "Which model is it?"\n↳ The requested information is not in FACTS.' }, "en");
  assert.deepEqual(reply.text.split("\n"), [
    'Ask: "Which model is it?"',
    "↳ Nothing in today's data has it — I can get it from the expert.",
  ]);
  assert.deepEqual(reply.buttons, [{ id: "ask_expert", title: "Find out for me" }]);
  assert.match(unknownReply({ text: "x" }, "hi").text, /एक्सपर्ट/);
});

test("a unit conversion of what they said is not an invention", () => {
  assert.deepEqual(unsupportedNumbers("At 10 feet, a 65 inch fills the wall.", allowed, "they sit 3 metres away"), []);
  assert.deepEqual(unsupportedNumbers("sits 1.5 metres away", allowed, "about 5 feet from the wall"), []);
  assert.deepEqual(unsupportedNumbers("At 14 feet you want bigger.", allowed, "they sit 3 metres away"), ["14 foot"]);
});

test("tapping Find out for me logs what they actually asked", async () => {
  const logged: { question: string; area: string }[] = [];
  const store = {
    today: async () => [],
    openQuestions: async () => [],
    logVisit: async () => {},
    logQuestion: async (row: { question: string; area: string }) => void logged.push(row),
  };
  const session = newSession("919820000010");
  session.history.push({ who: "associate", text: "customer is asking how many USB ports this one has" });
  session.history.push({ who: "storeiq", text: "I do not have that detail right now." });
  const reply = await decide(
    { id: "e1", phone: session.phone, modality: "interactive", action: "ask_expert" },
    session,
    pack,
    undefined,
    store,
  );
  assert.equal(logged.length, 1);
  assert.match(logged[0]!.question, /USB ports/);
  assert.match(reply.text, /SIQ-/, "with a reference the associate can quote");
});

test("a gate is not a refusal to answer: asked outright, the offer is given", () => {
  // The gate exists to stop the product LEADING with price, which the store visits found in 6 of 6
  // conversations. An associate holding a customer who has decided asked three times and was sent
  // back to the room each time, so a question they asked in their own words opens it.
  const quoted = "The HDFC offer is 7.5%, capped at Rs 8000.";
  assert.equal(offerLeaked(quoted, false, false), true, "unprompted, before the home: still shut");
  assert.equal(offerLeaked(quoted, false, false, true), false, "they asked, so they are told");
  assert.equal(askedAboutOffers("any offer running on the Sony 85 inch"), true);
  assert.equal(askedAboutOffers("is there a discount on this"), true);
  assert.equal(askedAboutOffers("customer wants a washing machine"), false, "no offer word, no opening");
  assert.equal(askedAboutOffers(undefined), false, "a tap carries no words");
});
