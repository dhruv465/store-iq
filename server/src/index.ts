import { serve } from "@hono/node-server";
import { createApp } from "./webhook.js";
import { openDatabase, openPostgres, pricedEarly } from "./db.js";
import { startingPack } from "./pack.js";
import { falConfig } from "./fal.js";
import { startWorker } from "./worker.js";
import { managerRoutes } from "./manager.js";
import { assertModelAvailable, decide } from "./brain.js";
import type { Event } from "./types.js";
import { setAfterSalesData, type File as AfterSales } from "./aftersales.js";

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("PORT must be 1-65535");
const host = process.env.HOST || "127.0.0.1";
const local = ["127.0.0.1", "localhost", "::1"].includes(host);

const { pack, source: packSource } = await startingPack();
const db = process.env.DATABASE_URL ? await openPostgres(process.env.DATABASE_URL) : await openDatabase();
try {
  // The store's own charges, uploaded from the portal, replace the sample file's.
  const charges = await db.setting<AfterSales>("aftersales");
  if (charges) setAfterSalesData(charges);
  const whatsapp = !!(
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_GRAPH_VERSION &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_APP_SECRET &&
    process.env.WHATSAPP_VERIFY_TOKEN
  );
  // Which model answers a turn, said plainly at startup: the log read "gemini-2.5-flash" while
  // every turn was going to fal, which is the sort of thing that costs an afternoon.
  const fal = falConfig();
  // With fal, the turn, the voice note and the photo all go through it, so a Gemini key is not
  // needed at all. Without fal, the photo needs one, and without either it asks for the model number.
  const photo = fal ? "on fal" : process.env.GEMINI_API_KEY?.trim() ? await assertModelAvailable() : "off";
  const model = fal
    ? `fal ${fal.model} · voice on fal-ai/elevenlabs/speech-to-text · photo ${photo}`
    : await assertModelAvailable();
  const worker = startWorker(db, pack, { whatsapp });
  const app = createApp(
    {
      appSecret: process.env.WHATSAPP_APP_SECRET,
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      ready: true,
      whatsappReady: whatsapp,
    },
    async (messages) => {
      await db.enqueue(messages);
      worker.kick();
    },
  );
  app.get("/health/queues", async (c) => {
    try {
      return c.json({ ...(await db.health()), pack: pack.version });
    } catch {
      return c.json({ status: "unavailable" }, 503);
    }
  });
  if (local) app.get("/health/recent", async (c) => c.json(await db.recentSends()));
  // Clearing build-time test numbers before a demo, one number at a time so the real floor cannot
  // be swept away with them. Never exposed off localhost.
  if (local)
    app.post("/health/forget", async (c) => {
      const { phone } = await c.req.json<{ phone?: string }>();
      try {
        return c.json({ phone, deleted: await db.forget(String(phone ?? "")) });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "unknown" }, 400);
      }
    });
  // The manager's dashboard is off unless a password is set, because it is reachable through the
  // same tunnel as the webhook and it can message the whole floor.
  if (process.env.ADMIN_PASSWORD) managerRoutes(app, db, pack);
  else console.error("Manager dashboard off: set ADMIN_PASSWORD in .env to turn it on");
  // Local text harness: iterate on the seven steps without WhatsApp. Never exposed off localhost.
  if (local)
    app.post("/try", async (c) => {
      const body = await c.req.json<{ phone?: string; text?: string; action?: string }>();
      const phone = body.phone || "919999999999";
      const event: Event = {
        id: `try:${Date.now()}`,
        phone,
        modality: body.action ? "interactive" : "text",
        ...(body.text ? { text: body.text } : {}),
        ...(body.action ? { action: body.action } : {}),
      };
      const session = await db.session(phone);
      const started = Date.now();
      // The worker answers a failed turn with an honest line on WhatsApp. Here the reason itself is
      // the useful thing: a 500 saying "Internal error" sent me looking for a bug that was a quota.
      let reply;
      try {
        reply = await decide(event, session, pack, fetch, db);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "unknown", step: session.step }, 502);
      }
      // Nothing is queued here on purpose, so /try never messages a real phone; the price measure
      // would otherwise be the one thing the harness could not reproduce.
      if (pricedEarly(session, reply)) session.priced_before_home = true;
      await db.commit(session, []);
      return c.json({
        reply,
        ms: Date.now() - started,
        step: session.step,
        card: session.card,
        assessed: session.assessed,
        demonstrated: session.demonstrated,
      });
    });
  const server = serve({ fetch: app.fetch, port, hostname: host }, () =>
    console.log(
      `Store IQ http://${host}:${port} · pack ${pack.version} (${packSource}) · ${model} · whatsapp ${whatsapp ? "on" : "off"}`,
    ),
  );
  // Render's free instance sleeps after 15 minutes without inbound traffic, and the next WhatsApp
  // message then waits a minute for it to wake. A request to its own public URL counts as inbound.
  const self = process.env.RENDER_EXTERNAL_URL;
  if (self) setInterval(() => void fetch(`${self}/health`).catch(() => {}), 10 * 60 * 1000).unref();
  let closing = false;
  async function shutdown(code = 0) {
    if (closing) return;
    closing = true;
    server.close();
    await worker.stop();
    await db.close();
    process.exit(code);
  }
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  server.on("error", () => void shutdown(1));
} catch (error) {
  await db.close();
  throw error;
}
