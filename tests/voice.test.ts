import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide } from "../server/src/brain.js";
import { newSession, type Event } from "../server/src/types.js";

/** A voice note is read the way a label photo is: the model says only what it heard, and the code
 *  writes the reply. Letting the model answer directly produced "Okay, so 5 feet viewing distance
 *  in the bedroom" on a real note — no question, no reason, and none of the shape every other
 *  reply obeys. */

const pack = await loadPack("data/pack.json");
// The listener below answers every request; the key only has to exist for the call to be attempted.
process.env.GEMINI_API_KEY = "test-key";

/** Gemini, answering the voice schema and nothing else. */
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
    listener("Customer wants a TV for the bedroom, they sit about five feet away", {
      room: "bedroom",
      distance_feet: 5,
    }),
  );
  assert.equal(session.card.distance_feet, 5, "what was heard reaches the card");
  assert.equal(session.card.room, "bedroom");
  assert.match(reply.text, /^Noted:/, "the house shape, not a sentence of the model's own");
  assert.match(reply.text, /Ask: /, "and the next question to ask out loud");
  assert.match(reply.text, /↳/, "with its reason");
  assert.ok(reply.text.split("\n").length <= 3);
  assert.doesNotMatch(reply.text, /Okay|Sure|Alright/, "no conversational opener");
});

test("the extractor wins over the model where both read the same words", async () => {
  const session = newSession("919820000001");
  // The model mishears the distance; the words it wrote down say otherwise.
  await decide(note(), session, pack, listener("they sit 3 m away from the screen", { distance_m: 9 }));
  assert.equal(session.card.distance_m, 3, "the stricter reading wins");
});

test("a spoken objection reaches the same answer a typed one does", async () => {
  const session = newSession("919820000001");
  const reply = await decide(note(), session, pack, listener("the customer says it is too costly", {}));
  assert.match(reply.text, /Say: /);
  assert.match(reply.text, /large amount/, "the pack's own line, not the model's");
});

test("a voice note in Hindi is answered in Hindi", async () => {
  const session = newSession("919820000001");
  const reply = await decide(
    note(),
    session,
    pack,
    listener("ग्राहक हॉल के लिए टीवी चाहता है, तीन मीटर दूर बैठते हैं", { room: "hall", distance_m: 3 }),
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
  const reply = await decide(note(), session, pack, listener("five feet away in the bedroom", { distance_feet: 5 }));
  assert.doesNotMatch(reply.text, /How far will you sit/, "asking again is how you look like you were not listening");
  assert.match(reply.text, /How much light/, "it moves to the next thing it does not know");
});
