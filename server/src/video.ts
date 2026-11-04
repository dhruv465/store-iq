import { unsupportedNumbers } from "./brain.js";
import { addSpend, falText, type FalConfig } from "./fal.js";
import { modelRequest, providerRequest, readLimited } from "./http.js";

/** The morning video brief: the manager types today's brief roughly, the model writes a short spoken
 *  script around it, and Google's Gemini Omni Flash films the fixed presenter saying it, voice and lips
 *  together, from his photo. Nothing goes to the floor from here; the manager watches it in the portal
 *  and approves it there.
 *
 *  Chosen by the store on 4 Nov 2026 over ElevenLabs plus lipsync-2 on a pre-filmed clip (about 2
 *  minutes): it moved more naturally and took 46 s. It films 10 s at most and takes no audio, so the
 *  script is cut into pieces that fit 10 s, every piece is filmed at once, each starting and ending on
 *  the same photo so the cuts meet, and fal's ffmpeg joins them. The voice is Google's, described the
 *  same way every time; the store's ElevenLabs voice cannot be given to it. Prices from fal, 4 Nov 2026. */
const FILM = "google/gemini-omni-flash/v1.1/image-to-video"; // $0.10 a second at 720p
const JOIN = "fal-ai/ffmpeg-api/merge-videos"; // $0 a compute second
const FILM_PER_SECOND = 0.1;
const CLIP_SECONDS = 10; // the most it films
// Measured 4 Nov 2026: 26 spoken words took 9 s, so 24 leaves room for a breath.
const WORDS_PER_CLIP = 24;
const WORDS_PER_SECOND = 2.6;
/** Meta refuses a video message over 16 MB. */
const WHATSAPP_VIDEO_BYTES = 16 * 1024 * 1024;

/** Said the same way for every clip, so the pieces sound like one man. */
const SCENE = [
  "A Reliance Digital store manager in his red shirt speaks straight to the camera at the morning team huddle: warm, confident and natural, small head movements, at most one light hand gesture. Static camera, framing unchanged. His lips match every word.",
  "Voice: a warm, clear Indian male voice in his thirties, speaking natural Hinglish the way managers in Indian stores talk: English words in an Indian English accent, Hindi words in natural Hindi. Brisk, friendly pace. Always the same voice.",
  "He starts and ends still, mouth closed, looking at the camera, exactly as in the photo.",
  "Audio: only his voice and a faint, quiet showroom ambience. No music, no subtitles, no text on screen.",
].join("\n");

export type VideoBrief = {
  status: "scripting" | "rendering" | "ready" | "failed";
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

const ONES =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " ",
  );
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** 0 to 99 in Hindi: no rule makes them, so they are listed. */
export const HINDI_UNDER_100 = (
  "शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस " +
  "बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस " +
  "चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ " +
  "साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी " +
  "अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पंचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे"
).split(" ");

const WORDS = {
  en: { hundred: "hundred", thousand: "thousand", lakh: "lakh", crore: "crore", point: "point" },
  hi: { hundred: "सौ", thousand: "हज़ार", lakh: "लाख", crore: "करोड़", point: "दशमलव" },
};
type Tongue = keyof typeof WORDS;

function underHundred(n: number, tongue: Tongue): string {
  // n is 0 to 99, so the lists always have it
  if (tongue === "hi") return HINDI_UNDER_100[n]!;
  return n < 20 ? ONES[n]! : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}

/** A whole number in words, counted the Indian way: 119990 is "one lakh nineteen thousand nine hundred
 *  ninety", and 12 in Hindi is "बारह". */
function inWords(n: number, tongue: Tongue): string {
  if (n === 0) return underHundred(0, tongue);
  const words = WORDS[tongue];
  const parts: string[] = [];
  for (const [size, word] of [
    [1e7, words.crore],
    [1e5, words.lakh],
    [1e3, words.thousand],
    [100, words.hundred],
  ] as const) {
    if (n >= size) parts.push(`${inWords(Math.floor(n / size), tongue)} ${word}`);
    n %= size;
  }
  if (n) parts.push(underHundred(n, tongue));
  return parts.join(" ");
}

/** A figure as written in the script ("1,19,990", "4.5") said in words. */
function sayNumber(written: string, tongue: Tongue = "en"): string {
  const [whole, decimals] = written.replace(/,/g, "").split(".");
  const point = decimals
    ? ` ${WORDS[tongue].point} ${[...decimals].map((d) => underHundred(+d, tongue)).join(" ")}`
    : "";
  return inWords(Number(whole), tongue) + point;
}

// A figure on its own, not part of a model code like S25 or 4K.
const FIGURE = String.raw`(?<![\w.])\d+(?:,\d{2,3})*(?:\.\d+)?(?!\w|\.\d)`;

/** The script as the presenter should say it, every figure spelt out so it is said the store's way
 *  and not read off as letters and digits ("R S 100,199,000"), or in Hindi where English was meant. Prices and percentages are said
 *  in English, the way the floor says them ("one lakh nineteen thousand nine hundred ninety rupees",
 *  "ten percent"); a number that counts a Hindi word is said in Hindi ("बारह महीने तक"), unless it
 *  follows an English name (iPhone 16 पर); any other number is English. The caption keeps
 *  "Rs 1,19,990"; only what is said changes. */
export function spokenScript(script: string): string {
  return script
    .replace(
      new RegExp(String.raw`(?:\bRs\.?|₹|\bINR)\s*(${FIGURE})(?:\s*\/-)?`, "gi"),
      (_, n: string) => `${sayNumber(n)} rupees`,
    )
    .replace(new RegExp(String.raw`(${FIGURE})\s*%`, "g"), (_, n: string) => `${sayNumber(n)} percent`)
    .replace(new RegExp(String.raw`(?<![A-Za-z][\w-]*\s+)${FIGURE}(?=\s*[ऀ-ॿ])`, "g"), (n) => sayNumber(n, "hi"))
    .replace(new RegExp(FIGURE, "g"), (n) => sayNumber(n));
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
const spokenWords = (text: string) => wordCount(spokenScript(text));

/** The script cut into what one clip can say: whole sentences packed in order, and a sentence too
 *  long for one clip cut at its commas. */
export function clipLines(script: string): string[] {
  const pieces = script
    .trim()
    .split(/(?<=[.!?।])\s+/)
    .flatMap((sentence) => (spokenWords(sentence) > WORDS_PER_CLIP ? sentence.split(/(?<=,)\s+/) : [sentence]));
  const clips: string[] = [];
  for (const piece of pieces) {
    const joined = clips.length ? `${clips.at(-1)} ${piece}` : "";
    if (joined && spokenWords(joined) <= WORDS_PER_CLIP) clips[clips.length - 1] = joined;
    else clips.push(piece);
  }
  return clips;
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
  if (current && ["scripting", "rendering"].includes(current.status)) return null;
  const job: VideoBrief = { status: "scripting", brief, cost: 0 };
  current = job;
  let billed = 0;
  const done = (async () => {
    try {
      const written = await writeScript(config, brief, request);
      job.script = written.script;
      // falText has already counted the script in the spend; the clips are counted below.
      job.cost = written.cost;
      job.status = "rendering";
      const filmed = await Promise.allSettled(
        clipLines(job.script).map(async (line) => {
          const seconds = Math.min(CLIP_SECONDS, Math.max(4, Math.ceil(spokenWords(line) / WORDS_PER_SECOND) + 1));
          const made = await falQueue(
            config,
            FILM,
            {
              prompt: `${SCENE}\nHe says exactly this, word for word, adding nothing before or after: "${spokenScript(line)}"`,
              image_url: presenter,
              end_image_url: presenter,
              aspect_ratio: "9:16",
              resolution: "720p",
              duration: seconds,
            },
            request,
            wait,
          );
          billed += seconds * FILM_PER_SECOND;
          job.cost = written.cost + billed;
          const url = made.video?.url;
          if (typeof url !== "string" || !url.startsWith("https://")) throw Error("A clip came back empty.");
          return made.video as { url: string; file_size?: number };
        }),
      );
      // Settled, not all, so a clip still filming when another fails is counted before the spend is.
      const failed = filmed.find((clip) => clip.status === "rejected");
      if (failed) throw failed.reason;
      const clips = filmed.map((clip) => (clip as PromiseFulfilledResult<{ url: string; file_size?: number }>).value);
      const made =
        clips.length === 1
          ? clips[0]!
          : (await falQueue(config, JOIN, { video_urls: clips.map((clip) => clip.url) }, request, wait)).video;
      const video = made?.url;
      if (typeof video !== "string" || !video.startsWith("https://")) throw Error("The video came back empty.");
      if (Number(made.file_size) > WHATSAPP_VIDEO_BYTES)
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
