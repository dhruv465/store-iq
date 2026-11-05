import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack, bandHolds } from "../server/src/pack.js";
import { decide, deterministic } from "../server/src/brain.js";
import { openDatabase } from "../server/src/db.js";
import { pipeMetres, storeDay, wantsSold, withAfterSales } from "../server/src/aftersales.js";
import { newSession, type Event } from "../server/src/types.js";
import { manager } from "./model.js";

const pack = await loadPack("data/pack.json");
const ASSOCIATE = "919820000001";
const said = (text: string): Event => ({
  id: `t${Math.random()}`,
  phone: ASSOCIATE,
  modality: "text",
  text,
  name: "Gaurav",
});
const tap = (action: string): Event => ({
  id: `a${Math.random()}`,
  phone: ASSOCIATE,
  modality: "interactive",
  action,
  name: "Gaurav",
});

test("resQ's price band is read off the plan's own name", () => {
  assert.equal(bandHolds("3 Year - resQ Care Plan - Refrigerator from Rs.40000 to Rs.50000", 45000), true);
  assert.equal(bandHolds("3 Year - resQ Care Plan - Refrigerator from Rs.40000 to Rs.50000", 55000), false);
  assert.equal(bandHolds("2 Year - resQ Care Plan - Refrigerator from Rs.1.5L to Rs.1.75L", 160000), true);
  assert.equal(bandHolds("4 Year - resQ Care Plan - Laptop upto Rs.15000", 14000), true);
  assert.equal(bandHolds("2 Year - resQ Care Plan - Laptop above Rs.3L", 310000), true);
  assert.equal(bandHolds("resQ Installation Service", 10000), false, "no band, no plan");
});

test("the sale is a whole message, not a word inside a question", () => {
  assert.equal(wantsSold("Sold!", undefined), true);
  assert.equal(wantsSold("he bought it", undefined), true);
  assert.equal(wantsSold("deal done", undefined), true);
  assert.equal(wantsSold("bik gaya", undefined), true);
  assert.equal(wantsSold("is the sold out model back?", undefined), false);
  assert.equal(wantsSold(undefined, "sold"), true);
});

test("the store day is India's, not the server's", () => {
  // 20:00 UTC on the 5th is 01:30 on the 6th in Mumbai.
  assert.equal(storeDay(0, Date.parse("2026-11-05T20:00:00Z")), "2026-11-06");
  assert.equal(storeDay(1, Date.parse("2026-11-05T10:00:00Z")), "2026-11-06");
});

test("Sold raises the follow-ups, hello shows them, and only the associate who owns one can close it", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = { id: "c-1", phone: "9876543210", name: "Vidya Sathe" };
    await decide(tap("select:TCL-55C6KS"), session, pack, manager({}).fetch, db);
    const sold = await decide(tap("sold"), session, pack, manager({}).fetch, db);
    assert.match(sold.text, /🎉/);
    const all = await db.followUps({ phone: ASSOCIATE });
    assert.equal(all.length, 3);
    assert.match(all[0]!.what, /^Call Vidya Sathe: did the TCL 55 inch C6K QD-Mini LED arrive/);
    assert.equal(all[0]!.due_on, storeDay(1));
    assert.equal(
      (await db.followUps({ phone: ASSOCIATE, dueBy: storeDay() })).length,
      0,
      "nothing due on the day of the sale",
    );

    // Two days on, the first two are due.
    const due = await db.followUps({ phone: ASSOCIATE, dueBy: storeDay(2) });
    assert.equal(due.length, 2);
    assert.equal(await db.doneFollowUp(due[0]!.id, "919999999999"), null, "someone else's tap changes nothing");
    assert.match((await db.doneFollowUp(due[0]!.id, ASSOCIATE))!.what, /arrive/);
    assert.equal((await db.followUps({ phone: ASSOCIATE })).length, 2);
    assert.equal((await db.followUps({ customer_id: "c-1" })).length, 2, "and they are on her card");
  } finally {
    await db.close();
  }
});

test("hello carries the count of today's follow-ups and the tap that lists them", async () => {
  const db = await openDatabase("memory://");
  try {
    await db.addFollowUps([
      { phone: ASSOCIATE, product: "LG fridge", what: "Call Asha: did the LG fridge arrive?", due_on: storeDay(-1) },
    ]);
    const session = await db.session(ASSOCIATE);
    const hello = await decide(said("hi"), session, pack, manager({}).fetch, db);
    assert.match(hello.text, /1 follow-up due today/);
    assert.equal(hello.buttons?.[0]?.id, "followups");
    const list = await decide(tap("followups"), session, pack, manager({}).fetch, db);
    assert.match(list.text.replace(/\*/g, ""), /^1\. Call Asha: did the LG fridge arrive\?/);
    const id = list.buttons?.[0]?.id;
    assert.match(id ?? "", /^fu:done:\d+$/);
    const done = await decide(tap(id!), session, pack, manager({}).fetch, db);
    assert.match(done.text.replace(/\*/g, ""), /^Done ✓ Call Asha/);
    assert.match((await decide(said("follow ups"), session, pack, manager({}).fetch, db)).text, /Nothing due today/);
  } finally {
    await db.close();
  }
});

test("asked for a customer's card by name, the code shows it, with what they bought and what is next", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = { id: "c-1", phone: "9876543210", name: "Vidya Sathe" };
    await decide(tap("select:TCL-55C6KS"), session, pack, manager({}).fetch, db);
    await decide(tap("sold"), session, pack, manager({}).fetch, db);
    await db.commit(session, []);
    await decide(tap("new_customer"), session, pack, manager({}).fetch, db);

    const model = manager({ lines: ["I can't access previous purchase history."] });
    const card = await decide(said("What's vidya sathe's homecard"), session, pack, model.fetch, db);
    assert.equal(model.prompts.length, 0, "the card is the code's, not the model's");
    assert.match(
      card.text,
      /^Vidya Sathe ··3210 · \*?Bought:\*? TCL 55 inch C6K QD-Mini LED, \*?Rs 54,990\*? \(\d{4}-\d{2}-\d{2}\)/,
    );
    assert.match(card.text.replace(/\*/g, ""), /Next: Call Vidya Sathe: did the TCL/);
    assert.deepEqual(
      card.buttons?.map((button) => button.id),
      ["cust:serve", "cust:problem", "followups:customer"],
    );
    assert.equal(session.customer?.id, "c-1", "her card is open");

    // The button the model used to invent and then fail on.
    const again = await decide(said("Previous purchases"), session, pack, model.fetch, db);
    assert.match(again.text, /Bought:\*? TCL 55 inch/);
    assert.equal(model.prompts.length, 0);
  } finally {
    await db.close();
  }
});

test("two customers with one name are told apart by their numbers", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    for (const [id, phone] of [
      ["c-1", "9876543210"],
      ["c-2", "9123456789"],
    ] as const) {
      session.customer = { id, phone, name: "Rahul Shah" };
      await db.commit(session, []);
    }
    delete session.customer;
    const which = await decide(said("show Rahul Shah's card"), session, pack, manager({}).fetch, db);
    assert.match(which.text, /More than one Rahul Shah on file/);
    assert.deepEqual(which.buttons?.map((button) => button.title).sort(), ["Rahul ··3210", "Rahul ··6789"]);
    const picked = await decide(tap("cust:9123456789"), session, pack, manager({}).fetch, db);
    assert.match(picked.text, /^Rahul Shah ··6789/);
    // Read through a function: the delete above narrowed the field to nothing.
    const opened = () => session.customer;
    assert.equal(opened()?.id, "c-2");
  } finally {
    await db.close();
  }
});

test("a problem with something bought is raised with service, with a check-back tomorrow", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = {
      id: "c-1",
      phone: "9876543210",
      name: "Vidya Sathe",
      bought: [{ sku: "x", name: "Samsung 615 L Refrigerator, Black", total: 210190, on: "2026-11-05" }],
    };
    const asked = await decide(tap("cust:problem"), session, pack, manager({}).fetch, db);
    assert.match(asked.text, /What is wrong with the Samsung 615 L Refrigerator\?/);
    const model = manager({});
    const raised = await decide(said("not cooling since yesterday"), session, pack, model.fetch, db);
    assert.equal(model.prompts.length, 0);
    assert.match(raised.text, /^Raised with .* · SIQ-\d{4}/);
    assert.equal(session.reporting_problem, undefined);
    const open = await db.openQuestions();
    assert.equal(open[0]?.area, "after-sales service");
    const next = await db.followUps({ customer_id: "c-1" });
    assert.match(next[0]!.what, /has service called about "not cooling since yesterday"/);
    assert.equal(next[0]!.due_on, storeDay(1));
  } finally {
    await db.close();
  }
});

test("the pipe run is read only beside a word about the pipe or the outdoor unit", () => {
  assert.equal(pipeMetres("outdoor unit is 5 metres away"), 5);
  assert.equal(pipeMetres("copper pipe 6 m"), 6);
  assert.equal(pipeMetres("bahar ka unit 4 meter door hai"), 4);
  assert.equal(pipeMetres("room is 5 metres wide"), null, "a room is not a pipe");
  assert.equal(pipeMetres("outdoor unit on the terrace"), null);
});

test("an AC's pipe past what is included is multiplied out in code and added to the bill", () => {
  const ac = {
    ...pack.products[0]!,
    sku: "AC-1",
    name: "Lloyd 1.5 Ton 3 Star Inverter Split AC, GLS18I3ASASR",
    categories: ["Split Air Conditioners"],
    price_rupees: 38490,
  };
  const live = withAfterSales({ ...pack, products: [ac], charges: [], install_requirements: {}, offers: [] });
  const session = newSession(ASSOCIATE);
  session.customer = { id: "c-1", phone: "9876543210", name: "Vidya" };
  const run = (event: Event) => deterministic(event, session, live)!;
  run(tap("select:AC-1"));
  run(tap("sold"));
  assert.equal(session.customer.bought?.[0]?.total, 41690);
  const reply = run(said("Outdoor unit is 5 metres away, how much extra for copper pipe?"));
  assert.match(reply.text, /^Copper pipe: 5 m run, 3 m included, so 2 m extra × Rs 850 = Rs 1,700\./);
  assert.match(reply.text, /Extra copper pipe, per metre beyond 3 metres × 2 — Rs 1,700\. Total Rs 43,390/);
  assert.equal(session.customer.bought?.[0]?.total, 43390, "the card's total follows the bill");
  const shorter = run(said("actually the pipe is 2.5 m"));
  assert.match(shorter.text, /within the 3 m included/);
  assert.doesNotMatch(shorter.text, /copper pipe, per metre/i, "the extra line comes off again");
});

test("a retried sale does not raise its follow-ups twice", async () => {
  const db = await openDatabase("memory://");
  try {
    const row = { phone: ASSOCIATE, product: "LG fridge", what: "Call Asha: did it arrive?", due_on: storeDay(1) };
    await db.addFollowUps([row]);
    await db.addFollowUps([row]);
    assert.equal((await db.followUps({ phone: ASSOCIATE })).length, 1);
  } finally {
    await db.close();
  }
});
