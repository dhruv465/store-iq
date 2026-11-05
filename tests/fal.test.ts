import { test } from "node:test";
import assert from "node:assert/strict";
import {
  falConfig,
  falText,
  falTranscribe,
  falVision,
  onSpend,
  readJson,
  shapeInstruction,
} from "../server/src/fal.js";
import { openDatabase } from "../server/src/db.js";
import { decide } from "../server/src/brain.js";
import { loadPack } from "../server/src/pack.js";
import { newSession, type Event } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");

function spy(output: string): { fetch: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ output, usage: { cost: 0.000071 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: fetcher, calls };
}

test("the key travels in the header with fal's own prefix, never in the URL", async () => {
  const { fetch: fake, calls } = spy("{}");
  const { cost } = await falText({ key: "fal-secret", model: "qwen/qwen3.7-flash" }, "you are", "they said", fake);
  const sent = calls[0]!;
  assert.equal(sent.url, "https://fal.run/openrouter/router");
  assert.equal((sent.init.headers as Record<string, string>).authorization, "Key fal-secret");
  assert.doesNotMatch(sent.url, /fal-secret/, "a key in a URL is a key in a log");
  const body = JSON.parse(String(sent.init.body));
  assert.equal(body.model, "qwen/qwen3.7-flash");
  assert.equal(body.system_prompt, "you are");
  assert.equal(body.prompt, "they said");
  assert.equal(cost, 0.000071, "what the turn actually cost comes back");
});

test("an error or an empty answer is not read as a reply", async () => {
  const refused = (async () =>
    new Response(JSON.stringify({ error: "no such model" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  await assert.rejects(() => falText({ key: "k", model: "m" }, "s", "u", refused), /no such model/);
  const { fetch: empty } = spy("   ");
  await assert.rejects(() => falText({ key: "k", model: "m" }, "s", "u", empty), /Empty fal response/);
});

test("JSON is read out of whatever the model wrapped it in", () => {
  assert.deepEqual(readJson('```json\n{"step":"assess"}\n```'), { step: "assess" });
  assert.deepEqual(readJson('Sure! Here it is: {"step":"close"} — hope that helps'), { step: "close" });
  assert.deepEqual(readJson('{"lines":["a"],"card":{"room":"hall"}}'), { lines: ["a"], card: { room: "hall" } });
  assert.throws(() => readJson("I cannot do that"), /No JSON in the answer/);
});

test("the shape is spelled out, since there is nowhere to put a schema", () => {
  const said = shapeInstruction({ type: "OBJECT", required: ["step"] });
  assert.match(said, /one JSON object and nothing else/);
  assert.match(said, /"required":\["step"\]/, "the schema itself, so it cannot drift from the real one");
});

test("the catalogue of settings: nothing is on until the key is", () => {
  assert.equal(falConfig({} as never), null);
  assert.deepEqual(falConfig({ FAL_KEY: " k " } as never), { key: "k", model: "google/gemini-2.5-flash" });
  assert.equal(falConfig({ FAL_KEY: "k", FAL_MODEL: "z-ai/glm-5.3-flash" } as never)!.model, "z-ai/glm-5.3-flash");
});

test("a turn goes to fal when the key is set, and Gemini is never called", async () => {
  const saved = { fal: process.env.FAL_KEY, gemini: process.env.GEMINI_API_KEY };
  process.env.FAL_KEY = "fal-secret";
  delete process.env.GEMINI_API_KEY;
  try {
    const { fetch: fake, calls } = spy(
      '```json\n{"step":"assess","card":{},"shortlist":[],"demonstrated":false,' +
        '"lines":["Ask: \\"Which room is it for?\\""],"buttons":[],"unknown":false}\n```',
    );
    const session = newSession("919820000001");
    const event: Event = { id: "f1", phone: session.phone, modality: "text", text: "customer wants a TV" };
    const reply = await decide(event, session, pack, fake);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /fal\.run/);
    assert.doesNotMatch(calls[0]!.url, /googleapis/, "no GEMINI_API_KEY is set and none is needed");
    assert.match(reply.text, /Ask: "\*Which room is it for\?\*"/);
  } finally {
    if (saved.fal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = saved.fal;
    if (saved.gemini !== undefined) process.env.GEMINI_API_KEY = saved.gemini;
  }
});

test("a voice note is uploaded first, because the speech model takes a URL", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const body = String(url).includes("storage/upload")
      ? { upload_url: "https://v3b.fal.media/files/b/x?signature=s", file_url: "https://v3b.fal.media/files/b/x" }
      : String(url).includes("speech-to-text")
        ? { text: "  they sit about five feet away  " }
        : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const heard = await falTranscribe(
    { key: "fal-secret", model: "ignored" },
    {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/ogg",
    },
    fake,
  );
  assert.equal(heard, "they sit about five feet away");
  assert.deepEqual(
    calls.map((call) => `${call.init.method} ${new URL(call.url).host}${new URL(call.url).pathname}`),
    [
      "POST rest.alpha.fal.ai/storage/upload/initiate",
      "PUT v3b.fal.media/files/b/x",
      "POST fal.run/fal-ai/elevenlabs/speech-to-text",
    ],
  );
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { content_type: "audio/ogg", file_name: "note" });
  assert.doesNotMatch(String(calls[2]!.init.body), /base64/, "the audio itself is not in the transcribe call");
  for (const index of [0, 2])
    assert.equal((calls[index]!.init.headers as Record<string, string>).authorization, "Key fal-secret");
  assert.equal((calls[1]!.init.headers as Record<string, string>).authorization, undefined);
});

test("a shelf-tag photo is uploaded, then read on the router's vision route with the turn's model", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const answer = String(url).includes("initiate")
      ? { upload_url: "https://v3b.fal.media/files/b/x", file_url: "https://v3b.fal.media/files/b/x" }
      : String(url).includes("vision")
        ? { output: 'SAMSUNG 55M70H 55" 4K', usage: { cost: 0.0002 } }
        : {};
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const read = await falVision(
    { key: "fal-secret", model: "google/gemini-2.5-flash" },
    "read the tag",
    { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" },
    fake,
  );
  assert.equal(read, 'SAMSUNG 55M70H 55" 4K');
  const vision = calls.find((call) => call.url.endsWith("/openrouter/router/vision"))!;
  const body = JSON.parse(String(vision.init.body));
  assert.equal(body.model, "google/gemini-2.5-flash");
  assert.deepEqual(body.image_urls, ["https://v3b.fal.media/files/b/x"]);
  assert.doesNotMatch(vision.url, /fal-secret/);
  assert.ok(
    calls.every((call) => !call.url.includes("googleapis")),
    "no Gemini call",
  );
});

test("a reply that hangs is asked again, and the first answer wins", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    const output = calls === 1 ? "slow" : "fast";
    await new Promise((resolve) => setTimeout(resolve, calls === 1 ? 300 : 5));
    return new Response(JSON.stringify({ output }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const { text } = await falText({ key: "k", model: "m" }, "s", "u", fake, 20);
  assert.equal(text, "fast");
  assert.equal(calls, 2);
});

test("a quick answer never sends the second request, and a hard failure is not retried by it", async () => {
  let calls = 0;
  const ok = (async () => {
    calls++;
    return new Response(JSON.stringify({ output: "hi" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  await falText({ key: "k", model: "m" }, "s", "u", ok, 30);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(calls, 1);

  calls = 0;
  const refused = (async () => {
    calls++;
    return new Response("no", { status: 401 });
  }) as unknown as typeof fetch;
  await assert.rejects(falText({ key: "k", model: "m" }, "s", "u", refused, 30));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(calls, 1);
});

test("every bill fal sends is kept by kind, a voice note priced from fal's own list", async () => {
  const config = falConfig({ FAL_KEY: "k" })!;
  const billed: [string, number][] = [];
  onSpend(async (kind, usd) => void billed.push([kind, usd]));
  try {
    await falText(config, "system", "user", spy("hello").fetch);
    const stub = (async (url: string | URL) => {
      const at = String(url);
      if (at.includes("upload/initiate"))
        return Response.json({ upload_url: "https://up.example/x", file_url: "https://files.example/x" });
      if (at.startsWith("https://up.example")) return new Response("", { status: 200 });
      if (at.includes("models/pricing"))
        return Response.json({ prices: [{ endpoint_id: "fal-ai/elevenlabs/speech-to-text", unit_price: 0.03 }] });
      return Response.json({ text: "fridge for a family of four" }, { headers: { "x-fal-billable-units": "2" } });
    }) as unknown as typeof fetch;
    assert.equal(
      await falTranscribe(config, { bytes: new Uint8Array([1]), mimeType: "audio/ogg" }, stub),
      "fridge for a family of four",
    );
    assert.deepEqual(billed, [
      ["model", 0.000071],
      ["voice", 0.06],
    ]);
  } finally {
    onSpend(null);
  }
});

test("the ledger keeps today's cost and the running total across days", async () => {
  const db = await openDatabase("memory://");
  try {
    assert.deepEqual(await db.spendTotals("2026-11-06"), { today: 0, total: 0, since: null, kinds: {} });
    await db.addSpend("2026-11-05", "model", 0.01);
    await db.addSpend("2026-11-06", "model", 0.002);
    await db.addSpend("2026-11-06", "model", 0.003);
    await db.addSpend("2026-11-06", "voice", 0.03);
    const totals = await db.spendTotals("2026-11-06");
    assert.equal(totals.since, "2026-11-05");
    assert.equal(Number(totals.today.toFixed(6)), 0.035);
    assert.equal(Number(totals.total.toFixed(6)), 0.045);
    assert.equal(Number(totals.kinds.model!.toFixed(6)), 0.015);
  } finally {
    await db.close();
  }
});
