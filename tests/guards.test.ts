import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNumbers, loadPack, pairsIn } from "../server/src/pack.js";
import {
  isAssessed,
  moneySafe,
  decide,
  numbersIn,
  offerExpert,
  askedAboutOffers,
  offerLeaked,
  unknownReply,
  awaitingSale,
  reasonFrom,
  floor,
  render,
  rememberShown,
  unsupportedNumbers,
  startInteraction,
  withOffered,
  withShown,
} from "../server/src/brain.js";
import { newSession } from "../server/src/types.js";
import { followThrough } from "../server/src/steps.js";
import { manager } from "./model.js";

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

test("the reply is capped at three lines and three buttons", () => {
  const reply = floor(
    render({
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
    }),
  );
  assert.equal(reply.text, "one\n\ntwo\n\nthree");
  assert.equal(reply.buttons?.length, 3);
});

test("a pitch, which puts a product up for sale, reads out up to six lines before its price", () => {
  const lines = ["fits", "feature one", "feature two", "feature three", 'Ask: "picture it"', "Rs 54,990", "seventh"];
  const reply = floor(
    render({
      step: "recommend",
      card: {},
      shortlist: [],
      demonstrated: false,
      lines,
      buttons: [{ id: "select:TCL-55C6KS", title: "TCL 55" }],
    }),
  );
  assert.equal(reply.text.split("\n").filter((line) => line.trim()).length, 6);
  assert.ok(reply.text.includes("54,990") && !reply.text.includes("seventh"));
});

test("the model's reason goes last, marked, and never costs a line to say", () => {
  const base = { step: "recommend" as const, card: {}, shortlist: [], demonstrated: false, buttons: [] };
  const reason = "↳ They watch cricket, so motion matters.";
  assert.equal(render({ ...base, lines: ["A", "B"], reason }).text, `A\nB\n${reason}`);
  assert.equal(render({ ...base, lines: ["A", "B", "C"], reason }).text, "A\nB\nC");
  assert.equal(render({ ...base, lines: ["A"], reason: null }).text, "A");
  assert.equal(render({ ...base, lines: [], reason: "x" }).text.includes("↳"), false);
});

test("duplicate buttons are dropped", () => {
  const button = (id: string, title: string) => ({ id, title });
  const reply = (buttons: { id: string; title: string }[]) =>
    render({ step: "assess", card: {}, shortlist: [], demonstrated: false, lines: ["ask"], buttons });
  assert.equal(reply([button("", "Gaming"), button("", "Gaming")]).buttons?.length, 1);
  assert.equal(reply([button("select:A", "Black"), button("select:A", "Silver")]).buttons?.length, 1);
});

test("a button the model wrote says its own title, and only ids the code acts on survive", () => {
  const reply = render({
    step: "assess",
    card: {},
    shortlist: [],
    demonstrated: false,
    lines: ["ask"],
    buttons: [
      { id: "card:start_level", title: "Gaming" },
      { id: "select:IP18-256_S", title: "Silver" },
      { id: "select:H9", title: "Haier 9 Kg Front Load (Rs 39,970)" },
    ],
  });
  assert.deepEqual(reply.buttons, [
    { id: "say:Gaming", title: "Gaming" },
    { id: "select:IP18-256_S", title: "Silver" },
    { id: "select:H9", title: "Haier 9 Kg Front" },
  ]);
});

test("a title that says something is never cut into something else: the button goes", () => {
  const reply = render({
    step: "assess",
    card: {},
    shortlist: [],
    demonstrated: false,
    lines: ["ask"],
    buttons: [
      { id: "", title: "What will they use it for?" },
      { id: "", title: "(Rs 3,999)" },
      { id: "", title: "Any offers on it?" },
    ],
  });
  assert.deepEqual(reply.buttons, [{ id: "say:Any offers on it?", title: "Any offers on it?" }]);
});

test("a reply with no real next step sends no buttons at all", () => {
  const reply = render({
    step: "complete",
    card: {},
    shortlist: [],
    demonstrated: false,
    lines: ["It is Rs 1,64,900."],
    buttons: [],
  });
  assert.equal(reply.buttons, undefined);
});

test("assessed is four things the customer said, whatever the product is", () => {
  assert.equal(isAssessed({ room: "hall", family: "4 people", budget_rupees: 60000 }), false);
  assert.equal(isAssessed({ facts: { use: "gaming", camera: "yes", battery: "long", storage: "256" } }), true);
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
  });
  assert.equal(reply.text.split("\n").length, 3);
  assert.ok(reply.text.includes("Sony"));
  assert.ok(!reply.text.includes("↳"));
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

test("saying there is no offer is not opening one", () => {
  // "The iPhone 17 256 GB is Rs 99,900. There are no offers running on it today." was replaced
  // with "Offers come after the home": the gate read the price as the offer's figure and the
  // honest denial as the leak. An associate who asks and is told "none" has not been sold to.
  assert.equal(
    offerLeaked("The iPhone 17 256 GB is Rs 99,900. There are no offers running on it today.", false, false),
    false,
  );
  assert.equal(offerLeaked("No offers are running on the iPhone 18 Pro models today.", false, false), false);
  assert.equal(offerLeaked("There is no discount on this one, it is Rs 54,990.", false, false), false);
  // But an offer's own name is not a denial, and a real quote is still a leak.
  assert.equal(offerLeaked("No-cost EMI runs 9 months at Rs 6110.", false, false), true);
  assert.equal(offerLeaked("The HDFC offer is 7.5%, capped at Rs 8000.", false, false), true);
});

test("what is on the associate's screen stays in FACTS when the next search finds other things", () => {
  const session = newSession("910000000000");
  const [a, b, c] = pack.products;
  const tagged = { ...pack, offers: [{ title: "Free wall mount", on: [a!.name] }] };
  rememberShown(session, tagged, [a!.sku, "not-in-pack", b!.sku]);
  assert.deepEqual(
    session.shown?.products.map((p) => p.sku),
    [a!.sku, b!.sku],
  );
  assert.deepEqual(session.shown?.offers, [{ title: "Free wall mount", on: [a!.name] }]);

  const elsewhere = { ...pack, products: [c!], offers: [] };
  const merged = withShown(elsewhere, session);
  assert.deepEqual(
    merged.products.map((p) => p.sku),
    [a!.sku, b!.sku, c!.sku],
  );
  assert.equal(merged.offers.length, 1);
  assert.ok(allowedNumbers(merged).size >= allowedNumbers(elsewhere).size);

  rememberShown(session, elsewhere, []);
  assert.equal(session.shown?.products.length, 2, "a turn that shows nothing keeps the last ones");
  assert.equal(withShown(pack, session).products.length, pack.products.length, "nothing is added twice");
});

test("a reason is the customer's own need and what it means, or nothing", () => {
  const card = {
    facts: { "Main use": "cricket and cartoons" },
    budget_rupees: 60000,
    priorities: ["bright room", "sound"],
  };
  assert.equal(
    reasonFrom(card, "main use", "a fast ball is the thing to show"),
    "cricket and cartoons: a fast ball is the thing to show",
  );
  assert.equal(reasonFrom(card, "budget_rupees", "all three fit"), "Rs 60,000: all three fit");
  assert.equal(
    reasonFrom(card, "priorities", "show it with the lights on"),
    "bright room, sound: show it with the lights on",
  );
  assert.equal(
    reasonFrom(card, "asking about offers", "the customer has decided"),
    null,
    "a need the card does not hold",
  );
  assert.equal(reasonFrom(card, null, "anything"), null);
  assert.equal(reasonFrom(card, "main use", "  "), null);
  assert.equal(reasonFrom(card, "facts", "x"), null);
});

test("while a pick waits, the Sold tap is always on the reply", () => {
  assert.deepEqual(
    awaitingSale({ text: "ok" }, "en").map((b) => b.id),
    ["sold"],
  );
  const kept = awaitingSale(
    {
      text: "ok",
      buttons: [
        { id: "say:a", title: "A" },
        { id: "say:b", title: "B" },
        { id: "consent:yes", title: "x" },
      ],
    },
    "hi",
  );
  assert.deepEqual(
    kept.map((b) => b.id),
    ["sold", "say:a", "say:b"],
  );
  assert.equal(kept[0]!.title, "✅ बिक गया");
});

test("a real mount offered with the pick is its own line in the total, at its own price", () => {
  const session = newSession("910000000000");
  const tv = pack.products[0]!;
  const mount = { id: "mount-1", title: "Brand Wall Mount WM-1", price_rupees: 1000, for: tv.sku };
  session.selection = { sku: tv.sku, accessories: [], charges: [], offered: [mount] };
  const live = { ...pack, accessories: [] };
  const priced = withOffered(live, session);
  assert.equal(priced.accessories.length, 1);
  assert.equal(withOffered(priced, session).accessories.length, 1, "never added twice");

  session.selection.accessories.push("mount-1");
  const reply = followThrough(session, priced, "Asha");
  const total = (tv.price_rupees + 1000).toLocaleString("en-IN");
  assert.match(reply.text, new RegExp(`Brand Wall Mount WM-1 — Rs 1,000`));
  assert.match(reply.text, new RegExp(`Total Rs ${total}`));
  assert.equal(reply.buttons?.[0]?.id, "sold");
});

test("a new customer does not inherit the last one's pick or their yes", () => {
  const session = newSession("910000000000");
  session.selection = { sku: pack.products[0]!.sku, accessories: [], charges: [] };
  session.consent = true;
  session.sold = true;
  session.site_checked = true;
  startInteraction(session);
  assert.equal(session.sold, undefined);
  assert.equal(session.selection, undefined);
  assert.equal(session.consent, false);
  assert.equal(session.site_checked, undefined);
});

test("a typed answer whose meaning was its price is dropped, not left as 'Under'", () => {
  const base = {
    step: "assess" as const,
    card: {},
    shortlist: [],
    demonstrated: false,
    lines: ["Ask: which one, or what budget?"],
  };
  const reply = render({
    ...base,
    buttons: [
      { id: "", title: "Under Rs 40,000" },
      { id: "", title: "Gaming" },
      { id: "select:494749535", title: "BPL 55 (Rs 41,999)" },
    ],
  });
  assert.deepEqual(
    reply.buttons?.map((button) => button.title),
    ["Gaming", "BPL 55"],
  );
});

test("the store's item codes never reach the words to say", () => {
  const base = { step: "recommend" as const, card: {}, shortlist: [], demonstrated: false, buttons: [] };
  const reply = render({
    ...base,
    lines: ["Show the BPL 55-inch 4K (494749535) and the TCL 494811849 side by side, Rs 41,999."],
  });
  assert.equal(reply.text, "Show the BPL 55-inch 4K and the TCL side by side, Rs 41,999.");
});

test("a fridge named 215 L can be said back as 215 litre, and 350 litre still cannot", () => {
  const named = pairsIn("Samsung 215 L 5 Star Single Door Refrigerator");
  assert.ok(named.has("215 litre"));
  assert.ok(!named.has("350 litre"));
});

test("a figure the associate said a turn ago can still be quoted back", async () => {
  const session = newSession("919820000011");
  session.history.push({ who: "associate", text: "customer wants a single door fridge 350 litre" });
  session.history.push({ who: "storeiq", text: "How many people at home?" });
  const model = manager({ lines: ["For 4 people, 350 litre in a single door is not here today."] });
  const reply = await decide(
    { id: "e1", phone: session.phone, modality: "text", text: "4 people" },
    session,
    pack,
    model.fetch,
  );
  assert.match(reply.text, /350 litre/);
});

test("a bank card saving is an offer, and a running cost is not", () => {
  assert.equal(offerLeaked("It's Rs 44,990, and you save Rs 4,499 with an IDFC card.", false, false), true);
  assert.equal(offerLeaked("Inverter compressor, so it saves on the bill. Rs 44,990.", false, false), false);
});

test("a question's buttons are its answers, not three fridges", () => {
  const base = { step: "assess" as const, card: {}, shortlist: [], demonstrated: false };
  const fridges = [
    { id: "select:494606322", title: "LG 605L Black" },
    { id: "select:494813746", title: "LG 574L Prime" },
  ];
  const asked = render({
    ...base,
    lines: ["Does she want a water dispenser on the door, or is that not a priority?"],
    buttons: fridges,
  });
  assert.equal(asked.buttons, undefined);
  const chosen = render({ ...base, lines: ["Which one do they like?"], buttons: fridges });
  assert.equal(chosen.buttons?.length, 2);
});
