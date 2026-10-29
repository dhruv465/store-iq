import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { proposeAccessory } from "../server/src/steps.js";
import { matchObjection, validateReply } from "../server/src/validate.js";
import { rank } from "../server/src/recommend.js";
import { deterministic } from "../server/src/brain.js";
import { newSession, type Event, type Session } from "../server/src/types.js";
import type { HomeCard } from "../server/src/types.js";

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

/** The objections live behind the same claim trigger as the myths, so an ordinary objection on the
 *  floor gets the confirm-then-correct shape without a model request. */
test("the too-costly objection is confirmed, then handed one line to say", () => {
  const packText = pack.objections!.find((o) => o.claim === "It is too costly")!;
  assert.equal(matchObjection(pack, "customer says it is too costly")!.claim, packText.claim);
  const reply = validateReply(pack, "customer says it is too costly", "en");
  assert.match(reply!.text, /It is a large amount/);
  assert.match(reply!.text, /which part feels high/);

  const session = newSession("919820000001");
  const answer = deterministic(
    { id: "o1", phone: session.phone, modality: "text", text: "customer says it's too costly" },
    session,
    pack,
  )!;
  assert.equal(session.step, "validate");
  assert.equal(session.objections![0], "It is too costly", "the objection is recorded for the review");
  assert.match(answer.text, /Ask:|Say:/, "the associate gets words, not advice");
});

test("a Hinglish objection on the same floor still matches", () => {
  assert.match(matchObjection(pack, "grahak ne bola bahut mehenga hai")!.claim, /costly/);
});

test("the buy-online objection answers with the demo, not with figures", () => {
  const matched = matchObjection(pack, "customer says he will check online")!;
  assert.equal(matched.claim, "I can buy the same set online");
  const reply = validateReply(pack, "customer says he will check online", "en")!;
  assert.doesNotMatch(reply.text, /\d{3,}/, "objections speak in words; the numbers belong to the pack steps");
});

test("customer thinks a spec, not about leaving — the myth wins over the later objection", () => {
  // Bare "thinks" must not read as "thinking it over", so a real claim still gets its myth.
  const matched = matchObjection(pack, "customer thinks 60 Hz is enough");
  assert.equal(matched, null);
});

test("a claim the pack does not know is not answered with an invented line", () => {
  assert.equal(matchObjection(pack, "customer says his uncle repairs televisions"), null);
  assert.equal(validateReply(pack, "customer says his uncle repairs televisions", "en"), null);
});

const HOME: Pick<HomeCard, "distance_m" | "light" | "mount" | "content"> = {
  distance_m: 3,
  light: "bright",
  mount: "wall",
  content: ["cricket"],
};

test("a console home is handed the full-quality cable, with its own why", () => {
  const suggestion = proposeAccessory(pack, { ...HOME, devices: ["PS5"] } as HomeCard, {
    sku: "TCL-55C6KS",
    accessories: [],
    charges: [],
  });
  assert.equal(suggestion?.id, "ACC-HDMI");
  assert.match(suggestion!.for, /PS5/);
});

test("a larger hall is handed the soundbar; an already-taken accessory never comes back", () => {
  const taken = { sku: "TCL-55C6KS", accessories: ["ACC-SOUNDBAR"], charges: [] };
  const clean = { sku: "TCL-55C6KS", accessories: [], charges: [] };
  assert.equal(proposeAccessory(pack, { ...HOME, room: "large hall" } as HomeCard, taken), null);
  // More than four people at the wall is a large hall by the same measure.
  assert.equal(
    proposeAccessory(pack, { ...HOME, family: "6 people" } as HomeCard, clean)?.id,
    "ACC-SOUNDBAR",
    "the soundbar repeats for six people even when 'large' was never said",
  );
});

test("an unstable-supply note on the site constraints proposes the stabiliser", () => {
  const suggestion = proposeAccessory(
    pack,
    {
      ...HOME,
      site_constraints: ["area has unstable supply"],
    } as HomeCard,
    {
      sku: "TCL-55C6KS",
      accessories: [],
      charges: [],
    },
  );
  assert.equal(suggestion?.id, "ACC-STAB");
});

test("the draft offers the accessory with a take-it tap next to consent", () => {
  const session = newSession("919820000001");
  session.card = { ...HOME, devices: ["PS5"] } as HomeCard;
  session.step = "follow_through";
  tap(session, "select:TCL-55C6KS");
  const draft = tap(session, "add:TV-DELIVERY")!;
  assert.match(draft.text, /For this home also: HDMI 2.1 cable 2 m, Rs 699/);
  assert.deepEqual(
    draft.buttons?.map((button) => button.id),
    ["add:ACC-HDMI", "consent:yes", "consent:no"],
  );
  const after = tap(session, "add:ACC-HDMI")!;
  assert.doesNotMatch(after.text, /For this home also/, "a taken accessory clears the proposal");
});

test("an option above the budget says the gap in the open, with its reason behind it", () => {
  const card: HomeCard = { distance_feet: 5, light: "bright afternoon sun", content: ["cricket"] };
  // A Rs 60,000 budget: the TCL leads at 54,990, the Samsung and the LG sit above it and must
  // still be presentable, with their gap in the open.
  const options = rank(pack, { ...card, budget_rupees: 60000 }, "en");
  const above = options.filter((option) => option.product.price_rupees > 60000);
  assert.ok(above.length >= 1, "an over-budget option stayed on the list");
  assert.ok(
    options.some((option) => option.product.price_rupees <= 60000),
    "the in-budget pick still leads",
  );
  for (const option of above)
    assert.match(
      option.reason,
      new RegExp(`Rs ${(option.product.price_rupees - 60000).toLocaleString("en-IN")} above that budget`),
      `${option.product.sku} states its gap`,
    );
});
