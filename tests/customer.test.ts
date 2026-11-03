import { test } from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide, mobileIn, recordPurchase, type SavedCustomer } from "../server/src/brain.js";
import { openDatabase } from "../server/src/db.js";
import { newSession, type Event } from "../server/src/types.js";
import { manager } from "./model.js";

const pack = await loadPack("data/pack.json");
const ASSOCIATE = "919820000001";
const said = (text: string): Event => ({ id: `c${Math.random()}`, phone: ASSOCIATE, modality: "text", text });

function cards(saved: Record<string, SavedCustomer> = {}) {
  return {
    findCustomer: async (phone: string) => saved[phone] ?? null,
    namesIn: async (text: string) =>
      Object.values(saved)
        .map((row) => row.name)
        .filter((name): name is string => !!name && text.includes(name)),
  };
}

test("a saved customer asked about by name gets the number asked for, not 'no record'", async () => {
  const session = newSession(ASSOCIATE);
  const saved = { "9876501234": { id: "c-2", name: "Rahul", card: { budget_rupees: 50000 }, history: [] } };
  const asking = 'Ask: "What number did Rahul give last time?"';
  const model = manager({ lines: [asking], ask_number: asking, customer: { arrived: "returning", name: "Rahul" } });
  const reply = await decide(said("what did Rahul want last time?"), session, pack, model.fetch, cards(saved) as never);
  assert.match(model.prompts[0]!, /CUSTOMER NUMBER: not given, and a card is saved under the name Rahul/);
  assert.equal(reply.text.match(/What number did Rahul give/g)?.length, 1, "asked once, not twice");
  assert.equal(session.customer, undefined, "a name alone does not load a card");
});

test("the model's copy of the welcome line is not sent under the code's", async () => {
  const session = newSession(ASSOCIATE);
  const saved = { "9876501234": { id: "c-2", name: "Rahul", card: { budget_rupees: 50000 }, history: [] } };
  const model = manager({ lines: ["Welcome back, Rahul. Last time: budget Rs 50,000."] });
  const reply = await decide(said("9876501234"), session, pack, model.fetch, cards(saved) as never);
  assert.equal(reply.text.match(/Welcome back/g)?.length, 1);
});

test("a saved name is found in the words only as a whole name", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = { id: "c-3", phone: "9876501234", name: "Ram Kumar" };
    await db.commit(session, []);
    assert.deepEqual(await db.namesIn("Ram ka data batao"), ["Ram Kumar"]);
    assert.deepEqual(await db.namesIn("what did ram want"), ["Ram Kumar"]);
    assert.deepEqual(await db.namesIn("the program is on"), [], "not inside another word");
  } finally {
    await db.close();
  }
});

test("the customer's number is read from the associate's own words", () => {
  assert.equal(mobileIn("her number is +91 98765 43210"), "9876543210");
  assert.equal(mobileIn("number is 98765-43210 ok"), "9876543210");
  assert.equal(mobileIn("9876543210 ka data batao"), "9876543210");
  assert.equal(mobileIn("her name is Asha"), null);
  assert.equal(mobileIn("budget 60000"), null);
  assert.equal(mobileIn("1876543210"), null, "not a mobile");
  assert.equal(mobileIn("item 498765432101"), null, "part of a longer number");
});

test("a new customer is read from the words, not a fixed phrase, and the card is saved", async () => {
  const session = newSession(ASSOCIATE);
  session.history = [
    { who: "associate", text: "the last one wanted a TV" },
    { who: "storeiq", text: "ok" },
  ];
  session.card = { room: "hall", budget_rupees: 60000, facts: { "screen size": "55 inch" } };
  // What the live model did: it saw the new customer and copied the last one's card back anyway.
  const model = manager({
    customer: { arrived: "new", name: "Asha" },
    card: { budget_rupees: 60000, facts: [{ name: "screen size", value: "55 inch" }] },
  });
  const reply = await decide(
    said("ek aunty aayi hai, Asha, 9876543210, fridge chahiye"),
    session,
    pack,
    model.fetch,
    cards() as never,
  );
  assert.deepEqual(session.card, {}, "the last customer's card is not hers");
  assert.equal(session.customer?.name, "Asha");
  assert.equal(session.customer?.phone, "9876543210");
  assert.match(reply.text, /^Home card saved for Asha\./);
});

test("a returning customer gets their old card and history back", async () => {
  const session = newSession(ASSOCIATE);
  const saved = {
    "9876543210": {
      id: "c-1",
      name: "Asha",
      card: { budget_rupees: 30000, facts: { "main use": "family of five" } },
      history: [{ who: "associate" as const, text: "she wants a double door fridge" }],
    },
  };
  const model = manager({ customer: { arrived: "returning" } });
  const reply = await decide(said("she came last week, 9876543210"), session, pack, model.fetch, cards(saved) as never);
  assert.equal(session.customer?.id, "c-1");
  assert.equal(session.card.budget_rupees, 30000);
  assert.equal(session.history[0]?.text, "she wants a double door fridge");
  assert.match(reply.text, /^Welcome back, Asha\. Last time: budget \*?Rs 30000\*?; main use: family of five\./);
});

test("a returning number with no card is said, and no card is made up", async () => {
  const session = newSession(ASSOCIATE);
  const model = manager({ customer: { arrived: "returning" } });
  const reply = await decide(said("he was here before, 9876543210"), session, pack, model.fetch, cards() as never);
  assert.equal(session.customer, undefined);
  assert.match(reply.text, /^No card on 9876543210\./);
});

test("the prompt tells the model whether this customer has a card", async () => {
  const session = newSession(ASSOCIATE);
  const model = manager({});
  await decide(said("what do they want"), session, pack, model.fetch, cards() as never);
  assert.match(model.prompts[0]!, /CUSTOMER NUMBER: none yet/);
  session.customer = { id: "c-1", phone: "9876543210", name: "Asha" };
  await decide(said("what next"), session, pack, model.fetch, cards() as never);
  assert.match(
    model.prompts[1]!,
    /CUSTOMER NUMBER: given; the customer is Asha, and you are talking to the associate, not to Asha/,
  );
});

test("the card is kept under the customer's number, and nothing is ever sent to it", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = { id: "c-9", phone: "9876543210", name: "Asha" };
    session.card = { budget_rupees: 30000 };
    session.history = [{ who: "associate", text: "fridge" }];
    assert.equal(await db.commit(session, [{ text: "Home card saved for Asha." }]), true);
    session.card = { budget_rupees: 40000 };
    assert.equal(await db.commit(session, [{ text: "ok" }]), true);

    const found = await db.findCustomer("9876543210");
    assert.equal(found?.id, "c-9");
    assert.equal(found?.name, "Asha");
    assert.equal(found?.card.budget_rupees, 40000, "the latest card, not the first");
    assert.equal(await db.findCustomer("9000000000"), null);

    const sentTo: string[] = [];
    const lease = randomUUID();
    for (let row = await db.claimOutbox(lease); row; row = await db.claimOutbox(lease)) {
      sentTo.push(row.phone);
      await db.finishOutbox(row.id, lease, "sent");
    }
    assert.ok(sentTo.length >= 2);
    assert.ok(
      sentTo.every((phone) => phone === ASSOCIATE),
      "Rule 5: replies go to the associate only",
    );
  } finally {
    await db.close();
  }
});

test("the model's line asking for the name and number goes out once, and not over a saved card", async () => {
  const session = newSession(ASSOCIATE);
  const asking = 'Ask: "Can I note your name and number for next time?"';
  const model = manager([
    { lines: ["Samsung fridges are in aisle four."], ask_number: asking },
    { lines: ["Show the double door one."], ask_number: asking },
  ]);
  const first = await decide(said("customer wants a fridge"), session, pack, model.fetch, cards() as never);
  assert.match(model.prompts[0]!, /CUSTOMER NUMBER: none yet/);
  assert.match(first.text, /Can I note your name and number/);
  const second = await decide(said("which one is bigger"), session, pack, model.fetch, cards() as never);
  assert.match(model.prompts[1]!, /CUSTOMER NUMBER: none, already asked for/);
  assert.doesNotMatch(second.text, /Can I note/, "asked once, not every turn");

  const saved = newSession(ASSOCIATE);
  saved.customer = { id: "c-1", phone: "9876543210" };
  const third = await decide(
    said("which one is bigger"),
    saved,
    pack,
    manager({ ask_number: asking }).fetch,
    cards() as never,
  );
  assert.doesNotMatch(third.text, /Can I note/);
});

test("given only the number, the reply is the saved line and no filler", async () => {
  const session = newSession(ASSOCIATE);
  const model = manager({ lines: [], customer: { name: "Asha" } });
  const reply = await decide(said("Asha, 9876543210"), session, pack, model.fetch, cards() as never);
  assert.equal(reply.text.trim(), "Home card saved for Asha.");
});

test("a number alone brings the card back before the model writes, even when the model passes nothing on", async () => {
  const session = newSession(ASSOCIATE);
  const saved = {
    "9876543210": { id: "c-1", name: "Meena", card: { facts: { "main use": "cricket" } }, history: [] },
  };
  // What the live model did with "<number> ka data batao": no customer field at all.
  const model = manager({ customer: null, lines: ["She was looking at TVs for cricket."] });
  const reply = await decide(said("9876543210 ka data batao"), session, pack, model.fetch, cards(saved) as never);
  assert.match(model.prompts[0]!, /cricket/, "the model wrote with her card in front of it");
  assert.match(model.prompts[0]!, /That number is Meena from an earlier visit/);
  assert.match(reply.text, /^Welcome back, Meena\. Last time: main use: cricket\./);
  assert.equal(session.customer?.id, "c-1");
});

test("a number nobody has saved, asked about out of the blue, is said to be unknown and not saved", async () => {
  const session = newSession(ASSOCIATE);
  const model = manager({ customer: null, lines: ["Let me check."] });
  const reply = await decide(said("9876543210 ka data batao"), session, pack, model.fetch, cards() as never);
  assert.match(reply.text, /^No card on 9876543210\./);
  assert.equal(session.customer, undefined);
});

test("what the customer agreed to buy goes on their home card, once", () => {
  const session = newSession(ASSOCIATE);
  const product = pack.products[0]!;
  session.customer = { id: "c-4", phone: "9876512345", name: "Suresh" };
  session.selection = { sku: product.sku, accessories: [], charges: [] };
  // A function, so the first assert does not narrow what the later ones read.
  const bought = () => session.customer?.bought;
  recordPurchase(session, pack);
  assert.equal(bought(), undefined, "no yes, no purchase");
  session.consent = true;
  recordPurchase(session, pack);
  recordPurchase(session, pack);
  assert.equal(bought()?.length, 1, "the yes tapped twice is one purchase");
  assert.equal(bought()?.[0]?.name, product.name);
  assert.equal(bought()?.[0]?.total, product.price_rupees);
});

test("a returning customer is shown what they bought", async () => {
  const session = newSession(ASSOCIATE);
  const saved = {
    "9876512345": {
      id: "c-4",
      name: "Suresh",
      card: {},
      history: [],
      purchases: [{ sku: "x", name: "Haier 9 Kg Front Load", total: 39970, on: "2026-11-03" }],
    },
  };
  const model = manager({ lines: ["What does he need today?"] });
  const reply = await decide(said("9876512345"), session, pack, model.fetch, cards(saved) as never);
  assert.match(reply.text, /Bought: Haier 9 Kg Front Load, \*?Rs 39,970\*? \(2026-11-03\)\./);
  assert.match(model.prompts[0]!, /They bought Haier 9 Kg Front Load then/);
  assert.equal(session.customer?.bought?.length, 1, "kept, so the next save does not wipe it");
});

test("the associate is not greeted by the customer's name, and the save is said once", async () => {
  const session = newSession(ASSOCIATE);
  session.customer_asked = true;
  const model = manager({
    lines: ["Okay, Suresh. What capacity is he looking for?", "Suresh ji ke liye home card ban gaya hai."],
    customer: { name: "Suresh" },
  });
  const reply = await decide(said("Suresh, 9876512345"), session, pack, model.fetch, cards() as never);
  assert.match(model.prompts[0]!, /any name in it is the customer's, not the associate's/);
  assert.doesNotMatch(reply.text, /Okay, Suresh/);
  assert.equal(reply.text.match(/home card/gi)?.length, 1);
  assert.match(reply.text, /What capacity is he looking for\?/);
});

test("purchases survive the database round trip", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = {
      id: "c-5",
      phone: "9876523456",
      name: "Meena",
      bought: [{ sku: "x", name: "LG fridge", total: 50000, on: "2026-11-03" }],
    };
    await db.commit(session, []);
    assert.equal((await db.findCustomer("9876523456"))?.purchases?.[0]?.name, "LG fridge");
  } finally {
    await db.close();
  }
});
