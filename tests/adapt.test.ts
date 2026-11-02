import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptPack, adaptProduct, figure, fromFdk, fromPromotion, running } from "../server/src/adapt.js";

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
  assert.equal(product.energy.units_per_year_4h_day, 190);
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
  assert.equal(product.size_inch, 55);
  assert.equal(product.panel, "LED");
  assert.deepEqual(product.good_for, ["bright living room", "OTT", "news"]);
  assert.equal(product.specs.peak_nits, 400);
  assert.equal(product.specs.refresh_hz, 60, '"60Hz" is read as a number');
});

test("a product the shop cannot sell today is out of stock, not absent", () => {
  const { product } = adaptProduct(fromFdk({ ...fdkRow, sellable: false }));
  assert.equal(product.stock_units, 0);
  assert.equal(adaptProduct(fromFdk(fdkRow)).product.stock_units, 1);
});

test("the screen size is the number before inch, not the first number in the name", () => {
  assert.equal(adaptProduct(fromFdk({ ...fdkRow, attributes: {} })).product.size_inch, 55);
  assert.equal(adaptProduct(fromFdk({ name: 'LG 4 Series 65" UHD', price: {} })).product.size_inch, 65);
  assert.equal(adaptProduct(fromFdk({ name: "Samsung Series 7 Washing Machine", price: {} })).product.size_inch, 0);
});

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

const liveOffer = {
  id: "69b25c62744fd8d69d6c7fd4",
  promotion_type: "free_gift_items",
  promotion_name: "MAR29226",
  offer_text: "MAR29226\n",
  description: '<table width="141"><tbody><tr><td>MAR29226</td></tr></tbody></table><style>.x{max-width:100%}</style>',
  promotion_group: "product",
  valid_till: "2027-03-31T18:25:00+00:00",
  free_gift_items: [{ item_id: 7517594, item_name: "SONY WALL MOUNT WM 60 65", item_brand_name: "Sony" }],
  discount_rules: [{ discount_type: "free_gift_items", offer: { max_offer_quantity: 1 } }],
};

test("a live promotion is read for what it does, not for its reference", () => {
  const offer = fromPromotion(liveOffer);
  assert.equal(offer.title, "Free with it: SONY WALL MOUNT WM 60 65");
  assert.equal(offer.applies_to, "product");
  assert.equal(offer.valid_till, "2027-03-31T18:25:00+00:00");
  assert.equal(offer.needs, undefined);
  assert.equal(offer.percent, undefined, "no amount is read: discount_rules says the kind, not how much");

  assert.equal(fromPromotion({ ...liveOffer, free_gift_items: [] }).title, "Offer MAR29226");
  assert.equal(
    fromPromotion({ offer_text: "10% off on HDFC cards", free_gift_items: [] }).title,
    "10% off on HDFC cards",
  );
});

test("the listing's power figure and who it is for come through, and no cue is made up", () => {
  const { product } = adaptProduct(
    fromFdk({
      ...fdkRow,
      highlights: ["Top Loading"],
      attributes: { power_consumption: "421.25 W", "recommended-for": "Large Families" },
    }),
  );
  assert.equal(product.energy.typical_watts, 421.25);
  assert.ok(product.good_for.includes("Large Families"));
  assert.equal(product.demo_cue, "", "a sentence the store never wrote is not a fact");
  assert.equal(adaptProduct(fromFdk({ name: "x", price: {} })).product.panel, "", "a phone has no LED panel");
});

test("a row's own offers come out of _custom_meta, with figures the guard can check", () => {
  const specs = (meta: { key: string; value: string }[], extra = {}): Record<string, unknown> =>
    adaptProduct(fromFdk({ ...fdkRow, _custom_meta: meta, ...extra })).product.specs;

  const phone = specs(
    [
      {
        key: "pg_offer",
        value: JSON.stringify({ bank: "ICICI BANK NO COST EMI", subtitle: "26315.46/6", discount: "7007.24" }),
      },
      { key: "Tag1", value: "12.5% Upto 10,000 HDFC/ICICI CC*" },
      { key: "Tag2", value: "PRE_ORDER" },
    ],
    { discount: "42% OFF" },
  );
  assert.equal(
    phone.bank_offer,
    "ICICI BANK NO COST EMI: 6 months at Rs 26315 a month, Rs 157890 in all, saves Rs 7007",
  );
  assert.equal(phone.offer_tag, "12.5% Upto 10,000 HDFC/ICICI CC*");
  assert.equal(phone.status, "pre order");
  assert.equal(phone.discount, "42% OFF");

  const flat = specs([{ key: "pg_offer", value: JSON.stringify({ bank: "IDFC", subtitle: "", discount: "15000" }) }]);
  assert.equal(flat.bank_offer, "IDFC card: saves Rs 15000");

  const none = specs([
    { key: "pg_offer", value: "not json" },
    { key: "Tag1", value: "NONE" },
  ]);
  assert.equal(none.bank_offer, undefined);
  assert.equal(none.offer_tag, undefined);
});

test("the contact details on every row are not specs", () => {
  const { product } = adaptProduct(
    fromFdk({
      ...fdkRow,
      attributes: { "customer-care-number": "1800", "manufacturer-address": "x", "net-quantity": "1", ram: "8 GB" },
    }),
  );
  assert.deepEqual(Object.keys(product.specs).sort(), ["ram", "rating"]);
});
