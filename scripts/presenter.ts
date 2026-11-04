/** Makes the one presenter the video brief reuses every day, so the floor sees the same face each
 *  morning. Run once; put the URL it prints into PRESENTER_IMAGE_URL.
 *
 *    node --env-file=.env --import tsx scripts/presenter.ts [fal-image-model]
 *
 *  flux/schnell by default: at $0.003 a megapixel it is the cheapest, and on 4 Nov 2026 it spelled
 *  "Reliance Digital" on the shirt where nano-banana ($0.04) wrote "Relance". The output is already on
 *  fal's CDN, which is where the avatar model reads it from. */
const key = process.env.FAL_KEY?.trim();
if (!key) throw Error("Set FAL_KEY in .env");
const model = process.argv[2] ?? "fal-ai/flux/schnell";
const prompt =
  "Photorealistic portrait of a friendly young Indian store associate, a man in his late twenties, wearing a plain red " +
  'polo staff shirt with "Reliance Digital" printed in white on the chest. Facing the camera straight on, head and ' +
  "shoulders, mouth closed, neutral relaxed smile, eyes to camera, soft even light, softly blurred electronics store " +
  "behind him. Vertical portrait framing, nothing covering the face.";
const response = await fetch(`https://fal.run/${model}`, {
  method: "POST",
  headers: { authorization: `Key ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ prompt, num_images: 1, image_size: "portrait_4_3" }),
});
const body = (await response.json()) as { images?: { url?: string }[]; detail?: unknown };
const url = body.images?.[0]?.url;
if (!response.ok || !url) throw Error(`fal answered ${response.status}: ${JSON.stringify(body.detail ?? body)}`);
console.log(url);
