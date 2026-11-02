import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCard } from "../server/src/extract.js";

test("the brief's own example sentence is read without a model", () => {
  const card = extractCard(
    "Customer has a 12-by-14-foot living room, four people at home, mostly sports and OTT, and wants good sound.",
  );
  assert.equal(card.space, "12 by 14 feet");
  assert.equal(card.room, "living room");
  assert.equal(card.family, "4 people");
  assert.deepEqual(card.content, ["sports", "OTT"]);
  assert.deepEqual(card.priorities, ["sound"]);
});

test("distance is read in either unit, but only when it is a distance", () => {
  assert.equal(extractCard("they sit about 8 feet from the wall").distance_feet, 8);
  assert.equal(extractCard("sits 3 m away from the screen").distance_m, 3);
  assert.equal(
    extractCard("customer wants a 12 by 14 foot room done up").distance_feet,
    undefined,
    "room dimensions are not a viewing distance",
  );
  assert.equal(extractCard("customer wants a 12 by 14 foot room done up").space, "12 by 14 feet");
});

test("light, mount, devices and budget are read from ordinary phrasing", () => {
  const card = extractCard(
    "strong afternoon sun on that wall, wall mounted, they have a PS5 and a set-top box, budget around 60k",
  );
  assert.equal(card.light, "bright afternoon sun");
  assert.equal(card.mount, "wall");
  assert.deepEqual(card.devices, ["PS5", "set-top box"]);
  assert.equal(card.budget_rupees, 60000);
});

test("budget is understood in rupees, thousands and lakhs", () => {
  assert.equal(extractCard("budget Rs 55,000").budget_rupees, 55000);
  assert.equal(extractCard("under 80 thousand").budget_rupees, 80000);
  assert.equal(extractCard("upto 1 lakh").budget_rupees, 100000);
});

test("Hinglish counts and phrasing are read too", () => {
  const card = extractCard("ghar mein char log hain, cricket dekhte hain, wall par lagana hai");
  assert.equal(card.family, "4 people");
  assert.deepEqual(card.content, ["cricket"]);
  assert.equal(card.mount, "wall");
});

test("a sentence with nothing in it yields nothing, rather than a guess", () => {
  assert.deepEqual(extractCard("customer walked in and said hello"), {});
  assert.deepEqual(extractCard("ok"), {});
});

test("an absurd distance is not believed", () => {
  assert.equal(extractCard("they sit 400 feet from the wall").distance_feet, undefined);
});
