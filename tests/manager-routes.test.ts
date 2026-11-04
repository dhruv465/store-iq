import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { DB, SentBroadcast } from "../server/src/db.js";
import { managerRoutes, sessionToken } from "../server/src/manager.js";
import { newSession, type Reply, type Session } from "../server/src/types.js";

const PASSWORD = "test-password";
const AUTH = `Basic ${Buffer.from(`manager:${PASSWORD}`).toString("base64")}`;
const ORIGIN = "http://localhost";

function harness(options: { reachable?: string[] } = {}): {
  app: Hono;
  sent: { phone: string; reply: Reply }[];
  removed: string[];
  held: { body: string; phones: string[] }[];
} {
  const sent: { phone: string; reply: Reply }[] = [];
  const removed: string[] = [];
  const held: { body: string; phones: string[] }[] = [];
  const history: SentBroadcast[] = [];
  const session: Session = Object.assign(newSession("919820000001"), { associate: "Ramesh" });
  const db = {
    today: async (): Promise<Session[]> => [session],
    openQuestions: async () => [],
    roster: async () => [
      { phone: "919820000001", name: "Ramesh" },
      { phone: "919820000002", name: "Asha" },
    ],
    reachable: async (): Promise<string[]> => options.reachable ?? ["919820000001", "919820000002", "919999999999"],
    send: async (phone: string, reply: Reply): Promise<void> => void sent.push({ phone, reply }),
    addAssociate: async (): Promise<void> => {},
    removeAssociate: async (phone: string): Promise<void> => void removed.push(phone),
    noticesWaiting: async (): Promise<number> => 0,
    recentVisits: async () => [
      {
        reference: "SIV-1234",
        phone: "919820000001",
        associate: "Ramesh",
        store: "Croma CBD Belapur",
        body: "the demo was better than ours",
        created_at: "2026-10-29T10:00:00.000Z",
      },
    ],
    queueNotice: async (body: string, phones: string[]): Promise<number> => {
      held.push({ body, phones });
      return 1;
    },
    resolveQuestion: async (ref: string): Promise<boolean> => ref === "SIQ-1234",
    logBroadcast: async (row: SentBroadcast): Promise<void> => void history.push(row),
    broadcasts: async (kind: string) => history.filter((row) => row.kind === kind),
  } as unknown as DB;
  process.env.ADMIN_PASSWORD = PASSWORD;
  const app = new Hono();
  managerRoutes(app, db);
  return { app, sent, removed, held };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): [string, RequestInit] {
  return [
    path,
    {
      method: "POST",
      headers: {
        authorization: AUTH,
        origin: ORIGIN,
        "content-type": "application/json",
        "x-store-iq": "portal",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  ];
}

test("the floor cannot be read without signing in", async () => {
  const { app } = harness();
  for (const path of ["/api/manager/floor", "/api/manager/roster"]) {
    const response = await app.request(path);
    assert.equal(response.status, 401, path);
  }
});

test("a signed cookie is accepted, and a forged or expired one is not", async () => {
  const { app } = harness();
  const good = sessionToken(PASSWORD, Date.now() + 60_000);
  const signedIn = await app.request("/api/manager/floor", { headers: { cookie: `storeiq_manager=${good}` } });
  assert.equal(signedIn.status, 200);

  for (const bad of [
    sessionToken("the wrong password", Date.now() + 60_000),
    sessionToken(PASSWORD, Date.now() - 1),
    `${Date.now() + 60_000}.not-a-signature`,
    "rubbish",
  ]) {
    const response = await app.request("/api/manager/floor", { headers: { cookie: `storeiq_manager=${bad}` } });
    assert.equal(response.status, 401, bad);
  }
});

test("signing in needs the password, and hands back a cookie that is not readable by script", async () => {
  const { app } = harness();
  const refused = await app.request(...post("/api/manager/login", { password: "nearly-the-password" }));
  assert.equal(refused.status, 401);

  const response = await app.request(...post("/api/manager/login", { password: PASSWORD }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^storeiq_manager=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i, "so it is never attached to somebody else's request");
});

test("somebody else's page cannot send to the floor with the manager's cached credentials", async () => {
  for (const headers of [
    { origin: "https://evil.example.com", "content-type": "application/x-www-form-urlencoded" },
    { origin: "https://evil.example.com", "x-store-iq": "" },
  ]) {
    const { app, sent } = harness();
    const response = await app.request(...post("/api/manager/broadcast", { text: "free TVs, come now" }, headers));
    assert.equal(response.status, 403, `refused before anything is queued: ${JSON.stringify(headers)}`);
    assert.deepEqual(sent, [], "and nothing was queued");
  }
});

test("even same-origin, a request that did not come from the portal is refused", async () => {
  const { app, sent } = harness();
  const response = await app.request(...post("/api/manager/broadcast", { text: "hello" }, { "x-store-iq": "" }));
  assert.equal(response.status, 403);
  assert.deepEqual(sent, []);
});

test("the floor data carries the rows, the summary and who can be reached", async () => {
  const { app } = harness();
  const response = await app.request("/api/manager/floor", { headers: { authorization: AUTH } });
  const body = (await response.json()) as Record<string, any>;
  assert.equal(response.status, 200);
  assert.equal(body.maxScore, 14);
  assert.equal(body.guide, 11);
  assert.ok(Array.isArray(body.objections), "objections heatmap is returned");
  assert.ok(Array.isArray(body.products), "product distribution is returned");
  assert.ok(Array.isArray(body.feed), "floor feed is returned");
  assert.equal(body.reachable, 2, "the stranger is not one of the manager's associates");
  assert.deepEqual(
    body.rows.map((row: any) => row.name),
    ["Ramesh", "Asha"],
  );
  assert.equal(body.rows[1].quiet, true, "Asha is on the roster and has taken nobody today");
  assert.equal(body.visits[0].store, "Croma CBD Belapur", "and the store visits the floor logged");
});

test("the preview says who it reaches and queues nothing", async () => {
  const { app, sent } = harness();
  const response = await app.request(...post("/api/manager/broadcast/preview", { text: "two LG 65 inch left" }));
  const body = (await response.json()) as Record<string, any>;
  assert.equal(response.status, 200);
  assert.deepEqual(
    body.to.map((person: any) => person.name),
    ["Ramesh", "Asha"],
  );
  assert.match(body.message, /^📢 .*:\n\ntwo LG 65 inch left$/s);
  assert.deepEqual(sent, [], "a preview sends nothing");
});

test("the manager's own click reaches every associate inside the window", async () => {
  const { app, sent } = harness();
  const response = await app.request(
    ...post("/api/manager/broadcast", { text: "TCL 55 inch is Rs 54,990 today only" }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()) as unknown, { queued: 2, waiting: 0 });
  assert.deepEqual(
    sent.map((entry) => entry.phone),
    ["919820000001", "919820000002"],
    "the stranger who messaged the number is not on the floor and is not sent to",
  );
  assert.match(sent[0]!.reply.text, /^📢 .*:\n\nTCL 55 inch is Rs 54,990 today only$/s);
});

test("a sent notice is kept in the notice history, and not in the morning brief's", async () => {
  const { app } = harness({ reachable: ["919820000001"] });
  await app.request(...post("/api/manager/broadcast", { text: "Two LG 65 inch left" }));
  const notices = (await (
    await app.request("/api/manager/broadcasts/notice", { headers: { authorization: AUTH } })
  ).json()) as any;
  assert.deepEqual(
    notices.sent.map((row: SentBroadcast) => [row.body, row.queued, row.waiting]),
    [["Two LG 65 inch left", 1, 1]],
  );
  const videos = (await (
    await app.request("/api/manager/broadcasts/video", { headers: { authorization: AUTH } })
  ).json()) as any;
  assert.deepEqual(videos.sent, []);
  assert.equal((await app.request("/api/manager/broadcasts/other", { headers: { authorization: AUTH } })).status, 404);
});

test("an empty notice is not sent to anyone", async () => {
  const { app, sent } = harness();
  const response = await app.request(...post("/api/manager/broadcast", { text: "   " }));
  assert.equal(response.status, 400);
  assert.deepEqual(sent, []);
});

test("a roster entry that is not a phone number is refused with a line the manager can act on", async () => {
  const { app } = harness();
  const response = await app.request(...post("/api/manager/roster", { name: "Ramesh", phone: "not a phone" }));
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as any).error, /country code/);
});

test("an associate is added as typed and removed by number", async () => {
  const { app, removed } = harness();
  const added = await app.request(...post("/api/manager/roster", { name: "  Sunil  ", phone: "+91 98200 00099" }));
  assert.deepEqual((await added.json()) as unknown, { ok: true, phone: "919820000099", name: "Sunil" });
  const gone = await app.request("/api/manager/roster/919820000099", {
    method: "DELETE",
    headers: { authorization: AUTH, origin: ORIGIN, "x-store-iq": "portal" },
  });
  assert.equal(gone.status, 200);
  assert.deepEqual(removed, ["919820000099"]);
});

test("an associate outside the window is held rather than dropped", async () => {
  const { app, sent, held } = harness({ reachable: ["919820000001"] });
  const response = await app.request(...post("/api/manager/broadcast", { text: "TCL 55 inch is Rs 54,990 today" }));
  assert.deepEqual((await response.json()) as unknown, { queued: 1, waiting: 1 });
  assert.deepEqual(
    sent.map((entry) => entry.phone),
    ["919820000001"],
    "Ramesh wrote today, so his goes now",
  );
  assert.deepEqual(
    held,
    [{ body: sent[0]!.reply.text, phones: ["919820000002"] }],
    "Asha's waits for her, word for word",
  );
});

test("an expert question can be marked resolved from the portal", async () => {
  const { app } = harness();
  const res = await app.request(...post("/api/manager/expert/SIQ-1234/resolve", {}));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()) as unknown, { ok: true, reference: "SIQ-1234" });

  const notFound = await app.request(...post("/api/manager/expert/SIQ-9999/resolve", {}));
  assert.equal(notFound.status, 404);
});
