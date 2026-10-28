import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { briefAnswer, reviewReply, score, shiftBrief, wantsBrief, wantsReview } from "../server/src/steps.js";
import { deterministic } from "../server/src/brain.js";
import { newSession, type Event } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");

test("the brief carries stock, offers, the video and one question with its options", () => {
  const reply = shiftBrief(pack);
  assert.match(reply.text, /Sony K-55S30 back in stock/);
  assert.match(reply.text, /HDFC card instant discount/);
  assert.match(reply.text, /Why the room decides the size/);
  assert.match(reply.text, /8 feet/);
  assert.deepEqual(reply.buttons?.map((b) => b.title), ["43 inch", "55 inch", "75 inch"]);
  assert.ok(reply.buttons!.every((b) => b.id.startsWith("brief:answer:")));
});

test("the brief question is marked from the pack, right and wrong", () => {
  assert.match(briefAnswer(pack, "55 inch").text, /^Right: 55 inch\./);
  const wrong = briefAnswer(pack, "75 inch");
  assert.match(wrong.text, /Not quite\. The answer is 55 inch, not 75 inch\./);
  assert.match(wrong.text, /forces head movement/);
});

test("coverage of the brief's nine stages maps onto the judges' 0 to 14 scale", () => {
  const session = newSession("919999999999");
  assert.deepEqual(score(session), {
    points: 0,
    missing: ["brief", "assess", "validate", "translate", "recommend", "complete", "close", "follow_through", "review"],
  });
  session.steps_done = ["brief", "assess", "translate", "recommend"];
  session.card = { distance_feet: 8, light: "bright", mount: "wall", content: ["cricket"] };
  session.demonstrated = true;
  // Four of nine stages.
  assert.equal(score(session).points, 6);
});

test("a claimed step without its evidence does not score", () => {
  const session = newSession("919999999999");
  session.steps_done = ["assess", "translate"];
  // The model said it assessed and demonstrated; the card and the flag say otherwise.
  assert.equal(score(session).points, 0);
  assert.deepEqual(score(session).missing.includes("assess"), true);
});

test("the review names the score, what was covered and one thing to try", () => {
  const session = newSession("919999999999");
  session.steps_done = ["brief"];
  const reply = reviewReply(session);
  assert.match(reply.text, /2 of 14/);
  assert.match(reply.text, /Covered: brief\./);
  assert.match(reply.text, /Next time: Ask about the home before the product/);
});

test("brief and review are recognised by word or by tap, in Hinglish too", () => {
  assert.equal(wantsBrief("brief", undefined), true);
  assert.equal(wantsBrief("aaj ka kya hai", undefined), true);
  assert.equal(wantsBrief(undefined, "brief"), true);
  assert.equal(wantsBrief("customer wants a TV", undefined), false);
  assert.equal(wantsReview("review", undefined), true);
  assert.equal(wantsReview("kaisa raha", undefined), true);
  assert.equal(wantsReview("recommend three options", undefined), false);
});

test("a deterministic turn never reaches the model and records its step", () => {
  const session = newSession("919999999999");
  const event: Event = { id: "x", phone: "919999999999", modality: "text", text: "brief" };
  const reply = deterministic(event, session, pack);
  assert.ok(reply);
  assert.equal(session.step, "brief");
  assert.deepEqual(session.steps_done, ["brief"]);
  const shopping: Event = { id: "y", phone: "919999999999", modality: "text", text: "customer wants a 55 inch" };
  assert.equal(deterministic(shopping, session, pack), null);
});
