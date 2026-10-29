import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptProduct, adaptPack, figure } from "../server/src/adapt.js";
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
