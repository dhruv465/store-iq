import { randomUUID } from "node:crypto";
import { decide } from "./brain.js";
import type { DB } from "./db.js";
import type { Pack } from "./pack.js";
import type { Event, Reply } from "./types.js";
import { downloadWhatsAppMedia, opusSeconds, sendWhatsApp } from "./whatsapp.js";

function rawMessage(raw: any, id: string): any {
  for (const entry of raw.entry ?? [])
    for (const change of entry.changes ?? [])
      for (const message of change.value?.messages ?? []) if (message.id === id) return message;
  throw Error("Message missing from signed webhook");
}

function profileName(raw: any, phone: string): string | undefined {
  for (const entry of raw.entry ?? [])
    for (const change of entry.changes ?? [])
      for (const contact of change.value?.contacts ?? [])
        if (contact?.wa_id === phone && typeof contact.profile?.name === "string")
          return contact.profile.name.slice(0, 60);
  return undefined;
}

export async function incomingEvent(row: any): Promise<Event> {
  if (!/^[1-9]\d{6,14}$/.test(row.phone)) throw Error("Invalid associate phone");
  const message = rawMessage(row.raw, row.message_id);
  const timestamp = Number(message.timestamp) * 1000;
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > 86_400_000 || timestamp > Date.now() + 300_000)
    throw Error("Message timestamp missing or outside the reply window");
  const event: Event = {
    id: row.message_id,
    phone: row.phone,
    modality:
      message.type === "audio"
        ? "voice"
        : message.type === "image"
          ? "image"
          : message.type === "text"
            ? "text"
            : message.type === "interactive"
              ? "interactive"
              : "other",
  };
  const name = profileName(row.raw, row.phone);
  if (name) event.name = name;
  if (message.type === "text" && typeof message.text?.body === "string") event.text = message.text.body.slice(0, 4000);
  else if (message.type === "interactive") {
    const action = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
    if (typeof action !== "string" || !action.trim() || action.length > 256) throw Error("Could not read that choice");
    event.action = action;
  } else if (message.type === "audio") {
    const media = await downloadWhatsAppMedia(message.audio?.id);
    const seconds = opusSeconds(media.bytes);
    if (seconds !== null && seconds > 120)
      event.text = "That voice note was over two minutes. Say it again in one short note.";
    else event.audio = { bytes: media.bytes, mimeType: media.mimeType };
  } else if (message.type === "image") {
    const media = await downloadWhatsAppMedia(message.image?.id);
    event.image = { bytes: media.bytes, mimeType: media.mimeType };
    if (typeof message.image?.caption === "string") event.text = message.image.caption.slice(0, 4000);
  } else event.text = "help";
  return event;
}

/** Optional restriction, off by default: any associate can message the number and get a reply.
 *  Set ALLOWED_PHONES only to pin the build to specific handsets, for a rehearsal say. The control
 *  that actually stops a stray message reaching a stranger is the 24 hour window below, which needs
 *  no list: Store IQ answers people who wrote to it, and nobody else. */
export function allowedPhones(raw = process.env.ALLOWED_PHONES): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim().replace(/^\+/, ""))
      .filter(Boolean),
  );
}

export function sendableTo(phone: string, allowed: Set<string>): boolean {
  return allowed.size === 0 || allowed.has(phone);
}

/** The floor rule is a first reply inside 5 seconds; voice and photo work cannot meet that, so they get an instant line. */
const ACK: Record<string, string> = {
  audio: "👂 Sun raha hoon…",
  image: "🔎 Label padh raha hoon…",
};

export function startWorker(db: DB, pack: Pack, options: { whatsapp: boolean }) {
  let stopped = false;
  let reading = false;
  let sending = false;
  const running = new Map<string, Promise<void>>();

  async function handle(row: any): Promise<void> {
    const ack = ACK[row.message_type];
    if (ack) await db.send(row.phone, { text: ack }).catch(() => {});
    const event = await incomingEvent(row);
    const session = await db.session(row.phone);
    let reply: Reply;
    try {
      reply = await decide(event, session, pack, fetch, db);
    } catch (error) {
      // Silence in front of a customer is worse than an honest line. The session is left untouched,
      // so the associate can simply ask again from where they were.
      console.error("Turn failed after retries", error instanceof Error ? error.message : "unknown");
      await db.send(row.phone, {
        text:
          session.language === "hi"
            ? "Main abhi jawab nahi de paya. Ek baar phir bhejiye.\n↳ Connection issue, aapka customer card waise hi hai."
            : "I could not answer that just now. Send it again.\n↳ A connection problem, your customer card is untouched.",
      });
      return;
    }
    if (!(await db.commit(session, [reply]))) throw Error("Session changed while answering; not overwriting");
  }

  async function inbox(): Promise<void> {
    if (stopped || reading) return;
    reading = true;
    const token = randomUUID();
    let row: any;
    try {
      row = await db.claimInbox(token);
      if (row) {
        // One associate's slow voice note must not reorder their own turns.
        const previous = running.get(row.phone);
        const job = (async () => {
          await previous?.catch(() => {});
          await handle(row);
        })();
        running.set(
          row.phone,
          job.catch(() => {}),
        );
        await job;
        await db.finishInbox(row.message_id, token);
      }
    } catch (error) {
      console.error("Inbox job failed", error instanceof Error ? error.message : "unknown");
      if (row) await db.finishInbox(row.message_id, token, "Processing failed").catch(() => {});
    } finally {
      if (row && running.size > 50) running.clear();
      reading = false;
      if (row && !stopped) setImmediate(() => void inbox());
    }
  }

  async function outbox(): Promise<void> {
    if (stopped || sending || !options.whatsapp) return;
    sending = true;
    const token = randomUUID();
    let row: any;
    try {
      row = await db.claimOutbox(token);
      if (row) {
        if (!sendableTo(row.phone, allowedPhones())) {
          console.error(`Refused to message ${row.phone}: ALLOWED_PHONES is set and excludes it`);
          await db.finishOutbox(row.id, token, "skipped", undefined, "Recipient not in ALLOWED_PHONES");
          return;
        }
        if (!(await db.withinWindow(row.phone))) {
          await db.finishOutbox(row.id, token, "skipped", undefined, "Outside the 24 hour reply window");
          return;
        }
        const providerId = await sendWhatsApp(row.phone, row.payload);
        await db.finishOutbox(row.id, token, "sent", providerId);
      }
    } catch (error) {
      // A timeout can follow provider acceptance; fail closed rather than send twice.
      const http = error instanceof Error ? error.message.match(/HTTP (\d+)/)?.[1] : undefined;
      const status = http === "429" ? "pending" : http?.startsWith("4") ? "failed" : "uncertain";
      console.error("Outbox needs attention; no blind resend");
      if (row)
        await db
          .finishOutbox(row.id, token, status, undefined, http ? `HTTP ${http}` : "Acceptance unknown")
          .catch(() => {});
    } finally {
      sending = false;
      if (row && !stopped) setImmediate(() => void outbox());
    }
  }

  const timers = [setInterval(() => void inbox(), 300), setInterval(() => void outbox(), 200)];
  return {
    kick: () => {
      setImmediate(() => void inbox());
    },
    stop: async () => {
      stopped = true;
      timers.forEach(clearInterval);
      while (reading || sending) await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}
