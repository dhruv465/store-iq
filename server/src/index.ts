import { serve } from "@hono/node-server";
import { createApp } from "./webhook.js";
import { openDatabase, pricedEarly } from "./db.js";
import { loadPack } from "./pack.js";
import { startWorker } from "./worker.js";
import { assertModelAvailable, decide } from "./brain.js";
import type { Event } from "./types.js";

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("PORT must be 1-65535");
const host = process.env.HOST || "127.0.0.1";
const local = ["127.0.0.1", "localhost", "::1"].includes(host);

const pack = await loadPack();
const db = await openDatabase();
try {
  const whatsapp = !!(
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_GRAPH_VERSION &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_APP_SECRET &&
    process.env.WHATSAPP_VERIFY_TOKEN
  );
  const model = await assertModelAvailable();
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
      const reply = await decide(event, session, pack, fetch, db);
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
      `Store IQ http://${host}:${port} · pack ${pack.version} · ${model} · whatsapp ${whatsapp ? "on" : "off"}`,
    ),
  );
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
