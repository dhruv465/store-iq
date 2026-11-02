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
  assert.match(reviewReply(session).text, /ही बातचीत: 14 पैकी 3/);
  assert.match(reviewReply(session).text, /गाइड 11 पासून सुरू होतो/);
});

test("a missing phrase falls back to English rather than breaking", () => {
  assert.equal(t("mr", "a.key.that.does.not.exist"), "a.key.that.does.not.exist");
  assert.match(t("hi", "guard.figure"), /[\u0900-\u097F]/);
});

test("figures and product names are never translated", () => {
  assert.match(t("hi", "ft.read", { name: "TCL 55 inch C6K", total: "56,988" }), /TCL 55 inch C6K/);
  assert.match(t("mr", "ft.read", { name: "TCL 55 inch C6K", total: "56,988" }), /Rs 56,988/);
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

test("the review's advice is spoken in the associate's language too", () => {
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
