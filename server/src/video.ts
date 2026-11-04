import { unsupportedNumbers } from "./brain.js";
import { addSpend, falText, type FalConfig } from "./fal.js";
import { modelRequest, providerRequest, readLimited } from "./http.js";

/** The morning video brief: the manager types today's brief roughly, the model writes a short spoken
 *  script around it, ElevenLabs reads it, and sync's lipsync-2 moves the fixed presenter's mouth to it.
 *  Nothing goes to the floor from here; the manager watches it in the portal and approves it there.
 *
 *  The presenter is a 22 s clip of him talking, made once (scripts/presenter.ts), so each day only the
 *  lips are made. Chosen by the store on 4 Nov 2026 from three side by side: LatentSync drifted off
 *  the words after the first sentences on a clip played back and forth, and lipsync-2 on a clip that
 *  only plays forward held them, in about 2 minutes. If the voice runs past the clip, it bounces.
 *  lipsync-2 sets its own bitrate whatever it is given, by resolution: at 720x1280 19.2 s was 14.3 MB
 *  and a Hinglish brief went over WhatsApp's 16 MB; at 540x960 it is 7.4 MB, so the clip is 540x960.
 *  Prices from fal, 4 Nov 2026. */
const VOICE = "fal-ai/elevenlabs/tts/turbo-v2.5"; // $0.05 per 1000 characters; half of multilingual-v2
const VOICE_ID = "7b9mYhmnp0y2qSH1FnBL"; // the store's chosen ElevenLabs voice, 4 Nov 2026
const LIPSYNC = "fal-ai/sync-lipsync/v2"; // $3 a minute of video
const VOICE_PER_CHAR = 0.05 / 1000;
const LIPSYNC_PER_SECOND = 3 / 60;
// shortcut: fal does not return the length, so it is estimated from the words (about 15 characters a
// second for this voice); read it from the file if the spend has to be exact.
const SPOKEN_CHARS_PER_SECOND = 15;
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
  "You write what a Reliance Digital store manager says to camera at the morning huddle, to the floor team: the store associates, never customers. It is heard, not read.",
  "35 to 45 words, about 15 seconds; never more. Talk the way a good manager actually talks to their team: short sentences, one idea each, a quick greeting, what is on today and what to do about it, and a short push to finish.",
  'Never say the same word twice in a row or in back-to-back sentences (not "sale... sale"); say it once and move on. No headings, lists, emoji, hashtags or stage directions.',
  'Always write in Hinglish, whatever language the brief is in: mostly English, mixed with the everyday Hindi a manager on an Indian store floor actually uses ("Good morning team! Diwali sale आज से live है.", "हर TV sale पर extended warranty ज़रूर pitch करो."). English words in English letters, Hindi words in Devanagari, never Hindi written in English letters. Brand and model names, and every figure with its unit, stay exactly as the brief writes them (LG, iPhone 16, 55 inch, 10%).',
  'Keep every fact as the brief has it, including when: "kal" is tomorrow, "aaj" is today; never move a day.',
  "Use only what the brief says. Every price, percentage, number, date and duration must appear in the brief exactly as written; never add one, round one or work one out.",
  "Write money as Rs 54,990, never with the rupee sign.",
  "Answer with the script only, no quotes around it.",
].join("\n");

/** An amount as it is said aloud in an Indian store: 1,19,990 is "1 लाख 19 हज़ार 990". The
 *  voice reads digits well and "Rs" and Indian commas badly ("R S 100,199,000"), so the figures stay
 *  the checked ones and only the way they are written changes. */
function sayAmount(written: string): string {
  const plain = written.replace(/,/g, "");
  if (!/^\d+$/.test(plain)) return plain;
  const n = Number(plain);
  const parts = [
    [Math.floor(n / 1e7), "करोड़"],
    [Math.floor((n % 1e7) / 1e5), "लाख"],
    [Math.floor((n % 1e5) / 1e3), "हज़ार"],
  ]
    .filter(([count]) => count)
    .map(([count, word]) => `${count} ${word}`);
  if (n % 1000 || !parts.length) parts.push(String(n % 1000));
  return parts.join(" ");
}

/** The script as the voice should read it. The caption keeps "Rs 54,990"; only the audio changes. */
export function spokenScript(script: string): string {
  return script
    .replace(
      /(?:\bRs\.?|₹|\bINR)\s*(\d+(?:,\d{2,3})*(?:\.\d+)?)(?:\s*\/-)?/gi,
      (_, amount: string) => `${sayAmount(amount)} रुपये`,
    )
    .replace(/\b\d{1,3}(?:,\d{2,3})+\b/g, sayAmount)
    .replace(/(\d)\s*%/g, "$1 परसेंट");
}

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
            body: JSON.stringify({ text: spokenScript(job.script), voice: VOICE_ID, language_code: "hi" }),
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
      const made = await falQueue(
        config,
        LIPSYNC,
        { video_url: presenter, audio_url: audio, sync_mode: "bounce" },
        request,
        wait,
      );
      billed += (spokenScript(job.script).length / SPOKEN_CHARS_PER_SECOND) * LIPSYNC_PER_SECOND;
      job.cost = written.cost + billed;
      const video = made.video?.url;
      if (typeof video !== "string" || !video.startsWith("https://")) throw Error("The video came back empty.");
      if (Number(made.video.file_size) > WHATSAPP_VIDEO_BYTES)
        throw Error("The video is over WhatsApp's 16 MB limit. Make the brief shorter and try again.");
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
