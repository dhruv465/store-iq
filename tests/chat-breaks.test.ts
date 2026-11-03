import { test } from "node:test";
import assert from "node:assert/strict";
import {
  askedAboutOffers,
  moneySafe,
  numbersIn,
  offerLeaked,
  unsupportedNumbers,
  wrongScript,
  pretty,
} from "../server/src/brain.js";
import { falTranscribe } from "../server/src/fal.js";
import { askedToSwitchLanguage, languageFrom, t } from "../server/src/i18n.js";

// Each of these broke in one real test chat on the number, 2 Nov 2026.

test("the language is the one just spoken, not the one used last", () => {
  assert.equal(languageFrom("Are there any offers running on this TV?", "hi"), "en");
  assert.equal(languageFrom("for the laptop option under 30 to 40 thousand", "hi"), "en");
  assert.equal(languageFrom("Are there any offers running on this TV?", "mr"), "en");
  assert.equal(languageFrom("customer ko 40 hazar ke neeche laptop chahiye", "hi"), "hi", "Hinglish is still Hindi");
  assert.equal(languageFrom("mala TV pahije kiti aahe", "mr"), "mr", "and Marathi in Latin is still Marathi");
  assert.equal(languageFrom("LG Nanocell", "hi"), "hi", "a product name alone says nothing about the language");
  assert.equal(languageFrom("Laptop में कोई और option है", "en"), "hi");
  assert.equal(languageFrom("ٹی وی کے بارے میں بتاؤ", "en"), "hi", "speech models write Hindi in Urdu script");
});

test("the script of a reply is checked against the message it answers", () => {
  assert.ok(wrongScript("इस पर 15% छूट है", "Are there any offers?", "en"));
  assert.ok(!wrongScript("It is 15% off", "Are there any offers?", "en"));
  assert.ok(wrongScript("It is 15% off", "कोई ऑफर है?", "hi"));
  assert.ok(!wrongScript("LG पर 15% OFF है", "कोई ऑफर है?", "hi"), "a brand in Latin inside Hindi is Hindi");
  assert.ok(wrongScript("इस पर छूट है", "offer hai kya", "hi"), "Latin in, Latin out");
  assert.ok(!wrongScript("Haan, 15% off hai", "offer hai kya", "hi"));
  assert.ok(wrongScript("It is 15% off", undefined, "hi"), "a tap keeps the language that was on");
});

test("asking for a language works in that language's own script", () => {
  assert.equal(askedToSwitchLanguage("इंग्लिश में बताओ"), "en");
  assert.equal(askedToSwitchLanguage("अंग्रेज़ी में बताइए"), "en");
  assert.equal(askedToSwitchLanguage("हिंदी में बोलो"), "hi");
  assert.equal(askedToSwitchLanguage("मराठीत सांगा"), "mr");
  assert.equal(languageFrom("इंग्लिश में बताओ", "hi"), "en");
  assert.equal(askedToSwitchLanguage("english"), "en");
  assert.equal(askedToSwitchLanguage("englishman"), null);
});

test("what the code says while working, and when it fails, is in the associate's language", () => {
  assert.doesNotMatch(t("en", "lang.switched"), /theek/i);
  assert.doesNotMatch(t("en", "ack.audio"), /raha/);
  assert.match(t("hi", "ack.audio"), /सुन/);
  assert.match(t("mr", "voice.unheard"), /[ऀ-ॿ]/);
  assert.match(t("hi", "turn.failed"), /↳/);
});

test("a budget said in thousands is the figure it means", () => {
  for (const said of [
    "under 30 to 40 thousand",
    "30-40 हजार के नीचे",
    "30-40 हज़ार",
    "30 se 40 hazar",
    "30 to 40k",
    "under 30 to 40,000",
    "30-40,000 ke neeche",
  ]) {
    const heard = numbersIn(said);
    assert.ok(heard.has(30000) && heard.has(40000), said);
    assert.deepEqual(unsupportedNumbers("Under Rs 40,000 or Rs 30,000.", new Set(), said), [], said);
  }
  assert.ok(numbersIn("1.5 lakh tak").has(150000));
  assert.ok(numbersIn("2 लाख").has(200000));
  assert.deepEqual(numbersIn("the 40 kg one").has(40000), false, "a unit that starts with k is not thousands");
  assert.deepEqual(unsupportedNumbers("Rs 50,000", new Set(), "under 40 thousand"), ["50000"], "the guard still holds");
});

test("money is grouped the Indian way whatever the model wrote", () => {
  assert.equal(moneySafe("Surface Rs 215,990 hai"), "Surface Rs 2,15,990 hai");
  assert.equal(moneySafe("Rs 118,999."), "Rs 1,18,999.");
  assert.equal(moneySafe("saves Rs 3899, and more"), "saves Rs 3,899, and more");
  assert.equal(moneySafe("Rs 54,990 or Rs 26,315.46"), "Rs 54,990 or Rs 26,315.46");
});

test("the comma after a price is not part of the bold", () => {
  assert.equal(pretty({ text: "Acer at Rs 36,990, with 8 GB RAM" }).text, "Acer at *Rs 36,990*, with 8 GB RAM");
});

test("an offer question in Hindi is an offer question, and the gate holds in Hindi", () => {
  assert.ok(askedAboutOffers("इस टीवी पर कोई ऑफर है?"));
  assert.ok(askedAboutOffers("कोई ऑफ़र चल रहा है क्या"));
  assert.ok(askedAboutOffers("कितनी छूट मिलेगी"));
  assert.ok(!askedAboutOffers("इसमें कितने HDMI हैं"));
  assert.ok(offerLeaked("इस पर 15% की छूट है", false, false), "volunteered, it is a leak");
  assert.ok(!offerLeaked("यह Rs 38,990 का है, इस पर आज कोई ऑफर नहीं है।", false, false), "a denial is not one");
});

test("a voice note goes to the speech model that hears Hindi, and silence says so", async () => {
  const urls: string[] = [];
  const speech = (text: string) =>
    (async (url: string | URL) => {
      urls.push(String(url));
      return Response.json(
        String(url).includes("upload/initiate")
          ? { upload_url: "https://v3b.fal.media/x", file_url: "https://v3b.fal.media/x" }
          : { text },
      );
    }) as unknown as typeof fetch;
  const config = { key: "k", model: "m" };
  const audio = { bytes: new Uint8Array([1]), mimeType: "audio/ogg" };
  assert.equal(await falTranscribe(config, audio, speech(" under eighty thousand ")), "under eighty thousand");
  assert.ok(urls.includes("https://fal.run/fal-ai/elevenlabs/speech-to-text"));
  await assert.rejects(falTranscribe(config, audio, speech("  ")), /Nothing heard/);
});

test("typed Marathi is Marathi, and typed Hindi is Hindi, though the script is the same", () => {
  assert.equal(languageFrom("ग्राहकाला हॉलसाठी 55 इंच टीव्ही हवा आहे, बजेट 60 हजार", "en"), "mr");
  assert.equal(languageFrom("यावर काही ऑफर आहे का?", "hi"), "mr");
  assert.equal(languageFrom("ग्राहक को 55 इंच का टीवी चाहिए", "mr"), "hi");
  assert.equal(languageFrom("इसमें क्या है?", "en"), "hi");
  assert.equal(languageFrom("टीव्ही", "mr"), "mr", "a word that says nothing keeps what was on");
  assert.equal(languageFrom("टीवी", "en"), "hi");
});
