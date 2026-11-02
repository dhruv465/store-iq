import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide } from "../server/src/brain.js";
import { isGreeting } from "../server/src/ask.js";
import { wantsExpert, wantsManagerView } from "../server/src/extras.js";
import { manager } from "./model.js";
import { newSession, type Event } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");
const dead: typeof fetch = () => Promise.reject(Error("a greeting is not worth a model request"));
const said = (text: string): Event => ({ id: `a${Math.random()}`, phone: "919820000001", modality: "text", text });

test("a hello is a hello, in any script and with a manager's address on it", () => {
  for (const hello of ["hi", "Hello!", "namaste", "good morning", "नमस्ते", "नमस्कार", "हाय", "नमस्ते।", "हॅलो"])
    assert.equal(isGreeting(hello), true, hello);
  for (const hello of ["namaste sir", "hi boss", "hello bhai", "namaste ji", "हाय सर"])
    assert.equal(isGreeting(hello), true, hello);
  for (const not of [
    "नमस्ते, ग्राहक हॉल के लिए टीवी चाहता है",
    "hit the 65 inch target",
    "sir what do we have in 65 inch",
  ])
    assert.equal(isGreeting(not), false, not);
});

test("saying hello is answered, not turned into a questionnaire", async () => {
  const session = newSession("919820000001");
  const reply = await decide(said("hi"), session, pack, dead);
  assert.match(reply.text, /what's happening/i);
  assert.deepEqual(
    reply.buttons?.map((button) => button.id),
    ["brief", "new_customer"],
  );
  assert.deepEqual(session.card, {});
});

test("a brief button is only offered when there is a brief", async () => {
  const reply = await decide(said("hi"), newSession("919820000001"), { ...pack, shift_brief: {} }, dead);
  assert.deepEqual(
    reply.buttons?.map((button) => button.id),
    ["new_customer"],
  );
});

test("a question that merely starts like a command goes to the model", async () => {
  // Each of these used to be answered by a fixed reply about something else: the manager's table,
  // an empty home card, the shift brief, the score.
  for (const question of [
    "today's price of iPhone 17?",
    "what do you have in Samsung phones?",
    "review of the Sony 85 inch",
    "brief me on the iPhone 18 Pro",
    "is the expert model any good",
    "what is the summary of this phone's features",
  ]) {
    const model = manager({ lines: ["answered"] });
    const reply = await decide(said(question), newSession("919820000001"), pack, model.fetch);
    assert.equal(model.calls, 1, question);
    assert.match(reply.text, /answered/, question);
  }
  assert.equal(wantsManagerView("today's price of iPhone 17?", undefined), false);
  assert.equal(wantsExpert("is the expert model any good", undefined), false);
  assert.equal(wantsExpert("ask an expert", undefined), true);
});

test("nothing the model did not say reaches the card from a question", async () => {
  const session = newSession("919820000001");
  await decide(said("is the Sony good for a dark room"), session, pack, manager({ lines: ["Yes."] }).fetch);
  assert.deepEqual(session.card, {}, "it used to file light = dim");
});

test("a decided customer is not read a card back, whatever the model filed", async () => {
  const session = newSession("919820000001");
  session.card = { facts: { a: "1", b: "2", c: "3", d: "4" } };
  const reply = await decide(
    said("I want to buy an iPhone 18 Pro 256 GB"),
    session,
    pack,
    manager({ step: "complete", lines: ["Which colour?"] }).fetch,
  );
  assert.doesNotMatch(reply.text, /I heard/);
  assert.match(reply.text, /Which colour/);
});

test("an answer is never replaced by a card read-back, however much is on the card", async () => {
  const session = newSession("919820000001");
  session.card = { facts: { a: "1", b: "2", c: "3", d: "4" } };
  const reply = await decide(
    said("does it have a heater"),
    session,
    pack,
    manager({ step: "recommend", lines: ["It is not listed."] }).fetch,
  );
  assert.doesNotMatch(reply.text, /I heard/);
  assert.match(reply.text, /not listed/);
});

test("the card is there when it is asked for", async () => {
  const session = newSession("919820000001");
  session.card = { room: "hall" };
  const reply = await decide(said("card"), session, pack, dead);
  assert.match(reply.text, /I heard/);
});

test("a select button for a product that is not there is dropped", async () => {
  const reply = await decide(
    said("which one"),
    newSession("919820000001"),
    pack,
    manager({
      lines: ["Which one?"],
      buttons: [
        { id: "select:TCL-55C6KS", title: "TCL" },
        { id: "select:MADE-UP", title: "Invented" },
      ],
    }).fetch,
  );
  assert.deepEqual(reply.buttons, [{ id: "select:TCL-55C6KS", title: "TCL" }]);
});

test("tapping a button the model wrote is treated as typing its title", async () => {
  const model = manager({ lines: ["Then the Pro."] });
  const session = newSession("919820000001");
  await decide(
    { id: "t1", phone: session.phone, modality: "interactive", action: "say:Gaming" },
    session,
    pack,
    model.fetch,
  );
  assert.match(model.prompts[0]!, /said: Gaming/);
  assert.equal(session.history[0]!.text, "Gaming");
});

test("a figure the model gets wrong gets one retry, and what it refuses twice does not go out", async () => {
  const twice = manager({ lines: ["It is Rs 12,345."] });
  const refused = await decide(said("how much"), newSession("919820000001"), pack, twice.fetch);
  assert.equal(twice.calls, 2);
  assert.doesNotMatch(refused.text, /12,345\.$/m, "the figure is only named as refused");
  assert.match(refused.text, /not in the catalogue data/);

  const fixed = manager([{ lines: ["It is Rs 12,345."] }, { lines: ["It is Rs 54,990."] }]);
  const answer = await decide(said("how much"), newSession("919820000001"), pack, fixed.fetch);
  assert.match(fixed.prompts[1]!, /You wrote 12345/);
  assert.match(answer.text, /Rs 54,990/);
});

test("offers the model volunteers go, the price it was asked for stays", async () => {
  const reply = await decide(
    said("how much is the TCL"),
    newSession("919820000001"),
    pack,
    manager({ lines: ["The TCL is Rs 54,990.", "The HDFC offer is 7.5%, capped at Rs 8000."] }).fetch,
  );
  assert.match(reply.text, /54,990/);
  assert.doesNotMatch(reply.text, /HDFC/);
});

test("asked outright, the same offer is given", async () => {
  const reply = await decide(
    said("any offer on the TCL"),
    newSession("919820000001"),
    pack,
    manager({ lines: ["The HDFC offer is 7.5%, capped at Rs 8000."] }).fetch,
  );
  assert.match(reply.text, /HDFC/);
});
