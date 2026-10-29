import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide } from "../server/src/brain.js";
import { storeNamed, wantsVisitLog, worthFiling } from "../server/src/visit.js";
import { newSession, type Event, type Session } from "../server/src/types.js";

/** The contest's last extra point. The visits of 10 and 11 October are why this product exists and
 *  they were written up from memory hours later; somebody standing in a competitor's shop can only
 *  speak. */

const pack = await loadPack("data/pack.json");
process.env.GEMINI_API_KEY = "test-key";

const NOTE =
  "Went to Croma CBD Belapur as a customer. The associate showed an 85 inch in a bright hall and " +
  "compared Mini LED flicker against OLED side by side. He asked three questions about the room " +
  "before showing anything, and never mentioned a price until I did.";

function filing(): {
  store: { logVisit: (row: Record<string, unknown>) => Promise<void> };
  filed: Record<string, unknown>[];
} {
  const filed: Record<string, unknown>[] = [];
  return {
    filed,
    store: { logVisit: async (row: Record<string, unknown>) => void filed.push(row) },
  };
}

const dead: typeof fetch = () => Promise.reject(Error("a visit must not need the model"));
const said = (text: string, phone = "919820000001"): Event => ({
  id: `v${Math.random()}`,
  phone,
  modality: "text",
  text,
});

test("a visit is filed against the store its own words name", async () => {
  const session = newSession("919820000001");
  const { store, filed } = filing();
  await decide(said("visit"), session, pack, dead, store as never);
  assert.equal(session.logging_visit, true);

  const reply = await decide(said(NOTE), session, pack, dead, store as never);
  assert.equal(filed.length, 1);
  assert.equal(filed[0]!.store, "Croma CBD Belapur");
  assert.match(String(filed[0]!.body), /^Went to Croma/);
  assert.match(reply.text, /Filed · SIV-\d{4} · Croma CBD Belapur/);
  assert.equal(session.logging_visit, undefined, "and the log closes, so the next thing is a customer again");
});

test("a visit note is never read as a customer's home", async () => {
  const session = newSession("919820000001");
  const { store } = filing();
  await decide(said("visit"), session, pack, dead, store as never);
  await decide(said(NOTE), session, pack, dead, store as never);
  // The note says "bright hall" and "85 inch", which the card extractor would happily take.
  assert.deepEqual(session.card, {}, "a competitor's shop is not this customer's home");
  assert.deepEqual(session.steps_done, []);
});

test("a spoken visit is filed in the words that were spoken", async () => {
  const session: Session = Object.assign(newSession("919820000001"), { associate: "Ramesh" });
  const { store, filed } = filing();
  await decide(said("visit"), session, pack, dead, store as never);

  const listener: typeof fetch = (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript: NOTE, card: { room: "hall" } }) }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  const voice: Event = {
    id: "vv",
    phone: session.phone,
    modality: "voice",
    audio: { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg" },
  };
  const reply = await decide(voice, session, pack, listener, store as never);
  assert.equal(filed.length, 1);
  assert.match(String(filed[0]!.body), /Croma CBD Belapur/);
  assert.equal(filed[0]!.associate, "Ramesh", "so the manager knows who went");
  assert.match(reply.text, /Filed · SIV-/);
  assert.deepEqual(session.card, {}, "even what the model heard about a room is not this customer's home");
});

test("a visit too short to be useful is refused rather than filed", async () => {
  const session = newSession("919820000001");
  const { store, filed } = filing();
  await decide(said("visit"), session, pack, dead, store as never);
  const reply = await decide(said("was ok"), session, pack, dead, store as never);
  assert.deepEqual(filed, []);
  assert.match(reply.text, /too short/);
  assert.equal(session.logging_visit, true, "and the log stays open for the real answer");
});

test("a store nobody named is still a visit worth keeping", () => {
  assert.equal(storeNamed("the shop near the station had three people waiting"), "unnamed store");
  assert.equal(storeNamed("went to Vijay Sales and the demo was poor"), "Vijay Sales");
  assert.match(storeNamed("Reliance Digital Juhu was busy", pack), /^Reliance Digital/);
});

test("the log opens from the word or the tap, and not from a passing mention", () => {
  assert.equal(wantsVisitLog("visit", undefined), true);
  assert.equal(wantsVisitLog("store visit", undefined), true);
  assert.equal(wantsVisitLog(undefined, "visit"), true);
  assert.equal(wantsVisitLog("the customer will visit again tomorrow", undefined), false);
  assert.equal(worthFiling("ok"), false);
  assert.equal(worthFiling("the demo at Croma was better"), true);
});
