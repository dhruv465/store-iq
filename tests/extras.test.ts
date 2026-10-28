import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack } from "../server/src/pack.js";
import { expertReply, managerView, newReference, routeTo, wantsExpert, wantsManagerView } from "../server/src/extras.js";
import { newSession, type Session } from "../server/src/types.js";

const pack = await loadPack("data/pack.json");

function conversation(steps: Session["steps_done"], assessed = true): Session {
  const session = newSession("919820000001");
  session.steps_done = steps;
  if (assessed) {
    session.card = { distance_feet: 8, light: "bright", mount: "wall", content: ["cricket"] };
    session.demonstrated = true;
  }
  return session;
}

test("a question is routed by what it is about", () => {
  assert.equal(routeTo(pack, "can we wall mount on a false ceiling?").area, "installation and site survey");
  assert.equal(routeTo(pack, "is there EMI on this card?").area, "finance and EMI");
  assert.equal(routeTo(pack, "when will stock come in?").area, "stock and delivery dates");
  assert.equal(routeTo(pack, "what panel is this exactly").area, "product and specifications");
});

test("the expert reply names an owner, a reference and a line to say", () => {
  const { reply, owner, area } = expertReply(pack, "can we wall mount on a false ceiling?", "SIQ-1234");
  assert.match(reply.text, /^Sent to Suresh \(service desk\) · SIQ-1234/);
  assert.match(reply.text, /Say: "Let me confirm that with our installation and site survey desk/);
  assert.equal(owner, "Suresh (service desk)");
  assert.equal(area, "installation and site survey");
});

test("references are unique enough to quote to a customer", () => {
  const seen = new Set(Array.from({ length: 200 }, () => newReference()));
  assert.ok(seen.size > 150, "references collide too often");
  assert.ok([...seen].every((r) => /^SIQ-\d{4}$/.test(r)));
});

test("the manager view reports volume, the median score and the weakest step", () => {
  const reply = managerView(
    [conversation(["assess", "recommend"]), conversation(["assess", "recommend", "complete"]), conversation(["assess"])],
    [{ reference: "SIQ-1111", area: "finance and EMI", owner: "Priya (billing)" }],
  );
  assert.match(reply.text, /Today: 3 conversations, median \d+ of 14/);
  assert.match(reply.text, /Home assessed in 3 of 3/);
  assert.match(reply.text, /Most skipped step: /);
  assert.match(reply.text, /Open expert questions: 1 · SIQ-1111/);
});

test("an empty floor says so rather than inventing numbers", () => {
  assert.match(managerView([], []).text, /No conversations yet today/);
  assert.match(managerView([newSession("919820000001")], []).text, /No conversations yet today/);
});

test("both views are recognised from ordinary words", () => {
  assert.equal(wantsManagerView("team", undefined), true);
  assert.equal(wantsManagerView("shift report", undefined), true);
  assert.equal(wantsManagerView("the customer is on my team", undefined), false, "only at the start of a message");
  assert.equal(wantsExpert("ask an expert about the ceiling", undefined), true);
  assert.equal(wantsExpert("escalate this", undefined), true);
  assert.equal(wantsExpert("recommend three options", undefined), false);
});
