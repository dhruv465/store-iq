import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { followThrough, itemisedTotal } from "../server/src/steps.js";
import { deterministic } from "../server/src/brain.js";
import { newSession, type Event, type Session } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");
const ASSOCIATE = "Ramesh";

function tap(session: Session, action: string) {
  const event: Event = { id: `e${Math.random()}`, phone: session.phone, modality: "interactive", action, name: ASSOCIATE };
  return deterministic(event, session, pack);
}

test("the total is computed from the pack, itemised line by line", () => {
  const result = itemisedTotal(pack, { sku: "TCL-55C6KS", accessories: ["ACC-SOUNDBAR"], charges: ["TV-WALL", "TV-DELIVERY"] });
  // 54990 + 11990 + 1499 + 499
  assert.equal(result!.total, 68978);
  assert.equal(result!.lines.length, 4);
  assert.match(result!.lines[0]!, /^TCL 55 inch C6K QD-Mini LED — Rs 54,990$/);
  assert.ok(result!.lines.some((l) => /Home delivery — Rs 499/.test(l)));
});

test("a percentage charge is resolved against the product price", () => {
  // Extended warranty is 6% of 54990.
  const result = itemisedTotal(pack, { sku: "TCL-55C6KS", accessories: [], charges: ["TV-EXT-WARR"] });
  assert.equal(result!.total, 54990 + 3299);
});

test("a selection outside the pack does not produce a total", () => {
  assert.equal(itemisedTotal(pack, { sku: "NOPE", accessories: [], charges: [] }), null);
  assert.equal(itemisedTotal(pack, { sku: "TCL-55C6KS", accessories: ["ACC-INVENTED"], charges: [] }), null);
});

test("without a selection it asks which product rather than guessing", () => {
  const session = newSession("919820000001");
  session.shortlist = ["TCL-55C6KS", "SAM-55QE1D"];
  const reply = followThrough(session, pack, ASSOCIATE);
  assert.match(reply.text, /Which one did they pick/);
  assert.deepEqual(reply.buttons?.map((b) => b.id), ["select:TCL-55C6KS", "select:SAM-55QE1D"]);
});

test("the summary is withheld until the customer consents", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-WALL");
  const draft = followThrough(session, pack, ASSOCIATE);
  assert.match(draft.text, /May I send you a summary/);
  assert.deepEqual(draft.buttons?.map((b) => b.id), ["consent:yes", "consent:no"]);
  assert.doesNotMatch(draft.text, /Task:/, "no task is raised before consent");
});

test("consent produces the summary, the task owner and the site needs", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-WALL");
  const reply = tap(session, "consent:yes")!;
  assert.match(reply.text, /Total Rs 56,489/);
  assert.match(reply.text, new RegExp(`owner ${ASSOCIATE}`));
  assert.match(reply.text, /Install job needs: .*concrete or brick/);
  assert.ok(session.steps_done.includes("follow_through"));
  assert.ok(session.steps_done.includes("close"));
});

test("declining consent sends nothing", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  const reply = tap(session, "consent:no")!;
  assert.equal(session.consent, false);
  assert.match(reply.text, /No summary sent/);
});

test("changing the selection withdraws consent", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "consent:yes");
  assert.equal(session.consent, true);
  tap(session, "select:SAM-55QE1D");
  assert.equal(session.consent, false, "a new product needs fresh consent");
});

test("a product or accessory outside the pack is refused", () => {
  const session = newSession("919820000001");
  assert.match(tap(session, "select:MADE-UP")!.text, /not in today's data pack/);
  tap(session, "select:TCL-55C6KS");
  assert.match(tap(session, "add:ACC-MADE-UP")!.text, /not in today's data pack/);
});
