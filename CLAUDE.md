# Store IQ — instructions for Claude

A WhatsApp copilot for a **Reliance Digital store associate**, not for customers. Think of it as
the **floor manager** the associate messages with whatever they do not know — a customer standing in
front of them, a product, an offer, what arrived today, a shift, a bad morning. Answer whichever it
is. A question for the customer is prefixed `Ask:`. Everything you say is to the associate; the
customer never talks to you.

## SecBrain memory

Project memory lives at `/Users/dhruvsmac/Desktop/SecBrain/projects/store-iq/`. Start meaningful
work by reading, in order:

1. `index.md` — the current checkpoint
2. `status/recent-changes.md` — what moved recently
3. `outputs/2026-10-29-agent-handoff.md` — conventions, what is next, what not to touch
4. `sources/2026-10-29-store-iq-build.md` — the full record, including the mistakes

Use the code, tests and git to verify the vault, not to replace it.

**Vault First, Vault Ask.** Never write to the vault unless the user asks in the current turn. When
they do, update the matching project folder: the source note, `index.md`, `log.md`,
`status/recent-changes.md`, and the backlinks. Never store secrets, tokens or customer data there.

## The rules this codebase is built on

1. **No invented figures.** Every amount, percentage and specification in a reply must exist in
   `data/pack.json`, be derivable from it, or have been said by the associate. A figure carrying a
   unit is checked as a **pair** — `2 year` passes, `1 year` does not, however many 1s the pack
   holds — in English, Hindi and Marathi.
   **Because of this, the replies that state a figure are composed in code, and stay that way.**
   The product sheet, the itemised cost, finance, the card read-back, the brief and the score are
   written phrases with the pack's numbers in them. Do not hand them to the model to phrase: that
   is where "the warranty is one year" and "today's target is 12 TVs" came from. Decided
   2026-10-30, by the user, after both were proposed.
2. **The offer gate.** No offer, discount, exchange, EMI or finance figure before the home is
   assessed *and* a difference demonstrated.
3. **Consent.** Nothing reaches a customer without an explicit tap. Changing the product withdraws it.
4. **No written questions.** The model asks. `questionFlow` and `nextQuestion` were deleted on
   2026-10-30 — six questions with buttons and eight more — because a written list can only ever be
   about a television, and it made the product a form with a chat window around it. The code files
   what it reads and tells the model in a note (`JUST NOW:`, `STILL BLANK ON THE CARD:`); what is
   worth asking this customer is the model's judgement. **Do not add a question to the code.**
   What still answers without a model request is anything that is a fact rather than a judgement: a
   product sheet, a label figure, an objection matched from the pack, the card read-back, the brief,
   the itemised cost, the score.
5. **The 24-hour window.** Replies go only to numbers that wrote to us inside Meta's window. Never
   remove `withinWindow()`.

## Working here

```bash
npm run check        # typecheck + tests — before every commit
npm run dev          # server on :3000
npm run tunnel       # reserved ngrok domain; the number is dead without it
npm run build:web    # the manager portal
npm run format       # Prettier at 120 columns, pinned in .prettierrc
```

- Test on localhost with `POST /try`. It never queues a WhatsApp message. Do not message real
  numbers while testing.
- With `FAL_KEY` set (`server/src/fal.ts`): the turn goes through **fal.ai's OpenRouter router**
  (model in `FAL_MODEL`) and a **voice note through `fal-ai/whisper`** — uploaded to fal storage
  first, because Whisper answers "Unsupported data URL" to base64 inline. The router has no
  response schema, so the JSON shape is asked for in words and read by `readJson()`.
  **Gemini is still the label photo**, and answers the turn when there is no `FAL_KEY`.
- The pack comes from the **live catalogue** when `CATALOG_APPLICATION_ID` and
  `CATALOG_APPLICATION_TOKEN` are set (`startingPack()` in `pack.ts`), and from `data/pack.json`
  otherwise — or when the live call fails, loudly, so a bad key cannot kill the number. The host
  defaults to Fynd's, because Jio Commerce is on Fynd's platform and the application pair selects
  the Reliance Digital sales channel.
- Money is written `Rs 54,990`, never `₹`.
- Every user-facing string goes through `server/src/i18n.ts` in `en`, `hi` and `mr`.
- Never commit `.env`, `web/dist`, `web/node_modules`, `data/runtime/`.
- The branch `fal-assets` is parked by instruction. Leave it.
