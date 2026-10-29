import { test } from "node:test";
import assert from "node:assert/strict";
import { perAssociate } from "../server/src/extras.js";
import { escape, notice } from "../server/src/manager.js";
import { newSession, type Session } from "../server/src/types.js";

/** The manager's view is one row per associate over many conversations, which is the thing the
 *  session table cannot show: it holds one row per associate, overwritten by the next customer. */

function conversation(phone: string, name: string, done: Session["steps_done"], assessed: boolean): Session {
  const session = newSession(phone);
  session.associate = name;
  session.steps_done = done;
  if (assessed) {
    session.card = { distance_m: 3, light: "bright", mount: "wall", content: ["cricket"] };
    session.card_confirmed = true;
  }
  return session;
}

test("an associate's day is one row, however many customers they took", () => {
  const rows = perAssociate([
    conversation("919820000001", "Ramesh", ["assess", "recommend"], true),
    conversation("919820000001", "Ramesh", ["assess"], true),
    conversation("919820000001", "Ramesh", [], false),
    conversation("919820000002", "Asha", ["assess"], false),
  ]);
  assert.equal(rows.length, 2, "two associates, four customers");
  const ramesh = rows.find((row) => row.name === "Ramesh")!;
  assert.equal(ramesh.conversations, 3);
  assert.equal(ramesh.homeCards, 2, "the third customer never got as far as a home card");
  assert.equal(ramesh.readBack, 2);
});

test("the strongest associate is first, so the manager reads the gap downwards", () => {
  const strong = conversation("919820000003", "Priya", ["assess", "validate", "translate"], true);
  strong.demonstrated = true;
  const rows = perAssociate([strong, conversation("919820000004", "Vikram", [], false)]);
  assert.equal(rows[0]!.name, "Priya");
  assert.ok(rows[0]!.median > rows[1]!.median);
});

test("an associate who never gave a name is shown by number rather than dropped", () => {
  const anonymous = newSession("919820000005");
  anonymous.steps_done = ["assess"];
  assert.equal(perAssociate([anonymous])[0]!.name, "919820000005");
});

test("a WhatsApp profile name cannot put markup into the manager's page", () => {
  assert.equal(escape(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(escape("Ramesh & Co's"), "Ramesh &amp; Co&#39;s");
});

test("a floor notice says who it is from, so it is not read as the agent talking", () => {
  assert.equal(notice("  TCL is Rs 54,990 today  ", "Store manager"), "📢 Store manager:\nTCL is Rs 54,990 today");
  assert.ok(notice("x".repeat(2000), "Manager").length < 950, "a notice is capped before it reaches WhatsApp");
});
