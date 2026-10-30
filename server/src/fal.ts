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

/** Cheap enough not to think about: at ~3,200 tokens a turn this is about a hundredth of a US cent.
 *  Any OpenRouter slug works — FAL_MODEL swaps it without a code change. */
const DEFAULT_MODEL = "qwen/qwen3.7-flash";

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
  return { text: body.output, cost: body.usage?.cost ?? 0 };
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
