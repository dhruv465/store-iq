import { modelRequest, readLimited } from "./http.js";

/** The turn, answered through fal.ai's OpenRouter router.
 *
 *  Gemini's free tier is 20 requests a day, and since the written questions went the model answers
 *  nearly every turn, so the free tier is no longer a product. This is the paid path: one POST, a
 *  cheap model chosen by slug, charged on tokens actually used.
 *
 *  What the router cannot do:
 *   - it takes no audio, so a voice note goes to ElevenLabs Scribe on fal, below; a shelf-tag photo
 *     goes to the router's own vision route, also below, so neither needs a Gemini key
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

/** What fal has billed this process, from the cost it returns with every call. The database keeps the
 *  running total across restarts through `onSpend()`; this copy is for the log and `/health`. */
let spent = 0;
export type SpendKind = "model" | "photo" | "voice" | "video";
let recorder: ((kind: SpendKind, usd: number) => Promise<void>) | null = null;

export function falSpend(): number {
  return spent;
}

/** Where every bill is kept beyond this process: the database, set at start. */
export function onSpend(record: ((kind: SpendKind, usd: number) => Promise<void>) | null): void {
  recorder = record;
}

function bill(kind: SpendKind, usd: number): void {
  if (!(usd > 0)) return;
  spent += usd;
  // A ledger that cannot be written must never cost the associate their answer.
  recorder?.(kind, usd).catch((error) => console.error("Spend not recorded:", error));
}

/** For what fal bills without saying so in the answer: a video is priced per second of film. */
export function addSpend(cost: number, kind: SpendKind = "video"): void {
  bill(kind, cost);
}

/** Every fal endpoint Store IQ calls (server/src/video.ts, scripts/presenter.ts), so fal's total
 *  is this project's and not the whole account's. Add one here when a new endpoint is called. */
const OUR_ENDPOINTS = [
  "openrouter/router",
  "openrouter/router/vision",
  "fal-ai/elevenlabs/speech-to-text",
  "google/gemini-omni-flash/v1.1/image-to-video",
  "fal-ai/ffmpeg-api/merge-videos",
  "fal-ai/ffmpeg-api/extract-frame",
  "fal-ai/nano-banana-pro",
];
/** The first commit: nothing before it was Store IQ. */
export const BILLED_SINCE = "2026-10-28";
export type Billed = { total: number; since: string; endpoints: Record<string, number> };
let billedCache: { at: number; value: Billed | null } | undefined;

/** What fal itself has charged for Store IQ, from every key and machine: local tests included, which
 *  the spend table never sees, and requests that timed out here but were still billed. It needs
 *  FAL_BILLING_KEY, a key on fal's BILLING preset; the turn's FAL_KEY is refused with a 403. Read at
 *  most every 10 minutes, and a failure is kept for as long, so the portal is never held up by it. */
export async function falBilled(
  env = process.env,
  request: typeof fetch = fetch,
  now = Date.now(),
): Promise<Billed | null> {
  const key = env.FAL_BILLING_KEY?.trim();
  if (!key) return null;
  if (billedCache && now - billedCache.at < 10 * 60 * 1000) return billedCache.value;
  let value: Billed | null = null;
  try {
    const url = new URL("https://api.fal.ai/v1/models/usage");
    url.searchParams.set("start", BILLED_SINCE);
    url.searchParams.set("expand", "summary");
    url.searchParams.set("endpoint_id", OUR_ENDPOINTS.join(","));
    const response = await request(url, {
      headers: { authorization: `Key ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw Error(`status ${response.status}`);
    const body = (await response.json()) as {
      summary?: { endpoint_id?: string; cost_total?: number; cost?: number }[];
    };
    value = { total: 0, since: BILLED_SINCE, endpoints: {} };
    for (const line of body.summary ?? []) {
      const usd = Number(line.cost_total ?? line.cost ?? 0);
      value.total += usd;
      const id = line.endpoint_id ?? "other";
      value.endpoints[id] = (value.endpoints[id] ?? 0) + usd;
    }
  } catch (error) {
    console.error("fal usage not read:", error instanceof Error ? error.message : error);
  }
  billedCache = { at: now, value };
  return value;
}

export function falConfig(env = process.env): FalConfig | null {
  const key = env.FAL_KEY?.trim();
  if (!key) return null;
  return { key, model: env.FAL_MODEL?.trim() || DEFAULT_MODEL };
}

/** A reply is 1 to 3 s. Measured 3 Nov 2026, the 15 and 25 s turns were one request that hung
 *  until the 9 s attempt timeout before its retry answered in 2 s. */
export const HEDGE_MS = 4500;

/** One chat completion, retried on the transient failures every provider has. If it has not
 *  answered by HEDGE_MS, the same request is sent again and the first answer wins: a hang costs
 *  a duplicate of a tenth of a cent instead of the customer's patience. */
export async function falText(
  config: FalConfig,
  system: string,
  user: string,
  request: typeof fetch = fetch,
  hedgeMs = HEDGE_MS,
): Promise<{ text: string; cost: number }> {
  type Answer = { output?: string; error?: string; usage?: { cost?: number } };
  // Each request is billed as soon as its answer is read: fal charges the hedged duplicate and an
  // empty or refused answer too, and leaving those out made the portal's cost read low.
  const post = async (): Promise<Answer> => {
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
    const answer = JSON.parse(new TextDecoder().decode(await readLimited(response, 512 * 1024))) as Answer;
    bill("model", answer.usage?.cost ?? 0);
    return answer;
  };
  // The second request starts only while the first is still out. A first that answers, or that
  // fails before then, stands it down; one that fails after it started leaves it running.
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let standDown: (reason: Error) => void = () => {};
  const second = new Promise<Answer>((resolve, reject) => {
    standDown = reject;
    timer = setTimeout(() => {
      started = true;
      post().then(resolve, reject);
    }, hedgeMs);
  });
  const first = post();
  const stop = (): void => {
    clearTimeout(timer);
    standDown(Error("not needed"));
  };
  first.then(stop, () => {
    if (!started) stop();
  });
  const body = await Promise.any([first, second]).catch((all: AggregateError) => {
    throw all.errors[0];
  });
  if (body.error) throw Error(`fal refused: ${body.error}`);
  if (!body.output?.trim()) throw Error("Empty fal response");
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
  name = "note",
): Promise<string> {
  const started = await modelRequest(
    request,
    "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
    {
      method: "POST",
      headers: { authorization: `Key ${config.key}`, "content-type": "application/json" },
      // A neutral name: nothing about the associate or the customer goes into it.
      body: JSON.stringify({ content_type: audio.mimeType, file_name: name }),
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

/** A shelf-tag photo, read on the router's vision route with the same key and model as the turn.
 *  Measured 3 Nov 2026 on a rendered tag: every printed figure back in 2.7 s for $0.0002. It only
 *  reads the tag; the reply is still written from the catalogue, so a misread is never a price. */
export async function falVision(
  config: FalConfig,
  prompt: string,
  image: { bytes: Uint8Array; mimeType: string },
  request: typeof fetch = fetch,
): Promise<string> {
  const response = await modelRequest(
    request,
    "https://fal.run/openrouter/router/vision",
    {
      method: "POST",
      headers: { authorization: `Key ${config.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        prompt,
        image_urls: [await falUpload(config, image, request, "tag")],
        temperature: 0,
        max_tokens: 160,
      }),
    },
    "fal",
  );
  const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 64 * 1024))) as {
    output?: string;
    error?: string;
    usage?: { cost?: number };
  };
  bill("photo", body.usage?.cost ?? 0);
  if (body.error) throw Error(`fal refused the photo: ${body.error}`);
  return (body.output ?? "").trim();
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
  limit = 600,
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
  // fal bills a voice note in minutes without saying the cost: the units come in a header, the price
  // from fal's own pricing list.
  const units = Number(response.headers.get("x-fal-billable-units"));
  if (units > 0) bill("voice", units * (await voicePrice(config, request)));
  if (!body.text?.trim()) throw Error(NOTHING_HEARD);
  return body.text.trim().slice(0, limit);
}

let perMinute: number | null = null;
/** fal's price per billed unit of speech-to-text, asked once a process; 0 (and asked again next time)
 *  when the pricing list does not answer, so a voice note is never held up by it. */
async function voicePrice(config: FalConfig, request: typeof fetch): Promise<number> {
  if (perMinute !== null) return perMinute;
  try {
    const response = await request(
      "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/elevenlabs/speech-to-text",
      { headers: { authorization: `Key ${config.key}` }, signal: AbortSignal.timeout(5000) },
    );
    const body = (await response.json()) as { prices?: { unit_price?: number }[] };
    const price = body.prices?.[0]?.unit_price;
    if (typeof price === "number" && price >= 0) return (perMinute = price);
  } catch (error) {
    console.error("fal pricing not read:", error instanceof Error ? error.message : error);
  }
  return 0;
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
