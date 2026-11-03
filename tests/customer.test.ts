import { test } from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide, mobileIn, type SavedCustomer } from "../server/src/brain.js";
import { openDatabase } from "../server/src/db.js";
import { newSession, type Event } from "../server/src/types.js";
import { manager } from "./model.js";

const pack = await loadPack("data/pack.json");
const ASSOCIATE = "919820000001";
const said = (text: string): Event => ({ id: `c${Math.random()}`, phone: ASSOCIATE, modality: "text", text });

function cards(saved: Record<string, SavedCustomer> = {}) {
  return { findCustomer: async (phone: string) => saved[phone] ?? null };
}

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
  assert.match(reply.text, /^Card saved for Asha\./);
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
  assert.match(model.prompts[1]!, /CUSTOMER NUMBER: given, by Asha/);
});

test("the card is kept under the customer's number, and nothing is ever sent to it", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = { id: "c-9", phone: "9876543210", name: "Asha" };
    session.card = { budget_rupees: 30000 };
    session.history = [{ who: "associate", text: "fridge" }];
    assert.equal(await db.commit(session, [{ text: "Card saved for Asha." }]), true);
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
  assert.equal(reply.text.trim(), "Card saved for Asha.");
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
