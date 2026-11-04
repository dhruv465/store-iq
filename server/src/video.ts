import { unsupportedNumbers } from "./brain.js";
import { addSpend, falText, type FalConfig } from "./fal.js";
import { modelRequest, providerRequest, readLimited } from "./http.js";

/** The morning video brief: the manager types today's brief roughly, the model writes a short spoken
 *  script around it, ElevenLabs reads it, and Kling makes the one fixed presenter say it. Nothing
 *  goes to the floor from here; the manager watches it in the portal and approves it there.
 *
 *  Prices from fal's pricing API, 4 Nov 2026. The first real brief, 4 Nov: 20 s of video, $1.15, 5.5
 *  minutes, 12.2 MB. Kling writes about 0.6 MB a second, so the script is kept to 20 seconds to stay
 *  under WhatsApp's 16 MB. */
const VOICE = "fal-ai/elevenlabs/tts/turbo-v2.5"; // $0.05 per 1000 characters; half of multilingual-v2
const AVATAR = "fal-ai/kling-video/ai-avatar/v2/standard"; // $0.0562 per second of video
const VOICE_PER_CHAR = 0.05 / 1000;
const AVATAR_PER_SECOND = 0.0562;
/** Meta refuses a video message over 16 MB. */
const WHATSAPP_VIDEO_BYTES = 16 * 1024 * 1024;

export type VideoBrief = {
  status: "scripting" | "voicing" | "rendering" | "ready" | "failed";
  brief: string;
  script?: string;
  video?: string;
  error?: string;
  cost: number;
};

const SCRIPT_SYSTEM = [
  "You write the script for a short video that opens the shift at a Reliance Digital store. A presenter in the store's red staff shirt reads it to camera, to the floor team: the store associates, never customers.",
  "40 to 60 words, about 20 seconds spoken. Warm and energetic, plain speech: no headings, lists, emoji, hashtags or stage directions.",
  "Write in the language the manager wrote the brief in. Hinglish stays Hinglish, in Latin letters.",
  "Use only what the brief says. Every price, percentage, number, date and duration must appear in the brief exactly as written; never add one, round one or work one out.",
  "Write money as Rs 54,990, never with the rupee sign.",
  "Answer with the script only, no quotes around it.",
].join("\n");

/** The script, held to Rule 1: every figure in it must be in the manager's own words. Refused once,
 *  the model is told which figure; refused twice, nothing is generated and the manager is told. */
export async function writeScript(
  config: FalConfig,
  brief: string,
  request: typeof fetch = fetch,
): Promise<{ script: string; cost: number }> {
  let cost = 0;
  const draft = async (note = ""): Promise<string> => {
    const answer = await falText(config, SCRIPT_SYSTEM, `${note}MANAGER'S BRIEF:\n${brief}`, request);
    cost += answer.cost;
    return answer.text.trim().replace(/^["“]|["”]$/g, "");
  };
  let script = await draft();
  // An empty allowlist: the brief is the only source a figure can come from.
  let wrong = unsupportedNumbers(script, new Set(), brief);
  if (wrong.length) {
    script = await draft(
      `You wrote ${wrong.join(", ")}, which is not in the brief. Write it again using only figures exactly as the brief has them.\n\n`,
    );
    wrong = unsupportedNumbers(script, new Set(), brief);
  }
  if (wrong.length)
    throw Error(
      `The script kept a figure that is not in your brief (${wrong.join(", ")}). Nothing was generated; if it is right, put it in the brief.`,
    );
  return { script, cost };
}

async function json(response: Response): Promise<Record<string, any>> {
  return JSON.parse(new TextDecoder().decode(await readLimited(response, 256 * 1024)));
}

/** fal's own URLs for a queued request, and nowhere else: the key goes with every poll. */
function queueUrl(raw: unknown): string {
  const url = new URL(String(raw));
  if (url.protocol !== "https:" || url.hostname !== "queue.fal.run") throw Error("fal gave an unexpected queue URL");
  return url.href;
}

/** A job that takes minutes, through fal's queue: submitted once, then polled. The submit is not
 *  retried, since a duplicate is a second video billed; the polls are, since they cost nothing. */
export async function falQueue(
  config: FalConfig,
  endpoint: string,
  input: unknown,
  request: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 20 * 60_000,
): Promise<Record<string, any>> {
  const headers = { authorization: `Key ${config.key}`, "content-type": "application/json" };
  const submitted = await json(
    await providerRequest(
      request,
      `https://queue.fal.run/${endpoint}`,
      { method: "POST", headers, body: JSON.stringify(input) },
      "fal",
    ),
  );
  const status = queueUrl(submitted.status_url);
  const result = queueUrl(submitted.response_url);
  for (const until = Date.now() + timeoutMs; Date.now() < until; await wait(5000)) {
    const now = await json(await modelRequest(request, status, { headers }, "fal"));
    if (now.error) throw Error(`fal refused the video: ${String(now.error).slice(0, 200)}`);
    if (now.status === "COMPLETED") return json(await modelRequest(request, result, { headers }, "fal"));
  }
  throw Error("The video took over 20 minutes; nothing was sent. Try again.");
}

let current: VideoBrief | null = null;

/** shortcut: one brief, in memory, so a restart forgets it; move it to the database if the manager
 *  needs to come back to a video after a deploy. */
export function videoBrief(): VideoBrief | null {
  return current;
}

export function discardVideoBrief(): void {
  current = null;
}

/** The ready brief, handed over once, and only if it is the video the manager watched. */
export function takeVideoBrief(video: string): VideoBrief | null {
  if (current?.status !== "ready" || current.video !== video) return null;
  const taken = current;
  current = null;
  return taken;
}

/** Starts the pipeline and answers at once; the portal polls videoBrief(). Null while one is
 *  already being made, so two clicks are not two videos billed. */
export function startVideoBrief(
  config: FalConfig,
  presenter: string,
  brief: string,
  request: typeof fetch = fetch,
  wait?: (ms: number) => Promise<void>,
): { job: VideoBrief; done: Promise<void> } | null {
  if (current && ["scripting", "voicing", "rendering"].includes(current.status)) return null;
  const job: VideoBrief = { status: "scripting", brief, cost: 0 };
  current = job;
  let billed = 0;
  const done = (async () => {
    try {
      const written = await writeScript(config, brief, request);
      job.script = written.script;
      // falText has already counted the script in the spend; the voice and the video are counted below.
      job.cost = written.cost;
      job.status = "voicing";
      const voiced = await json(
        await providerRequest(
          request,
          `https://fal.run/${VOICE}`,
          {
            method: "POST",
            headers: { authorization: `Key ${config.key}`, "content-type": "application/json" },
            body: JSON.stringify({ text: job.script, voice: "Brian" }),
          },
          "fal",
          60_000,
        ),
      );
      billed += job.script.length * VOICE_PER_CHAR;
      job.cost = written.cost + billed;
      const audio = voiced.audio?.url;
      if (typeof audio !== "string") throw Error("The voice came back empty.");
      job.status = "rendering";
      const made = await falQueue(config, AVATAR, { image_url: presenter, audio_url: audio }, request, wait);
      billed += (Number(made.duration) || 0) * AVATAR_PER_SECOND;
      job.cost = written.cost + billed;
      const video = made.video?.url;
      if (typeof video !== "string" || !video.startsWith("https://")) throw Error("The video came back empty.");
      if (Number(made.video.file_size) > WHATSAPP_VIDEO_BYTES)
        throw Error("The video is over WhatsApp's 16 MB limit. Shorten the brief and try again.");
      job.video = video;
      job.status = "ready";
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "The video could not be made.";
      console.error("Video brief failed:", job.error);
    } finally {
      addSpend(billed);
    }
  })();
  return { job, done };
}
