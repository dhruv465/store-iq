import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack, bandHolds } from "../server/src/pack.js";
import { decide, deterministic } from "../server/src/brain.js";
import { openDatabase } from "../server/src/db.js";
import {
  afterSalesData,
  chargesCsv,
  chargesList,
  pipeMetres,
  readChargesCsv,
  setAfterSalesData,
  storeDay,
  wantsSold,
  withAfterSales,
} from "../server/src/aftersales.js";
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

test("asked by number, the home card is who they are, the last purchase and a count, with history a tap away", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = { id: "3f9a2c1e-0000-4000-8000-000000000001", phone: "9876543210", name: "Vidya Sathe" };
    await decide(tap("select:TCL-55C6KS"), session, pack, manager({}).fetch, db);
    await decide(tap("sold"), session, pack, manager({}).fetch, db);
    session.customer.bought = [
      { sku: "old", name: "LG 7 Kg Washing Machine, Silver", total: 31990, on: "2026-06-01" },
      ...(session.customer.bought ?? []),
    ];
    await db.commit(session, []);
    await decide(tap("new_customer"), session, pack, manager({}).fetch, db);

    const model = manager({ lines: ["I can't access previous purchase history."] });
    const card = await decide(said("What's 9876543210's home card"), session, pack, model.fetch, db);
    const text = card.text.replace(/\*/g, "");
    assert.equal(model.prompts.length, 0, "the card is the code's, not the model's");
    assert.match(text, /^Vidya Sathe · 98765 43210 · ID C-3F9A2C1E\n+/);
    assert.match(text, /Last bought: TCL 55 inch C6K QD-Mini LED, Rs 54,990 \(\d+ \w+ \d{4}\) · 1 more on file/);
    assert.doesNotMatch(text, /LG 7 Kg/, "the card shows the last purchase, not the whole history");
    assert.deepEqual(
      card.buttons?.map((button) => button.id),
      ["cust:history", "cust:problem", "followups:customer"],
    );

    const history = await decide(tap("cust:history"), session, pack, model.fetch, db);
    assert.match(
      history.text.replace(/\*/g, ""),
      /^1\. TCL 55 inch C6K QD-Mini LED, Rs 54,990 · .*\n+2\. LG 7 Kg Washing Machine, Rs 31,990 · 1 Jun 2026/,
    );
    // The words the model used to fail on, with her card open.
    const again = await decide(said("Previous purchases"), session, pack, model.fetch, db);
    assert.match(again.text, /LG 7 Kg Washing Machine/);
    assert.equal(model.prompts.length, 0);
  } finally {
    await db.close();
  }
});

test("asked by name, a customer's card is not opened: the number is asked for, since names repeat", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = { id: "c-1", phone: "9876543210", name: "Rahul Shah" };
    await db.commit(session, []);
    delete session.customer;
    const model = manager({});
    const reply = await decide(said("show Rahul Shah's home card"), session, pack, model.fetch, db);
    assert.match(reply.text, /^Send me the mobile number Rahul Shah gave\. Names repeat, numbers do not\./);
    assert.equal(model.prompts.length, 0);
    const opened = () => session.customer;
    assert.equal(opened(), undefined, "a name alone opens nothing");
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

test("the store's charges CSV replaces a category's sample rates, and a bad row saves nothing", () => {
  const fridge = {
    ...pack.products[0]!,
    sku: "F-1",
    name: "LG 343 L Refrigerator",
    categories: ["Refrigerators"],
    price_rupees: 40000,
  };
  const csv = [
    "category,charge,amount,on every bill,per metre beyond",
    'refrigerator,"Delivery, within 10 km",0,yes,',
    "Refrigerator,Installation and demo,Rs 250,yes,",
    'fridge,Stabiliser,"1,999",no,',
  ].join("\r\n");
  const read = readChargesCsv(csv);
  assert.ok("data" in read, JSON.stringify(read));
  const fridges = read.data.categories.find((category) => category.kind === "refrigerator")!;
  assert.equal(fridges.sample, false);
  assert.deepEqual(
    fridges.charges.map((charge) => [charge.title, charge.amount_rupees, !!charge.default]),
    [
      ["Delivery, within 10 km", 0, true],
      ["Installation and demo", 250, true],
      ["Stabiliser", 1999, false],
    ],
  );
  assert.ok(
    read.data.categories.find((category) => category.kind === "air conditioner")!.charges.length > 1,
    "the AC keeps its list",
  );
  try {
    setAfterSalesData(read.data);
    const live = withAfterSales({ ...pack, products: [fridge], charges: [], install_requirements: {}, offers: [] });
    const list = chargesList(live, fridge, "en");
    assert.match(list, /Installation and demo Rs 250/);
    assert.doesNotMatch(list, /Sample rates/, "the store's own list is not called a sample");
    assert.match(
      chargesCsv(),
      /^category,charge,amount,on every bill,per metre beyond\nrefrigerator,"Delivery, within 10 km",0,yes,\n/,
    );
  } finally {
    setAfterSalesData(null);
  }
  assert.equal(afterSalesData().sample, true, "back to the file");

  const bad = readChargesCsv("microwave,Delivery,0,yes,\nrefrigerator,Delivery,free,yes,\nrefrigerator,,10,no,");
  assert.ok("errors" in bad);
  assert.deepEqual(
    bad.errors.map((error) => error.split(":")[0]),
    ["Row 1", "Row 2", "Row 3"],
  );
  assert.ok(
    "errors" in readChargesCsv("category,charge,amount,on every bill,per metre beyond\n"),
    "an empty list is refused",
  );
});

test("the downloaded CSV reads back to the same charges", () => {
  const read = readChargesCsv(chargesCsv());
  assert.ok("data" in read);
  for (const [index, category] of afterSalesData().categories.entries())
    assert.deepEqual(read.data.categories[index]!.charges, category.charges, category.kind);
});

test("a saved setting comes back after it is written again", async () => {
  const db = await openDatabase("memory://");
  try {
    assert.equal(await db.setting("aftersales"), null);
    await db.saveSetting("aftersales", { categories: [] });
    await db.saveSetting("aftersales", { categories: [{ kind: "x" }] });
    assert.deepEqual(await db.setting("aftersales"), { categories: [{ kind: "x" }] });
  } finally {
    await db.close();
  }
});

test("on Render the floor's memory must be Postgres, so a deploy cannot forget it", async () => {
  const { storeKind } = await import("../server/src/db.js");
  assert.throws(() => storeKind({ RENDER: "true", LOCAL_DB_PATH: "memory://" }), /DATABASE_URL is not set on Render/);
  assert.throws(() => storeKind({ RENDER: "true", DATABASE_URL: "  " }), /DATABASE_URL/);
  assert.equal(storeKind({ RENDER: "true", DATABASE_URL: "postgres://x" }), "postgres");
  assert.equal(storeKind({ LOCAL_DB_PATH: "memory://" }), "memory", "a local run may stay in memory");
  assert.equal(storeKind({}), "disk");
});

test("an expert question is answered once, and the answer is kept with it", async () => {
  const db = await openDatabase("memory://");
  try {
    await db.logQuestion({
      reference: "SIQ-1111",
      phone: ASSOCIATE,
      area: "ac",
      owner: "AC specialist",
      question: "stabiliser?",
    });
    assert.deepEqual(await db.answerQuestion("SIQ-1111", "Yes"), { phone: ASSOCIATE, question: "stabiliser?" });
    assert.equal(await db.answerQuestion("SIQ-1111", "again"), null, "not twice");
    assert.equal((await db.openQuestions()).length, 0);
  } finally {
    await db.close();
  }
});

test("Sold before take-or-deliver asks it, asks for the home card, and the follow-ups wait for the answer", async () => {
  const live = withAfterSales({ ...pack, charges: [], install_requirements: {} });
  for (const [answer, expected] of [
    ["deliver:LTV-DEL", 3],
    ["deliver:carry", 2],
  ] as const) {
    const db = await openDatabase("memory://");
    try {
      const session = await db.session(ASSOCIATE);
      await decide(tap("select:TCL-55C6KS"), session, live, manager({}).fetch, db);
      const sold = await decide(tap("sold"), session, live, manager({}).fetch, db);
      const text = sold.text.replace(/\*/g, "");
      assert.match(text, /🎉/);
      assert.match(text, /Shall I save this on the customer's home card\? Send me their name and mobile number\./);
      assert.match(text, /Will you take it with you, or shall we deliver it home\?/);
      assert.deepEqual(
        sold.buttons?.map((button) => button.id),
        ["deliver:yes", "deliver:carry", "summary:customer"],
      );
      assert.equal((await db.followUps({ phone: ASSOCIATE })).length, 0, "nothing set before it is answered");

      const next = await decide(tap(answer), session, live, manager({}).fetch, db);
      assert.match(next.text, /Before I book the installer/, "then the site, as before");
      const set = await db.followUps({ phone: ASSOCIATE });
      assert.equal(set.length, expected, answer);
      assert.equal(
        set.some((row) => /arrive/.test(row.what)),
        answer !== "deliver:carry",
        "no delivery call for a carry",
      );
      await decide(tap("site:ok"), session, live, manager({}).fetch, db);
      assert.equal((await db.followUps({ phone: ASSOCIATE })).length, expected, "set once, not on every tap");
    } finally {
      await db.close();
    }
  }
});

test("a sale with a home card already open does not ask for one", async () => {
  const db = await openDatabase("memory://");
  try {
    const session = await db.session(ASSOCIATE);
    session.customer = { id: "c-9", phone: "9876543210", name: "Vidya" };
    await decide(tap("select:TCL-55C6KS"), session, pack, manager({}).fetch, db);
    const sold = await decide(tap("sold"), session, pack, manager({}).fetch, db);
    assert.doesNotMatch(sold.text, /home card/);
  } finally {
    await db.close();
  }
});
