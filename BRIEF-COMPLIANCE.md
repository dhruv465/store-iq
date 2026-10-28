# Developer brief compliance

Tracked against `reliance-digital-store-iq-developer-brief.pdf` (received 28 Oct 2026).
Status is what the code actually does, verified, not what it intends to do.

## 6. Functional requirements for the demo

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Receive and process associate voice notes | **Wired, untested.** Audio goes to Gemini inline, no transcription hop. No real voice note has been sent through it. |
| 2 | Create, display and correct a home card | **Done.** Read back in the brief's "I heard" shape with confirm and fix buttons; recommend, complete and close are held until confirmed. |
| 3 | Suggest the next question based on the current card | **Done, deterministic.** `QUESTION_FLOW` walks the floor order in the brief's `Ask:` shape with its own buttons. A tap no longer costs a model request: the whole assess walk runs in 0–11 ms. |
| 4 | Accept a product-label image, return a customer-friendly explanation | **Wired, untested.** Image goes inline; `labels[]` in the pack supplies the phrasing. |
| 5 | Three recommendations, one reason **and one demonstration cue** each | **Done, deterministic.** `recommend.ts` ranks the pack against the card in code, so no request is spent and the reasons cannot be invented. Reasons are de-duplicated: three options never share one. Verified live at 1 ms. |
| 6 | Calculate and display an itemised total from supplied data | **Done.** `itemisedTotal()` computes it in code, not the model, so it cannot be wrong. Accessories and delivery added. Verified live: 54,990 + 1,499 + 499 = Rs 56,988. |
| 7 | Gate offers until assessment and demonstration are complete | **Done.** `offerLeaked()`, fires on an offer word plus a figure. Tested. |
| 8 | Explain finance using only supplied terms and full cost | **Partial.** Terms are in the pack; the one-sentence full-cost form is unverified. |
| 9 | Consent-based summary and follow-up task | **Done, deterministic.** Selection comes from a tap only, the summary is withheld until `consent:yes`, and changing the product withdraws consent. Task owner is the associate; site needs come from the pack. Verified live at 1 ms. |
| 10 | Conversation score and one improvement suggestion | **Done.** Deterministic, 0–14, costs no model request. |

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
| Hindi and one more Indian language | **Done for every deterministic reply.** Hindi and Marathi, including the questions, the buttons, the card read-back, the recommendation reasons and the demonstration cues. Devanagari input fills the card too. Figures, product names and prices are never translated. |
| Department manager view | **Done.** "team" returns today's volume, median score, how often the home was assessed, the most skipped step and open expert questions. |
| Ask an expert | **Done.** Routed by subject to a named owner with a quotable reference and a line to hold the customer. |
| Store visit log by voice note | **Not built** — needs voice, which needs a model. |

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
