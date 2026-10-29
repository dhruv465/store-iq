import { test } from "node:test";
import assert from "node:assert/strict";
import { perAssociate } from "../server/src/extras.js";
import { ago, escape, notice, phoneOf, recipients } from "../server/src/manager.js";
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

test("a rostered associate who did nothing today is in the table, not missing from it", () => {
  const rows = perAssociate(
    [conversation("919820000001", "Ramesh", ["assess", "recommend"], true)],
    [
      { phone: "919820000001", name: "Ramesh K" },
      { phone: "919820000009", name: "Sunil", lastSeen: "2026-10-28T04:00:00.000Z" },
    ],
  );
  const sunil = rows.find((row) => row.name === "Sunil")!;
  assert.equal(sunil.conversations, 0, "quiet all day, and that is the point of showing him");
  assert.equal(sunil.onRoster, true);
  assert.equal(sunil.lastSeen, "2026-10-28T04:00:00.000Z");
  // The manager's own spelling wins over whatever WhatsApp has in the profile.
  assert.equal(rows.find((row) => row.phone === "919820000001")!.name, "Ramesh K");
});

test("a number that used the agent without being on the roster is still shown, and marked", () => {
  const rows = perAssociate(
    [conversation("919820000007", "Unknown", ["assess"], false)],
    [{ phone: "919820000001", name: "Ramesh" }],
  );
  assert.equal(rows.find((row) => row.phone === "919820000007")!.onRoster, false);
  assert.equal(rows.length, 2, "both the stranger and the quiet rostered associate");
});

test("a phone is read however the manager types it, and rubbish is refused", () => {
  assert.equal(phoneOf("+91 98200 00001"), "919820000001");
  assert.equal(phoneOf("91-98200-00001"), "919820000001");
  assert.equal(phoneOf("0"), null);
  assert.equal(phoneOf("not a phone"), null);
  assert.equal(phoneOf(""), null);
});

test("last seen reads as a person would say it", () => {
  const now = Date.parse("2026-10-29T12:00:00.000Z");
  assert.equal(ago(undefined, now), "never");
  assert.equal(ago("2026-10-29T11:58:00.000Z", now), "2 min ago");
  assert.equal(ago("2026-10-29T09:00:00.000Z", now), "3 h ago");
  assert.equal(ago("2026-10-28T12:00:00.000Z", now), "yesterday");
});

test("a floor notice goes to the manager's own associates, not to whoever messaged the number", () => {
  const roster = [
    { phone: "919820000001", name: "Ramesh" },
    { phone: "919820000009", name: "Sunil" },
  ];
  // 919999999999 wrote to the agent but is nobody's associate: a test number, a wrong number, a
  // customer who found the number. It must not receive the floor's notices.
  const { to, unreachable, rosterEmpty } = recipients(roster, ["919820000001", "919999999999"]);
  assert.deepEqual(to, ["919820000001"]);
  assert.deepEqual(
    unreachable.map((person) => person.name),
    ["Sunil"],
    "on the roster but outside the 24 hour window, so the manager is told",
  );
  assert.equal(rosterEmpty, false);
});

test("before anyone is rostered it falls back, and says it is falling back", () => {
  const { to, rosterEmpty } = recipients([], ["919820000001", "919999999999"]);
  assert.deepEqual(to.sort(), ["919820000001", "919999999999"]);
  assert.equal(rosterEmpty, true, "the page warns rather than letting this look deliberate");
});
