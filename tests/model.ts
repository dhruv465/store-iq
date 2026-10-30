import type { Decision } from "../server/src/brain.js";

/** The manager, stubbed.
 *
 *  The questions used to be six written ones, so most of these tests could prove a whole walk with
 *  a fetch that rejects. The manager asks them now, which means a walk needs something standing in
 *  for the model — and what the code sends it is worth asserting too: every fact the code filed
 *  reaches the prompt as a note, or the manager asks for what they have already been told. */
// A stubbed fetch is still a request as far as the code is concerned, and it refuses to make one
// without a key.
process.env.GEMINI_API_KEY ||= "test-key";

export function manager(
  decisions: Partial<Decision> | Partial<Decision>[],
  transcript?: { transcript: string; card: Record<string, unknown> },
): { fetch: typeof fetch; prompts: string[]; calls: number } {
  const queue = Array.isArray(decisions) ? [...decisions] : [decisions];
  const state = { prompts: [] as string[], calls: 0 };
  const answerWith: typeof globalThis.fetch = (async (_url: string | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body ?? "{}"));
    const sent = JSON.stringify(body?.contents ?? body);
    state.prompts.push(sent);
    state.calls += 1;
    // A voice note is two requests: the transcription first, then the turn itself.
    const answer =
      transcript && sent.includes("inline_data")
        ? transcript
        : {
            step: "assess",
            card: {},
            shortlist: [],
            demonstrated: false,
            lines: ['Ask: "What matters most to them?"'],
            buttons: [],
            reason: "the manager's own question",
            unknown: false,
            ...(queue.length > 1 ? queue.shift() : queue[0]),
          };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return {
    fetch: answerWith,
    get prompts() {
      return state.prompts;
    },
    get calls() {
      return state.calls;
    },
  };
}
