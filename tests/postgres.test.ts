import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { openDatabase, openPostgres, type DB } from "../server/src/db.js";

const url = process.env.TEST_DATABASE_URL;

async function scenario(db: DB) {
  const phone = "919820000009";
  await db.enqueue([
    { message_id: "m1", phone, message_type: "text", raw: { text: "hi" } } as never,
    { message_id: "m1", phone, message_type: "text", raw: { text: "hi" } } as never,
  ]);
  const inbox = await db.claimInbox("00000000-0000-0000-0000-000000000001");
  await db.finishInbox(inbox.message_id, "00000000-0000-0000-0000-000000000001");
  const session = await db.session(phone);
  const first = await db.commit(session, [{ text: "Ask: what size is the room?" } as never]);
  const stale = await db.commit({ ...session, version: 0 }, []);
  const outbox = await db.claimOutbox("00000000-0000-0000-0000-000000000002");
  await db.finishOutbox(outbox.id, "00000000-0000-0000-0000-000000000002", "sent", "wamid.1");
  await db.addAssociate(phone, "Asha");
  await db.logQuestion({ reference: "Q1", phone, area: "tv", owner: "Ravi", question: "VESA size?" });
  await db.queueNotice("Two LG 65 inch left", [phone]);
  return {
    claimed: inbox.message_id,
    version: (await db.session(phone)).version,
    first,
    stale,
    sentPayload: outbox.payload,
    window: await db.withinWindow(phone),
    roster: (await db.roster()).map((row) => [row.phone, row.name, !!row.lastSeen]),
    noticesWaiting: await db.noticesWaiting(),
    waiting: (await db.waitingNotices(phone)).map((row) => row.body),
    resolved: [await db.resolveQuestion("Q1"), await db.resolveQuestion("Q1")],
    today: (await db.today()).length,
    health: await db.health(),
    forget: await db.forget(phone),
    after: (await db.session(phone)).version,
  };
}

test(
  "Postgres answers exactly as PGlite does",
  { skip: !url && "set TEST_DATABASE_URL to a throwaway Postgres" },
  async () => {
    const reset = new pg.Pool({ connectionString: url });
    await reset.query("drop schema public cascade; create schema public");
    await reset.end();
    const lite = await openDatabase("memory://");
    const real = await openPostgres(url!);
    try {
      assert.deepEqual(await scenario(real), await scenario(lite));
    } finally {
      await lite.close();
      await real.close();
    }
  },
);
