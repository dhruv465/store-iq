import { providerRequest, readLimited } from "./http.js";
import type { Reply } from "./types.js";

const MB = 1024 * 1024;
// WhatsApp voice notes are OGG/Opus and photos are JPEG/PNG; nothing else is accepted on the floor.
const mediaTypes: Record<string, { extension: string; limit: number }> = {
  "image/jpeg": { extension: "jpg", limit: 5 * MB },
  "image/png": { extension: "png", limit: 5 * MB },
  "audio/ogg": { extension: "ogg", limit: 16 * MB },
  "audio/mp4": { extension: "m4a", limit: 16 * MB },
  "audio/mpeg": { extension: "mp3", limit: 16 * MB },
};

export type MediaInput = { bytes: Uint8Array; mimeType: string; fileName: string };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw Error(`Missing ${name}`);
  return value;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function graphConfig() {
  const version = required("WHATSAPP_GRAPH_VERSION");
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  if (!/^v\d{1,3}\.0$/.test(version)) throw Error("Invalid WHATSAPP_GRAPH_VERSION");
  if (!/^\d{1,30}$/.test(phoneNumberId)) throw Error("Invalid WHATSAPP_PHONE_NUMBER_ID");
  return { base: `https://graph.facebook.com/${version}`, phoneNumberId, token: required("WHATSAPP_ACCESS_TOKEN") };
}

async function json(response: Response, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const bytes = await readLimited(response, limit);
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw Error("Invalid provider JSON response");
  }
}

/** Floor rule: at most 3 buttons, so a reply is always a plain text or a 3-button card. */
export async function sendWhatsApp(phone: string, reply: Reply, request: typeof fetch = fetch): Promise<string> {
  if (!/^[1-9]\d{6,14}$/.test(phone)) throw Error("Invalid WhatsApp recipient");
  const buttons = reply.buttons ?? [];
  if (typeof reply.text !== "string" || !reply.text.trim() || reply.text.length > (buttons.length ? 1024 : 4096))
    throw Error("Invalid WhatsApp reply text");
  if (
    buttons.length > 3 ||
    buttons.some(
      (b) =>
        !b ||
        typeof b.id !== "string" ||
        !b.id.trim() ||
        b.id !== b.id.trim() ||
        b.id.length > 256 ||
        typeof b.title !== "string" ||
        !b.title.trim() ||
        b.title.length > 20,
    ) ||
    new Set(buttons.map((b) => b.id)).size !== buttons.length ||
    new Set(buttons.map((b) => b.title.trim())).size !== buttons.length
  )
    throw Error("Invalid WhatsApp reply buttons");
  const config = graphConfig();
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    ...(buttons.length
      ? {
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: reply.text },
            action: { buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
          },
        }
      : { type: "text", text: { body: reply.text, preview_url: false } }),
  };
  const result = await json(
    await providerRequest(
      request,
      `${config.base}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      "WhatsApp",
    ),
  );
  const first = Array.isArray(result.messages) ? object(result.messages[0]) : {};
  if (typeof first.id !== "string" || !first.id.startsWith("wamid.") || first.id.length > 1024)
    throw Error("Invalid WhatsApp message response");
  return first.id;
}

/** Only the URL Meta returns for this business phone is eligible for download. */
export async function downloadWhatsAppMedia(id: unknown, request: typeof fetch = fetch): Promise<MediaInput> {
  if (typeof id !== "string" || !/^\d{1,30}$/.test(id)) throw Error("Invalid WhatsApp media ID");
  const config = graphConfig();
  const headers = { authorization: `Bearer ${config.token}` };
  const metadataUrl = new URL(`${config.base}/${id}`);
  metadataUrl.searchParams.set("phone_number_id", config.phoneNumberId);
  const metadata = await json(await providerRequest(request, metadataUrl, { headers }, "WhatsApp media"));
  let url: URL;
  try {
    url = new URL(String(metadata.url));
  } catch {
    throw Error("Invalid WhatsApp media URL");
  }
  // shortcut: only Meta's known download host is allowed; verify any new official host before widening.
  if (
    url.protocol !== "https:" ||
    url.hostname !== "lookaside.fbsbx.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw Error("Untrusted WhatsApp media URL");
  const mimeType = typeof metadata.mime_type === "string" ? metadata.mime_type.split(";")[0]!.trim().toLowerCase() : "";
  const format = mediaTypes[mimeType];
  if (!format) throw Error("Unsupported WhatsApp media type");
  const fileSize =
    typeof metadata.file_size === "string" && /^\d{1,9}$/.test(metadata.file_size)
      ? Number(metadata.file_size)
      : metadata.file_size;
  if (typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > format.limit)
    throw Error("Invalid WhatsApp media size");
  const response = await providerRequest(request, url, { headers }, "WhatsApp download");
  if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== mimeType) {
    await response.body?.cancel().catch(() => {});
    throw Error("WhatsApp media MIME mismatch");
  }
  const bytes = await readLimited(response, Math.min(format.limit, fileSize));
  if (bytes.byteLength !== fileSize) throw Error("WhatsApp media size mismatch");
  return { bytes, mimeType, fileName: `${id}.${format.extension}` };
}

/** Ogg/Opus duration from the last page granule position; null when the bytes are not Ogg/Opus. */
export function opusSeconds(bytes: Uint8Array): number | null {
  const audio = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = 27 + (audio[26] ?? 0);
  if (audio.toString("ascii", 0, 4) !== "OggS" || audio.toString("ascii", head, head + 8) !== "OpusHead") return null;
  for (let at = audio.lastIndexOf("OggS"); at > 0; at = audio.lastIndexOf("OggS", at - 1)) {
    if (audio[at + 4] !== 0 || at + 14 > audio.length) continue;
    const granule = audio.readBigInt64LE(at + 6);
    if (granule >= 0n) return Number(granule) / 48_000;
  }
  return null;
}
