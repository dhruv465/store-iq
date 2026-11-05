import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { followThrough, itemisedTotal } from "../server/src/steps.js";
import { deterministic } from "../server/src/brain.js";
import { followUpPlan, withAfterSales } from "../server/src/aftersales.js";
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

test("a pick shows the associate the whole cost at once, with nothing to agree to", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  const breakdown = tap(session, "add:TV-WALL")!;
  assert.match(
    breakdown.text,
    /^Breakdown: TCL 55 inch C6K QD-Mini LED — Rs 54,990; Wall mount installation — Rs 1,499\. Total Rs 56,489\./,
  );
  assert.equal(breakdown.buttons?.[0]?.id, "sold");
  assert.ok(
    !breakdown.buttons?.some((button) => button.id.startsWith("consent:")),
    "no customer yes for the associate's own sheet",
  );
  assert.doesNotMatch(breakdown.text, /May I send|Task:/);
});

test("asked for the summary of the breakdown in words, it shows it instead of 'tap They agreed'", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  const reply = deterministic(
    { id: "s1", phone: session.phone, modality: "text", text: "Yes, share summary of breakdown", name: ASSOCIATE },
    session,
    pack,
  )!;
  assert.match(reply.text, /^Breakdown: /);
  assert.doesNotMatch(reply.text, /They agreed/);
});

test("before a pick, a question about the total cost is not taken for the breakdown", () => {
  const session = newSession("919820000001");
  const reply = deterministic(
    { id: "s2", phone: session.phone, modality: "text", text: "total cost of the LG fridge?" },
    session,
    pack,
  );
  assert.equal(reply, null, "the model answers it from the catalogue");
});

test("Sold says well done, asks the site question out loud, and sets the follow-ups", () => {
  const session = newSession("919820000001");
  session.customer = { id: "c-1", phone: "9876543210", name: "Vidya Sathe" };
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-WALL");
  const reply = tap(session, "sold")!;
  assert.match(
    reply.text,
    /^🎉 Sold — well done, Ramesh! TCL 55 inch C6K QD-Mini LED, Rs 56,489, on Vidya Sathe's card\./,
  );
  assert.match(reply.text, /Before I book the installer — .*concrete or brick/);
  assert.match(reply.text, /Follow-ups set: delivery tomorrow · day 2 installer's call · day 3 working check/);
  assert.deepEqual(
    reply.buttons?.map((button) => button.id),
    ["site:ok", "site:problem", "summary:customer"],
  );
  assert.equal(session.sold, true);
  assert.ok(session.steps_done.includes("close") && session.steps_done.includes("follow_through"));
  assert.equal(session.customer.bought?.[0]?.total, 56489, "on the card for the next visit");
});

test("typed, the sale is the same as the tap", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  const reply = deterministic(
    { id: "s3", phone: session.phone, modality: "text", text: "he bought it!", name: ASSOCIATE },
    session,
    pack,
  )!;
  assert.match(reply.text, /^🎉 Sold/);
  assert.equal(session.sold, true);
});

test("once the site is confirmed, the install job has its owner and nobody is congratulated twice", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-WALL");
  tap(session, "sold");
  const reply = tap(session, "site:ok")!;
  assert.equal(session.site_checked, true);
  assert.match(reply.text, new RegExp(`Install job: site ready \\(.*\\) · owner ${ASSOCIATE}`));
  assert.doesNotMatch(reply.text, /🎉/);
  assert.deepEqual(
    reply.buttons?.map((button) => button.id),
    ["charges", "summary:customer", "new_customer"],
  );
});

test("an order with no installation charge goes straight through", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-DELIVERY");
  const reply = tap(session, "sold")!;
  assert.doesNotMatch(reply.text, /Before I book the installer/, "delivery alone needs no site survey");
  assert.match(reply.text, /Task: follow up this order · owner Ramesh/);
});

test("a sale of nothing picked asks which one", () => {
  const session = newSession("919820000001");
  session.shortlist = ["TCL-55C6KS"];
  const reply = tap(session, "sold")!;
  assert.match(reply.text, /Which one did they pick/);
  assert.equal(session.sold, undefined);
});

test("the customer's own summary is optional, and only it waits for their yes", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "add:TV-WALL");
  tap(session, "sold");
  const asked = tap(session, "summary:customer")!;
  assert.match(asked.text, /May I send you a summary of the TCL 55 inch C6K QD-Mini LED, total Rs 56,489, on WhatsApp/);
  assert.deepEqual(
    asked.buttons?.map((button) => button.id),
    ["consent:yes", "consent:no"],
  );
  const sent = tap(session, "consent:yes")!;
  assert.match(sent.text, /^Send: ".*Total Rs 56,489\. Installation needs: wall type/);
  assert.match(sent.text, /Nothing goes out from here/);
});

test("declining consent sends nothing", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  const reply = tap(session, "consent:no")!;
  assert.equal(session.consent, false);
  assert.match(reply.text, /No summary sent/);
});

test("changing the selection withdraws the sale and the consent", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  tap(session, "sold");
  tap(session, "consent:yes");
  assert.equal(session.consent, true);
  tap(session, "select:SAM-55QE1D");
  assert.equal(session.consent, false, "a new product needs fresh consent");
  assert.equal(session.sold, false);
});

test("a heavy product asks take or deliver at the pick, and the distance sets the delivery line", () => {
  // The live catalogue has no charges: the after-sales list fills them for the kinds in view.
  const live = withAfterSales({ ...pack, charges: [], install_requirements: {} });
  const session = newSession("919820000001");
  const run = (event: Partial<Event>) =>
    deterministic(
      { id: `l${Math.random()}`, phone: session.phone, modality: "interactive", name: ASSOCIATE, ...event } as Event,
      session,
      live,
    )!;
  const breakdown = run({ action: "select:TCL-55C6KS" });
  assert.deepEqual(session.selection?.charges, ["LTV-DEMO"], "no delivery line until it is asked");
  assert.match(breakdown.text, /Table-top installation and demo — free\. Total Rs 54,990/);
  assert.match(breakdown.text, /Will you take it with you, or shall we deliver it home\?/);
  assert.deepEqual(
    breakdown.buttons?.map((button) => button.id),
    ["deliver:yes", "deliver:carry", "charges"],
  );

  const rates = run({ action: "deliver:yes" });
  const said = rates.text.replace(/\*/g, "");
  assert.match(
    said,
    /^Delivery: Home delivery within 5 km free · Delivery beyond 5 km Rs 299\. Installation and extras: Table-top installation and demo free · Wall mount installation Rs 799\./,
  );
  assert.match(said, /How far is your home from the store\?/);
  assert.match(said, /Sample rates/);
  assert.deepEqual(
    rates.buttons?.map((button) => [button.id, button.title]),
    [
      ["deliver:LTV-DEL", "Within 5 km"],
      ["deliver:LTV-DEL-FAR", "Beyond 5 km"],
    ],
  );

  const far = run({ modality: "text", text: "they live about 7 km away" });
  assert.match(
    far.text.replace(/\*/g, ""),
    /^7 km: Delivery beyond 5 km\.\n+Breakdown: .*Delivery beyond 5 km — Rs 299; Table-top installation and demo — free\. Total Rs 55,289/,
  );
  assert.equal(far.buttons?.[0]?.id, "sold");
  const near = run({ action: "deliver:LTV-DEL" });
  assert.match(near.text, /Home delivery within 5 km — free; Table-top installation and demo — free\. Total Rs 54,990/);
  assert.deepEqual(session.selection?.charges, ["LTV-DEL", "LTV-DEMO"], "one delivery line, never two");

  const charges = run({ action: "charges" });
  assert.match(charges.text, /Charges for a television: Home delivery within 5 km free · Delivery beyond 5 km Rs 299/);
});

test("a large live screen without TV in its name still gets delivery and a site check", () => {
  const television = { ...pack.products[0]!, name: "Sony 139 cm", size_inch: 55, categories: ["Electronics"] };
  const live = withAfterSales({ ...pack, products: [television], charges: [], install_requirements: {} });
  const session = newSession("919820000001");
  const run = (action: string) =>
    deterministic(
      { id: `t${Math.random()}`, phone: session.phone, modality: "interactive", action, name: ASSOCIATE },
      session,
      live,
    )!;

  assert.match(run("select:SON-K55S30").text, /take it with you, or shall we deliver/i);
  run("deliver:yes");
  run("deliver:LTV-DEL");
  assert.match(run("sold").text, /Before I book the installer/);
});

test("a customer who takes it with them has no delivery on the bill", () => {
  const live = withAfterSales({ ...pack, charges: [], install_requirements: {} });
  const session = newSession("919820000001");
  const run = (event: Partial<Event>) =>
    deterministic(
      { id: `c${Math.random()}`, phone: session.phone, modality: "interactive", name: ASSOCIATE, ...event } as Event,
      session,
      live,
    )!;
  run({ action: "select:TCL-55C6KS" });
  const carried = run({ modality: "text", text: "they will take it themselves" });
  assert.equal(session.selection?.delivery, "carry");
  assert.doesNotMatch(carried.text.split("\n").slice(0, 2).join("\n"), /delivery/i, "not on the bill, not as an extra");
  assert.equal(carried.buttons?.[0]?.id, "sold");
});

test("a pack that brings its own charges lists those, not the sample sheet", () => {
  const session = newSession("919820000001");
  tap(session, "select:TCL-55C6KS");
  const reply = tap(session, "charges")!;
  assert.match(reply.text, /Wall mount installation Rs 1,499/);
  assert.doesNotMatch(reply.text, /Sample rates/);
});

test("an AC's sale carries the store visit's list: installation, bracket, nitrogen test, and the wall asked first", () => {
  const ac = {
    ...pack.products[0]!,
    sku: "AC-1",
    name: "Lloyd 1.5 Ton 3 Star Inverter Split AC, GLS18I3ASASR",
    categories: ["Split Air Conditioners"],
    price_rupees: 38490,
  };
  const live = withAfterSales({ ...pack, products: [ac], charges: [], install_requirements: {}, offers: [] });
  const session = newSession("919820000001");
  const tapLive = (action: string) =>
    deterministic(
      { id: `a${Math.random()}`, phone: session.phone, modality: "interactive", action, name: ASSOCIATE },
      session,
      live,
    )!;
  tapLive("select:AC-1");
  const breakdown = tapLive("deliver:AC-DEL");
  assert.match(
    breakdown.text,
    /Home delivery within 5 km — free; Split AC installation — Rs 1,500; Outdoor unit bracket — Rs 1,200; Nitrogen leak test — Rs 500\. Total Rs 41,690/,
  );
  assert.match(breakdown.text, /Extra copper pipe, per metre beyond 3 metres Rs 850/);
  const sold = tapLive("sold");
  assert.match(sold.text, /Before I book the installer — a hole in the wall for the pipe/);
  assert.equal(followUpPlan(ac, "Vidya", "en").length, 3);
});

test("a product or accessory outside the pack is refused", () => {
  const session = newSession("919820000001");
  assert.match(tap(session, "select:MADE-UP")!.text, /dropped off this search/);
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
