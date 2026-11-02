import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide } from "../server/src/brain.js";
import { newSession, type Event } from "../server/src/types.js";
import { manager } from "./model.js";

const pack = await loadPack("data/pack.json");
process.env.GEMINI_API_KEY = "test-key";

function heard(
  transcript: string,
  card: Record<string, unknown> = {},
  decision: Record<string, unknown> = { lines: ['Ask: "How much light is on that wall?"'] },
): ReturnType<typeof manager> {
  return manager(decision, { transcript, card });
}

function listener(transcript: string, card: Record<string, unknown> = {}): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript, card }) }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

const note = (): Event => ({
  id: "v1",
  phone: "919820000001",
  modality: "voice",
  audio: { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg" },
});

test("a voice note answers in the same shape as typing, not in the model's own words", async () => {
  const session = newSession("919820000001");
  const reply = await decide(
    note(),
    session,
    pack,
    heard("Customer wants a TV for the bedroom, they sit about five feet away", {
      room: "bedroom",
      distance_feet: 5,
    }).fetch,
  );
  assert.equal(session.card.distance_feet, 5, "what was heard reaches the card");
  assert.equal(session.card.room, "bedroom");
  assert.match(reply.text, /Ask: /, "a question to ask out loud");
  assert.ok(reply.text.split("\n").length <= 3);
});

test("a spoken question reaches the model in its own words", async () => {
  const session = newSession("919820000001");
  const model = heard("the customer says it is too costly");
  await decide(note(), session, pack, model.fetch);
  assert.match(model.prompts.at(-1)!, /too costly/);
});

test("a voice note in Hindi is answered in Hindi", async () => {
  const session = newSession("919820000001");
  const reply = await decide(
    note(),
    session,
    pack,
    heard(
      "ग्राहक हॉल के लिए टीवी चाहता है, तीन मीटर दूर बैठते हैं",
      { room: "hall", distance_m: 3 },
      {
        lines: ['Ask: "हॉल में धूप कितनी आती है?"'],
      },
    ).fetch,
  );
  assert.equal(session.language, "hi", "the language of the note sets the language of the reply");
  assert.match(reply.text, /[ऀ-ॿ]/);
});

test("a voice note the model cannot read leaves the session untouched", async () => {
  const session = newSession("919820000001");
  const broken: typeof fetch = (async () =>
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  await assert.rejects(decide(note(), session, pack, broken), /Empty voice response/);
  assert.deepEqual(session.card, {}, "nothing half-written onto the card");
});

test("an associate who said five feet is not asked the distance again", async () => {
  const session = newSession("919820000001");
  const model = heard("five feet away in the bedroom", { distance_feet: 5 });
  const reply = await decide(note(), session, pack, model.fetch);
  assert.match(model.prompts.join(" "), /distance_feet/);
  assert.match(model.prompts.join(" "), /5/);
  assert.match(reply.text, /Ask: /);
});

test("a voice note reaches the catalogue, because the words arrive before the search", async () => {
  // A spoken "do we have the iPhone 18 Pro in stock" used to search for nothing at all, and the
  // model honestly reported that no iPhone was in FACTS, as having no access to the catalogue.
  const store: string[] = [];
  const reply = (body: unknown): Response => Response.json(body);
  const fake = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.host === "api.example.com") {
      store.push(url.pathname + url.search);
      return reply({ items: [], page: {}, available_promotions: [] });
    }
    const sent = String(init.body);
    const text = sent.includes("inline_data")
      ? { transcript: "do we have the iPhone 18 Pro in stock", card: {} }
      : sent.includes("one search of the store")
        ? { q: sent.includes("iPhone 18 Pro") ? "iphone 18 pro" : null }
        : {
            step: "assess",
            card: {},
            shortlist: [],
            demonstrated: false,
            lines: ["Not coming up."],
            buttons: [],
          };
    return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(text) }] } }] });
  }) as unknown as typeof fetch;
  Object.assign(process.env, {
    CATALOG_HOST: "https://api.example.com",
    CATALOG_APPLICATION_ID: "app",
    CATALOG_APPLICATION_TOKEN: "token",
  });
  try {
    await decide(note(), newSession("919820000001"), pack, fake);
    assert.match(store[0]!, /q=iphone\+18\+pro/);
  } finally {
    delete process.env.CATALOG_HOST;
    delete process.env.CATALOG_APPLICATION_ID;
    delete process.env.CATALOG_APPLICATION_TOKEN;
  }
});
