import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { DB } from "../server/src/db.js";
import { managerRoutes } from "../server/src/manager.js";
import { newSession, type Reply, type Session } from "../server/src/types.js";

/** The confirm route messages every associate on the floor, so it is worth proving in process who
 *  can reach it. Nothing here touches WhatsApp: the stub records what would have been sent. */

const PASSWORD = "test-password";
const AUTH = `Basic ${Buffer.from(`manager:${PASSWORD}`).toString("base64")}`;
// The origin the request itself carries: a different port is a different origin, which is the
// whole point of the check.
const ORIGIN = "http://localhost";

function harness(): { app: Hono; sent: { phone: string; reply: Reply }[] } {
  const sent: { phone: string; reply: Reply }[] = [];
  const session: Session = Object.assign(newSession("919820000001"), { associate: "Ramesh" });
  const db = {
    today: async (): Promise<Session[]> => [session],
    openQuestions: async () => [],
    reachable: async (): Promise<string[]> => ["919820000001", "919820000002"],
    send: async (phone: string, reply: Reply): Promise<void> => void sent.push({ phone, reply }),
  } as unknown as DB;
  process.env.ADMIN_PASSWORD = PASSWORD;
  const app = new Hono();
  managerRoutes(app, db);
  return { app, sent };
}

function form(text: string): BodyInit {
  return new URLSearchParams({ text });
}

test("the dashboard asks for a password rather than opening", async () => {
  const { app } = harness();
  const response = await app.request("/manager");
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /^Basic/);
});

test("somebody else's page cannot send to the floor with the manager's cached credentials", async () => {
  const { app, sent } = harness();
  const response = await app.request("/manager/broadcast/confirm", {
    method: "POST",
    headers: {
      authorization: AUTH,
      origin: "https://evil.example.com",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form("free TVs for everyone, come now"),
  });
  assert.equal(response.status, 403, "a cross-origin post is refused before anything is queued");
  assert.deepEqual(sent, [], "and nothing was queued");
});

test("the manager's own click reaches every associate inside the window", async () => {
  const { app, sent } = harness();
  const response = await app.request("/manager/broadcast/confirm", {
    method: "POST",
    headers: { authorization: AUTH, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: form("TCL 55 inch is Rs 54,990 today only"),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    sent.map((entry) => entry.phone),
    ["919820000001", "919820000002"],
  );
  assert.match(sent[0]!.reply.text, /^📢 .*:\nTCL 55 inch is Rs 54,990 today only$/s);
});

test("the preview step shows who it reaches and queues nothing", async () => {
  const { app, sent } = harness();
  const response = await app.request("/manager/broadcast", {
    method: "POST",
    headers: { authorization: AUTH, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: form("two LG 65 inch left"),
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Send this to 2 associates\?/);
  assert.match(body, /Ramesh/, "the associate is named, not numbered");
  assert.deepEqual(sent, [], "a preview sends nothing");
});

test("an empty notice is not sent to anyone", async () => {
  const { app, sent } = harness();
  const response = await app.request("/manager/broadcast/confirm", {
    method: "POST",
    headers: { authorization: AUTH, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: form("   "),
  });
  assert.equal(response.status, 303);
  assert.deepEqual(sent, []);
});
