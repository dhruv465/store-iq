/** Makes the one presenter the video brief films every day, so the floor sees the same face each
 *  morning. Run once; put the URL it prints into PRESENTER_IMAGE_URL.
 *
 *    node --env-file=.env --import tsx scripts/presenter.ts
 *
 *  nano-banana-pro (Google) draws him: on 4 Nov 2026 it gave the most professional look and put the
 *  logo on the correct side of the chest, where flux-pro ultra put it on the wrong side and
 *  flux/schnell looked cheap. Gemini Omni Flash then films him from this photo each day. About $0.15. */
const key = process.env.FAL_KEY?.trim();
if (!key) throw Error("Set FAL_KEY in .env");

const response = await fetch("https://fal.run/fal-ai/nano-banana-pro", {
  method: "POST",
  headers: { authorization: `Key ${key}`, "content-type": "application/json" },
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
});
const body = await response.json();
if (!response.ok) throw Error(`fal answered ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
const image = body.images?.[0]?.url;
if (!image) throw Error("nano-banana-pro gave no image");
console.log(image);
