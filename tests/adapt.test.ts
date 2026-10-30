import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptPack, adaptProduct, figure, fromFdk, fromPromotion, running } from "../server/src/adapt.js";
import { rank } from "../server/src/recommend.js";
import type { Pack } from "../server/src/pack.js";

/** The real catalogue will arrive in its own shape. These are the shapes a retail export actually
 *  takes — spaced and capitalised headers, rupee signs, units inside the value — and the point of
 *  the adapter is that none of them needs a change anywhere but its name list. */

const vendorRow = {
  "Article Code": "RD-TCL-55C6",
  "Brand Name": "TCL",
  "Article Description": "TCL 55 inch C6K QD-Mini LED",
  "Screen Size": "55 inch",
  "Panel Type": "QD-Mini LED",
  MRP: "₹89,990",
  "Selling Price": "₹54,990.00",
  "Available Qty": "9",
  "Peak Brightness": "800 nits",
  "Refresh Rate": "144Hz",
  "HDMI 2.1": 2,
  "Sound Output": "30 W",
  "Operating System": "Google TV",
  "Best For": "bright living room; PS5 gaming; cricket",
  "Power Consumption Watts": 130,
};

test("a figure survives rupee signs, commas, decimals and units", () => {
  assert.equal(figure("₹54,990.00"), 54990);
  assert.equal(figure("55 inch"), 55);
  assert.equal(figure("144Hz"), 144);
  assert.equal(figure(54990), 54990);
  assert.equal(figure("out of stock"), undefined);
});

test("a vendor row with its own headers becomes a product we can serve", () => {
  const { product, missing } = adaptProduct(vendorRow);
  assert.deepEqual(missing, []);
  assert.equal(product.sku, "RD-TCL-55C6");
  assert.equal(product.price_rupees, 54990);
  assert.equal(product.size_inch, 55);
  assert.equal(product.stock_units, 9);
  assert.equal(product.specs.refresh_hz, 144);
  assert.equal(product.specs.hdmi_21_ports, 2);
  assert.deepEqual(product.good_for, ["bright living room", "PS5 gaming", "cricket"]);
  // Four hours a day for a year at 130 W.
  assert.equal(product.energy.units_per_year_4h_day, 190);
});

test("the ranking reasons about a vendor row exactly as it does about ours", () => {
  const { pack } = adaptPack({ products: [vendorRow] } as never);
  const options = rank(pack as Pack, { distance_m: 3, light: "bright afternoon sun", devices: ["PS5"] });
  assert.equal(options[0]?.product.sku, "RD-TCL-55C6");
  assert.match(options[0]!.reason, /144 Hz and 2 HDMI 2.1 for the console/);
});

test("a row that cannot be served says which row, which field, and where to fix it", () => {
  const { problems } = adaptPack({
    products: [
      vendorRow,
      {
        "Article Code": "RD-BROKEN",
        "Brand Name": "Haier",
        "Article Description": "Haier 43",
        "Screen Size": 43,
        "Available Qty": 3,
      },
    ],
  } as never);
  assert.equal(problems.length, 2);
  assert.match(problems[0]!, /row 2 \(RD-BROKEN\): no price_rupees\. Add its name to FIELDS\.price_rupees/);
  assert.match(problems[1]!, /price is 0/);
});

test("a duplicate sku is caught before it can be quoted twice", () => {
  const { problems } = adaptPack({ products: [vendorRow, vendorRow] } as never);
  assert.ok(problems.some((problem) => /duplicate sku/.test(problem)));
});

test("our own pack passes through the adapter unchanged", async () => {
  const { loadPack } = await import("../server/src/pack.js");
  const pack = await loadPack("data/pack.json");
  const tcl = pack.products.find((product) => product.sku === "TCL-55C6KS")!;
  assert.equal(tcl.price_rupees, 54990);
  assert.equal(tcl.specs.refresh_hz, 144);
  assert.match(tcl.demo_cue, /Cricket clip/);
  assert.equal(tcl.demo_cue_hi !== undefined, true, "the Hindi cue survives the adapter");
});

/** One ProductListingDetail as getProducts returns it, with the fields the reference documents. */
const fdkRow = {
  uid: 7501234,
  name: "Sony Bravia 2 55 inch 4K LED Google TV",
  slug: "sony-bravia-2-55-inch-4k-led-google-tv",
  item_code: "SON-K55S30",
  short_description: "4K LED with Google TV",
  brand: { uid: 12, name: "Sony", logo: { url: "https://x/logo.png" } },
  categories: [{ uid: 3, name: "Televisions" }],
  price: {
    marked: { min: 79900, max: 79900, currency_code: "INR", currency_symbol: "₹" },
    effective: { min: 62990, max: 62990, currency_code: "INR", currency_symbol: "₹" },
  },
  highlights: ["bright living room", "OTT", "news"],
  attributes: { display_type: "LED", peak_nits: 400, refresh_rate: "60Hz", speaker_watts: "20 W" },
  sellable: true,
  rating: 4.3,
};

test("a product from the live catalogue becomes one we can serve", () => {
  const { product, missing } = adaptProduct(fromFdk(fdkRow));
  assert.deepEqual(missing, []);
  assert.equal(product.sku, "SON-K55S30");
  assert.equal(product.brand, "Sony");
  assert.equal(product.price_rupees, 62990, "effective, not marked");
  assert.equal(product.mrp_rupees, 79900);
  // "55 inch" is in the name far more reliably than in a named attribute.
  assert.equal(product.size_inch, 55);
  assert.equal(product.panel, "LED");
  assert.deepEqual(product.good_for, ["bright living room", "OTT", "news"]);
  assert.equal(product.specs.peak_nits, 400);
  assert.equal(product.specs.refresh_hz, 60, '"60Hz" is read as a number');
});

test("the ranking reasons about a live catalogue row exactly as it does about ours", () => {
  const { pack } = adaptPack({ products: [fromFdk(fdkRow)] } as never);
  const options = rank(pack as Pack, { distance_m: 2.5, light: "bright afternoon sun", content: ["news"] });
  assert.equal(options[0]?.product.sku, "SON-K55S30");
  assert.ok(options[0]!.reason.length > 0, "and gives a reason from its own figures");
});

test("a product the shop cannot sell today is out of stock, not absent", () => {
  const { product } = adaptProduct(fromFdk({ ...fdkRow, sellable: false }));
  assert.equal(product.stock_units, 0);
  // Units come from the stock-status endpoint; sellable is only a yes or no.
  assert.equal(adaptProduct(fromFdk(fdkRow)).product.stock_units, 1);
});

test("the screen size is the number before inch, not the first number in the name", () => {
  // "Sony Bravia 2 55 inch" — the first number is the model line, not the screen.
  assert.equal(adaptProduct(fromFdk({ ...fdkRow, attributes: {} })).product.size_inch, 55);
  assert.equal(adaptProduct(fromFdk({ name: 'LG 4 Series 65" UHD', price: {} })).product.size_inch, 65);
  assert.equal(adaptProduct(fromFdk({ name: "Samsung Series 7 Washing Machine", price: {} })).product.size_inch, 0);
});

/** One PromotionOffer as getPromotionOffers returns it, with the fields the reference documents. */
const promotion = {
  id: "661f0c5d8a",
  offer_text: "10% off up to Rs 8,000 on HDFC credit cards",
  promotion_name: "HDFC October",
  promotion_type: "bank_offer",
  promotion_group: "bank",
  valid_till: "2026-11-30T18:30:00.000Z",
  description: "On HDFC credit cards. Not valid with no-cost EMI.",
  discount_rules: [{ some_key_we_have_not_seen: 10 }],
};

test("a live promotion becomes an offer, with its own words and no figure of ours", () => {
  const offer = fromPromotion(promotion);
  assert.equal(offer.id, "661f0c5d8a");
  assert.equal(offer.title, "10% off up to Rs 8,000 on HDFC credit cards");
  assert.equal(offer.applies_to, "bank");
  assert.match(String(offer.needs), /no-cost EMI/);
  // discount_rules is undocumented, so nothing is read off it and nothing is computed from it.
  assert.equal(offer.percent, undefined);
  assert.equal(offer.flat_rupees, undefined);
});

test("an offer that has run out is not running", () => {
  const nov = Date.parse("2026-11-01T00:00:00.000Z");
  assert.equal(running(fromPromotion(promotion), nov), true);
  assert.equal(running(fromPromotion(promotion), Date.parse("2026-12-01T00:00:00.000Z")), false);
  assert.equal(running({ title: "no end date" }, nov), true, "an offer with no end date is on");
});

test("the floor questions a listing can answer come through with the specs", () => {
  const { product } = adaptProduct(fromFdk({ ...fdkRow, country_of_origin: "Vietnam" }));
  assert.equal(product.specs.country_of_origin, "Vietnam");
  assert.equal(product.specs.rating, 4.3);
});
