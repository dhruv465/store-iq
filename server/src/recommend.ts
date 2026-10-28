import { recommendedInches, type Pack, type Product } from "./pack.js";
import type { HomeCard, Reply } from "./types.js";

/** Section 4E and 6.5: three options, a reason for each, and the difference to demonstrate.
 *
 *  Choosing between four products against a filled-in card is arithmetic over structured data, so
 *  it is done here rather than by the model: the result is reproducible, instant, costs no request,
 *  and every number in the reason is read straight off the product it describes. */

export type Option = { product: Product; score: number; reason: string; cue: string };

type Rule = {
  /** Points if it fires, and the reason it supplies when it is the strongest match. */
  weight: number;
  applies: (product: Product, card: HomeCard) => boolean;
  reason: (product: Product) => string;
};

function wants(card: HomeCard, ...needles: string[]): boolean {
  const hay = [...(card.content ?? []), ...(card.devices ?? []), ...(card.priorities ?? [])]
    .join(" ")
    .toLowerCase();
  return needles.some((needle) => hay.includes(needle));
}

function bright(card: HomeCard): boolean {
  return /bright|sun|afternoon|light/i.test(String(card.light ?? ""));
}

/** The viewing distance in inches of screen, from whichever unit the associate gave. */
export function targetInches(card: HomeCard): number | null {
  if (typeof card.distance_m === "number" && card.distance_m > 0)
    return recommendedInches(card.distance_m * 3.28084);
  if (typeof card.distance_feet === "number" && card.distance_feet > 0) return recommendedInches(card.distance_feet);
  return null;
}

const RULES: Rule[] = [
  {
    weight: 30,
    applies: (product, card) => wants(card, "ps5", "console", "gaming", "xbox") &&
      Number(product.specs.hdmi_21_ports) >= 1 && Number(product.specs.refresh_hz) >= 120,
    reason: (product) =>
      `${product.specs.refresh_hz} Hz and ${product.specs.hdmi_21_ports} HDMI 2.1 for the console`,
  },
  {
    weight: 25,
    applies: (product, card) => bright(card) && Number(product.specs.peak_nits) >= 600,
    reason: (product) => `${product.specs.peak_nits} nits holds the picture in that afternoon sun`,
  },
  {
    weight: 18,
    applies: (product, card) => wants(card, "cricket", "sport", "football") && Number(product.specs.refresh_hz) >= 120,
    reason: (product) => `${product.specs.refresh_hz} Hz keeps the ball sharp`,
  },
  {
    weight: 12,
    applies: (product, card) => wants(card, "sound", "music", "audio") && Number(product.specs.speaker_watts) >= 30,
    reason: (product) => `${product.specs.speaker_watts} W speakers, no soundbar needed yet`,
  },
  {
    weight: 8,
    applies: (product, card) => wants(card, "ott", "netflix", "prime", "movie") && !!product.specs.os,
    reason: (product) => `${product.specs.os} has the OTT apps built in`,
  },
];

/** Ranked options for this home. Never more than three, never an out-of-stock product. */
export function rank(pack: Pack, card: HomeCard): Option[] {
  const target = targetInches(card);
  const scored = pack.products
    .filter((product) => product.stock_units > 0)
    .map((product) => {
      let score = 0;
      let best: { weight: number; reason: string } | null = null;
      for (const rule of RULES)
        if (rule.applies(product, card)) {
          score += rule.weight;
          if (!best || rule.weight > best.weight) best = { weight: rule.weight, reason: rule.reason(product) };
        }
      // Size is the thing the brief leads with, so it always contributes and can always explain itself.
      if (target !== null) {
        const off = Math.abs(product.size_inch - target);
        score += Math.max(0, 30 - off * 2.5);
        // Size always counts towards the score, but it is the dullest thing to say: it is often true
        // of every option at once. Only explain with it when nothing more distinguishing applied.
        if (!best)
          best = {
            weight: 1,
            reason:
              off <= 6
                ? `${product.size_inch} inch is the fit at that distance`
                : `${product.size_inch} inch, the closest we stock to the ${target} inch that distance suggests`,
          };
      }
      if (typeof card.budget_rupees === "number" && card.budget_rupees > 0) {
        if (product.price_rupees <= card.budget_rupees) score += 10;
        else score -= 40;
      }
      return {
        product,
        score,
        reason: best?.reason ?? `${product.panel} panel, ${product.good_for[0] ?? "general use"}`,
        cue: product.demo_cue,
      };
    });
  // Stable order: score, then the cheaper one, then the sku, so the same card always ranks the same way.
  scored.sort((a, b) => b.score - a.score || a.product.price_rupees - b.product.price_rupees ||
    a.product.sku.localeCompare(b.product.sku));
  return scored.slice(0, 3);
}

/** "One reason each" means one reason EACH. Where the same reason fits two options, the duplicate is
 *  replaced with a fact that actually separates it from the others, still read straight off the pack. */
export function distinguish(options: Option[]): Option[] {
  const cheapest = Math.min(...options.map((option) => option.product.price_rupees));
  const brightest = Math.max(...options.map((option) => Number(option.product.specs.peak_nits)));
  const loudest = Math.max(...options.map((option) => Number(option.product.specs.speaker_watts)));
  const seen = new Set<string>();
  return options.map((option) => {
    if (!seen.has(option.reason)) {
      seen.add(option.reason);
      return option;
    }
    const product = option.product;
    const separators = [
      product.price_rupees === cheapest && `the lowest price of the three`,
      Number(product.specs.peak_nits) === brightest && `${product.specs.peak_nits} nits, the brightest of the three`,
      Number(product.specs.speaker_watts) === loudest && `${product.specs.speaker_watts} W speakers, the strongest sound here`,
      product.panel !== options[0]!.product.panel && `${product.panel}, a different panel to compare`,
      `${product.specs.os} for the apps`,
    ].filter((entry): entry is string => typeof entry === "string" && !seen.has(entry));
    const reason = separators[0] ?? option.reason;
    seen.add(reason);
    return { ...option, reason };
  });
}

function short(product: Product): string {
  return `${product.brand} ${product.size_inch}"`;
}

/** Three lines, each carrying its own reason and its own demonstration cue. */
export function recommendReply(pack: Pack, card: HomeCard): Reply {
  const options = distinguish(rank(pack, card));
  if (!options.length) return { text: "Nothing in today's pack is in stock for this home." };
  return {
    text: options
      .map(
        (option) =>
          `${short(option.product)} Rs ${option.product.price_rupees.toLocaleString("en-IN")} — ${option.reason}. Show: ${option.cue}`,
      )
      .join("\n")
      .slice(0, 1000),
    buttons: options.map((option) => ({ id: `select:${option.product.sku}`, title: short(option.product).slice(0, 20) })),
  };
}
