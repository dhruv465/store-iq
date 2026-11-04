import { createHmac, timingSafeEqual } from "node:crypto";
import { basicAuth } from "hono/basic-auth";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { DB } from "./db.js";
import {
  floorFeed,
  managerView,
  objectionInsights,
  perAssociate,
  productInsights,
  type AssociateRow,
  type FeedItem,
  type ObjectionInsight,
  type ProductInsight,
  type Rostered,
} from "./extras.js";
import { falConfig, falSpend } from "./fal.js";
import { GUIDE, MAX_SCORE } from "./steps.js";
import { loadPack, type Pack } from "./pack.js";
import { languageFrom, t } from "./i18n.js";
import { discardVideoBrief, startVideoBrief, takeVideoBrief, videoBrief } from "./video.js";

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
  // Bold on WhatsApp, like every reply: a notice is read on a phone between customers.
  return `📢 *${from}*:\n\n${text.trim().slice(0, 900)}`;
}

export function videoCaption(script: string, from: string): string {
  return notice(`${t(languageFrom(script, "en"), "video.title")}\n\n${script}`, from);
}

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

/** Which model is answering turns, for the portal to name. */
function catalogModel(): string {
  return falConfig()?.model ?? process.env.GEMINI_MODEL?.trim() ?? "gemini";
}

export function managerRoutes(app: Hono, db: DB, pack?: Pack, request: typeof fetch = fetch): void {
  const user = process.env.ADMIN_USER?.trim() || "manager";
  const password = process.env.ADMIN_PASSWORD!;
  const from = process.env.ADMIN_NAME?.trim() || "Store manager";
  const basic = basicAuth({ username: user, password });

  const guard = async (c: Parameters<typeof basic>[0], next: Parameters<typeof basic>[1]) => {
    if (validSession(password, getCookie(c, COOKIE))) return next();
    return basic(c, next);
  };

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

  app.post("/api/manager/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.use("/api/manager/*", csrf());

  app.use("/api/manager/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.header("x-store-iq") !== "portal")
      return c.json({ error: "Call this from the manager portal." }, 403);
    await next();
  });
  app.use("/api/manager/*", guard);

  app.get("/api/manager/floor", async (c) => {
    const packData = pack ?? (await loadPack().catch(() => undefined));
    const sessions = await db.today();
    const roster = await db.roster();
    const reachable = await db.reachable();
    const open = await db.openQuestions();
    return c.json({
      summary: managerView(sessions, open).text,
      // Who is waiting on an answer, and which associate is holding the customer meanwhile.
      openQuestions: open,
      visits: await db.recentVisits(),
      rows: floorRows(perAssociate(sessions, roster)),
      reachable: recipients(roster, reachable).to.length,
      waiting: await db.noticesWaiting(),
      rosterEmpty: !roster.length,
      maxScore: MAX_SCORE,
      guide: GUIDE,
      from,

      spend: Number(falSpend().toFixed(6)),
      model: catalogModel(),
      objections: objectionInsights(sessions, packData),
      products: productInsights(sessions, packData),
      feed: floorFeed(sessions),
    });
  });

  app.post("/api/manager/expert/:reference/resolve", async (c) => {
    const reference = c.req.param("reference");
    if (!reference) return c.json({ error: "Reference is required." }, 400);
    const resolved = await db.resolveQuestion(reference);
    if (!resolved) return c.json({ error: "Question not found or already answered." }, 404);
    return c.json({ ok: true, reference });
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
  // Who a message would reach, by name, for the manager to see before anything goes.
  const audience = async () => {
    const roster = await db.roster();
    const { to, unreachable, rosterEmpty } = recipients(roster, await db.reachable());
    const names = new Map<string, string>([
      ...(await db.today()).map((session): [string, string] => [session.phone, session.associate ?? session.phone]),
      ...roster.map((person): [string, string] => [person.phone, person.name]),
    ]);
    return {
      to: to.map((phone) => ({ phone, name: names.get(phone) ?? phone })),
      unreachable: unreachable.map((person) => ({ phone: person.phone, name: person.name })),
      rosterEmpty,
    };
  };

  app.post("/api/manager/broadcast/preview", async (c) => {
    const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const text = String(body.text ?? "").trim();
    if (!text) return c.json({ error: "Nothing to send." }, 400);
    return c.json({ message: notice(text, from), ...(await audience()) });
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
    await db.logBroadcast({ kind: "notice", body: text, queued: to.length, waiting: held.length });
    // Each message is checked against the window again as it leaves, so one that closed a moment
    // ago means that associate is skipped rather than failed.
    return c.json({ queued: to.length, waiting: held.length });
  });

  app.get("/api/manager/broadcasts/:kind", async (c) => {
    const kind = c.req.param("kind");
    if (kind !== "notice" && kind !== "video") return c.json({ error: "No such history." }, 404);
    return c.json({ sent: await db.broadcasts(kind) });
  });

  // The video brief: made on the manager's click, watched in the portal, and sent only on a second,
  // explicit one (Rule 3). Making it takes minutes, so the portal polls the GET.
  app.get("/api/manager/video-brief", async (c) => {
    const job = videoBrief();
    return c.json({
      job,
      caption: job?.script ? videoCaption(job.script, from) : null,
      ...(job?.status === "ready" ? await audience() : {}),
    });
  });

  app.post("/api/manager/video-brief", async (c) => {
    const body = await c.req.json<{ brief?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    const brief = String(body.brief ?? "")
      .trim()
      .slice(0, 900);
    if (!brief) return c.json({ error: "Write today's brief first." }, 400);
    const config = falConfig();
    const presenter = process.env.PRESENTER_IMAGE_URL?.trim();
    if (!config || !presenter)
      return c.json({ error: "Video briefs need FAL_KEY and PRESENTER_IMAGE_URL set on the server." }, 503);
    const started = startVideoBrief(config, presenter, brief, request);
    if (!started) return c.json({ error: "A video is already being made. Wait for it, or discard it." }, 409);
    return c.json({ job: started.job });
  });

  app.delete("/api/manager/video-brief", (c) => {
    // A render already at fal still finishes and is billed; it is simply never shown or sent.
    discardVideoBrief();
    return c.json({ ok: true });
  });

  app.post("/api/manager/video-brief/send", async (c) => {
    const body = await c.req.json<{ video?: unknown }>().catch(() => ({}) as Record<string, unknown>);
    // Only the video the manager watched, and only once: it is taken off the shelf as it goes.
    const job = takeVideoBrief(String(body.video ?? ""));
    if (!job?.video || !job.script)
      return c.json({ error: "There is no finished video to send. Make one first." }, 409);
    const { to, unreachable } = recipients(await db.roster(), await db.reachable());
    const caption = videoCaption(job.script, from);
    for (const phone of to) await db.send(phone, { text: caption, video: job.video });
    // Held like a text notice, and released when they next write, which is what opens their window.
    const held = unreachable.map((person) => person.phone);
    if (held.length) await db.queueNotice(caption, held, job.video);
    await db.logBroadcast({
      kind: "video",
      body: job.script,
      video: job.video,
      queued: to.length,
      waiting: held.length,
    });
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
