import type { HomeCard } from "./types.js";

/** Pulls home-card facts out of what the associate typed or said.
 *
 *  A model does this better and handles phrasing this cannot. But it runs in microseconds, costs no
 *  quota, and keeps the floor working when the model is unavailable, so it runs first and the model
 *  only sees what it could not read. It only takes what it is confident about: a pattern that does
 *  not clearly match leaves the field empty rather than guessing. */

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5,
};

function number(raw: string): number | null {
  const word = WORD_NUMBERS[raw.toLowerCase()];
  if (word) return word;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

const NUM = "(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch)";

export function extractCard(text: string): Partial<HomeCard> {
  const card: Partial<HomeCard> = {};
  const lower = text.toLowerCase();

  // Room dimensions, as the brief's own example gives them: "a 12-by-14-foot living room".
  // "12 by 14", "12x14" and the brief's own hyphenated "12-by-14-foot" all mean the same room.
  const space = lower.match(/(\d+)[\s-]*(?:by|x|×|\*)[\s-]*(\d+)[\s-]*(?:foot|feet|ft)?/);
  if (space) card.space = `${space[1]} by ${space[2]} feet`;

  const metres = lower.match(new RegExp(`${NUM}\\s*(?:-\\s*\\d+\\s*)?(?:m|mtr|meters?|metres?)\\b`));
  const feet = lower.match(new RegExp(`${NUM}\\s*(?:-\\s*\\d+\\s*)?(?:feet|foot|ft)\\b`));
  // "sits 8 feet away" is a distance; "a 12 by 14 foot room" is not, and is already taken as space.
  const distanceContext = /(sit|sits|sitting|away|distance|far|from the (tv|wall|screen))/.test(lower);
  if (metres && (distanceContext || !space)) {
    const value = number(metres[1]!);
    if (value && value > 0 && value < 15) card.distance_m = value;
  } else if (feet && distanceContext) {
    const value = number(feet[1]!);
    if (value && value > 0 && value < 40) card.distance_feet = value;
  }

  const room = lower.match(/\b(living room|drawing room|bedroom|hall|dining room|kitchen|shop)\b/);
  if (room) card.room = room[1]!;

  if (/\b(bright|sunny|sunlight|afternoon sun|lots of light|dhoop)\b/.test(lower)) card.light = "bright afternoon sun";
  else if (/\b(dim|dark|no sunlight|curtain|shaded)\b/.test(lower)) card.light = "dim";

  if (/\bwall[- ]?(mount|mounted|par)\b|\bmount on the wall\b/.test(lower)) card.mount = "wall";
  else if (/\b(table|stand|tabletop|table[- ]top)\b/.test(lower)) card.mount = "table";

  const content: string[] = [];
  if (/\b(cricket|ipl|match)\b/.test(lower)) content.push("cricket");
  if (/\b(sport|sports|football)\b/.test(lower)) content.push("sports");
  if (/\b(ott|netflix|prime|hotstar|movie|movies|film)\b/.test(lower)) content.push("OTT");
  if (/\b(news|serial|serials|saas|tv shows?)\b/.test(lower)) content.push("news");
  if (/\b(gaming|games?)\b/.test(lower)) content.push("gaming");
  if (content.length) card.content = [...new Set(content)];

  const devices: string[] = [];
  if (/\b(ps5|ps4|playstation|xbox|console)\b/.test(lower)) devices.push("PS5");
  if (/\b(set[- ]?top|settop|dth|tata play|dish)\b/.test(lower)) devices.push("set-top box");
  if (/\b(soundbar|sound bar|home theatre|home theater)\b/.test(lower)) devices.push("soundbar");
  if (devices.length) card.devices = [...new Set(devices)];

  const family = lower.match(new RegExp(`${NUM}\\s*(?:people|persons?|members?|log|jan)\\b`));
  if (family) {
    const value = number(family[1]!);
    if (value && value > 0 && value < 30) card.family = `${value} people`;
  }

  // "budget 60000", "under 60k", "around Rs 60,000"
  const budget = lower.match(/(?:budget|under|below|around|upto|up to|max|within)\s*(?:rs\.?|₹|inr)?\s*([\d,]+)\s*(k|thousand|lakh)?/);
  if (budget) {
    let value = Number(budget[1]!.replace(/,/g, ""));
    if (budget[2] === "k" || budget[2] === "thousand") value *= 1000;
    if (budget[2] === "lakh") value *= 100000;
    if (Number.isFinite(value) && value >= 1000 && value <= 10_000_000) card.budget_rupees = value;
  }

  const priorities: string[] = [];
  if (/\b(sound|audio|bass|music|speakers?)\b/.test(lower)) priorities.push("sound");
  if (/\b(picture quality|picture|display|screen quality)\b/.test(lower)) priorities.push("picture");
  if (/\b(warranty|service|guarantee)\b/.test(lower)) priorities.push("warranty");
  if (priorities.length) card.priorities = [...new Set(priorities)];

  // Why they are replacing, which section 3 asks for.
  const replacing = lower.match(/\b(old|current|existing|purana)\s+(tv|television|set)\b[^.]{0,40}/);
  if (replacing) card.replacing = replacing[0].trim().slice(0, 60);

  return card;
}

/** Human-readable list of what was just understood, for the "Noted:" line. */
export function describe(card: Partial<HomeCard>): string {
  return Object.entries(card)
    .map(([field, value]) => `${field.replace(/_/g, " ")} = ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("; ");
}
