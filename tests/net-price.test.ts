import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack, offerAmount } from "../server/src/pack.js";
import { applicableOffers, closeLines, netPayable, offerLines } from "../server/src/steps.js";
import { deterministic } from "../server/src/brain.js";
import { newSession, type Event, type Session } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");
const ASSOCIATE = "Ramesh";
const TCL = pack.products.find((product) => product.sku === "TCL-55C6KS")!;

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

const HOME_CARD = { distance_m: 3, light: "bright afternoon sun", mount: "wall", content: ["cricket"] };

test("offers are matched by their own applies_to line, or skipped", () => {
  assert.deepEqual(
    applicableOffers(pack, TCL).map((offer) => offer.id),
    ["HDFC-CC", "EXCH-TV"],
  );
  assert.equal(applicableOffers(pack, { ...TCL, size_inch: 43 }).length, 1);
  const weird = { ...pack, offers: [{ id: "GOLD", applies_to: "golden homes", percent: 5 }] };
  assert.deepEqual(applicableOffers(weird, TCL), []);
});

test("an offer is the percent capped, or the flat amount, never anything else", () => {
  assert.equal(offerAmount(TCL, { percent: 7.5, cap_rupees: 8000 }), 4124);
  assert.equal(offerAmount(TCL, { flat_rupees: 3000 }), 3000);
  assert.equal(offerAmount({ ...TCL, price_rupees: 200000 }, { percent: 7.5, cap_rupees: 8000 }), 8000);
  assert.equal(offerAmount(TCL, { title: "an offer without a figure" }), 0);
});

test("every closing line carries the pack's figure and the pack's own conditions", () => {
  const [card, exchange] = offerLines(pack, TCL, "en");
  assert.match(card!, /HDFC credit card instant discount: − Rs 4,124 if they have HDFC credit card/);
  assert.match(exchange!, /− Rs 3,000 if they have working old TV, same household/);
});

test("the net payable is the itemised total less every applicable offer", () => {
  assert.equal(netPayable(pack, TCL, 54990 + 1499), 49365);
});

test("with the gate open the summary leads with the MRP saving and the send ends at the net", () => {
  const session = newSession("919820000001");
  session.card = { ...HOME_CARD };
  session.demonstrated = true;
  tap(session, "select:TCL-55C6KS");
  const draft = tap(session, "add:TV-WALL")!;
  assert.match(draft.text, /Rs 35,000 off MRP today: listed Rs 89,990, here Rs 54,990/);
  assert.doesNotMatch(draft.text, /Net with those/, "the net waits until after consent");
  const asked = tap(session, "consent:yes")!;
  assert.match(asked.text, /Total Rs 56,489/, "the gross stays visible, so both figures are on the table");
  assert.match(asked.text, /wall type/, "the thing to check, not just the reason for checking");
  assert.doesNotMatch(asked.text, /− Rs/, "the offers wait one turn");
  const sent = tap(session, "site:ok")!;
  assert.match(sent.text, /Total Rs 56,489/);
  assert.match(sent.text, /HDFC credit card instant discount: − Rs 4,124/);
  assert.match(sent.text, /− Rs 3,000 if they have working old TV, same household/);
  assert.match(sent.text, /Net with those: Rs 49,365 to pay in all/);
});

test("with the gate closed the closing lines wait behind it", () => {
  const session = newSession("919820000002");
  tap(session, "select:TCL-55C6KS");
  const draft = tap(session, "add:TV-WALL")!;
  assert.doesNotMatch(draft.text, /off MRP today/, "no MRP saving before the home is assessed");
  const sent = tap(session, "consent:yes")!;
  assert.doesNotMatch(sent.text, /− Rs/, "no offer figure before the home is assessed");
  assert.doesNotMatch(sent.text, /Net with those/);
});

test("the close adapts to the associate's language, pack figures aside", () => {
  const [hindi, marathi] = [offerLines(pack, TCL, "hi")[0], offerLines(pack, TCL, "mr")[0]];
  assert.match(hindi!, /छूट/);
  assert.match(marathi!, /वजावट/);
  assert.match(hindi!, /HDFC credit card/);
  assert.match(marathi!, /Rs 4,124/);
  assert.deepEqual(closeLines(pack, TCL, 54990, "en", false), [], "gate shut: no closing lines at all");
});
