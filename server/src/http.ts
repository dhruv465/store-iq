/** Bounded provider requests intentionally hide transport errors and response bodies. */
export async function providerRequest(
  request: typeof fetch,
  url: string | URL,
  init: RequestInit,
  provider: string,
  timeoutMs = 30_000,
): Promise<Response> {
  let response: Response;
  try {
    response = await request(url, {
      ...init,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw Error(`${provider} request failed or timed out`);
  }
  if (!response.ok || response.redirected) {
    await response.body?.cancel().catch(() => {});
    throw Error(`${provider} unavailable: HTTP ${response.status}`);
  }
  return response;
}

export async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (length > limit) {
    await response.body?.cancel().catch(() => {});
    throw Error("Provider response exceeds size limit");
  }
  if (!response.body) throw Error("Empty provider response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw Error("Provider response exceeds size limit");
      }
      chunks.push(value);
    }
  } catch {
    throw Error("Provider response unreadable or exceeds size limit");
  } finally {
    reader.releaseLock();
  }
  if (!size) throw Error("Empty provider response");
  return Buffer.concat(chunks, size);
}

const RETRYABLE = /request failed or timed out|unavailable: HTTP (404|500|502|503|504)/;
const ATTEMPT_TIMEOUT_MS = 9000;
const ATTEMPTS = 3;

/** Retries a model call. Safe because generation has no side effect beyond tokens spent.
 *
 *  Provider-agnostic on purpose: Gemini answers a voice note and a photo, and fal.ai's router
 *  answers the turn, and both fail in the same transient ways. */
export async function modelRequest(
  request: typeof fetch,
  url: string,
  init: RequestInit,
  provider = "Gemini",
  attempts = ATTEMPTS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await providerRequest(request, url, init, provider, ATTEMPT_TIMEOUT_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (attempt >= attempts || !RETRYABLE.test(message)) throw error;
      console.error(`${provider} attempt ${attempt} failed (${message}); retrying`);
      await wait(250 * attempt * attempt);
    }
  }
}
