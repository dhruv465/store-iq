import { basicAuth } from "hono/basic-auth";
import { csrf } from "hono/csrf";
import type { Hono } from "hono";
import type { DB } from "./db.js";
import { managerView, perAssociate, type AssociateRow, type Rostered } from "./extras.js";
import { GUIDE, MAX_SCORE } from "./steps.js";

/** The department manager's own view, in a browser rather than on the floor phone: how each
 *  associate worked today, and one box to tell the floor what is on.
 *
 *  Everything here is read from the same conversations the number already wrote, so the dashboard
 *  cannot disagree with what the associates were told. */

/** Associate names come from WhatsApp profiles, so they are somebody else's text in our page. */
export function escape(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

const STYLE = `
:root { color-scheme: light dark; --line: #d7d7db; --dim: #6b6b70; --bg: #fff; --fg: #111; --warn: #8a5a00; }
@media (prefers-color-scheme: dark) { :root { --line: #33343a; --dim: #9a9aa2; --bg: #16171a; --fg: #ececf0; --warn: #e2b55f; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg);
  font: 15px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 860px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 2px; }
h2 { font-size: 15px; margin: 32px 0 8px; font-weight: 600; }
p.sub { color: var(--dim); margin: 0 0 24px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: 8px 6px; border-bottom: 1px solid var(--line); }
th:first-child, td:first-child { text-align: left; }
th { font-weight: 600; color: var(--dim); font-size: 13px; }
tr.guide td:nth-child(4) { font-weight: 700; }
.note { border-left: 3px solid var(--line); padding: 2px 0 2px 12px; color: var(--dim); margin: 12px 0; }
.warn { color: var(--warn); }
textarea { width: 100%; min-height: 90px; padding: 10px; font: inherit; border: 1px solid var(--line);
  border-radius: 6px; background: var(--bg); color: var(--fg); }
button { margin-top: 10px; padding: 9px 16px; font: inherit; border: 1px solid var(--line);
  border-radius: 6px; background: var(--fg); color: var(--bg); cursor: pointer; }
button.secondary { background: transparent; color: var(--fg); }
.scroll { overflow-x: auto; }
tr.quiet td { color: var(--dim); }
.tag { font-size: 12px; color: var(--dim); border: 1px solid var(--line); border-radius: 10px; padding: 1px 7px; white-space: nowrap; }
button.link { background: none; border: 0; color: var(--dim); padding: 0; margin: 0; font: inherit; text-decoration: underline; cursor: pointer; }
form.inline { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 12px 0 0; }
form.inline input { padding: 9px 10px; font: inherit; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); }
form.inline button { margin: 0; }
pre { white-space: pre-wrap; background: color-mix(in srgb, var(--fg) 5%, transparent);
  padding: 12px; border-radius: 6px; margin: 0; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/** When the associate last wrote to the number, which is as close as we get to "are they working". */
export function ago(iso?: string, now = Date.now()): string {
  if (!iso) return "never";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  if (ms < 60_000) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function table(rows: AssociateRow[]): string {
  if (!rows.length)
    return `<p class="note">Nobody on the roster yet. Add your associates below and the table fills as they work.</p>`;
  const head = [
    "Associate",
    "Customers",
    "Home cards",
    `Median /${MAX_SCORE}`,
    `Guide (${GUIDE}+)`,
    "Home before price",
    "Last seen",
    "",
  ];
  return `<div class="scroll"><table><thead><tr>${head
    .map((cell) => `<th>${escape(cell)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => {
      // A rostered associate with no customers today is the whole reason the roster exists.
      const quiet = row.onRoster && row.conversations === 0;
      return `<tr class="${quiet ? "quiet" : row.guide ? "guide" : ""}">
<td>${escape(row.name)}${quiet ? ` <span class="tag">quiet today</span>` : ""}${
        row.onRoster ? "" : ` <span class="tag">not on the roster</span>`
      }</td>
<td>${row.conversations}</td><td>${row.homeCards}</td><td>${row.median}</td><td>${row.guide}</td>
<td>${row.conversations ? `${row.homeBeforePrice} of ${row.conversations}` : "—"}</td>
<td>${escape(ago(row.lastSeen))}</td>
<td>${
        row.onRoster
          ? `<form method="post" action="/manager/roster/remove"><input type="hidden" name="phone" value="${escape(row.phone)}"><button class="link" type="submit">remove</button></form>`
          : `<form method="post" action="/manager/roster"><input type="hidden" name="phone" value="${escape(row.phone)}"><input type="hidden" name="name" value="${escape(row.name)}"><button class="link" type="submit">add</button></form>`
      }</td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

/** A phone as a person types it, or nothing when it is not one. */
export function phoneOf(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null;
}

/** A floor notice carries who it is from, so an associate does not read it as the agent talking. */
export function notice(text: string, from: string): string {
  return `📢 ${from}:\n${text.trim().slice(0, 900)}`;
}

/** Who a floor notice is actually for: the manager's own people who can be reached right now.
 *  Before anyone is on the roster it falls back to whoever wrote to the number, which is the only
 *  thing it can do, and the page says so rather than letting it look deliberate. */
export function recipients(
  roster: Rostered[],
  reachable: string[],
): { to: string[]; unreachable: Rostered[]; rosterEmpty: boolean } {
  const canReach = new Set(reachable);
  if (!roster.length) return { to: [...canReach], unreachable: [], rosterEmpty: true };
  return {
    to: roster.filter((person) => canReach.has(person.phone)).map((person) => person.phone),
    unreachable: roster.filter((person) => !canReach.has(person.phone)),
    rosterEmpty: false,
  };
}

export function managerRoutes(app: Hono, db: DB): void {
  const user = process.env.ADMIN_USER?.trim() || "manager";
  const password = process.env.ADMIN_PASSWORD!;
  const from = process.env.ADMIN_NAME?.trim() || "Store manager";
  // A browser attaches Basic credentials to every request to this origin, a form POST from
  // somebody else's page included, and the route below messages the whole floor. The Origin header
  // is what separates the manager's own click from that, so it is checked before anything is sent.
  app.use("/manager/*", csrf());
  app.use("/manager/*", basicAuth({ username: user, password }));
  app.use("/manager", basicAuth({ username: user, password }));

  app.get("/manager", async (c) => {
    const sessions = await db.today();
    const roster = await db.roster();
    const rows = perAssociate(sessions, roster);
    const floor = managerView(sessions, await db.openQuestions());
    const reachable = await db.reachable();
    return c.html(
      page(
        "Store IQ · manager",
        `<h1>The floor today</h1><p class="sub">Every conversation on the number in the last 12 hours.</p>
<pre>${escape(floor.text)}</pre>
<h2>Your floor</h2>${table(rows)}
<form class="inline" method="post" action="/manager/roster">
<input name="name" placeholder="Name" maxlength="60" required>
<input name="phone" placeholder="WhatsApp number, e.g. 919820000001" maxlength="20" required>
<button type="submit">Add associate</button></form>
<p class="sub">Adding somebody here does not let the number message them on its own: WhatsApp only
carries a message to a person who wrote to it in the last 24 hours, whoever is on the roster.</p>
<h2>Tell the floor</h2>
<p class="sub">Today's offers, a stock change, anything everyone needs. It reaches the ${reachable.length}
associate${reachable.length === 1 ? "" : "s"} who messaged the number in the last 24 hours — WhatsApp does not
allow a free-form message to anyone else. You will see exactly who before anything is sent.</p>
<form method="post" action="/manager/broadcast">
<textarea name="text" maxlength="900" placeholder="e.g. TCL 55 inch is down to Rs 54,990 today only. Two LG 65 inch left."></textarea>
<button type="submit">Preview</button></form>`,
      ),
    );
  });

  app.post("/manager/roster", async (c) => {
    const form = await c.req.parseBody();
    const phone = phoneOf(form.phone);
    const name = String(form.name ?? "")
      .trim()
      .slice(0, 60);
    if (!phone || !name)
      return c.html(
        page(
          "That is not a number",
          `<h1>That did not look like a WhatsApp number</h1>
<p class="note">Digits only, with the country code and no plus: 919820000001. A name is needed too.</p>
<p><a href="/manager">Back</a></p>`,
        ),
        400,
      );
    await db.addAssociate(phone, name);
    return c.redirect("/manager", 303);
  });

  app.post("/manager/roster/remove", async (c) => {
    const form = await c.req.parseBody();
    const phone = phoneOf(form.phone);
    // Removing somebody takes them off the roster only; what they did today is still counted.
    if (phone) await db.removeAssociate(phone);
    return c.redirect("/manager", 303);
  });

  // Two steps on purpose: a message to the whole floor is not an accident anyone should be able
  // to have, and the store visits are full of things that went out without anyone owning them.
  app.post("/manager/broadcast", async (c) => {
    const form = await c.req.parseBody();
    const text = String(form.text ?? "").trim();
    if (!text) return c.redirect("/manager", 303);
    const { to, unreachable, rosterEmpty } = recipients(await db.roster(), await db.reachable());
    const names = new Map<string, string>([
      ...(await db.today()).map((session): [string, string] => [session.phone, session.associate ?? session.phone]),
      ...(await db.roster()).map((person): [string, string] => [person.phone, person.name]),
    ]);
    if (!to.length)
      return c.html(
        page(
          "Nobody to reach",
          `<h1>Nobody can be reached right now</h1>
<p class="note warn">${
            unreachable.length
              ? `None of your ${unreachable.length} associate${unreachable.length === 1 ? " has" : "s have"} messaged the number in the last 24 hours`
              : "Nobody has messaged the number in the last 24 hours"
          }, and WhatsApp does not allow a free-form message outside that window. Ask one of them to send any
message first, or this has to go out as an approved template.</p><p><a href="/manager">Back</a></p>`,
        ),
      );
    return c.html(
      page(
        "Send to the floor?",
        `<h1>Send this to ${to.length} associate${to.length === 1 ? "" : "s"}?</h1>
<pre>${escape(notice(text, from))}</pre>
<h2>Goes to</h2><ul>${to.map((phone) => `<li>${escape(names.get(phone) ?? phone)}</li>`).join("")}</ul>
${
  rosterEmpty
    ? `<p class="note warn">Nobody is on your roster, so this goes to every number that has written to the
agent today, whoever they are. Add your associates and it will only ever go to them.</p>`
    : ""
}${
          unreachable.length
            ? `<p class="note">Not reachable, so they will not get it: ${unreachable
                .map((person) => escape(person.name))
                .join(", ")}. WhatsApp only carries a message to someone who wrote in the last 24 hours.</p>`
            : ""
        }
<form method="post" action="/manager/broadcast/confirm">
<input type="hidden" name="text" value="${escape(text)}">
<button type="submit">Send now</button></form>
<p><a href="/manager">Change it</a></p>`,
      ),
    );
  });

  app.post("/manager/broadcast/confirm", async (c) => {
    const form = await c.req.parseBody();
    const text = String(form.text ?? "").trim();
    if (!text) return c.redirect("/manager", 303);
    const { to } = recipients(await db.roster(), await db.reachable());
    for (const phone of to) await db.send(phone, { text: notice(text, from) });
    return c.html(
      page(
        "Sent",
        `<h1>Queued for ${to.length} associate${to.length === 1 ? "" : "s"}</h1>
<pre>${escape(notice(text, from))}</pre>
<p class="note">Each one still passes the 24 hour check as it leaves, so a window that closed in the last
moment means that associate is skipped rather than failed.</p><p><a href="/manager">Back to the floor</a></p>`,
      ),
    );
  });
}
