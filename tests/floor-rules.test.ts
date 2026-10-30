import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide, floor, pretty, render } from "../server/src/brain.js";
import { newSession, type Event, type Session } from "../server/src/types.js";
import { manager } from "./model.js";

/** The contest's own floor rules: "not more than 3 lines and 3 buttons", and, in the judging, a
 *  reason in each answer. They were enforced only on model output, and eight of the nine stages
 *  stopped going through the model — so this walks a whole conversation and holds every reply to
 *  them, whichever path wrote it. */

const pack = await loadPack("data/pack.json");
/** A manager who writes too much, on purpose: five lines and five buttons. The turns that go
 *  through the model are held to the floor's shape by floor(), not by the model's restraint. */
const wordy = (): ReturnType<typeof manager> =>
  manager({
    lines: ["First line", "Second line", "Third line", "Fourth line", "Fifth line"],
    buttons: [
      { id: "a", title: "One" },
      { id: "b", title: "Two" },
      { id: "c", title: "Three" },
      { id: "d", title: "Four" },
      { id: "e", title: "Five" },
    ],
    reason: "a reason of its own",
  });

const WALK: ({ text: string } | { action: string })[] = [
  { text: "new customer" },
  { text: "brief" },
  { text: "hall, 3 m away, 4 people, cricket and PS5, bright window, wall mount" },
  { action: "card:confirmed" },
  { text: "customer says LED and QLED are the same thing" },
  { text: "the tag says 800 nits" },
  { text: "customer says it is too costly" },
  { text: "recommend" },
  { action: "select:TCL-55C6KS" },
  { action: "add:TV-WALL" },
  { action: "consent:yes" },
  { action: "site:ok" },
  { text: "what is the EMI" },
  { text: "review" },
];

/** The recommend step spends all three lines on three options, each carrying its own reason, which
 *  is the one shape where a separate reason line would push it over the limit. */
const REASON_INSIDE_THE_LINE = /Show:|दिखाइए:|दाखवा:/;

/** Lines of something to read. A reply is spaced with a blank line between each part, because
 *  WhatsApp renders one as space, and the contest's limit of three counts what there is to read. */
const content = (text: string): string[] => text.split("\n").filter((line) => line.trim());

test("every reply on a whole conversation obeys the floor's three lines and three buttons", async () => {
  const session = newSession("919820000001");
  for (const [index, turn] of WALK.entries()) {
    const event: Event = { id: `w${index}`, phone: session.phone, modality: "text", ...turn } as Event;
    const reply = await decide(event, session, pack, wordy().fetch);
    const lines = content(reply.text);
    const what = `turn ${index + 1} (${JSON.stringify(turn)}): ${reply.text}`;
    assert.ok(lines.length <= 3, `more than three lines — ${what}`);
    assert.ok((reply.buttons ?? []).length <= 3, `more than three buttons — ${what}`);
    assert.ok(reply.text.includes("↳") || REASON_INSIDE_THE_LINE.test(reply.text), `no reason in the answer — ${what}`);
  }
});

test("the same walk in Hindi and in Marathi keeps the same shape", async () => {
  for (const language of ["hi", "mr"] as const) {
    const session: Session = Object.assign(newSession("919820000002"), { language });
    for (const [index, turn] of WALK.entries()) {
      const event: Event = { id: `w${index}`, phone: session.phone, modality: "text", ...turn } as Event;
      const reply = await decide(event, session, pack, wordy().fetch);
      assert.ok(content(reply.text).length <= 3, `${language} turn ${index + 1}: ${reply.text}`);
      assert.ok((reply.buttons ?? []).length <= 3, `${language} turn ${index + 1}`);
    }
  }
});

test("the gate keeps the words to say and drops the reason when something has to go", () => {
  const long = floor({
    text: '↳ the reason\nAsk: "the first thing"\nAsk: "the second thing"\nAsk: "the third thing"',
    buttons: [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
      { id: "d", title: "D" },
    ],
  });
  // Trimmed first, then formatted: the words to say come out emboldened, the reason italic, and a
  // blank line between each.
  assert.equal(long.text, 'Ask: "*the first thing*"\n\nAsk: "*the second thing*"\n\n_↳ the reason_');
  assert.equal(long.buttons!.length, 3);
});

test("a blank line is not a line", () => {
  // Blank lines in, one blank line out between each part: what is counted is what there is to read.
  assert.deepEqual(content(floor({ text: "one\n\n\ntwo" }).text), ["one", "two"]);
  assert.equal(floor({ text: "one\n\n\ntwo" }).text, "one\n\ntwo");
});

test("a reason with nothing to do is not an answer", () => {
  // The model sometimes returns only its justification. An associate reading "↳ the viewing
  // distance is the most important factor" has been told nothing to do.
  const reply = render({
    step: "assess",
    card: {},
    shortlist: [],
    demonstrated: false,
    lines: [],
    buttons: [],
    reason: "the viewing distance is the most important factor",
  });
  const lines = reply.text.split("\n");
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines[0]!, /^↳/, "something to do comes first");
  assert.match(lines[1]!, /^↳/);
});

test("WhatsApp's own formatting, and nothing it would render as litter", () => {
  const one = (text: string): string => pretty({ text }).text;
  // The sentence to speak is what the eye should land on.
  assert.equal(one('Ask: "How far will they sit?"'), 'Ask: "*How far will they sit?*"');
  // An inch mark is a double quote. A looser rule paired two of them and emboldened the gap
  // between two televisions: `Sony 55"* LED · LG 65*" LED`.
  assert.equal(one('On the floor: Sony 55" LED · LG 65" LED'), '*On the floor:* Sony 55" LED · LG 65" LED');
  // One weight per line: the label takes it, so the figures on that line stay plain.
  assert.equal(one("Wall mount: Rs 1,499 fitted"), "*Wall mount:* Rs 1,499 fitted");
  // And where there is no label, the price is what the eye should find.
  assert.equal(one("TCL 55 inch · Rs 54,990 · 9 in stock"), "TCL 55 inch · *Rs 54,990* · 9 in stock");
  assert.equal(one("↳ because the room decides"), "_↳ because the room decides_");
  // A line with neither is left alone rather than decorated for its own sake.
  assert.equal(one("Right?"), "Right?");
});

test("the prompt names the sizes the shop can actually hand over", async () => {
  // Told only the rule of thumb, it answered a real associate "6 फीट की दूरी के लिए 43 इंच का टीवी
  // सही रहेगा" — and this shop stocks no 43. The guard let it through because the shift brief's own
  // question mentions 43 inch, which is how a figure can be quotable and still be wrong.
  const session = newSession("919820000009");
  session.card = { distance_feet: 6 };
  const model = manager({ lines: ["x"] });
  await decide(
    { id: "s1", phone: session.phone, modality: "text", text: "they sit 6 feet away" } as Event,
    session,
    pack,
    model.fetch,
  );
  const sent = model.prompts.join(" ");
  assert.match(sent, /In stock today, in inches: 55, 65/);
  assert.match(sent, /Never name a size that is not on that list/);
});
