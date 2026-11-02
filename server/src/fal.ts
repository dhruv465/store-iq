import { modelRequest, readLimited } from "./http.js";

/** The turn, answered through fal.ai's OpenRouter router.
 *
 *  Gemini's free tier is 20 requests a day, and since the written questions went the model answers
 *  nearly every turn, so the free tier is no longer a product. This is the paid path: one POST, a
 *  cheap model chosen by slug, charged on tokens actually used.
 *
 *  Two things the router cannot do, which is why the Gemini code stays:
 *   - it takes no image and no audio, so a voice note and a shelf-tag photo still go to Gemini
 *   - it has no response schema, so the shape is asked for in the system prompt and the answer is
 *     read tolerantly below. Gemini's own call keeps its schema and remains the stricter path. */

export type FalConfig = { key: string; model: string };

/** Any OpenRouter slug works — FAL_MODEL swaps it without a code change — but most of the cheap
 *  ones cannot do this job, and the router says why in three different ways. Measured 30 Oct 2026,
 *  four real turns each:
 *
 *   google/gemini-2.5-flash        $0.0007 to $0.0015 a turn, by how much of the pack the turn
 *                                  carries. The default: the prompt was written against this
 *                                  family, and Hindi and Marathi come back clean.
 *   mistralai/mistral-small-24b    ~$0.00015 a turn, and it invented a 2-year brand warranty and a
 *                                  price match with Croma. Cheap is not the only axis.
 *   anthropic/claude-haiku-4.5     works, about three times the default.
 *   qwen/qwen3.7-flash             refused: "ZDR violation (account settings)" — no provider for
 *                                  it meets the zero-data-retention policy on this account.
 *   z-ai/glm-5.3-flash, gpt-5-nano refused: "Reasoning is mandatory for this endpoint", and we ask
 *                                  for none, because the floor wants an answer in five seconds.
 *   qwen/qwen3-32b                 answered with an empty string and billed for it.
 *   openrouter/auto                answered `{"ok":<|endoftext|>true}`. Never route through it. */
const DEFAULT_MODEL = "google/gemini-2.5-flash";

/** What this process has spent, since fal returns the cost of every call it bills and nothing
 *  else records it. It resets when the server restarts, which under `npm run dev` is often, so it
 *  answers "what is this costing" rather than "what has it cost". fal's dashboard is the ledger. */
let spent = 0;

export function falSpend(): number {
  return spent;
}

export function falConfig(env = process.env): FalConfig | null {
  const key = env.FAL_KEY?.trim();
  if (!key) return null;
  return { key, model: env.FAL_MODEL?.trim() || DEFAULT_MODEL };
}

/** One chat completion, retried on the transient failures every provider has. */
export async function falText(
  config: FalConfig,
  system: string,
  user: string,
  request: typeof fetch = fetch,
): Promise<{ text: string; cost: number }> {
  const response = await modelRequest(
    request,
    "https://fal.run/openrouter/router",
    {
      method: "POST",
      // The key goes in the Authorization header with fal's own "Key" prefix, never in the URL.
      headers: { authorization: `Key ${config.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        system_prompt: system,
        prompt: user,
        temperature: 0.3,
        max_tokens: 700,
      }),
    },
    "fal",
  );
  const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 512 * 1024))) as {
    output?: string;
    error?: string;
    usage?: { cost?: number };
  };
  if (body.error) throw Error(`fal refused: ${body.error}`);
  if (!body.output?.trim()) throw Error("Empty fal response");
  spent += body.usage?.cost ?? 0;
  return { text: body.output, cost: body.usage?.cost ?? 0 };
}

/** The speech models take a URL and nothing else: a base64 data URI is refused with "Unsupported
 *  data URL", whatever the general file documentation says. So the bytes go to fal's own storage
 *  first, which hands back the URL to transcribe.
 *
 *  That URL is on a public CDN, and the voice note is a customer's room described out loud. It is
 *  the same trust boundary as sending the bytes to any transcription provider — WhatsApp's own CDN
 *  already holds the file — but it is worth knowing that is where it goes. */
async function falUpload(
  config: FalConfig,
  audio: { bytes: Uint8Array; mimeType: string },
  request: typeof fetch,
): Promise<string> {
  const started = await modelRequest(
    request,
    "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
    {
      method: "POST",
      headers: { authorization: `Key ${config.key}`, "content-type": "application/json" },
      // A neutral name: nothing about the associate or the customer goes into it.
      body: JSON.stringify({ content_type: audio.mimeType, file_name: "note" }),
    },
    "fal",
  );
  const where = JSON.parse(new TextDecoder().decode(await readLimited(started, 8 * 1024))) as {
    upload_url?: string;
    file_url?: string;
  };
  if (!where.upload_url || !where.file_url) throw Error("fal storage gave no upload URL");
  await modelRequest(
    request,
    where.upload_url,
    { method: "PUT", headers: { "content-type": audio.mimeType }, body: audio.bytes as unknown as BodyInit },
    "fal",
  );
  return where.file_url;
}

export const NOTHING_HEARD = "Nothing heard in the voice note";

/** A voice note, transcribed, on fal because the router takes no audio and Gemini's free tier is 20
 *  requests a day.
 *
 *  ElevenLabs Scribe and not Whisper, compared on ten real notes from the floor on 2 Nov 2026. Whisper
 *  returned nothing at all for a clear "someone wants to buy an iPhone under eighty thousand", wrote
 *  Hindi in Urdu script, and heard "laptop" as "लेक्टॉप" and "43 inch" as "फोर्टी त्री इंच". Scribe got
 *  all of those, and keeps "Laptop में कोई option है" in the mix it was said in.
 *
 *  Language is left unset on purpose: it detects it, and this product is spoken to in three. */
export async function falTranscribe(
  config: FalConfig,
  audio: { bytes: Uint8Array; mimeType: string },
  request: typeof fetch = fetch,
): Promise<string> {
  const response = await modelRequest(
    request,
    "https://fal.run/fal-ai/elevenlabs/speech-to-text",
    {
      method: "POST",
      headers: { authorization: `Key ${config.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        audio_url: await falUpload(config, audio, request),
        // The words only: no "(laughs)", and nobody cares who said which.
        tag_audio_events: false,
        diarize: false,
      }),
    },
    "fal",
  );
  const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 512 * 1024))) as {
    text?: string;
    error?: string;
  };
  if (body.error) throw Error(`fal refused the audio: ${body.error}`);
  if (!body.text?.trim()) throw Error(NOTHING_HEARD);
  return body.text.trim().slice(0, 600);
}

/** JSON out of a model that was only asked for it in words.
 *
 *  Without a response schema the answer arrives wrapped in a code fence, or with a sentence in
 *  front of it, often enough to matter. This takes the outermost braces and nothing else, so a
 *  model that cannot be told stays usable. */
export function readJson<T>(text: string): T {
  const fenced = text.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw Error(`No JSON in the answer: ${text.slice(0, 120)}`);
  return JSON.parse(fenced.slice(start, end + 1)) as T;
}

/** The schema, said in words, because this router has nowhere to put one. */
export function shapeInstruction(schema: unknown): string {
  return [
    "Answer with one JSON object and nothing else: no code fence, no sentence before or after it.",
    `It must match this schema exactly, every required key present: ${JSON.stringify(schema)}`,
  ].join("\n");
}
