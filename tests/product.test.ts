import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { findProduct, productReply, translateSpec } from "../server/src/product.js";
import { decide } from "../server/src/brain.js";
import { newSession } from "../server/src/types.js";
import type { Event } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");
const dead: typeof fetch = () => Promise.reject(Error("the model must not be reached for a pack fact"));
const said = (text: string): Event => ({ id: "m1", phone: "919000000000", modality: "text", text });

test("the set is found by sku, by the code on the tag, and by brand with size", () => {
  assert.equal(findProduct(pack, "sku SON-K55S30 pe kya rate hai")?.sku, "SON-K55S30");
  assert.equal(findProduct(pack, "customer is standing at the 65UT8050")?.sku, "LG-65UT8050");
  assert.equal(findProduct(pack, "the C6K one")?.sku, "TCL-55C6KS");
  assert.equal(findProduct(pack, "tell me about the Samsung 55")?.sku, "SAM-55QE1D");
  assert.equal(
    findProduct(pack, "the Sony"),
    pack.products.find((p) => p.brand === "Sony"),
    "one Sony in the pack is unambiguous",
  );
});

test("a bare size or an unknown brand names no set", () => {
  assert.equal(findProduct(pack, "55 inch dikhao"), null, "three sets are 55 inch");
  assert.equal(findProduct(pack, "do you have a Panasonic"), null);
  assert.equal(findProduct(pack, "4k"), null);
});

test("the sheet carries price, stock, both sides and the cue, and withholds the pick until the home is known", () => {
  const product = pack.products.find((candidate) => candidate.sku === "TCL-55C6KS")!;
  const cold = productReply(product, "en", false);
  assert.match(cold.text, /Rs 54,990/);
  assert.match(cold.text, /9 in stock/);
  assert.match(cold.text, /Weak:/);
  assert.match(cold.text, /Show them:/);
  assert.ok(!cold.buttons!.some((button) => button.id.startsWith("select:")), "no pick before the home is assessed");
  const warm = productReply(product, "en", true);
  assert.ok(warm.buttons!.some((button) => button.id === "select:TCL-55C6KS"));
  assert.match(productReply(product, "hi", false).text, /स्टॉक में/);
});

test("a label figure becomes a line about this home, and prefers the matched set's own spec", () => {
  const read = translateSpec(pack, "the tag says 800 nits", null, "en");
  assert.match(read!.text, /800 nits means the picture stays readable/);
  const product = pack.products.find((candidate) => candidate.sku === "TCL-55C6KS")!;
  const misread = translateSpec(pack, "label looks like 8OO nits, 144 Hz", product, "en");
  assert.match(misread!.text, /144 Hz/, "the pack's own figure wins over a misread one");
  assert.equal(translateSpec(pack, "nice colours on this one", null, "en"), null);
});

test("naming a set answers from the pack without reaching the model, and shortlists it", async () => {
  const session = newSession("919000000000");
  const reply = await decide(said("customer is looking at the TCL 55 inch, batao sab"), session, pack, dead);
  assert.match(reply.text, /Rs 54,990/);
  assert.deepEqual(session.shortlist, ["TCL-55C6KS"]);
});

test("a home fact in the same message still goes to the card first", async () => {
  const session = newSession("919000000000");
  const reply = await decide(said("they sit 3 m away and want a Samsung"), session, pack, dead);
  assert.equal(session.card.distance_m, 3);
  assert.doesNotMatch(reply.text, /Rs 71,990/, "the price is not quoted before the home is read");
});

test("asking which ones are good before the home is known returns a question, not a product", async () => {
  const session = newSession("919000000000");
  const reply = await decide(said("which ones are good?"), session, pack, dead);
  assert.match(reply.text, /Two quick questions first/);
  assert.match(reply.text, /Ask:/);
  assert.ok(!/Rs /.test(reply.text), "no price before the home");
});

test("a photo whose label cannot be read asks for the model number instead of failing", async () => {
  const session = newSession("919000000000");
  const event: Event = {
    id: "m2",
    phone: "919000000000",
    modality: "image",
    image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" },
  };
  const reply = await decide(event, session, pack, dead);
  assert.match(reply.text, /could not read a model/);
});

test("a tag's own figures do not hijack the answer: a photo asks about the set", async () => {
  const session = newSession("919000000000");
  const event: Event = {
    id: "m4",
    phone: "919000000000",
    modality: "image",
    // What the label reader returns for a shelf tag: the set AND its printed figures.
    text: "TCL, TCL-55C6KS, 55 inch, 800 nits, 144 Hz, 2 x HDMI 2.1",
    image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" },
  };
  const reply = await decide(event, session, pack, dead);
  assert.match(reply.text, /Rs 54,990/, "the set, not a lecture about nits");
  assert.doesNotMatch(reply.text, /2 PM sunlight/);
});

test("the same figures typed by hand are a question about the figure", async () => {
  const session = newSession("919000000000");
  const reply = await decide(said("what do I say about 800 nits"), session, pack, dead);
  assert.match(reply.text, /2 PM sunlight/);
});

test("a photo whose caption names the set is answered from the pack", async () => {
  const session = newSession("919000000000");
  const event: Event = {
    id: "m3",
    phone: "919000000000",
    modality: "image",
    text: "LG 65UT8050",
    image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" },
  };
  const reply = await decide(event, session, pack, dead);
  assert.match(reply.text, /Rs 79,990/);
});
