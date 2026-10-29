import { basicAuth } from "hono/basic-auth";
import type { Hono } from "hono";
import type { DB } from "./db.js";
import { managerView, perAssociate, type AssociateRow } from "./extras.js";
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
pre { white-space: pre-wrap; background: color-mix(in srgb, var(--fg) 5%, transparent);
  padding: 12px; border-radius: 6px; margin: 0; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

function table(rows: AssociateRow[]): string {
  if (!rows.length)
    return `<p class="note">No conversations yet today. The table fills as associates use the number.</p>`;
  const head = [
    "Associate",
    "Customers",
    "Home cards",
    `Median /${MAX_SCORE}`,
    "Best",
    `Guide (${GUIDE}+)`,
    "Home before price",
  ];
  return `<table><thead><tr>${head.map((cell) => `<th>${escape(cell)}</th>`).join("")}</tr></thead><tbody>${rows
    .map(
      (row) => `<tr class="${row.guide ? "guide" : ""}"><td>${escape(row.name)}</td><td>${row.conversations}</td>
<td>${row.homeCards}</td><td>${row.median}</td><td>${row.best}</td><td>${row.guide}</td>
<td>${row.homeBeforePrice} of ${row.conversations}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

/** A floor notice carries who it is from, so an associate does not read it as the agent talking. */
export function notice(text: string, from: string): string {
  return `📢 ${from}:\n${text.trim().slice(0, 900)}`;
}

export function managerRoutes(app: Hono, db: DB): void {
  const user = process.env.ADMIN_USER?.trim() || "manager";
  const password = process.env.ADMIN_PASSWORD!;
  const from = process.env.ADMIN_NAME?.trim() || "Store manager";
  app.use("/manager/*", basicAuth({ username: user, password }));
  app.use("/manager", basicAuth({ username: user, password }));

  app.get("/manager", async (c) => {
    const sessions = await db.today();
    const rows = perAssociate(sessions);
    const floor = managerView(sessions, await db.openQuestions());
    const reachable = await db.reachable();
    return c.html(
      page(
        "Store IQ · manager",
        `<h1>The floor today</h1><p class="sub">Every conversation on the number in the last 12 hours.</p>
<pre>${escape(floor.text)}</pre>
<h2>By associate</h2>${table(rows)}
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

  // Two steps on purpose: a message to the whole floor is not an accident anyone should be able
  // to have, and the store visits are full of things that went out without anyone owning them.
  app.post("/manager/broadcast", async (c) => {
    const form = await c.req.parseBody();
    const text = String(form.text ?? "").trim();
    if (!text) return c.redirect("/manager", 303);
    const reachable = await db.reachable();
    const names = new Map((await db.today()).map((session) => [session.phone, session.associate ?? session.phone]));
    if (!reachable.length)
      return c.html(
        page(
          "Nobody to reach",
          `<h1>Nobody can be reached right now</h1>
<p class="note warn">No associate has messaged the number in the last 24 hours, and WhatsApp does not allow a
free-form message outside that window. Ask one of them to send any message first, or this has to go out as an
approved template.</p><p><a href="/manager">Back</a></p>`,
        ),
      );
    return c.html(
      page(
        "Send to the floor?",
        `<h1>Send this to ${reachable.length} associate${reachable.length === 1 ? "" : "s"}?</h1>
<pre>${escape(notice(text, from))}</pre>
<h2>Goes to</h2><ul>${reachable.map((phone) => `<li>${escape(names.get(phone) ?? phone)}</li>`).join("")}</ul>
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
    const reachable = await db.reachable();
    for (const phone of reachable) await db.send(phone, { text: notice(text, from) });
    return c.html(
      page(
        "Sent",
        `<h1>Queued for ${reachable.length} associate${reachable.length === 1 ? "" : "s"}</h1>
<pre>${escape(notice(text, from))}</pre>
<p class="note">Each one still passes the 24 hour check as it leaves, so a window that closed in the last
moment means that associate is skipped rather than failed.</p><p><a href="/manager">Back to the floor</a></p>`,
      ),
    );
  });
}
