import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { openDatabase, type DB } from "../server/src/db.js";
import { managerRoutes } from "../server/src/manager.js";
import { HINDI_UNDER_100, spokenScript, writeScript } from "../server/src/video.js";
import { sendWhatsApp } from "../server/src/whatsapp.js";
import { deliverHeldNotices } from "../server/src/worker.js";
import type { Reply } from "../server/src/types.js";

const VIDEO = "https://v3.fal.media/files/brief.mp4";

function answers(...outputs: string[]): { fetch: typeof fetch; prompts: string[] } {
  const prompts: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    prompts.push(JSON.parse(String(init.body)).prompt);
    return Response.json({ output: outputs[prompts.length - 1] ?? outputs.at(-1), usage: { cost: 0.001 } });
  }) as unknown as typeof fetch;
  return { fetch: fetcher, prompts };
}

const config = { key: "k", model: "m" };
const brief = "Diwali offers today: LG 55 inch OLED at Rs 54,990, 10% off on Samsung soundbars.";

test("a figure the manager did not write is refused, and refused twice nothing is made", async () => {
  const { fetch: twice, prompts } = answers("Team, the LG OLED is Rs 49,990 today!");
  await assert.rejects(() => writeScript(config, brief, twice), /not in your brief \(49990\)/);
  assert.equal(prompts.length, 2, "one retry, no more");
  assert.match(prompts[1]!, /You wrote 49990/, "the retry names the figure");

  const { fetch: fixed } = answers(
    "Team, the LG OLED is Rs 49,990 today!",
    "Team, the LG 55 inch OLED is Rs 54,990 today, and Samsung soundbars are 10% off. Let's go!",
  );
  const { script } = await writeScript(config, brief, fixed);
  assert.match(script, /Rs 54,990/);
});

test("a video goes to WhatsApp as a video with its caption, and a bad one never leaves", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    WHATSAPP_GRAPH_VERSION: "v21.0",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_ACCESS_TOKEN: "t",
  });
  try {
    const bodies: any[] = [];
    const meta = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ messages: [{ id: "wamid.1" }] });
    }) as unknown as typeof fetch;
    await sendWhatsApp("919820000001", { text: "Today's brief", video: VIDEO }, meta);
    assert.deepEqual(bodies[0].video, { link: VIDEO, caption: "Today's brief" });
    assert.equal(bodies[0].type, "video");

    for (const reply of [
      { text: "x", video: "http://v3.fal.media/brief.mp4" },
      { text: "x", video: "not a url" },
      { text: "x".repeat(1025), video: VIDEO },
      { text: "x", video: VIDEO, buttons: [{ id: "a", title: "A" }] },
    ] as Reply[])
      await assert.rejects(() => sendWhatsApp("919820000001", reply, meta), /Invalid WhatsApp reply/);
    assert.equal(bodies.length, 1, "nothing invalid was posted");
  } finally {
    process.env = saved;
  }
});

/** fal, faked end to end: the script, the voice, and lipsync-2 through the queue. */
const falBodies: Record<string, any> = {};
const fal = (async (url: string, init?: RequestInit) => {
  if (typeof init?.body === "string") falBodies[url] = JSON.parse(init.body);
  if (url === "https://fal.run/openrouter/router")
    return Response.json({ output: "Team, LG 55 inch OLED Rs 54,990 aaj. Chalo!", usage: { cost: 0.001 } });
  if (url.startsWith("https://fal.run/fal-ai/elevenlabs/")) return Response.json({ audio: { url: "https://x/a.mp3" } });
  if (url === "https://queue.fal.run/fal-ai/sync-lipsync/v2")
    return Response.json({
      status_url: "https://queue.fal.run/fal-ai/sync-lipsync/requests/r1/status",
      response_url: "https://queue.fal.run/fal-ai/sync-lipsync/requests/r1",
    });
  if (url.endsWith("/r1/status")) return Response.json({ status: "COMPLETED" });
  if (url.endsWith("/r1")) return Response.json({ video: { url: VIDEO, file_size: 3_000_000 }, duration: 30 });
  throw Error(`unexpected ${url}`);
}) as unknown as typeof fetch;

test("the video goes only on approval, now to who can be reached and held for who cannot", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { ADMIN_PASSWORD: "pw", FAL_KEY: "k", PRESENTER_VIDEO_URL: "https://x/p.mp4" });
  const sent: { phone: string; reply: Reply }[] = [];
  const held: { body: string; phones: string[]; video?: string | undefined }[] = [];
  const db = {
    roster: async () => [
      { phone: "919820000001", name: "Ramesh" },
      { phone: "919820000002", name: "Asha" },
    ],
    reachable: async () => ["919820000001"],
    today: async () => [],
    send: async (phone: string, reply: Reply) => void sent.push({ phone, reply }),
    queueNotice: async (body: string, phones: string[], video?: string) => held.push({ body, phones, video }),
  } as unknown as DB;
  const app = new Hono();
  managerRoutes(app, db, undefined, fal);
  const headers = {
    authorization: `Basic ${Buffer.from("manager:pw").toString("base64")}`,
    origin: "http://localhost",
    "content-type": "application/json",
    "x-store-iq": "portal",
  };
  const call = (path: string, body?: unknown, method = "POST") =>
    app.request(`/api/manager/video-brief${path}`, { method, headers, body: JSON.stringify(body) });
  try {
    assert.equal((await call("", { brief: "LG 55 inch OLED Rs 54,990 today" })).status, 200);
    let view: any;
    for (let tick = 0; tick < 50 && view?.job?.status !== "ready"; tick++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      view = await (await app.request("/api/manager/video-brief", { headers })).json();
    }
    assert.equal(view.job.status, "ready");
    assert.equal(view.job.video, VIDEO);
    assert.equal(falBodies["https://fal.run/fal-ai/elevenlabs/tts/turbo-v2.5"].voice, "7b9mYhmnp0y2qSH1FnBL");
    assert.equal(falBodies["https://fal.run/fal-ai/elevenlabs/tts/turbo-v2.5"].language_code, "hi", "always Hindi");
    assert.equal(
      falBodies["https://queue.fal.run/fal-ai/sync-lipsync/v2"].video_url,
      "https://x/p.mp4",
      "lips on the clip",
    );
    assert.deepEqual(view.to, [{ phone: "919820000001", name: "Ramesh" }], "the manager sees who before sending");
    assert.equal(sent.length, 0, "and nothing has gone yet");

    assert.equal((await call("/send", { video: "https://v3.fal.media/other.mp4" })).status, 409, "not one unseen");
    const approved = await call("/send", { video: VIDEO });
    assert.deepEqual(await approved.json(), { queued: 1, waiting: 1 });
    assert.deepEqual(
      sent.map(({ phone, reply }) => [phone, reply.video]),
      [["919820000001", VIDEO]],
    );
    assert.match(sent[0]!.reply.text, /Today's video brief[\s\S]*Rs 54,990/);
    assert.deepEqual(held, [{ body: sent[0]!.reply.text, phones: ["919820000002"], video: VIDEO }]);
    assert.equal((await call("/send", { video: VIDEO })).status, 409, "and only once");
  } finally {
    process.env = saved;
  }
});

test("a held video reaches the associate when they next write", async () => {
  const db = await openDatabase("memory://");
  try {
    await db.queueNotice("📢 Store manager:\n🎬 Today's video brief", ["919820000002"], VIDEO);
    const sent: Reply[] = [];
    await deliverHeldNotices(
      {
        waitingNotices: (phone) => db.waitingNotices(phone),
        markNoticeDelivered: (id, phone) => db.markNoticeDelivered(id, phone),
        send: async (_phone, reply) => void sent.push(reply),
      },
      "919820000002",
    );
    assert.equal(sent[0]!.video, VIDEO);
    assert.deepEqual(await db.waitingNotices("919820000002"), []);
  } finally {
    await db.close();
  }
});

test("the voice says prices and percentages in English, a number before a Hindi word in Hindi, and the caption keeps Rs", () => {
  assert.equal(
    spokenScript(
      "LG 55 inch OLED पर Rs 1,19,990, SBI card पर 10% instant off. Sony Rs. 89,990/- में, 12 महीने तक no cost EMI.",
    ),
    "LG fifty-five inch OLED पर one lakh nineteen thousand nine hundred ninety rupees, SBI card पर ten percent instant off. " +
      "Sony eighty-nine thousand nine hundred ninety rupees में, बारह महीने तक no cost EMI.",
  );
  assert.equal(
    spokenScript("Rs 1,00,000 और Rs 2,50,00,000, ₹999, 7.5% cashback, buy 1 get 1 है"),
    "one lakh rupees और two crore fifty lakh rupees, nine hundred ninety-nine rupees, seven point five percent cashback, buy one get one है",
  );
  assert.equal(
    spokenScript("iPhone 16 पर exchange, Galaxy S25 और 4K TV, सिर्फ 3 दिन, 1,19,990 लोग, 45 मिनट"),
    "iPhone sixteen पर exchange, Galaxy S25 और 4K TV, सिर्फ तीन दिन, एक लाख उन्नीस हज़ार नौ सौ नब्बे लोग, पैंतालीस मिनट",
    "a model name stays English and a model code is left alone",
  );
  assert.equal(HINDI_UNDER_100.length, 100, "one Hindi word for each of 0 to 99");
  assert.equal(HINDI_UNDER_100[99], "निन्यानबे");
});
