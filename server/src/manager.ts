import { createHmac, timingSafeEqual } from "node:crypto";
import { basicAuth } from "hono/basic-auth";
import { getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { DB } from "./db.js";
import { managerView, perAssociate, type AssociateRow, type Rostered } from "./extras.js";
import { GUIDE, MAX_SCORE } from "./steps.js";

/** The department manager's own view: how each associate worked today, and one box to tell the
 *  floor what is on. The portal itself is the React app in web/; everything below is its data.
 *
 *  All of it is read from the conversations the number already wrote, so the portal cannot
 *  disagree with what the associates were actually told. */

/** When the associate last wrote to the number, which is as close as we get to "are they working".
 *  Formatted here rather than in the page, so the one implementation is the tested one. */
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
 *  thing it can do, and the portal says so rather than letting it look deliberate. */
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

export type FloorRow = AssociateRow & { lastSeenLabel: string; quiet: boolean };

export function floorRows(rows: AssociateRow[], now = Date.now()): FloorRow[] {
  return rows.map((row) => ({
    ...row,
    lastSeenLabel: ago(row.lastSeen, now),
    // A rostered associate with no customers today is the whole reason the roster exists.
    quiet: row.onRoster && row.conversations === 0,
  }));
}

const COOKIE = "storeiq_manager";
const DAY = 24 * 60 * 60 * 1000;

/** A signed note saying "this browser signed in, and until when". Nothing is stored server side:
 *  the signature is over the expiry alone, keyed by the password, so changing the password signs
 *  everybody out. */
export function sessionToken(password: string, expires: number): string {
  return `${expires}.${createHmac("sha256", password).update(String(expires)).digest("base64url")}`;
}

export function validSession(password: string, raw: string | undefined, now = Date.now()): boolean {
  const [expires, mac] = (raw ?? "").split(".");
  if (!expires || !mac || !/^\d+$/.test(expires) || Number(expires) < now) return false;
  const expected = createHmac("sha256", password).update(expires).digest("base64url");
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function managerRoutes(app: Hono, db: DB): void {
  const user = process.env.ADMIN_USER?.trim() || "manager";
  const password = process.env.ADMIN_PASSWORD!;
  const from = process.env.ADMIN_NAME?.trim() || "Store manager";
  const basic = basicAuth({ username: user, password });
  // The portal signs in with a form and carries a cookie; Basic auth stays for scripting and for
  // anything that is not a browser. SameSite=Strict means the cookie is not attached to a request
  // somebody else's page makes, which is the other half of the origin checks below.
  const guard = async (c: Parameters<typeof basic>[0], next: Parameters<typeof basic>[1]) => {
    if (validSession(password, getCookie(c, COOKIE))) return next();
    return basic(c, next);
  };
  // A browser attaches Basic credentials to every request to this origin, a fetch from somebody
  // else's page included, and the broadcast route messages the whole floor. The Origin header is
  // what separates the manager's own click from that.
  // Signing in is the one route that cannot require a session, and it is rate-limited by nothing
  // but the password itself, so it answers the same way whether the password was close or absurd.
  app.post("/api/manager/login", async (c) => {
    const body = await c.req.json<{ password?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const given = Buffer.from(String(body.password ?? ""));
    const want = Buffer.from(password);
    if (given.length !== want.length || !timingSafeEqual(given, want))
      return c.json({ error: "That is not the password." }, 401);
    const expires = Date.now() + DAY;
    setCookie(c, COOKIE, sessionToken(password, expires), {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: DAY / 1000,
      secure: c.req.url.startsWith("https://"),
    });
    return c.json({ ok: true });
  });

  app.use("/api/manager/*", csrf());
  // csrf() above covers what an HTML form can send. A form cannot set a header of its own, and a
  // fetch that does needs a preflight this server never grants, so requiring one closes the rest:
  // a page the manager happens to visit cannot reach these routes at all, credentials or not.
  app.use("/api/manager/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.header("x-store-iq") !== "portal")
      return c.json({ error: "Call this from the manager portal." }, 403);
    await next();
  });
  app.use("/api/manager/*", guard);
  // The portal's own files are not guarded: they hold no data and the page's whole job when it is
  // not signed in is to show the sign-in card. Everything it then asks for needs the session.

  app.get("/api/manager/floor", async (c) => {
    const sessions = await db.today();
    const roster = await db.roster();
    const reachable = await db.reachable();
    const open = await db.openQuestions();
    return c.json({
      summary: managerView(sessions, open).text,
      // Who is waiting on an answer, and which associate is holding the customer meanwhile.
      openQuestions: open,
      rows: floorRows(perAssociate(sessions, roster)),
      reachable: recipients(roster, reachable).to.length,
      waiting: await db.noticesWaiting(),
      rosterEmpty: !roster.length,
      maxScore: MAX_SCORE,
      guide: GUIDE,
      from,
    });
  });

  app.post("/api/manager/roster", async (c) => {
    const body = await c.req.json<{ phone?: unknown; name?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const phone = phoneOf(body.phone);
    const name = String(body.name ?? "")
      .trim()
      .slice(0, 60);
    if (!phone || !name)
      return c.json(
        { error: "Digits only, with the country code and no plus, like 919820000001. A name is needed too." },
        400,
      );
    await db.addAssociate(phone, name);
    return c.json({ ok: true, phone, name });
  });

  app.delete("/api/manager/roster/:phone", async (c) => {
    const phone = phoneOf(c.req.param("phone"));
    // Taking somebody off the roster does not erase what they did today.
    if (phone) await db.removeAssociate(phone);
    return c.json({ ok: true });
  });

  // Two calls on purpose: a message to the whole floor is not an accident anyone should be able to
  // have, and the store visits are full of things that went out without anyone owning them.
  app.post("/api/manager/broadcast/preview", async (c) => {
    const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const text = String(body.text ?? "").trim();
    if (!text) return c.json({ error: "Nothing to send." }, 400);
    const roster = await db.roster();
    const { to, unreachable, rosterEmpty } = recipients(roster, await db.reachable());
    const names = new Map<string, string>([
      ...(await db.today()).map((session): [string, string] => [session.phone, session.associate ?? session.phone]),
      ...roster.map((person): [string, string] => [person.phone, person.name]),
    ]);
    return c.json({
      message: notice(text, from),
      to: to.map((phone) => ({ phone, name: names.get(phone) ?? phone })),
      unreachable: unreachable.map((person) => ({ phone: person.phone, name: person.name })),
      rosterEmpty,
    });
  });

  app.post("/api/manager/broadcast", async (c) => {
    const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const text = String(body.text ?? "").trim();
    if (!text) return c.json({ error: "Nothing to send." }, 400);
    const roster = await db.roster();
    const { to, unreachable } = recipients(roster, await db.reachable());
    const line = notice(text, from);
    for (const phone of to) await db.send(phone, { text: line });
    // Nobody is dropped for being outside the window. The notice is held against them and goes out
    // the moment they next write to the number, which is what opens the window again. No template,
    // no approval, and the associate who has been quiet all morning still gets told.
    const held = unreachable.map((person) => person.phone);
    if (held.length) await db.queueNotice(line, held);
    // Each message is checked against the window again as it leaves, so one that closed a moment
    // ago means that associate is skipped rather than failed.
    return c.json({ queued: to.length, waiting: held.length });
  });

  // The portal itself is a build output, so say so plainly when it is missing rather than
  // answering 404 and leaving the manager to guess.
  // The portal is built with /manager/ as its base, so its own path prefix comes off before the
  // file is looked up.
  const portal = { root: "./web/dist", rewriteRequestPath: (path: string) => path.replace(/^\/manager/, "") || "/" };
  app.use("/manager/*", serveStatic(portal));
  app.get("/manager", serveStatic({ ...portal, path: "./web/dist/index.html" }));
  app.all("/manager", (c) => c.text("The manager portal is not built. Run: npm run build:web", 503));
  app.all("/manager/*", (c) => c.text("The manager portal is not built. Run: npm run build:web", 503));
}
