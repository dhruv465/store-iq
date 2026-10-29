import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";

export type IncomingMessage = {
  message_id: string;
  phone: string;
  phone_number_id: string;
  message_type: string;
  raw: Record<string, unknown>;
  sent_at?: string | null;
};
export type InboxWriter = (messages: IncomingMessage[]) => Promise<void>;
type Config = {
  appSecret?: string | undefined;
  verifyToken?: string | undefined;
  phoneNumberId?: string | undefined;
  ready?: boolean;
  whatsappReady?: boolean;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected object");
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error("Expected array");
  return value;
}

function nonempty(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw Error("Expected nonempty string");
  return value;
}

function messagesFrom(payload: unknown, phoneNumberId: string): IncomingMessage[] {
  const raw = object(payload);
  if (raw.object !== "whatsapp_business_account") throw Error("Unexpected webhook object");
  const messages = new Map<string, IncomingMessage>();
  for (const entry of list(raw.entry)) {
    for (const change of list(object(entry).changes)) {
      const changed = object(change);
      if (changed.field !== "messages") continue;
      const value = object(changed.value);
      if (value.messages === undefined) continue; // Delivery/read status, not an associate message.
      const number = nonempty(object(value.metadata).phone_number_id);
      if (number !== phoneNumberId) throw Error("Unexpected phone number ID");
      for (const message of list(value.messages)) {
        const item = object(message);
        const id = nonempty(item.id);
        const timestamp =
          typeof item.timestamp === "string" && /^\d{10,11}$/.test(item.timestamp)
            ? Number(item.timestamp) * 1000
            : NaN;
        messages.set(id, {
          message_id: id,
          phone: nonempty(item.from),
          phone_number_id: number,
          message_type: nonempty(item.type),
          raw,
          sent_at:
            Number.isFinite(timestamp) && timestamp <= Date.now() + 300_000 ? new Date(timestamp).toISOString() : null,
        });
      }
    }
  }
  return [...messages.values()];
}

export function createApp(config: Config, enqueue?: InboxWriter) {
  const app = new Hono();
  app.onError((error, c) => {
    // A middleware that means to answer 401 or 413 has already said so; turning that into a 500
    // would, among other things, stop a browser ever offering the manager a password box.
    if (error instanceof HTTPException) return error.getResponse();
    console.error("Request failed", error instanceof Error ? error.message : "unknown");
    return c.text("Internal error", 500);
  });
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      stage: config.ready ? "store-iq" : "foundation",
      agent_ready: config.ready === true,
      ...(config.ready ? { whatsapp_configured: config.whatsappReady === true } : {}),
    }),
  );

  app.get("/webhook", (c) => {
    if (!config.verifyToken) return c.text("Webhook not configured", 503);
    const challenge = c.req.query("hub.challenge");
    if (
      c.req.query("hub.mode") !== "subscribe" ||
      c.req.query("hub.verify_token") !== config.verifyToken ||
      !challenge
    ) {
      return c.text("Forbidden", 403);
    }
    return c.text(challenge);
  });

  app.post(
    "/webhook",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.text("Payload too large", 413),
    }),
    async (c) => {
      if (!config.appSecret || !config.phoneNumberId) return c.text("Webhook not configured", 503);
      const signature = c.req.header("x-hub-signature-256");
      if (!signature || !/^sha256=[a-f\d]{64}$/i.test(signature)) return c.text("Invalid signature", 401);
      const bytes = Buffer.from(await c.req.arrayBuffer());
      const expected = createHmac("sha256", config.appSecret).update(bytes).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"))) return c.text("Invalid signature", 401);

      let messages: IncomingMessage[];
      try {
        messages = messagesFrom(JSON.parse(bytes.toString("utf8")), config.phoneNumberId);
      } catch {
        return c.text("Invalid webhook payload", 400);
      }
      if (messages.length) {
        if (!enqueue) return c.text("Inbox not configured", 503);
        try {
          await enqueue(messages);
        } catch {
          // Provider errors may contain tokens or customer data; never print the raw error.
          console.error("Webhook persistence failed");
          return c.text("Inbox unavailable", 503);
        }
      }
      return c.text("EVENT_RECEIVED");
    },
  );
  return app;
}
