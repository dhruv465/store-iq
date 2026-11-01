import { t, type Lang } from "./i18n.js";
import type { Pack, Product } from "./pack.js";
import { cueFor } from "./recommend.js";
import type { Reply } from "./types.js";

/** The customer is standing at one set, or the associate has just photographed its shelf tag, and
 *  what they need is everything about THAT set in one glance. All of it is already in the pack, so
 *  this spends no model request and cannot invent a figure.
 *
 *  shortcut: a QR code is only matched through whatever text a reader makes of it; nothing here
 *  decodes one. Upgrade when the real pack's tags carry a payload we can test against. */

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Model codes as a tag prints them: "65UT8050", "C6K", "QE1D". A token needs both a letter and a
 *  digit to count as one, which keeps "4K" and a bare screen size out of it. */
function codes(product: Product): string[] {
  return `${product.sku} ${product.name}`
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length >= 3 && /[a-z]/i.test(token) && /\d/.test(token) && !/^4k$/i.test(token))
    .map(squash);
}

function named(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[^A-Za-z0-9]/g, "")}\\b`, "i").test(text);
}

/** The set being pointed at: by SKU, by the model code on the tag, or by brand and size. */
export function findProduct(pack: Pack, text: string | undefined): Product | null {
  if (!text) return null;
  const flat = squash(text);
  if (flat.length < 3) return null;
  const bySku = pack.products.find((product) => flat.includes(squash(product.sku)));
  if (bySku) return bySku;
  // A code is matched against the words themselves, not against the text with its spaces removed:
  // "about 800 nits" squashes to "about800nits", which contains "ut80" and used to return the LG.
  const words = new Set(
    text
      .split(/[^A-Za-z0-9]+/)
      .map(squash)
      .filter(Boolean),
  );
  const byCode = pack.products.find((product) => codes(product).some((code) => words.has(code)));
  if (byCode) return byCode;
  const brand = pack.products.filter((product) => named(text, product.brand));
  if (!brand.length) return null;
  // "the Samsung 55" is unambiguous even when the tag is out of reach; a size alone never is.
  const sized = brand.filter((product) => named(text, String(product.size_inch)));
  if (sized.length === 1) return sized[0]!;
  return brand.length === 1 ? brand[0]! : null;
}

function inr(amount: number): string {
  return `Rs ${amount.toLocaleString("en-IN")}`;
}

/** Everything about one set, in three lines. The "pick this one" tap appears only once the home is
 *  assessed, so reading a tag out loud still cannot jump the floor order. */
export function productReply(product: Product, lang: Lang, assessed: boolean): Reply {
  const lines = [
    `${product.name} · ${inr(product.price_rupees)} · ${product.stock_units > 0 ? t(lang, "p.stock", { n: product.stock_units }) : t(lang, "p.out")}`,
    // A live catalogue lists what a thing is good at and never what it is weak at, so the weak
    // half is dropped rather than printed as "Weak: ." on every real product.
    [
      product.good_for.length ? t(lang, "p.strong", { v: product.good_for.slice(0, 4).join(", ") }) : "",
      product.weak_for.length ? t(lang, "p.weak", { v: product.weak_for.join(", ") }) : "",
    ]
      .filter(Boolean)
      .join(" "),
    t(lang, "p.show", { v: cueFor(product, lang) }),
  ];
  return {
    text: [...lines, assessed ? "" : `↳ ${t(lang, "p.reason")}`].filter(Boolean).join("\n").slice(0, 1000),
    buttons: [
      ...(assessed ? [{ id: `select:${product.sku}`, title: t(lang, "btn.pick") }] : []),
      { id: "recommend", title: t(lang, "btn.three") },
      { id: "card:show", title: t(lang, "btn.showcard") },
    ],
  };
}

/** The figures a label prints, as the associate would read them out. */
const LABEL_FIGURE: Record<string, RegExp> = {
  peak_nits: /(\d{2,5})\s*nits?\b/i,
  refresh_hz: /(\d{2,3})\s*hz\b/i,
  hdmi_21_ports: /(\d)\s*(?:x\s*)?hdmi\b/i,
  speaker_watts: /(\d{1,3})\s*w(?:att)?s?\b/i,
};

/** Section 4D: a spec on the label becomes one line about this home. The pack carries the sentence
 *  for each spec, so the whole step is a lookup. */
export function translateSpec(pack: Pack, text: string | undefined, product: Product | null, lang: Lang): Reply | null {
  if (!text) return null;
  for (const label of pack.labels ?? []) {
    const found = LABEL_FIGURE[label.spec]?.exec(text);
    if (!found) continue;
    // The matched set's own figure beats one read off a photo, which may have been misread.
    const value = product?.specs?.[label.spec] ?? found[1]!;
    return {
      text: [t(lang, "val.say", { body: label.say.replace("{value}", String(value)) }), t(lang, "tr.reason")].join(
        "\n",
      ),
    };
  }
  return null;
}
