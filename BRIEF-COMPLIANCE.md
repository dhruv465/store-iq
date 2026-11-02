# Developer brief compliance

Tracked against `reliance-digital-store-iq-developer-brief.pdf` (received 28 Oct 2026).
Status is what the code actually does, verified, not what it intends to do.

## 6. Functional requirements for the demo

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Receive and process associate voice notes | **Done, on a real phone.** Transcribed by `fal-ai/whisper`, which returns the words and nothing else; the card is then read from them exactly as from typed words. Proven from a handset in English and in Hindi, and the one that came back refused — "तीन मीटर दूर बैठते हैं" answered in feet — was a guard fault, now fixed: three metres is ten feet. |
| 2 | Create, display and correct a home card | **Changed 2 Nov 2026, by the user: only where it helps.** What the customer says they need is noted, and read back with a correction button when the associate says `card`. It is no longer read back on its own: an automatic read-back replaced real answers ("does it have a heater" got a card). |
| 3 | Suggest the next question based on the current card | **Done, by the model.** Asked only if the answer changes what is shown, about the product in front of them. No question is written in code. |
| 4 | Accept a product-label image, return a customer-friendly explanation | **Works, not re-proven since 2 Nov.** Gemini reads the tag text; that text is treated as being told the same words, so the reply is written from the live catalogue. `labels[]` is no longer used. Photo is off without `GEMINI_API_KEY`. |
| 5 | Three recommendations, one reason **and one demonstration cue** each | **Model-written since 2 Nov, no longer deterministic.** `recommend.ts` ranked television rules and was deleted. Three options come from the live rows with one reason each. **The store has no demonstration cue, and the model is not given one, so a cue is not guaranteed.** |
| 6 | Calculate and display an itemised total from supplied data | **Done.** `itemisedTotal()` computes it in code, not the model, so it cannot be wrong. Verified live: 54,990 + 1,499 + 499 = Rs 56,988. The close now also states the **net payable** after every offer the pack says applies to that product, and the saving off MRP — "Rs 35,000 off MRP today: listed Rs 89,990, here Rs 54,990" — both behind the offer gate. |
| 7 | Gate offers until assessment and demonstration are complete | **Done, and opens when the associate asks outright.** `offerLeaked()` drops a line that volunteers one; the close is held behind the same gate. Tested both ways. |
| 8 | Explain finance using only supplied terms and full cost | **Model-written since 2 Nov, from the store's own terms.** A row's `pg_offer` gives months, the instalment, the total and the saving, all in FACTS and checked by the figure guard. `financeOptions()` computed from stub terms and was deleted. |
| 9 | Consent-based summary and follow-up task | **Done, deterministic.** Selection comes from a tap only, the summary is withheld until `consent:yes`, and changing the product withdraws consent. No accessory is proposed any more: the store does not say which go with what.
| 10 | Conversation score and one improvement suggestion | **Done.** The store visits' own card: seven steps, 0 to 2 each, Guide at 11. Deterministic, costs no model request. |

## Beyond the ten: the conversation that loses the sale

| Item | State |
| --- | --- |
| The three objections the store visits heard | **Model-written since 2 Nov.** The written confirm/correct pairs were television stubs and were deleted. The model answers, and reports the objection, which is recorded against the conversation for the manager. |
| An option over the budget | **Not guaranteed since 2 Nov.** A stated budget is now a price filter on the store, so what is over it is not returned. |

## Section 8 acceptance sequence

| Stage | Built | Needs a model |
| --- | --- | --- |
| assess | yes | yes |
| validate | yes | yes |
| translate | yes | **yes** — reading the label photo |
| recommend + demonstrate | yes | yes |
| complete | yes | no, once a product is tapped |
| close | yes | no, once a product is tapped |
| follow through | yes | no |
| review | yes | no |

## Asking, rather than being asked

| Behaviour | State |
| --- | --- |
| An associate can ask what the shop has | **Done.** Searched live and answered with names and prices from the store. |
| An associate can ask about one set | **Done.** Searched live; a question files nothing about the customer. |
| Saying hello | **Done.** Answered by asking what is going on, with what the associate can do next. |
| A question is told from a description | **Done, by the model.** `intentOf()` and its word lists were deleted. |

## Floor rules (contest §2)

| Rule | State |
| --- | --- |
| First reply in under 5 seconds | **Usually, not always.** Tapped and command turns answer in 1–25 ms. A model turn is two requests plus the store: 2–6 s measured on 2 Nov, and about 20 s when the provider times out once and is retried. Voice and photo get an acknowledgement immediately while the answer is prepared. |
| Not more than 3 lines and 3 buttons | **Holds, now enforced for every reply.** It used to be enforced only in `render()`, which handles model output — and eight of the nine stages stopped going through the model, so each deterministic reply was its own chance to break it. The shift brief ran to five lines and the close to four. `floor()` now gates every reply at the exit, dropping the reason before the words to say when something has to go. A test walks a whole conversation, in all three languages, and holds every turn to it. |
| A reason in each answer (judging, 25 with the steps) | **No longer holds, since 2 Nov.** Asked for one on every answer, the model explained itself ("The customer has decided and is asking about offers"), so model replies carry none. Code-composed replies and the "I do not know" reply still do. Decide whether judging needs it back. |
| Voice and photo first | **Wired, not exercised with real media.** The paths exist and a rendered shelf tag was read end to end in 2.9 s; no real voice note or phone photo has been through them. |

## 7. Guardrails

| Guardrail | Status |
| --- | --- |
| Test data and a test WhatsApp number only | Holds. `data/pack.json` is a stub; the number is the owner's test number. |
| Never message a real customer | Holds now. The 24-hour window means Store IQ only answers people who wrote to it. Broken once during wiring: a signed test webhook caused Meta to accept a reply to a number nobody owned. |
| Never invent a price, offer, stock, specification, finance term or discount | Holds. Exact-token number guard; 999 is not supported by 79990 containing it. Tested against an adversarial push to match a competitor quote. |
| Never infer wealth from appearance; the associate sets the starting level | Holds. `start_level` is only ever written from what the associate supplies. |
| Keep the associate in control of the recommendation | Holds. Every reply is a line to say or a question to ask, never an instruction to the customer. |
| Show uncertainty when data is missing | Holds. An unsupported figure is refused by name, and a search that finds nothing is told to the model as nothing and offered to a human. |
| **Home card is interaction-scoped unless persistence is approved** | **Was violated.** The card was stored per phone indefinitely, so an associate's next customer inherited the previous customer's home. Fixed this round. |

## Open gaps, in the order they are worth doing

1. ~~Metres, and "Not sure" (§4B)~~ — **done.** The flow asks in metres with a "Not sure" button, and either unit satisfies the assessment.
2. **Card fields from §3** — the fields exist on the card now; the prompt does not yet actively ask for the replacement reason or site constraints.
3. **Verify everything model-dependent** — the `Ask:` framing, the demonstration cue and the itemised total's one-sentence finance all need live model turns, which need quota.

## What still needs a model

Every turn about a product: one request for the search, one for the reply. Consent, the itemised
total, the card read-back, the brief, the review and the score are code, and answer in milliseconds.

## Extra points (contest §2)

| Item | State |
| --- | --- |
| Hindi and one more Indian language | **Done, two Indian languages: Hindi and Marathi, plus English.** Every deterministic reply. Hindi and Marathi, including the buttons and the card read-back; model replies follow the associate's language. Figures, product names and prices are never translated. |
| Department manager view | **Done, two ways, now with per-step coaching.** On the number, "team" returns the store visits' own table. In a browser, `/manager` is a React portal: the manager adds associates by name and number, then sees one row each — customers taken, home cards actually made, median and best of 14, conversations at Guide, how often the home came before the price, and when they were last seen. A rostered associate with no customers is marked quiet. Each row also carries that associate's seven step marks out of 2, so a manager sees where one person is weak rather than only their median, alongside a live floor stream, the objections the floor is meeting and which products are moving. The manager can also tell the whole floor today's offers, previewing exactly who it reaches first; anyone outside Meta's 24 hour window is held and told the moment they next write, so no approved template is needed and nobody is dropped. |
| Ask an expert | **Done.** Routed by subject to a named owner with a quotable reference and a line to hold the customer. |
| Store visit log by voice note | **Done.** Say `visit`, then speak or type it. The note is filed against the store its own words name, with a reference, the associate and the date, and the manager reads it in the portal. A visit is never read as a customer's home, though it is full of rooms, prices and brands — the log takes the next thing said before anything interprets it as a customer. Too short to be useful is refused rather than filed. |

## Hosting state, 28 Oct

Render cannot host this yet: every service in the workspace, `smartbazaar-demo` included, is `suspended`
with suspender `billing`, and `render blueprints validate` returns `billing_suspended`. `render.yaml` and
the `Dockerfile` are committed and ready for the moment that clears. The interim is a reserved ngrok
domain (`npm run tunnel`), which serves from the laptop with no cold start.

That suspension also explains the silence when the number was messaged: Meta was delivering to
`smartbazaar-demo`, which was itself suspended, so nothing was running at either end.

## Deviation worth flagging to the organisers

The brief says the first reply should land **within five seconds where possible**. Deterministic turns answer in
0–7 ms. Model turns measured 1.9–3.1 s on the stub pack, but the real data pack will be larger, and Render's
free tier sleeps after 15 idle minutes and takes about a minute to wake. The sleep, not the model, is the
real threat to that number.
