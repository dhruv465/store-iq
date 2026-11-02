import type { Decision } from "../server/src/brain.js";

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
