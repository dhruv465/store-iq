import { test } from "node:test";
import assert from "node:assert/strict";
import { falConfig, falText, falTranscribe, readJson, shapeInstruction } from "../server/src/fal.js";
import { decide } from "../server/src/brain.js";
import { loadPack } from "../server/src/pack.js";
import { newSession, type Event } from "../server/src/types.js";

/** The turn goes through fal.ai's OpenRouter router when FAL_KEY is set, because Gemini's free
 *  tier is 20 requests a day and the model now answers most turns. The router has no response
 *  schema and takes no audio or images, so the shape is asked for in words and read tolerantly,
 *  and the voice note and the photo stay on Gemini. */

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
  // No response schema on this endpoint, so an answer arrives fenced, or with a sentence in front.
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
        '"lines":["Ask: \\"Which room is it for?\\""],"buttons":[],"reason":"the room sizes it","unknown":false}\n```',
    );
    const session = newSession("919820000001");
    const event: Event = { id: "f1", phone: session.phone, modality: "text", text: "customer wants a TV" };
    const reply = await decide(event, session, pack, fake);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /fal\.run/);
    assert.doesNotMatch(calls[0]!.url, /googleapis/, "no GEMINI_API_KEY is set and none is needed");
    // The same floor shape as every other reply: the words emboldened, the reason italic.
    assert.match(reply.text, /Ask: "\*Which room is it for\?\*"/);
    assert.match(reply.text, /_↳ the room sizes it_/);
  } finally {
    if (saved.fal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = saved.fal;
    if (saved.gemini !== undefined) process.env.GEMINI_API_KEY = saved.gemini;
  }
});

test("a voice note is uploaded first, because Whisper refuses a data URI", async () => {
  // "Unsupported data URL" is what the endpoint answers to base64 inline, whatever the general file
  // documentation says. So the bytes go to fal's storage and the URL it returns is transcribed.
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const body = String(url).includes("storage/upload")
      ? { upload_url: "https://v3b.fal.media/files/b/x?signature=s", file_url: "https://v3b.fal.media/files/b/x" }
      : String(url).includes("whisper")
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
    ["POST rest.alpha.fal.ai/storage/upload/initiate", "PUT v3b.fal.media/files/b/x", "POST fal.run/fal-ai/whisper"],
  );
  // The file name carries nothing about the associate or the customer.
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { content_type: "audio/ogg", file_name: "note" });
  assert.doesNotMatch(String(calls[2]!.init.body), /base64/, "the audio itself is not in the transcribe call");
  // The key goes to fal's own API. The upload URL is already signed, so the CDN never sees it.
  for (const index of [0, 2])
    assert.equal((calls[index]!.init.headers as Record<string, string>).authorization, "Key fal-secret");
  assert.equal((calls[1]!.init.headers as Record<string, string>).authorization, undefined);
});
