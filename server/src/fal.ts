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
 *   google/gemini-2.5-flash        ~$0.0007 a turn. The default: the prompt was written against
 *                                  this family, and Hindi and Marathi come back clean.
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
