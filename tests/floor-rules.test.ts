import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide, floor, render } from "../server/src/brain.js";
import { newSession, type Event, type Session } from "../server/src/types.js";

/** The contest's own floor rules: "not more than 3 lines and 3 buttons", and, in the judging, a
 *  reason in each answer. They were enforced only on model output, and eight of the nine stages
 *  stopped going through the model — so this walks a whole conversation and holds every reply to
 *  them, whichever path wrote it. */

const pack = await loadPack("data/pack.json");
const dead: typeof fetch = () => Promise.reject(Error("a floor turn must not need the model"));

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

test("every reply on a whole conversation obeys the floor's three lines and three buttons", async () => {
  const session = newSession("919820000001");
  for (const [index, turn] of WALK.entries()) {
    const event: Event = { id: `w${index}`, phone: session.phone, modality: "text", ...turn } as Event;
    const reply = await decide(event, session, pack, dead);
    const lines = reply.text.split("\n");
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
      const reply = await decide(event, session, pack, dead);
      assert.ok(reply.text.split("\n").length <= 3, `${language} turn ${index + 1}: ${reply.text}`);
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
  assert.deepEqual(long.text.split("\n"), ['Ask: "the first thing"', 'Ask: "the second thing"', "↳ the reason"]);
  assert.equal(long.buttons!.length, 3);
});

test("a blank line is not a line", () => {
  assert.equal(floor({ text: "one\n\n\ntwo" }).text, "one\ntwo");
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
