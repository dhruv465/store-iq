import { test } from "node:test";
import assert from "node:assert/strict";
import { assertModelAvailable } from "../server/src/brain.js";
import { modelRequest } from "../server/src/http.js";

const URL_ = "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent";
const noWait = async () => {};

/** Counts calls and replays the given statuses; 0 means a transport failure. */
function stubFetch(statuses: number[]) {
  const calls: number[] = [];
  const request = (async () => {
    const status = statuses[calls.length] ?? 200;
    calls.push(status);
    if (status === 0) throw Error("socket hang up");
    return new Response(status === 200 ? '{"ok":true}' : "", { status });
  }) as unknown as typeof fetch;
  return { request, calls };
}

test("a 503 is retried and the next attempt is returned", async () => {
  const { request, calls } = stubFetch([503, 200]);
  const response = await modelRequest(request, URL_, { method: "POST" }, "Gemini", 3, noWait);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [503, 200]);
});

test("a hang is retried", async () => {
  const { request, calls } = stubFetch([0, 0, 200]);
  const response = await modelRequest(request, URL_, { method: "POST" }, "Gemini", 3, noWait);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
});

test("retries stop at the attempt limit and the error surfaces", async () => {
  const { request, calls } = stubFetch([503, 503, 503, 200]);
  await assert.rejects(
    () => modelRequest(request, URL_, { method: "POST" }, "Gemini", 3, noWait),
    /Gemini unavailable: HTTP 503/,
  );
  assert.equal(calls.length, 3);
});

test("a 400 is not retried: a bad request will not fix itself", async () => {
  const { request, calls } = stubFetch([400, 200]);
  await assert.rejects(() => modelRequest(request, URL_, { method: "POST" }, "Gemini", 3, noWait), /HTTP 400/);
  assert.deepEqual(calls, [400]);
});

test("a 429 is not retried: the free tier limit is per day, so a retry just spends more of it", async () => {
  const { request, calls } = stubFetch([429, 200]);
  await assert.rejects(() => modelRequest(request, URL_, { method: "POST" }, "Gemini", 3, noWait), /HTTP 429/);
  assert.deepEqual(calls, [429]);
});

test("the first attempt succeeding makes exactly one call", async () => {
  const { request, calls } = stubFetch([200]);
  await modelRequest(request, URL_, { method: "POST" }, "Gemini", 3, noWait);
  assert.equal(calls.length, 1);
});

test("a 404 is retried now that the model name is checked at boot", async () => {
  const { request, calls } = stubFetch([404, 200]);
  assert.equal((await modelRequest(request, URL_, { method: "POST" }, "Gemini", 3, noWait)).status, 200);
  assert.deepEqual(calls, [404, 200]);
});

test("a model name the key cannot serve fails at boot, with the real options listed", async () => {
  const request = (async () =>
    new Response(
      JSON.stringify({ models: [{ name: "models/gemini-2.5-flash" }, { name: "models/gemini-3.8-flash" }] }),
      {
        status: 200,
      },
    )) as unknown as typeof fetch;
  const saved = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY ||= "test-key";
  process.env.GEMINI_MODEL = "gemini-does-not-exist";
  try {
    await assert.rejects(() => assertModelAvailable(request), /not available to this key.*gemini-2.5-flash/s);
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    assert.equal(await assertModelAvailable(request), "gemini-3.8-flash");
  } finally {
    if (saved === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = saved;
  }
});

test("an unreachable listing does not block start-up", async () => {
  const request = (async () => {
    throw Error("offline");
  }) as unknown as typeof fetch;
  const saved = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY ||= "test-key";
  process.env.GEMINI_MODEL = "gemini-2.5-flash";
  try {
    assert.equal(await assertModelAvailable(request), "gemini-2.5-flash");
  } finally {
    if (saved === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = saved;
  }
});
