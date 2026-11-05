import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { openDatabase, type DB } from "../server/src/db.js";
import { managerRoutes } from "../server/src/manager.js";
import { HINDI_UNDER_100, addedToScript, clipLines, repeated, spokenScript, writeScript } from "../server/src/video.js";
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

/** fal, faked end to end: the script, a clip for each piece of it through the queue, and the join. */
const SCRIPT =
  "Good morning team, aaj ka din bada hai aur floor par sabko taiyaar rehna hai. " +
  "LG 55 inch OLED Rs 54,990 mein aaj se mil raha hai, har customer ko demo dikhao. " +
  "Chalo, shaandaar din banate hain, sab log full energy ke saath!";
const falBodies: Record<string, any[]> = {};
let clipsAsked = 0;
const fal = (async (url: string, init?: RequestInit) => {
  if (typeof init?.body === "string") (falBodies[url] ??= []).push(JSON.parse(init.body));
  if (url === "https://fal.run/openrouter/router")
    return Response.json({
      // the script, or the check of what the presenter said against it
      output: String(init?.body).includes("WHAT HE SAID") ? '{"added": []}' : SCRIPT,
      usage: { cost: 0.001 },
    });
  if (url === VIDEO) return new Response(new Uint8Array([0, 0, 0, 24]));
  if (url.includes("storage/upload/initiate"))
    return Response.json({ upload_url: "https://v3b.fal.media/u", file_url: "https://v3b.fal.media/heard" });
  if (url === "https://v3b.fal.media/u") return new Response(null);
  if (url === "https://fal.run/fal-ai/elevenlabs/speech-to-text") return Response.json({ text: SCRIPT });
  const queued = (id: string) =>
    Response.json({
      status_url: `https://queue.fal.run/requests/${id}/status`,
      response_url: `https://queue.fal.run/requests/${id}`,
    });
  if (url === "https://queue.fal.run/google/gemini-omni-flash/v1.1/image-to-video") return queued(`c${++clipsAsked}`);
  if (url === "https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos") return queued("join");
  if (url === "https://queue.fal.run/fal-ai/ffmpeg-api/extract-frame")
    return queued(`f${JSON.parse(String(init?.body)).video_url.match(/clip(\d)/)[1]}`);
  if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
  const clip = url.match(/requests\/c(\d)$/);
  if (clip)
    return Response.json({ video: { url: `https://v3.fal.media/files/clip${clip[1]}.mp4`, file_size: 3_000_000 } });
  const frame = url.match(/requests\/f(\d)$/);
  if (frame) return Response.json({ images: [{ url: `https://v3.fal.media/files/last${frame[1]}.jpg` }] });
  if (url.endsWith("/requests/join")) return Response.json({ video: { url: VIDEO, file_size: 9_000_000 } });
  throw Error(`unexpected ${url}`);
}) as unknown as typeof fetch;

test("the video goes only on approval, now to who can be reached and held for who cannot", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { ADMIN_PASSWORD: "pw", FAL_KEY: "k", PRESENTER_IMAGE_URL: "https://x/p.png" });
  const sent: { phone: string; reply: Reply }[] = [];
  const held: { body: string; phones: string[]; video?: string | undefined }[] = [];
  const logged: unknown[] = [];
  const db = {
    roster: async () => [
      { phone: "919820000001", name: "Ramesh" },
      { phone: "919820000002", name: "Asha" },
    ],
    reachable: async () => ["919820000001"],
    today: async () => [],
    allConversations: async () => [],
    send: async (phone: string, reply: Reply) => void sent.push({ phone, reply }),
    queueNotice: async (body: string, phones: string[], video?: string) => held.push({ body, phones, video }),
    logBroadcast: async (row: unknown) => void logged.push(row),
  } as unknown as DB;
  const app = new Hono();
  managerRoutes(app, db, undefined, fal);
  const login = await app.request("/api/manager/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "manager", password: "pw" }),
  });
  const headers = {
    cookie: (login.headers.get("set-cookie") ?? "").split(";")[0]!,
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
    assert.equal(view.job.heard, SCRIPT, "what he said was heard and checked before the manager sees it");
    assert.equal(view.job.video, VIDEO);
    const clips = falBodies["https://queue.fal.run/google/gemini-omni-flash/v1.1/image-to-video"]!;
    assert.equal(clips.length, 3, "a script over 10 s is filmed in pieces");
    assert.deepEqual(
      clips.map((clip) => clip.image_url),
      ["https://x/p.png", "https://v3.fal.media/files/last1.jpg", "https://v3.fal.media/files/last2.jpg"],
      "the first piece starts on the presenter, each next one on the frame the one before ended on",
    );
    assert.match(clips[1].prompt, /mid-talk/, "a later piece is told it carries on");
    for (const clip of clips) {
      assert.equal(clip.aspect_ratio, "9:16");
      assert.ok(clip.duration >= 4 && clip.duration <= 10, `a clip fits what the model films: ${clip.duration}`);
    }
    assert.match(
      clips[1].prompt,
      /word for word, once: "LG fifty-five inch OLED fifty-four thousand nine hundred ninety rupees/,
    );
    assert.deepEqual(
      falBodies["https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos"]![0].video_urls,
      [1, 2, 3].map((n) => `https://v3.fal.media/files/clip${n}.mp4`),
      "joined in the order they are said",
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
    assert.deepEqual(
      logged,
      [{ kind: "video", body: SCRIPT, video: VIDEO, queued: 1, waiting: 1 }],
      "kept in its history",
    );
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

test("a script is cut into whole sentences that each fit one 10 s clip, and nothing is lost", () => {
  const script =
    "Good morning team! Diwali offers आज से live हैं. Sony Bravia 65 inch Rs 89,990 में, 12 महीने तक no cost EMI है. " +
    "Boat earbuds पर buy 1 get 1 है. हर TV sale पर extended warranty ज़रूर pitch करो. Let's make it a great day!";
  const lines = clipLines(script);
  assert.equal(lines.join(" "), script);
  for (const line of lines) assert.ok(spokenScript(line).split(/\s+/).length <= 24, line);
  assert.deepEqual(clipLines("Short one. Two."), ["Short one. Two."], "a short script is one clip");
  const long =
    "Ek, do, teen, char, paanch, chhe, saat, aath, nau, das, gyaarah, baarah, terah, chaudah, pandrah, solah, satrah, athaarah, unnees, bees, ikkees, baees, teis, chaubees, pachchees, chhabbees.";
  assert.ok(clipLines(long).length > 1, "a sentence too long for one clip is cut at its commas");
});

test("what the presenter said is checked against his script: a figure heard wrong twice, or an offer he added, is caught", async () => {
  const script = "Sony Bravia 65 inch Rs 89,990 में, 12 महीने तक no cost EMI है.";
  const check = (hearings: string[], added: string[]) => {
    let heard = 0;
    return (async (url: string, init?: RequestInit) => {
      if (url === "https://v3.fal.media/files/v.mp4") return new Response(new Uint8Array([1]));
      if (url.includes("storage/upload/initiate"))
        return Response.json({ upload_url: "https://v3b.fal.media/u", file_url: "https://v3b.fal.media/h" });
      if (url === "https://v3b.fal.media/u") return new Response(null);
      if (url.endsWith("speech-to-text")) return Response.json({ text: hearings[heard++ % hearings.length] });
      if (url === "https://fal.run/openrouter/router") {
        assert.match(String(init?.body), /WHAT HE SAID/);
        return Response.json({ output: JSON.stringify({ added }), usage: { cost: 0.0001 } });
      }
      throw Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
  };
  const config = { key: "k", model: "m" } as Parameters<typeof addedToScript>[0];
  const video = "https://v3.fal.media/files/v.mp4";

  const clean = await addedToScript(
    config,
    script,
    video,
    check(["Sony Bravia 65 inch ₹89,990 में 12 महीने तक no cost EMI है।"], []),
  );
  assert.deepEqual(clean.added, [], "the same words, written differently, pass");

  const wrong = await addedToScript(config, script, video, check(["Sony Bravia 65 inch ₹79,990 में"], []));
  assert.ok(
    wrong.added.some((figure) => figure.includes("79")),
    `a price he said wrong is caught: ${wrong.added}`,
  );

  const misheard = await addedToScript(
    config,
    script,
    video,
    check(["Sony Bravia 65 inch ₹89,999 में", "Sony Bravia 65 inch ₹89,990 में"], []),
  );
  assert.deepEqual(misheard.added, [], "a figure misheard once, and heard right the second time, does not block it");

  const offer = await addedToScript(
    config,
    script,
    video,
    check(["... smart TV पे best deals"], ["smart TV पे best deals"]),
  );
  assert.deepEqual(offer.added, ["smart TV पे best deals"], "an offer he made up is caught");

  const stumble = await addedToScript(
    config,
    script,
    video,
    check(["Sony Bravia 65, 65 inch ₹89,990 में 12 महीने तक no cost EMI है।"], []),
  );
  assert.deepEqual(stumble.added, ["65 65"], "a word he says twice in a row is caught");

  const once = await addedToScript(
    config,
    script,
    video,
    check(["Sony Bravia 65, 65 inch ₹89,990 में", "Sony Bravia 65 inch ₹89,990 में"], []),
  );
  assert.deepEqual(once.added, [], "a repeat heard in only one hearing does not block it");
});

test("a repeat is a word or phrase said twice in a row that the script does not say twice", () => {
  assert.deepEqual(repeated("हर TV sale पे, हर TV sale पे warranty", "हर TV sale पर warranty"), [
    "हर tv sale पे हर tv sale पे",
  ]);
  assert.deepEqual(repeated("Very very good offer", "Very very good offer!"), [], "a repeat the script has passes");
  assert.deepEqual(repeated("Boat earbuds पे buy one get one है", "Boat earbuds पर buy 1 get 1 है."), []);
});
