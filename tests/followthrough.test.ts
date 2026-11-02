import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { financeOptions, financeReply, followThrough, itemisedTotal } from "../server/src/steps.js";
import { deterministic } from "../server/src/brain.js";
import { pricedEarly } from "../server/src/db.js";
import { newSession, type Event, type Session } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");
const ASSOCIATE = "Ramesh";

function tap(session: Session, action: string) {
  const event: Event = {
    id: `e${Math.random()}`,
    phone: session.phone,
    modality: "interactive",
    action,
    name: ASSOCIATE,
  };
  return deterministic(event, session, pack);
}

test("the total is computed from the pack, itemised line by line", () => {
  const result = itemisedTotal(pack, {
    sku: "TCL-55C6KS",
    accessories: ["ACC-SOUNDBAR"],
    charges: ["TV-WALL", "TV-DELIVERY"],
  });
  assert.equal(result!.total, 68978);
  assert.equal(result!.lines.length, 4);
  assert.match(result!.lines[0]!, /^TCL 55 inch C6K QD-Mini LED — Rs 54,990$/);
  assert.ok(result!.lines.some((l) => /Home delivery — Rs 499/.test(l)));
});

test("a percentage charge is resolved against the product price", () => {
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
  assert.deepEqual(
    reply.buttons?.map((b) => b.id),
    ["select:TCL-55C6KS", "select:SAM-55QE1D"],
  );
});

test("the summary is withheld until the customer consents", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-WALL");
  const draft = followThrough(session, pack, ASSOCIATE);
  assert.match(draft.text, /May I send you a summary/);
  assert.deepEqual(
    draft.buttons?.map((b) => b.id),
    ["consent:yes", "consent:no"],
  );
  assert.doesNotMatch(draft.text, /Task:/, "no task is raised before consent");
});

test("consent asks the site question before anyone books an installer", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-WALL");
  const reply = tap(session, "consent:yes")!;
  assert.match(reply.text, /Total Rs 56,489/);
  assert.match(reply.text, /Before I book the installer — .*concrete or brick/);
  assert.deepEqual(
    reply.buttons?.map((button) => button.id),
    ["site:ok", "site:problem"],
  );
  assert.ok(session.steps_done.includes("follow_through"));
  assert.ok(session.steps_done.includes("close"));
});

test("once the site is confirmed, the owner and the check-back are handed over", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-WALL");
  tap(session, "consent:yes");
  const reply = tap(session, "site:ok")!;
  assert.equal(session.site_checked, true);
  assert.match(reply.text, new RegExp(`Task: follow up this order · owner ${ASSOCIATE}`));
  assert.match(reply.text, /after install, check it switches on and the apps work/);
});

test("an order with no installation charge goes straight through", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-DELIVERY");
  const reply = tap(session, "consent:yes")!;
  assert.doesNotMatch(reply.text, /Before I book the installer/, "delivery alone needs no site survey");
  assert.match(reply.text, /after install, check it switches on/);
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

test("a price quoted before the home is known is recorded against the conversation", () => {
  const session = newSession("919820000001");
  assert.equal(pricedEarly(session, { text: "TCL 55 inch · Rs 54,990 · 9 in stock" }), true);
  assert.equal(pricedEarly(session, { text: 'Ask: "How far will you sit from the TV?"' }), false);
  session.assessed = true;
  assert.equal(pricedEarly(session, { text: "Total Rs 56,489." }), false, "after the home, a price is the job");
});

test("finance is computed from the pack's own terms, with the full cost", () => {
  const [noCost, standard] = financeOptions(pack, 62990);
  assert.equal(noCost!.monthly, 6999);
  assert.equal(noCost!.fullCost, 6999 * 9 + 299);
  assert.equal(noCost!.exact, true);
  assert.equal(standard!.monthly, 3930);
  assert.equal(standard!.fullCost, 3930 * 18 + 299);
  assert.equal(standard!.exact, false, "the bank sets the exact figure, so it is not stated as fact");
});

test("the finance line names the worst full cost, not the friendliest one", () => {
  const text = financeReply(pack, 62990, "en").text;
  assert.match(text, /Rs 6,999 a month for 9 months, Rs 63,290 in all/);
  assert.match(text, /about Rs 3,930 a month/);
  assert.match(text, /the bank sets the exact instalment/);
  assert.match(text, /costs up to Rs 8,049 more than today/);
});

test("finance waits for the home and the demonstration, like every other money answer", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  const notes: string[] = [];
  const early = deterministic(
    { id: "f1", phone: session.phone, modality: "text", text: "what is the EMI" },
    session,
    pack,
    notes,
  );
  assert.equal(early, null);
  assert.match(notes.join(" "), /before the home is known/);
  assert.doesNotMatch(notes.join(" "), /\d{4}/, "no figure before the gate opens");

  session.card = { distance_m: 3, light: "bright", mount: "wall", content: ["cricket"] };
  session.card_confirmed = true;
  session.demonstrated = true;
  const open = deterministic(
    { id: "f2", phone: session.phone, modality: "text", text: "what is the EMI" },
    session,
    pack,
  )!;
  assert.match(open.text, /No-cost EMI 9 months: Rs 6,110 a month/);
  assert.ok(session.steps_done.includes("complete"));
});
