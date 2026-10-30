# Developer brief compliance

Tracked against `reliance-digital-store-iq-developer-brief.pdf` (received 28 Oct 2026).
Status is what the code actually does, verified, not what it intends to do.

## 6. Functional requirements for the demo

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Receive and process associate voice notes | **Wired, untested.** Audio goes to Gemini inline, no transcription hop. No real voice note has been sent through it. |
| 2 | Create, display and correct a home card | **Done.** Read back in the brief's "I heard" shape with confirm and fix buttons; recommend, complete and close are held until confirmed. |
| 3 | Suggest the next question based on the current card | **Done.** The card is the input and the question is the manager's. The code files every fact it can read from the words, then tells the model what it just saved and what is still blank; the question comes back in the brief's `Ask:` shape. Two written lists of questions were deleted on 30 October because a written list can only ever be about a television — a washing machine was being asked its viewing distance. |
| 4 | Accept a product-label image, return a customer-friendly explanation | **Wired, untested.** Image goes inline; `labels[]` in the pack supplies the phrasing. |
| 5 | Three recommendations, one reason **and one demonstration cue** each | **Done, deterministic.** `recommend.ts` ranks the pack against the card in code, so no request is spent and the reasons cannot be invented. Reasons are de-duplicated: three options never share one. Verified live at 1 ms. |
| 6 | Calculate and display an itemised total from supplied data | **Done.** `itemisedTotal()` computes it in code, not the model, so it cannot be wrong. Verified live: 54,990 + 1,499 + 499 = Rs 56,988. The close now also states the **net payable** after every offer the pack says applies to that product, and the saving off MRP — "Rs 35,000 off MRP today: listed Rs 89,990, here Rs 54,990" — both behind the offer gate. |
| 7 | Gate offers until assessment and demonstration are complete | **Done.** `offerLeaked()` fires on an offer word plus a figure, and the deterministic close is held behind the same gate: with the home unknown, the MRP saving, the net payable and the accessory line are all absent, and asking for a discount is refused with the reason and no figure. Tested both ways. |
| 8 | Explain finance using only supplied terms and full cost | **Done, deterministic.** `financeOptions()` computes each term from the pack: a no-cost term is exact (instalments plus the processing fee), an interest-bearing one uses the standard reducing-balance instalment and is given as "about", because the bank sets the exact figure. The reason line names the worst full cost, not the friendliest: Rs 71,039 against Rs 62,990 today. Behind the same gate as every other money answer. |
| 9 | Consent-based summary and follow-up task | **Done, deterministic.** Selection comes from a tap only, the summary is withheld until `consent:yes`, and changing the product withdraws consent. The draft now proposes **one accessory the card justifies** — the HDMI 2.1 cable for a PS5 home, a soundbar for a larger hall, a stabiliser when the site notes say the supply is unstable — taken by tap, and never offered twice. Task owner is the associate; the site is asked about before an installer is booked and the last task is confirming it works. |
| 10 | Conversation score and one improvement suggestion | **Done.** The store visits' own card: seven steps, 0 to 2 each, Guide at 11. Deterministic, costs no model request. |

## Beyond the ten: the conversation that loses the sale

| Item | State |
| --- | --- |
| The three objections the store visits heard | **Done, deterministic.** The pack carries a confirm/correct pair and a matching line for "it is too costly", "I can buy the same set online" and "I will think about it", in English, Hinglish and Devanagari. Answered in the same confirm-then-correct shape as a spec myth, and recorded against the conversation so the manager can see which objection the floor meets most. A spec myth wins when both could match, because the customer is asking about the product rather than leaving. An objection the pack does not know is not answered at all. |
| An option over the budget | **Done.** It stays on the card with the gap stated in the open rather than being quietly dropped, so the associate chooses whether to show it. |

## Section 8 acceptance sequence

| Stage | Built | Needs a model |
| --- | --- | --- |
| assess | yes | only for free-form voice or text; by tap it is deterministic |
| validate | yes | only for a claim the pack does not list |
| translate | yes | **yes** — reading the label photo |
| recommend + demonstrate | yes | no |
| complete | yes | no |
| close | yes | no |
| follow through | yes | no |
| review | yes | no |

## Asking, rather than being asked

| Behaviour | State |
| --- | --- |
| An associate can ask what the shop has | **Done.** "What TVs do we have in stock" is answered with what is on the floor — brand, size and panel — and deliberately without prices, because our associates opened with price in 6 of 6 visits and a price list here would teach the habit the product exists to break. Once the home is known the same question offers the three that fit. |
| An associate can ask about one set | **Done.** "Is the Sony good for a dark room" answers from the pack about that set. It used to be filed as `light = dim`, a fact about the customer's living room. |
| Saying hello | **Done.** Answered, with what the associate can do next. It used to open the distance question, which is a questionnaire talking to itself. |
| A question is told from a description | **Done.** `intentOf()` separates them, and a question that is mostly about the customer — "do they have WiFi at home?" — is still read as a description. |

## Floor rules (contest §2)

| Rule | State |
| --- | --- |
| First reply in under 5 seconds | **Holds.** Deterministic turns answer in 1–15 ms; a model turn measured 1.9–3.1 s. Voice and photo get an acknowledgement immediately while the answer is prepared. |
| Not more than 3 lines and 3 buttons | **Holds, now enforced for every reply.** It used to be enforced only in `render()`, which handles model output — and eight of the nine stages stopped going through the model, so each deterministic reply was its own chance to break it. The shift brief ran to five lines and the close to four. `floor()` now gates every reply at the exit, dropping the reason before the words to say when something has to go. A test walks a whole conversation, in all three languages, and holds every turn to it. |
| A reason in each answer (judging, 25 with the steps) | **Holds.** Twelve of fourteen turns carry a `↳` line; the recommend step carries its reasons inside each of the three option lines, which is the one shape where a separate reason line would not fit. Each question now says why it is the one being asked — "the distance decides the size more than the room does". |
| Voice and photo first | **Wired, not exercised with real media.** The paths exist and a rendered shelf tag was read end to end in 2.9 s; no real voice note or phone photo has been through them. |

## 7. Guardrails

| Guardrail | Status |
| --- | --- |
| Test data and a test WhatsApp number only | Holds. `data/pack.json` is a stub; the number is the owner's test number. |
| Never message a real customer | Holds now. The 24-hour window means Store IQ only answers people who wrote to it. Broken once during wiring: a signed test webhook caused Meta to accept a reply to a number nobody owned. |
| Never invent a price, offer, stock, specification, finance term or discount | Holds. Exact-token number guard; 999 is not supported by 79990 containing it. Tested against an adversarial push to match a competitor quote. |
| Never infer wealth from appearance; the associate sets the starting level | Holds. `start_level` is only ever written from what the associate supplies. |
| Keep the associate in control of the recommendation | Holds. Every reply is a line to say or a question to ask, never an instruction to the customer. |
| Show uncertainty when data is missing | Holds. An unsupported figure becomes "that figure is not in today's data pack". |
| **Home card is interaction-scoped unless persistence is approved** | **Was violated.** The card was stored per phone indefinitely, so an associate's next customer inherited the previous customer's home. Fixed this round. |

## Open gaps, in the order they are worth doing

1. ~~Metres, and "Not sure" (§4B)~~ — **done.** The flow asks in metres with a "Not sure" button, and either unit satisfies the assessment.
2. **Card fields from §3** — the fields exist on the card now; the prompt does not yet actively ask for the replacement reason or site constraints.
3. **Verify everything model-dependent** — the `Ask:` framing, the demonstration cue and the itemised total's one-sentence finance all need live model turns, which need quota.

## What still needs a model

Two things: turning a free-form voice note or sentence into card fields, and reading a label photo.
Validate answers known claims from the pack's confirm/correct pairs, including the brief's own
electricity example, in 7 ms; a claim the pack has nothing on still goes to the model. Assess by tap, validate, recommend, complete, close, follow-through, brief and review
are all deterministic — they answer in single-digit milliseconds, spend no quota, and cannot invent a
figure. That is most of the §8 acceptance sequence running without the model at all.

## Extra points (contest §2)

| Item | State |
| --- | --- |
| Hindi and one more Indian language | **Done, two Indian languages: Hindi and Marathi, plus English.** Every deterministic reply. Hindi and Marathi, including the questions, the buttons, the card read-back, the recommendation reasons and the demonstration cues. Devanagari input fills the card too. Figures, product names and prices are never translated. |
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
