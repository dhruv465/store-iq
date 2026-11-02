import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, NOTICE_LIFE_HOURS } from "../server/src/db.js";
import { deliverHeldNotices } from "../server/src/worker.js";

test("a notice waits for the associate and is released once, in order", async () => {
  const db = await openDatabase("memory://");
  try {
    await db.queueNotice("📢 Store manager:\nTCL 55 inch is Rs 54,990 today", ["919820000002"]);
    await db.queueNotice("📢 Store manager:\nTwo LG 65 inch left", ["919820000002", "919820000003"]);
    assert.equal(await db.noticesWaiting(), 3, "two notices, three people to tell");

    const waiting = await db.waitingNotices("919820000002");
    assert.deepEqual(
      waiting.map((held) => held.body.split("\n")[1]),
      ["TCL 55 inch is Rs 54,990 today", "Two LG 65 inch left"],
      "oldest first, so the floor reads the day in order",
    );

    for (const held of waiting) await db.markNoticeDelivered(held.id, "919820000002");
    assert.deepEqual(await db.waitingNotices("919820000002"), [], "and never a second time");
    assert.equal((await db.waitingNotices("919820000003")).length, 1, "the other associate still has theirs");
    assert.equal(await db.noticesWaiting(), 1);
  } finally {
    await db.close();
  }
});

test("a notice about today is not delivered tomorrow", async () => {
  const db = await openDatabase("memory://");
  try {
    await db.queueNotice("📢 Store manager:\nToday only", ["919820000002"]);
    assert.deepEqual(await db.waitingNotices("919820000002", 0), [], "a stale offer is worse than no notice");
    assert.equal(await db.noticesWaiting(0), 0, "and the manager is not told it is still pending");
    assert.equal((await db.waitingNotices("919820000002")).length, 1, "but inside the shift it is still owed");
    assert.ok(NOTICE_LIFE_HOURS >= 8, "a shift is the unit this is measured in");
  } finally {
    await db.close();
  }
});

test("the same notice is never queued twice for one associate", async () => {
  const db = await openDatabase("memory://");
  try {
    await db.queueNotice("📢 Store manager:\nSame line", ["919820000002", "919820000002"]);
    assert.equal((await db.waitingNotices("919820000002")).length, 1);
  } finally {
    await db.close();
  }
});

test("writing to the number releases what was held, before the answer to what was asked", async () => {
  const sent: string[] = [];
  const marked: [number, string][] = [];
  const db = {
    waitingNotices: async (phone: string) =>
      phone === "919820000002" ? [{ id: 7, body: "📢 Store manager:\nTCL 55 inch is Rs 54,990 today" }] : [],
    send: async (_phone: string, reply: { text: string }) => void sent.push(reply.text),
    markNoticeDelivered: async (id: number, phone: string) => void marked.push([id, phone]),
  };

  assert.equal(await deliverHeldNotices(db, "919820000002"), 1);
  assert.deepEqual(sent, ["📢 Store manager:\nTCL 55 inch is Rs 54,990 today"]);
  assert.deepEqual(marked, [[7, "919820000002"]], "marked, so it is never delivered twice");

  assert.equal(await deliverHeldNotices(db, "919820000001"), 0, "nothing held, nothing sent");
  assert.equal(sent.length, 1);
});

test("forgetting one number takes everything of theirs and nothing of anybody else's", async () => {
  const db = await openDatabase("memory://");
  try {
    await db.addAssociate("919820000001", "Ramesh");
    await db.addAssociate("919820000002", "Asha");
    await db.queueNotice("📢 Store manager:\nTCL 55 inch today", ["919820000001", "919820000002"]);
    await db.logQuestion({
      reference: "SIQ-1234",
      phone: "919820000001",
      area: "installation and site survey",
      owner: "Suresh",
      question: "wall type?",
    });

    const deleted = await db.forget("919820000001");
    assert.equal(deleted.associates, 1);
    assert.equal(deleted.expert_questions, 1);
    assert.equal(deleted.notice_deliveries, 1);

    assert.deepEqual(
      (await db.roster()).map((person) => person.name),
      ["Asha"],
      "the other associate is untouched",
    );
    assert.equal((await db.waitingNotices("919820000002")).length, 1, "and still owed her notice");
    assert.deepEqual(await db.openQuestions(), []);
    await assert.rejects(db.forget("not-a-phone"), /Not a phone number/, "and it is never a pattern");
  } finally {
    await db.close();
  }
});
