import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { DB, SentBroadcast } from "../server/src/db.js";
import { managerRoutes } from "../server/src/manager.js";
import { setAfterSalesData } from "../server/src/aftersales.js";
import { newSession, type Reply, type Session } from "../server/src/types.js";

const PASSWORD = "test-password";
// The session cookie of the last harness to sign in; the tests in a file run one after another.
let AUTH = "";
const ORIGIN = "http://localhost";
const settings = new Map<string, unknown>();

async function harness(options: { reachable?: string[] } = {}): Promise<{
  app: Hono;
  sent: { phone: string; reply: Reply }[];
  removed: string[];
  held: { body: string; phones: string[] }[];
}> {
  const sent: { phone: string; reply: Reply }[] = [];
  settings.clear();
  const removed: string[] = [];
  const held: { body: string; phones: string[] }[] = [];
  const history: SentBroadcast[] = [];
  const session: Session = Object.assign(newSession("919820000001"), { associate: "Ramesh" });
  const db = {
    today: async (): Promise<Session[]> => [session],
    allConversations: async (): Promise<Session[]> => [session],
    openQuestions: async () => [
      {
        reference: "SIQ-4321",
        area: "air conditioners",
        owner: "AC specialist",
        phone: "919820000002",
        question: "does the AC need a stabiliser?",
        asked_at: "2026-11-06T05:00:00.000Z",
      },
    ],
    answerQuestion: async (ref: string, answer: string) =>
      ref === "SIQ-4321" || ref === "SIQ-7777"
        ? { phone: ref === "SIQ-4321" ? "919820000002" : "919820000009", question: `asked ${answer.length}` }
        : null,
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
    followUps: async () => [
      {
        id: 7,
        phone: "919820000001",
        owner: null,
        what: "Call Asha: did the fridge arrive?",
        due_on: "2000-01-01",
        customer_name: "Asha",
        product: "LG fridge",
      },
      {
        id: 8,
        phone: "919820000002",
        owner: null,
        what: "Call Ravi: is the AC working?",
        due_on: "2999-01-01",
        customer_name: "Ravi",
        product: "AC",
      },
    ],
    doneFollowUp: async (id: number, phone: string | null) => (id === 7 && phone === null ? { id: 7 } : null),
    logBroadcast: async (row: SentBroadcast): Promise<void> => void history.push(row),
    broadcasts: async (kind: string) => history.filter((row) => row.kind === kind),
    spendTotals: async () => ({ today: 0.0123, total: 0.5, since: "2026-11-03", kinds: { model: 0.5 } }),
    saveSetting: async (key: string, value: unknown): Promise<void> => void settings.set(key, value),
  } as unknown as DB;
  process.env.ADMIN_PASSWORD = PASSWORD;
  const app = new Hono();
  managerRoutes(app, db);
  AUTH = await signIn(app);
  return { app, sent, removed, held };
}

async function signIn(app: Hono, headers: Record<string, string> = {}): Promise<string> {
  const response = await app.request(
    ...post("/api/manager/login", { username: "manager", password: PASSWORD }, headers),
  );
  assert.equal(response.status, 200);
  return (response.headers.get("set-cookie") ?? "").split(";")[0]!;
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): [string, RequestInit] {
  return [
    path,
    {
      method: "POST",
      headers: {
        cookie: AUTH,
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
  const { app } = await harness();
  for (const path of ["/api/manager/floor", "/api/manager/roster"]) {
    const response = await app.request(path);
    assert.equal(response.status, 401, path);
  }
});

test("a session cookie is accepted, and a made-up one or Basic auth is not", async () => {
  const { app } = await harness();
  const signedIn = await app.request("/api/manager/floor", { headers: { cookie: AUTH } });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.headers.get("cache-control"), "no-store");
  assert.equal(signedIn.headers.get("x-frame-options"), "DENY");

  for (const bad of ["storeiq_manager=rubbish", `storeiq_manager=${AUTH.split("=")[1]}x`]) {
    const response = await app.request("/api/manager/floor", { headers: { cookie: bad } });
    assert.equal(response.status, 401, bad);
  }
  const basic = await app.request("/api/manager/floor", {
    headers: { authorization: `Basic ${Buffer.from(`manager:${PASSWORD}`).toString("base64")}` },
  });
  assert.equal(basic.status, 401);
  assert.equal(basic.headers.get("www-authenticate"), null, "so the browser never caches a password prompt");
});

test("logging out ends the session on the server, so the old cookie is refused", async () => {
  const { app } = await harness();
  const out = await app.request(...post("/api/manager/logout", {}));
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  const after = await app.request("/api/manager/floor", { headers: { cookie: AUTH } });
  assert.equal(after.status, 401);
});

test("a session ends by itself after 12 hours", async (t) => {
  const { app } = await harness();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.tick(12 * 60 * 60 * 1000 - 1000);
  assert.equal((await app.request("/api/manager/floor", { headers: { cookie: AUTH } })).status, 200);
  t.mock.timers.tick(1000);
  assert.equal((await app.request("/api/manager/floor", { headers: { cookie: AUTH } })).status, 401);
});

test("five wrong tries from one address lock it out for a while, and others are not", async () => {
  const { app } = await harness();
  const from = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await app.request(...post("/api/manager/login", { username: "manager", password: "no" }, from));
    assert.equal(response.status, 401, `try ${attempt}`);
  }
  const locked = await app.request(...post("/api/manager/login", { username: "manager", password: PASSWORD }, from));
  assert.equal(locked.status, 429, "even the right password waits");
  assert.match(((await locked.json()) as any).error, /Wait 15 minutes/);
  await signIn(app, { "x-forwarded-for": "198.51.100.4" });
});

test("an address the client writes into x-forwarded-for does not dodge the lockout", async () => {
  const { app } = await harness();
  for (let attempt = 1; attempt <= 5; attempt++)
    await app.request(
      ...post(
        "/api/manager/login",
        { username: "manager", password: "no" },
        { "x-forwarded-for": `192.0.2.${attempt}, 10.0.0.7` },
      ),
    );
  const locked = await app.request(
    ...post(
      "/api/manager/login",
      { username: "manager", password: PASSWORD },
      { "x-forwarded-for": "192.0.2.99, 10.0.0.7" },
    ),
  );
  assert.equal(locked.status, 429, "the proxy's own address is what counts");
});

test("thirty wrong tries across many addresses close sign-in for everyone for a while", async () => {
  const { app } = await harness();
  for (let attempt = 1; attempt <= 30; attempt++)
    await app.request(
      ...post(
        "/api/manager/login",
        { username: "manager", password: "no" },
        { "x-forwarded-for": `10.1.0.${attempt}` },
      ),
    );
  const locked = await app.request(
    ...post("/api/manager/login", { username: "manager", password: PASSWORD }, { "x-forwarded-for": "10.2.0.1" }),
  );
  assert.equal(locked.status, 429);
});

test("signing in needs the username and the password, and hands back a cookie script cannot read", async () => {
  const { app } = await harness();
  for (const wrong of [
    { username: "manager", password: "nearly-the-password" },
    { username: "admin", password: PASSWORD },
    { password: PASSWORD },
  ]) {
    const refused = await app.request(...post("/api/manager/login", wrong));
    assert.equal(refused.status, 401, JSON.stringify(wrong));
    assert.equal(((await refused.json()) as any).error, "That username and password do not match.");
  }

  const response = await app.request(...post("/api/manager/login", { username: "manager", password: PASSWORD }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^storeiq_manager=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i, "so it is never attached to somebody else's request");
  assert.doesNotMatch(cookie, /Secure/i, "plain http on localhost");

  const behindProxy = await app.request(
    ...post("/api/manager/login", { username: "manager", password: PASSWORD }, { "x-forwarded-proto": "https" }),
  );
  assert.match(behindProxy.headers.get("set-cookie") ?? "", /Secure/i, "https at Render's proxy");
});

test("somebody else's page cannot send to the floor with the manager's cached credentials", async () => {
  for (const headers of [
    { origin: "https://evil.example.com", "content-type": "application/x-www-form-urlencoded" },
    { origin: "https://evil.example.com", "x-store-iq": "" },
  ]) {
    const { app, sent } = await harness();
    const response = await app.request(...post("/api/manager/broadcast", { text: "free TVs, come now" }, headers));
    assert.equal(response.status, 403, `refused before anything is queued: ${JSON.stringify(headers)}`);
    assert.deepEqual(sent, [], "and nothing was queued");
  }
});

test("even same-origin, a request that did not come from the portal is refused", async () => {
  const { app, sent } = await harness();
  const response = await app.request(...post("/api/manager/broadcast", { text: "hello" }, { "x-store-iq": "" }));
  assert.equal(response.status, 403);
  assert.deepEqual(sent, []);
});

test("the floor data carries the rows, the summary and who can be reached", async () => {
  const { app } = await harness();
  const response = await app.request("/api/manager/floor", { headers: { cookie: AUTH } });
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
  const { app, sent } = await harness();
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
  const { app, sent } = await harness();
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
  const { app } = await harness({ reachable: ["919820000001"] });
  await app.request(...post("/api/manager/broadcast", { text: "Two LG 65 inch left" }));
  const notices = (await (
    await app.request("/api/manager/broadcasts/notice", { headers: { cookie: AUTH } })
  ).json()) as any;
  assert.deepEqual(
    notices.sent.map((row: SentBroadcast) => [row.body, row.queued, row.waiting]),
    [["Two LG 65 inch left", 1, 1]],
  );
  const videos = (await (
    await app.request("/api/manager/broadcasts/video", { headers: { cookie: AUTH } })
  ).json()) as any;
  assert.deepEqual(videos.sent, []);
  assert.equal((await app.request("/api/manager/broadcasts/other", { headers: { cookie: AUTH } })).status, 404);
});

test("an empty notice is not sent to anyone", async () => {
  const { app, sent } = await harness();
  const response = await app.request(...post("/api/manager/broadcast", { text: "   " }));
  assert.equal(response.status, 400);
  assert.deepEqual(sent, []);
});

test("a roster entry that is not a phone number is refused with a line the manager can act on", async () => {
  const { app } = await harness();
  const response = await app.request(...post("/api/manager/roster", { name: "Ramesh", phone: "not a phone" }));
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as any).error, /country code/);
});

test("an associate is added as typed and removed by number", async () => {
  const { app, removed } = await harness();
  const added = await app.request(...post("/api/manager/roster", { name: "  Sunil  ", phone: "+91 98200 00099" }));
  assert.deepEqual((await added.json()) as unknown, { ok: true, phone: "919820000099", name: "Sunil" });
  const gone = await app.request("/api/manager/roster/919820000099", {
    method: "DELETE",
    headers: { cookie: AUTH, origin: ORIGIN, "x-store-iq": "portal" },
  });
  assert.equal(gone.status, 200);
  assert.deepEqual(removed, ["919820000099"]);
});

test("an associate outside the window is held rather than dropped", async () => {
  const { app, sent, held } = await harness({ reachable: ["919820000001"] });
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
  const { app } = await harness();
  const res = await app.request(...post("/api/manager/expert/SIQ-1234/resolve", {}));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()) as unknown, { ok: true, reference: "SIQ-1234" });

  const notFound = await app.request(...post("/api/manager/expert/SIQ-9999/resolve", {}));
  assert.equal(notFound.status, 404);
});

test("the floor carries every open after-sales check-back, overdue first, under its owner's name", async () => {
  const { app } = await harness();
  const floor = (await (await app.request("/api/manager/floor", { headers: { cookie: AUTH } })).json()) as {
    followUps: { id: number; associate: string; overdue: boolean; due: boolean }[];
  };
  assert.deepEqual(
    floor.followUps.map((row) => [row.id, row.associate, row.overdue, row.due]),
    [
      [7, "Ramesh", true, true],
      [8, "Asha", false, false],
    ],
  );
  assert.ok(!JSON.stringify(floor.followUps).includes("customer_phone"), "no customer's number in the portal");
});

test("the manager can close any follow-up from the portal", async () => {
  const { app } = await harness();
  const res = await app.request(...post("/api/manager/followup/7/done", {}));
  assert.equal(res.status, 200);
  assert.equal((await app.request(...post("/api/manager/followup/9/done", {}))).status, 404);
  assert.equal((await app.request(...post("/api/manager/followup/abc/done", {}))).status, 400);
});

test("the manager uploads the store's charges: a bad file saves nothing, a good one is saved and quoted", async () => {
  const { app } = await harness();
  try {
    const before = await (await app.request("/api/manager/charges", { headers: { cookie: AUTH } })).json();
    assert.ok(before.categories.every((category: { sample: boolean }) => category.sample));
    assert.match(before.csv, /^category,charge,amount,on every bill,per metre beyond\n/);

    const bad = await app.request(...post("/api/manager/charges", { csv: "refrigerator,Delivery,free,yes," }));
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /^Nothing was saved\.\nRow 1: "free" is not an amount/);
    assert.equal(settings.size, 0);
    assert.equal((await app.request(...post("/api/manager/charges", {}))).status, 400);

    const good = await app.request(...post("/api/manager/charges", { csv: "refrigerator,Delivery,150,yes," }));
    assert.equal(good.status, 200);
    const fridge = (await good.json()).categories.find(
      (category: { kind: string }) => category.kind === "refrigerator",
    );
    assert.deepEqual(fridge, {
      kind: "refrigerator",
      sample: false,
      charges: [{ title: "Delivery", amount_rupees: 150, every: true, per_metre_beyond: null }],
    });
    assert.ok(settings.has("aftersales"), "kept in the database for the next start");
    assert.equal((await app.request("/api/manager/charges")).status, 401, "not without signing in");
  } finally {
    setAfterSalesData(null);
  }
});

test("the expert's answer goes to the associate who asked, now inside the window or when they next write", async () => {
  const { app, sent, held } = await harness();
  const floor = await (await app.request("/api/manager/floor", { headers: { cookie: AUTH } })).json();
  assert.equal(floor.openQuestions[0].associate, "Asha", "the portal names who asked");
  assert.equal(floor.openQuestions[0].phone, "919820000002");

  const res = await app.request(
    ...post("/api/manager/expert/SIQ-4321/answer", { answer: "Yes, take the V-Guard one." }),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).delivered, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.phone, "919820000002");
  assert.match(sent[0]!.reply.text, /answered SIQ-4321\*\n\nYou asked: "asked 26"\n\nYes, take the V-Guard one\.$/);

  // Not written to us in 24 hours: held like a notice, never sent outside Meta's window.
  const waiting = await app.request(...post("/api/manager/expert/SIQ-7777/answer", { answer: "No." }));
  assert.equal((await waiting.json()).delivered, "waiting");
  assert.equal(sent.length, 1);
  assert.deepEqual(held.at(-1)!.phones, ["919820000009"]);

  assert.equal((await app.request(...post("/api/manager/expert/SIQ-4321/answer", { answer: "  " }))).status, 400);
  assert.equal((await app.request(...post("/api/manager/expert/SIQ-0000/answer", { answer: "x" }))).status, 404);
  assert.equal(
    (await app.request(...post("/api/manager/expert/SIQ-4321/answer", { answer: "x".repeat(901) }))).status,
    400,
  );
});
