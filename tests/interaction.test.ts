import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { SCORED, cardSummary, score } from "../server/src/steps.js";
import { deterministic, readSearchTurn, startInteraction } from "../server/src/brain.js";
import { newSession, STEPS, type Event, type Session } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");

function assessed(): Session {
  const session = newSession("919820000001");
  session.card = { room: "hall", distance_m: 3, light: "bright", content: ["sports", "OTT"], family: "four people" };
  session.assessed = true;
  session.demonstrated = true;
  session.steps_done = ["assess", "translate", "recommend"];
  return session;
}

test("a new customer gets an empty card, never the last customer's", () => {
  const session = assessed();
  const before = session.interaction_id;
  startInteraction(session);
  assert.notEqual(session.interaction_id, before);
  assert.deepEqual(session.card, {});
  assert.equal(session.card_confirmed, false);
  assert.equal(session.assessed, false);
  assert.equal(session.demonstrated, false);
  assert.deepEqual(session.shortlist, []);
  assert.deepEqual(session.history, []);
});

test("the shift brief survives a new customer, the home card does not", () => {
  const session = assessed();
  session.steps_done = ["brief", "assess", "translate"];
  startInteraction(session);
  assert.deepEqual(session.steps_done, ["brief"]);
});

test("catalogue intent can reset a new customer without requiring a phrase", () => {
  assert.deepEqual(readSearchTurn({ q: null, new_customer: true }), { search: null, newCustomer: true });
  assert.deepEqual(readSearchTurn({ q: "air conditioner", new_customer: false }), {
    search: { q: "air conditioner" },
    newCustomer: false,
  });
});

test("the card is read back in the brief's I heard shape, with a correction button", () => {
  const reply = cardSummary(assessed());
  assert.match(reply.text, /^I heard: hall; sits 3 m away; bright; sports, OTT; four people\./);
  assert.deepEqual(
    reply.buttons?.map((b) => b.id),
    ["card:confirmed", "card:correct", "new_customer"],
  );
});

test("an empty card asks rather than inventing a summary", () => {
  const reply = cardSummary(newSession("919820000001"));
  assert.match(reply.text, /Nothing noted about this customer yet/);
  assert.equal(reply.buttons, undefined);
});

test("confirming the card records the assess step and tells the manager so", () => {
  const session = assessed();
  const event: Event = { id: "x", phone: session.phone, modality: "interactive", action: "card:confirmed" };
  const notes: string[] = [];
  assert.equal(deterministic(event, session, pack, notes), null);
  assert.equal(session.card_confirmed, true);
  assert.ok(session.steps_done.includes("assess"));
  assert.match(notes.join(" "), /just confirmed/);
});

test("asking to fix the card clears the confirmation", () => {
  const session = assessed();
  session.card_confirmed = true;
  deterministic({ id: "x", phone: session.phone, modality: "interactive", action: "card:correct" }, session, pack);
  assert.equal(session.card_confirmed, false);
});

test("the score is the judges' seven steps, not our nine stages", () => {
  assert.equal(STEPS.length, 9, "we walk nine stages");
  assert.equal(SCORED.length, 7, "the judges score seven of them, 0 to 2 each");
  const session = newSession("919820000001");
  assert.equal(score(session).points, 0);
  session.steps_done = [...STEPS];
  session.card = { distance_feet: 8, light: "bright", mount: "wall", content: ["x"] };
  session.card_confirmed = true;
  session.demonstrated = true;
  session.selection = { sku: "TCL-55C6KS", accessories: [], charges: ["TV-DELIVERY"] };
  session.sold = true;
  assert.equal(score(session).points, 14);
});
