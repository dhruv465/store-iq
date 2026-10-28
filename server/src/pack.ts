import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { HomeCard } from "./types.js";

export type Pack = {
  version: string;
  store: { id: string; name: string; city: string };
  shift_brief: Record<string, any>;
  products: Product[];
  offers: Record<string, any>[];
  finance: Record<string, any>[];
  charges: Record<string, any>[];
  accessories: { id: string; title: string; price_rupees: number; for: string }[];
  electricity: { tariff_rupees_per_unit: number; note: string };
  labels: { spec: string; say: string }[];
  myths: { claim: string; confirm: string; correct: string }[];
  install_requirements: Record<string, string[]>;
};
export type Product = {
  sku: string;
  brand: string;
  name: string;
  size_inch: number;
  panel: string;
  mrp_rupees: number;
  price_rupees: number;
  stock_units: number;
  specs: Record<string, number | string>;
  good_for: string[];
  weak_for: string[];
  /** Section 6.5: the difference to show the customer, not just the reason to say. */
  demo_cue: string;
  energy: { typical_watts: number; standby_watts: number; units_per_year_4h_day: number };
};

/** Single source of facts. Prices, offers, stock and finance terms exist only here. */
export async function loadPack(path = process.env.PACK_PATH || "data/pack.json"): Promise<Pack> {
  const pack = JSON.parse(await readFile(resolve(path), "utf8")) as Pack;
  if (!Array.isArray(pack.products) || !pack.products.length) throw Error("Data pack has no products");
  for (const product of pack.products)
    if (!product.sku || !Number.isFinite(product.price_rupees) || !Number.isInteger(product.stock_units))
      throw Error(`Data pack product incomplete: ${product.sku}`);
  return pack;
}

/** Every number Store IQ is allowed to say. Anything else in a reply is an invention. */
export function allowedNumbers(pack: Pack): Set<number> {
  const allowed = new Set<number>();
  const walk = (value: unknown): void => {
    if (typeof value === "number") allowed.add(value);
    // Figures inside prose, such as the "2 PM sunlight" label line, are quotable too.
    else if (typeof value === "string")
      for (const token of value.matchAll(/\d+(?:\.\d+)?/g)) allowed.add(Number(token[0]));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk({ p: pack.products, o: pack.offers, f: pack.finance, c: pack.charges, b: pack.shift_brief,
    l: pack.labels, m: pack.myths, i: pack.install_requirements, s: pack.store,
    a: pack.accessories, e: pack.electricity });
  // Derived totals an answer may legitimately state.
  for (const product of pack.products) {
    for (const offer of pack.offers) {
      const percent = typeof offer.percent === "number"
        ? Math.min(Math.round((product.price_rupees * offer.percent) / 100), Number(offer.cap_rupees ?? Infinity))
        : Number(offer.flat_rupees ?? 0);
      if (percent > 0) { allowed.add(percent); allowed.add(product.price_rupees - percent); }
    }
    allowed.add(product.mrp_rupees - product.price_rupees);
    // An itemised total may name the product with any accessory, and the yearly running cost.
    for (const accessory of pack.accessories ?? []) {
      allowed.add(product.price_rupees + accessory.price_rupees);
      for (const charge of pack.charges)
        if (typeof charge.amount_rupees === "number")
          allowed.add(product.price_rupees + accessory.price_rupees + charge.amount_rupees);
    }
    if (pack.electricity?.tariff_rupees_per_unit && product.energy?.units_per_year_4h_day)
      allowed.add(product.energy.units_per_year_4h_day * pack.electricity.tariff_rupees_per_unit);
    for (const term of pack.finance)
      if (Number(term.months) > 0) allowed.add(Math.round(product.price_rupees / Number(term.months)));
    for (const charge of pack.charges) {
      if (typeof charge.amount_rupees === "number") allowed.add(product.price_rupees + charge.amount_rupees);
      if (typeof charge.percent_of_price === "number")
        allowed.add(Math.round((product.price_rupees * charge.percent_of_price) / 100));
    }
  }
  return allowed;
}

/** Facts for this home only, so the model never sees the whole catalogue as fair game. */
export function factsFor(pack: Pack, card: HomeCard, shortlist: string[]): string {
  const picked = shortlist.length
    ? pack.products.filter((product) => shortlist.includes(product.sku))
    : pack.products;
  const sized = card.distance_feet
    ? picked.filter((product) => Math.abs(product.size_inch - recommendedInches(card.distance_feet!)) <= 12)
    : picked;
  return JSON.stringify({
    store: pack.store,
    products: (sized.length ? sized : picked).map((product) => ({ ...product, in_stock: product.stock_units > 0 })),
    offers: pack.offers,
    finance: pack.finance,
    charges: pack.charges,
    accessories: pack.accessories,
    electricity: pack.electricity,
    labels: pack.labels,
    myths: pack.myths,
    install_requirements: pack.install_requirements,
  });
}

/** Industry rule of thumb for 4K: screen diagonal is about 1.6 times the viewing distance. */
export function recommendedInches(distanceFeet: number): number {
  return Math.round((distanceFeet * 12) / 1.6);
}
