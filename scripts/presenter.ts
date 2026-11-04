/** Makes the one presenter the video brief reuses every day, so the floor sees the same face each
 *  morning. Run once; put the URL it prints into PRESENTER_VIDEO_URL. Needs ffmpeg.
 *
 *    node --env-file=.env --import tsx scripts/presenter.ts
 *
 *  1. nano-banana-pro (Google) draws him: on 4 Nov 2026 it gave the most professional look and put the
 *     logo on the correct side of the chest, where flux-pro ultra put it on the wrong side and
 *     flux/schnell looked cheap.
 *  2. The store's ElevenLabs voice reads a neutral 22 s greeting, and Kling AI Avatar films him saying
 *     it: a clip that only plays forward. Veo was tried first, but it films 8 s at most, and played
 *     back and forth to 40 s the lips drifted off the words; the store chose this one side by side.
 *  3. ffmpeg drops the sound and scales it to 540x960: lipsync-2 sets its bitrate by resolution, and at
 *     720x1280 a 20 s brief went over WhatsApp's 16 MB.
 *  4. The clip goes to fal's CDN, where lipsync-2 reads it from. About $1.40 in all. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const key = process.env.FAL_KEY?.trim();
if (!key) throw Error("Set FAL_KEY in .env");
const headers = { authorization: `Key ${key}`, "content-type": "application/json" };

async function call(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw Error(`fal answered ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const image = (
  await call("https://fal.run/fal-ai/nano-banana-pro", {
    method: "POST",
    headers,
    body: JSON.stringify({
      aspect_ratio: "9:16",
      num_images: 1,
      prompt:
        "Professional corporate photograph, shot on a full-frame camera with an 85mm lens. A confident, well-groomed " +
        "Indian man in his early thirties, a senior retail store manager, neat short hair, clean shave, warm genuine " +
        "smile with mouth closed, looking straight into the camera. He wears a crisp, well-fitted red collared shirt " +
        'with a small, neatly embroidered "Reliance Digital" logo in white on the left chest. Framed from mid-chest up, ' +
        "centred, vertical 9:16. Behind him a modern, premium electronics showroom with large TVs and warm lighting, " +
        "softly out of focus. Soft key light, gentle rim light, natural skin texture, sharp focus on the face, " +
        "high-end brand campaign look. Nothing covering the face.",
    }),
  })
).images?.[0]?.url;
if (!image) throw Error("nano-banana-pro gave no image");
console.log("image", image);

const voiced = await call("https://fal.run/fal-ai/elevenlabs/tts/turbo-v2.5", {
  method: "POST",
  headers,
  body: JSON.stringify({
    voice: "7b9mYhmnp0y2qSH1FnBL",
    text:
      "Good morning team. Today is a good day on the floor. Greet every customer who walks in, listen to what they " +
      "need, and show them the product working before anything else. Keep the demo units clean and switched on. " +
      "Help each other when it gets busy, and keep the energy up all day. If you are not sure about something, ask " +
      "me. Let's make it a great day for every customer, and for each other. Thank you, and have a great shift.",
  }),
});
const queued = await call("https://queue.fal.run/fal-ai/kling-video/ai-avatar/v2/standard", {
  method: "POST",
  headers,
  body: JSON.stringify({ image_url: image, audio_url: voiced.audio.url }),
});
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const now = await call(queued.status_url, { headers });
  if (now.error) throw Error(`Kling failed: ${JSON.stringify(now.error)}`);
  if (now.status === "COMPLETED") break;
}
const filmed = (await call(queued.response_url, { headers })).video?.url;
if (!filmed) throw Error("Kling gave no video");
console.log("kling", filmed);

const dir = mkdtempSync(join(tmpdir(), "presenter-"));
writeFileSync(join(dir, "kling.mp4"), Buffer.from(await (await fetch(filmed)).arrayBuffer()));
execFileSync("ffmpeg", [
  ...[
    "-v",
    "error",
    "-y",
    "-i",
    join(dir, "kling.mp4"),
    "-an",
    "-vf",
    "scale=540:960",
    "-c:v",
    "libx264",
    "-crf",
    "23",
  ],
  ...["-pix_fmt", "yuv420p", "-movflags", "+faststart", join(dir, "base.mp4")],
]);

const upload = await call("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
  method: "POST",
  headers,
  body: JSON.stringify({ content_type: "video/mp4", file_name: "presenter-base.mp4" }),
});
const put = await fetch(upload.upload_url, {
  method: "PUT",
  headers: { "content-type": "video/mp4" },
  body: readFileSync(join(dir, "base.mp4")),
});
if (!put.ok) throw Error(`fal storage answered ${put.status}`);
console.log(upload.file_url);
