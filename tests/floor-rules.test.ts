import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { decide, floor, pretty, render } from "../server/src/brain.js";
import { newSession, type Event, type Session } from "../server/src/types.js";
import { manager } from "./model.js";

const pack = await loadPack("data/pack.json");
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
  { action: "sold" },
  { action: "site:ok" },
  { action: "summary:customer" },
  { action: "consent:yes" },
  { action: "charges" },
  { text: "what is the EMI" },
  { text: "review" },
];

const content = (text: string): string[] => text.split("\n").filter((line) => line.trim());

test("every reply on a whole conversation obeys the floor's three lines and three buttons", async () => {
  const session = newSession("919820000001");
  for (const [index, turn] of WALK.entries()) {
    const event: Event = { id: `w${index}`, phone: session.phone, modality: "text", ...turn } as Event;
    const reply = await decide(event, session, pack, wordy().fetch);
    const lines = content(reply.text);
    const what = `turn ${index + 1} (${JSON.stringify(turn)}): ${reply.text}`;
    // The Sold handover carries the delivery questions and the bill, so the associate need not ask.
    const cap = /Follow-ups set/.test(reply.text) ? 6 : 3;
    assert.ok(lines.length <= cap, `more than ${cap} lines — ${what}`);
    assert.ok((reply.buttons ?? []).length <= 3, `more than three buttons — ${what}`);
  }
});

test("the same walk in Hindi and in Marathi keeps the same shape", async () => {
  for (const language of ["hi", "mr"] as const) {
    const session: Session = Object.assign(newSession("919820000002"), { language });
    for (const [index, turn] of WALK.entries()) {
      const event: Event = { id: `w${index}`, phone: session.phone, modality: "text", ...turn } as Event;
      const reply = await decide(event, session, pack, wordy().fetch);
      const cap = /Follow-ups set|फ़ॉलो-अप तय|पाठपुरावा ठरला/.test(reply.text) ? 6 : 3;
      assert.ok(content(reply.text).length <= cap, `${language} turn ${index + 1}: ${reply.text}`);
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
  assert.equal(long.text, 'Ask: "*the first thing*"\n\nAsk: "*the second thing*"\n\n_↳ the reason_');
  assert.equal(long.buttons!.length, 3);
});

test("a blank line is not a line", () => {
  assert.deepEqual(content(floor({ text: "one\n\n\ntwo" }).text), ["one", "two"]);
  assert.equal(floor({ text: "one\n\n\ntwo" }).text, "one\n\ntwo");
});

test("a model that wrote nothing still tells the associate something", () => {
  const reply = render({ step: "assess", card: {}, shortlist: [], demonstrated: false, lines: [], buttons: [] });
  assert.ok(reply.text.length > 0);
});

test("WhatsApp's own formatting, and nothing it would render as litter", () => {
  const one = (text: string): string => pretty({ text }).text;
  assert.equal(one('Ask: "How far will they sit?"'), 'Ask: "*How far will they sit?*"');
  assert.equal(one('On the floor: Sony 55" LED · LG 65" LED'), '*On the floor:* Sony 55" LED · LG 65" LED');
  assert.equal(one("Wall mount: Rs 1,499 fitted"), "*Wall mount:* Rs 1,499 fitted");
  assert.equal(one("TCL 55 inch · Rs 54,990 · 9 in stock"), "TCL 55 inch · *Rs 54,990* · 9 in stock");
  assert.equal(one("↳ because the room decides"), "_↳ because the room decides_");
  assert.equal(one("Right?"), "Right?");
});

test("the prompt carries no list of what is still to be asked", async () => {
  const session = newSession("919820000009");
  const model = manager({ lines: ["x"] });
  await decide(
    { id: "s1", phone: session.phone, modality: "text", text: "customer wants a phone" } as Event,
    session,
    pack,
    model.fetch,
  );
  const sent = model.prompts.join(" ");
  assert.doesNotMatch(sent, /STILL BLANK|In stock today, in inches/);
  assert.doesNotMatch(sent, /stock_units/, "a yes or no, and it came back as 1 in stock");
});

test("a doubt the customer raised reaches the manager's report, in the model's words", async () => {
  const session = newSession("919820000009");
  await decide(
    { id: "o1", phone: session.phone, modality: "text", text: "customer says it is too costly" } as Event,
    session,
    pack,
    manager({ lines: ['Ask: "Which part feels high?"'], objection: "too costly" }).fetch,
  );
  assert.deepEqual(session.objections, ["too costly"]);
  assert.ok(session.steps_done.includes("validate"), "answering a doubt is the Validate step");
});

test("a question after the customer's answer reads back what was heard first, in place of the reason", async () => {
  const session = newSession("919820000077");
  const reply = await decide(
    { id: "h1", phone: session.phone, modality: "text", text: "customer wants a monitor for office work" },
    session,
    pack,
    manager({
      card: { facts: [{ name: "main use", value: "office work" }] },
      lines: ['Ask: "How big a screen do they want?"'],
      because: "main use",
      reason: "office work needs a screen size",
    }).fetch,
  );
  assert.match(reply.text, /^\*I heard:\* main use: office work\.[\s\S]*How big a screen/);
  assert.doesNotMatch(reply.text, /↳/);
});

test("three questions asked and nothing shown yet tells the model to show options, not ask a fourth", async () => {
  const session = newSession("919820000078");
  session.history = ["What will they use it for?", "How big a screen?", "On a table or the wall?"].flatMap((q) => [
    { who: "storeiq" as const, text: `Ask: "${q}"` },
    { who: "associate" as const, text: "ok" },
  ]);
  const model = manager({ lines: ['Ask: "Gaming or general use?"'] });
  await decide({ id: "h2", phone: session.phone, modality: "text", text: "gaming" }, session, pack, model.fetch);
  assert.match(model.prompts.join(" "), /has answered enough/);
});

test("options put only on buttons, under a bare heading, are asked for again with a line each", async () => {
  const session = newSession("919820000079");
  const select = [
    { id: "select:SON-K55S30", title: "Sony 55" },
    { id: "select:TCL-55C6KS", title: "TCL 55" },
  ];
  const model = manager([
    { lines: ["Here are some good options:"], buttons: select },
    { lines: ["Sony 55 inch, Rs 57,990, for sports.", "TCL 55 inch, Rs 54,990, for movies."], buttons: select },
  ]);
  const reply = await decide(
    { id: "o1", phone: session.phone, modality: "text", text: "show options" },
    session,
    pack,
    model.fetch,
  );
  assert.equal(model.calls, 2);
  assert.match(reply.text, /TCL 55 inch/);
});
