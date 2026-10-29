import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide } from "../server/src/brain.js";
import { asksWhatWeHave, inStockReply, intentOf } from "../server/src/ask.js";
import { newSession, type Event } from "../server/src/types.js";

/** An associate who does not know the range has to be able to ask. Every sentence used to be read
 *  as a description of the customer's home, so "is the Sony good for a dark room" was filed as
 *  light = dim and "what TVs do we have" was answered with "how far will you sit from the TV?". */

const pack = await loadPack("data/pack.json");
const dead: typeof fetch = () => Promise.reject(Error("this must be answered from the pack"));
const said = (text: string): Event => ({ id: `a${Math.random()}`, phone: "919820000001", modality: "text", text });

test("a question about the shop is told apart from a description of the customer", () => {
  for (const asking of [
    "what TVs do we have in stock",
    "which models are available",
    "do we have the LG",
    "is the Sony good for a dark room",
    "kaunsa model hai",
    "any 65 inch?",
  ])
    assert.equal(intentOf(asking), "question", asking);

  for (const describing of [
    "customer sits 3 m away",
    "they watch cricket and have a PS5",
    "do they have WiFi at home?",
    "his budget is 60000",
    "hall, four people, bright window",
  ])
    assert.equal(intentOf(describing), "customer", describing);

  for (const greeting of ["hi", "Hello!", "namaste", "good morning"])
    assert.equal(intentOf(greeting), "greeting", greeting);
});

test("a question about a product does not become a fact about the customer's home", async () => {
  const session = newSession("919820000001");
  const reply = await decide(said("is the Sony good for a dark room"), session, pack, dead);
  assert.deepEqual(session.card, {}, "it used to file light = dim");
  assert.match(reply.text, /Sony Bravia/, "and it answers about the set instead");
});

test("what we have is answered without leading on price", async () => {
  const session = newSession("919820000001");
  const reply = await decide(said("what TVs do we have in stock today"), session, pack, dead);
  assert.match(reply.text, /On the floor today/);
  assert.match(reply.text, /Sony 55" LED/);
  // Our associates opened with price in 6 of 6 visits. A price list here would teach that habit.
  assert.doesNotMatch(reply.text, /Rs ?[\d,]{4,}/, "no prices before the home is known");
  assert.match(reply.text, /the home comes before the price/);
});

test("once the home is known, the same question points at the three that fit", () => {
  const assessed = inStockReply(pack, { distance_m: 3 }, "en", true);
  assert.match(assessed.text, /three options|narrow/i);
  assert.deepEqual(
    assessed.buttons?.map((button) => button.id),
    ["recommend"],
  );
  assert.doesNotMatch(assessed.text, /Rs ?[\d,]{4,}/);
});

test("saying hello is answered, not turned into a questionnaire", async () => {
  const session = newSession("919820000001");
  const reply = await decide(said("hi"), session, pack, dead);
  assert.doesNotMatch(reply.text, /How far will you sit/, "it used to open with the distance question");
  // A manager asks what is going on. It used to answer hello with a menu of its own features.
  assert.match(reply.text, /what's happening/i);
  assert.doesNotMatch(reply.text, /say brief|ask me about any set/i);
  assert.deepEqual(
    reply.buttons?.map((button) => button.id),
    ["brief", "new_customer"],
  );
  assert.deepEqual(session.card, {});
});

test("a description still fills the card, which is the whole point of the flow", async () => {
  const session = newSession("919820000001");
  await decide(said("customer sits 3 m away in the hall with four people"), session, pack, dead);
  assert.equal(session.card.distance_m, 3);
  assert.equal(session.card.room, "hall");
  assert.equal(session.card.family, "4 people");
});

test("asking what we have is not confused with asking about one set", () => {
  assert.equal(asksWhatWeHave("what do we have in stock"), true);
  assert.equal(asksWhatWeHave("which models are available"), true);
  assert.equal(asksWhatWeHave("is the Sony any good"), false);
});

test("a hello in Devanagari is a hello", () => {
  // \b in JavaScript only knows ASCII, so "नमस्ते\b" never matched and this reached the model,
  // which answered in Hindi with an English reason line.
  for (const hello of ["नमस्ते", "नमस्कार", "हाय", "नमस्ते।", "हॅलो"]) assert.equal(intentOf(hello), "greeting", hello);
  // And a sentence that merely starts with one is not a greeting.
  assert.notEqual(intentOf("नमस्ते, ग्राहक हॉल के लिए टीवी चाहता है"), "greeting");
  assert.notEqual(intentOf("hit the 65 inch target"), "greeting");
});

test("an associate relaying a customer's question is asking, not describing", async () => {
  // The most natural phrasing on a floor, and the one that still filed itself as a fact:
  // "customer is asking what warranty comes with the TCL" became priorities = warranty.
  for (const relayed of [
    "customer is asking what warranty comes with the TCL",
    "he wants to know if the Sony has HDMI 2.1",
    "customer asked about the exchange offer",
    "what do I tell him about delivery",
    "grahak pooch raha hai ki kitne din lagenge",
  ])
    assert.equal(intentOf(relayed), "question", relayed);

  // And describing the same customer is still describing.
  assert.equal(intentOf("customer wants a TV for the hall"), "customer");

  const session = newSession("919820000001");
  await decide(said("customer is asking what warranty comes with the TCL"), session, pack, dead).catch(() => null);
  assert.deepEqual(session.card, {}, "it used to file priorities = warranty");
});
