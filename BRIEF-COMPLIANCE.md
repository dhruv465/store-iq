# Developer brief compliance

Tracked against `reliance-digital-store-iq-developer-brief.pdf` (received 28 Oct 2026).
Status is what the code actually does, verified, not what it intends to do.

## 6. Functional requirements for the demo

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Receive and process associate voice notes | **Wired, untested.** Audio goes to Gemini inline, no transcription hop. No real voice note has been sent through it. |
| 2 | Create, display and correct a home card | **Partial.** Created and persisted; §3 also demands it be shown back for correction. Added this round. |
| 3 | Suggest the next question based on the current card | **Done.** `nextQuestion()` walks the floor order; the model also proposes one. |
| 4 | Accept a product-label image, return a customer-friendly explanation | **Wired, untested.** Image goes inline; `labels[]` in the pack supplies the phrasing. |
| 5 | Three recommendations, one reason **and one demonstration cue** each | **Partial.** Three options with reasons verified live. The demonstration cue is missing — gap. |
| 6 | Calculate and display an itemised total from supplied data | **Partial.** Product + installation verified (Rs 56,489). Accessories and delivery are not in the pack — gap. |
| 7 | Gate offers until assessment and demonstration are complete | **Done.** `offerLeaked()`, fires on an offer word plus a figure. Tested. |
| 8 | Explain finance using only supplied terms and full cost | **Partial.** Terms are in the pack; the one-sentence full-cost form is unverified. |
| 9 | Consent-based summary and follow-up task | **Not built** — gap. Needs the close and follow-through steps. |
| 10 | Conversation score and one improvement suggestion | **Done.** Deterministic, 0–14, costs no model request. |

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

1. **Follow-through (§4H, §6.9)** — consent summary, task with an owner, installation job with site requirements. Needed for the §8 acceptance sequence.
2. **Demonstration cue (§6.5)** — each option needs the difference to show, e.g. "motion on the cricket clip". Needs a `demo_cue` per product in the pack.
3. **Itemised total (§6.6)** — add accessories and delivery charges to the pack so the total is complete.
4. **Metres, and "Not sure" (§4B)** — the brief's own example is `[2–3 m] [3–4 m] [Not sure]`. The card stores feet and offers no unknown.
5. **Energy facts** — the brief's example objection is "a larger screen always uses much more electricity", answered with "the actual energy information for these models". The pack has no power data, so that exact exchange cannot be answered from facts.
6. **Card fields from §3** — replacement reason / current product, site constraints, customer priorities, available space. Not in the card today.

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
