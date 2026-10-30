import { test } from "node:test";
import assert from "node:assert/strict";
import { PHRASES, askedToSwitchLanguage, languageFrom, t } from "../server/src/i18n.js";
import { cardSummary, reviewReply } from "../server/src/steps.js";
import { newSession, type Session } from "../server/src/types.js";

function filled(lang: Session["language"]): Session {
  const session = newSession("919820000001");
  session.language = lang;
  session.card = { room: "hall", distance_m: 3, light: "bright", content: ["cricket"] };
  return session;
}

test("Devanagari switches to Hindi, Latin keeps what was chosen", () => {
  assert.equal(languageFrom("ग्राहक को टीवी चाहिए", "en"), "hi");
  assert.equal(languageFrom("customer wants a TV", "en"), "en");
  assert.equal(languageFrom("customer ko TV chahiye", "hi"), "hi", "Hinglish stays Hindi once chosen");
  assert.equal(languageFrom("ग्राहकाला टीव्ही हवा", "mr"), "mr", "Marathi is not overwritten by its own script");
});

test("an explicit request switches language outright", () => {
  assert.equal(askedToSwitchLanguage("marathi mein bolo"), "mr");
  assert.equal(askedToSwitchLanguage("hindi please"), "hi");
  assert.equal(askedToSwitchLanguage("switch to english"), "en");
  assert.equal(askedToSwitchLanguage("recommend three options"), null);
});

test("every phrase the code still writes exists in all three languages", () => {
  // The six written questions and their buttons used to be the bulk of this. What is left is the
  // card read-back, the gates and the refusals — and a phrase missing from one language is a
  // sentence of English in the middle of a Hindi conversation.
  for (const key of Object.keys(PHRASES.en))
    for (const lang of ["hi", "mr"] as const)
      assert.ok(PHRASES[lang][key] !== undefined, `${key} is missing from ${lang}`);
});

test("the card read-back speaks the associate's language", () => {
  assert.match(cardSummary(filled("hi")).text, /मैंने समझा/);
  assert.match(cardSummary(filled("mr")).text, /मला समजलं/);
  assert.match(cardSummary(filled("en")).text, /I heard/);
});

test("the review score speaks the associate's language", () => {
  const session = filled("mr");
  session.steps_done = ["brief", "validate"];
  // A filled card is half the Assess step, so validate 2 plus assess 1 is 3.
  assert.match(reviewReply(session).text, /ही बातचीत: 14 पैकी 3/);
  assert.match(reviewReply(session).text, /गाइड 11 पासून सुरू होतो/);
});

test("a missing phrase falls back to English rather than breaking", () => {
  assert.equal(t("mr", "a.key.that.does.not.exist"), "a.key.that.does.not.exist");
  assert.equal(t("hi", "rec.show"), "दिखाइए");
});

test("figures and product names are never translated", () => {
  // Rs and the pack's own numbers must survive in every language.
  assert.match(t("hi", "ft.read", { name: "TCL 55 inch C6K", total: "56,988" }), /TCL 55 inch C6K/);
  assert.match(t("mr", "ft.read", { name: "TCL 55 inch C6K", total: "56,988" }), /Rs 56,988/);
});

test("a Hindi sentence fills the card without a model", async () => {
  const { extractCard } = await import("../server/src/extract.js");
  const card = extractCard("ग्राहक को हॉल के लिए टीवी चाहिए, तीन मीटर दूर बैठते हैं, चार लोग हैं, क्रिकेट देखते हैं");
  assert.equal(card.room, "hall");
  assert.equal(card.distance_m, 3);
  assert.equal(card.family, "4 people");
  assert.deepEqual(card.content, ["cricket"]);
});

test("a Marathi sentence fills the card too", async () => {
  const { extractCard } = await import("../server/src/extract.js");
  const card = extractCard("दिवाणखान्यात भिंतीवर लावायचा आहे, खूप ऊन येतं, चार माणसं आहेत");
  assert.equal(card.mount, "wall");
  assert.equal(card.light, "bright afternoon sun");
  assert.equal(card.family, "4 people");
});

test("Devanagari with nothing in it still yields nothing", async () => {
  const { extractCard } = await import("../server/src/extract.js");
  assert.deepEqual(extractCard("नमस्ते"), {});
});

test("card values are spoken in the associate's language, not just the frame", async () => {
  const { cardSummary } = await import("../server/src/steps.js");
  const card = {
    room: "hall",
    distance_m: 3,
    light: "bright afternoon sun",
    mount: "wall",
    content: ["cricket"],
    family: "4 people",
  };
  const hi = newSession("91982");
  hi.language = "hi";
  hi.card = card;
  const mr = newSession("91982");
  mr.language = "mr";
  mr.card = card;
  const hindi = cardSummary(hi).text;
  const marathi = cardSummary(mr).text;
  for (const english of ["hall", "sits", "wall mount", "people"])
    assert.doesNotMatch(hindi, new RegExp(english, "i"), `"${english}" leaked into the Hindi read-back`);
  assert.match(hindi, /हॉल; 3 मीटर दूर बैठते हैं; दोपहर में तेज़ धूप; दीवार पर लगाना है; क्रिकेट; घर में 4 लोग/);
  assert.match(marathi, /भिंतीवर लावायचा/, "Marathi takes the oblique form, not भिंत वर");
});

test("free-text card values pass through rather than being mistranslated", async () => {
  const { cardSummary } = await import("../server/src/steps.js");
  const session = newSession("91982");
  session.language = "hi";
  session.card = { room: "hall", distance_m: 3, replacing: "old plasma from 2011", content: ["cricket"] };
  assert.match(cardSummary(session).text, /old plasma from 2011/);
});

test("a demonstration cue is spoken in the associate's language when the pack has one", async () => {
  const { loadPack } = await import("../server/src/pack.js");
  const { cueFor, recommendReply } = await import("../server/src/recommend.js");
  const pack = await loadPack("data/pack.json");
  const tcl = pack.products.find((p) => p.sku === "TCL-55C6KS")!;
  assert.match(cueFor(tcl, "hi"), /क्रिकेट क्लिप/);
  assert.match(cueFor(tcl, "mr"), /चेंडू स्पष्ट/);
  assert.match(cueFor(tcl, "en"), /Cricket clip/);
  // A pack without a translated cue falls back rather than dropping it.
  const { demo_cue_hi: _dropped, ...withoutHindi } = tcl;
  assert.equal(cueFor(withoutHindi, "hi"), tcl.demo_cue);
  assert.doesNotMatch(
    recommendReply(pack, { distance_feet: 8, light: "bright", content: ["cricket"] }, "hi").text,
    /Show:/,
  );
});

test("the review's advice is spoken in the associate's language too", () => {
  // The seven step names are the contest scorecard's own words and stay as they are; the sentence
  // telling the associate what to do next is the part that has to be theirs.
  const english =
    /When the customer is half right|Ask about the home|Turn one spec|Point at one difference|Give the full cost|With consent/;
  assert.match(reviewReply(Object.assign(filled("en"), { steps_done: [] })).text, english);
  for (const lang of ["hi", "mr"] as const) {
    const session = filled(lang);
    session.steps_done = [];
    const text = reviewReply(session).text;
    assert.doesNotMatch(text, english, `the ${lang} review still gives its advice in English: ${text}`);
    assert.match(text, /[\u0900-\u097F]{4,}/);
  }
});
