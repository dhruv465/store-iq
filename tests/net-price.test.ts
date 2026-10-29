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

// Four stated facts, one of them a distance: what isAssessed() asks for.
const HOME_CARD = { distance_m: 3, light: "bright afternoon sun", mount: "wall", content: ["cricket"] };

test("offers are matched by their own applies_to line, or skipped", () => {
  // "all TVs" and "TVs above 50 inch" both cover a 55 inch set.
  assert.deepEqual(
    applicableOffers(pack, TCL).map((offer) => offer.id),
    ["HDFC-CC", "EXCH-TV"],
  );
  // The exchange is for 50 inch and up, so the card discount alone survives on a smaller set.
  assert.equal(applicableOffers(pack, { ...TCL, size_inch: 43 }).length, 1);
  // An applies_to the code cannot parse offers nothing rather than a guessed saving.
  const weird = { ...pack, offers: [{ id: "GOLD", applies_to: "golden homes", percent: 5 }] };
  assert.deepEqual(applicableOffers(weird, TCL), []);
});

test("an offer is the percent capped, or the flat amount, never anything else", () => {
  // 54990 at 7.5 percent is 4124.25; the cap on this set never bites.
  assert.equal(offerAmount(TCL, { percent: 7.5, cap_rupees: 8000 }), 4124);
  assert.equal(offerAmount(TCL, { flat_rupees: 3000 }), 3000);
  // On a dearer set the cap is what keeps the figure honest.
  assert.equal(offerAmount({ ...TCL, price_rupees: 200000 }, { percent: 7.5, cap_rupees: 8000 }), 8000);
  assert.equal(offerAmount(TCL, { title: "an offer without a figure" }), 0);
});

test("every closing line carries the pack's figure and the pack's own conditions", () => {
  const [card, exchange] = offerLines(pack, TCL, "en");
  assert.match(card!, /HDFC credit card instant discount: − Rs 4,124 if they have HDFC credit card/);
  assert.match(exchange!, /− Rs 3,000 if they have working old TV, same household/);
});

test("the net payable is the itemised total less every applicable offer", () => {
  // 54990 + 1499 wall mount, less 4124 card, less 3000 exchange.
  assert.equal(netPayable(pack, TCL, 54990 + 1499), 49365);
});

test("with the gate open the summary leads with the MRP saving and the send ends at the net", () => {
  const session = newSession("919820000001");
  session.card = { ...HOME_CARD };
  session.demonstrated = true;
  tap(session, "select:TCL-55C6KS");
  const draft = tap(session, "add:TV-WALL")!;
  // 89990 MRP against 54990 today, and only after the home is assessed.
  assert.match(draft.text, /Rs 35,000 off MRP today: listed Rs 89,990, here Rs 54,990/);
  assert.doesNotMatch(draft.text, /Net with those/, "the net waits until after consent");
  const sent = tap(session, "consent:yes")!;
  assert.match(sent.text, /Total Rs 56,489/, "the gross stays visible, so both figures are on the table");
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
  // The offer figures are pack-derived, so the guard itself is untouched — the gate is the test.
});

test("the close adapts to the associate's language, pack figures aside", () => {
  const [hindi, marathi] = [offerLines(pack, TCL, "hi")[0], offerLines(pack, TCL, "mr")[0]];
  assert.match(hindi!, /छूट/);
  assert.match(marathi!, /वजावट/);
  // The pack's title and needs keep their own words, like every other pack read-back.
  assert.match(hindi!, /HDFC credit card/);
  assert.match(marathi!, /Rs 4,124/);
  assert.deepEqual(closeLines(pack, TCL, 54990, "en", false), [], "gate shut: no closing lines at all");
});
