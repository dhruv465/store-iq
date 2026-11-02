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
   what the catalogue returned for this turn, be derivable from it, or have been said by the
   associate. A figure carrying a unit is checked as a **pair** — `2 year` passes, `1 year` does
   not, however many 1s the data holds — in English, Hindi and Marathi.
   **The model writes the reply from the catalogue's rows, and the code checks every figure in it.**
   The turn is: what was said becomes a search, the store's rows become FACTS, the model writes.
   Decided by the user 2 Nov 2026, replacing the 2026-10-30 decision that the product sheet, finance
   and the options were composed in code: those were written over a stub of televisions and answered
   the wrong product. A refused figure gets one retry that names it, and what is refused twice does
   not go out. **Do not weaken the guard to get a reply through.** Still composed in code: the
   consent draft and itemised total (rule 3, arithmetic), the card read-back, the brief and the score.
2. **The offer gate.** No offer, discount, exchange, EMI or finance figure before the customer's
   needs are known *and* a difference demonstrated — **unless the associate asks outright**. A
   question in their own words opens it, and they get the real offer from the catalogue or "none is
   running on it today". Decided by the user 2 Nov 2026, after a walk where a customer who had already decided
   was sent back to the room three times instead of being told. The gate stops the product
   *leading* with price, which the store visits found in 6 of 6 conversations; it is not a refusal
   to answer. `askedAboutOffers()` in `brain.ts`. **Do not close it again.**
3. **Consent.** Nothing reaches a customer without an explicit tap. Changing the product withdraws it.
4. **No written questions.** The model asks. `questionFlow` and `nextQuestion` were deleted on
   2026-10-30 — six questions with buttons and eight more — because a written list can only ever be
   about a television, and it made the product a form with a chat window around it. The code tells
   the model only what it cannot see, in a note (`JUST NOW:`): a search that missed, a store that did
   not answer. What is worth asking this customer is the model's judgement, and a customer who has
   decided is served, not interviewed. **Do not add a question to the code.** What still answers
   without a model request is a tap or a whole-message command: the reset, consent, the card
   read-back, the brief, the score.
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
  (model in `FAL_MODEL`) and a **voice note through `fal-ai/elevenlabs/speech-to-text`** — uploaded to fal
  storage first, because it takes a URL and not base64 inline. Not Whisper: it dropped clear notes and misheard Hindi. The router has no
  response schema, so the JSON shape is asked for in words and read by `readJson()`.
  **Gemini is still the label photo**, and answers the turn when there is no `FAL_KEY`.
- The products come from the **live catalogue**, per turn, when `CATALOG_APPLICATION_ID` and
  `CATALOG_APPLICATION_TOKEN` are set: `searchFrom()` in `brain.ts` asks the model for one search
  and `searchPack()` in `pack.ts` runs it, in FDK `getProducts` parameters, with
  `getPromotionOffers` for the first five rows. That makes two model requests a turn. When the store
  does not answer it is logged, the model is told and the number stays up; no data is substituted.
  `data/pack.json` is a stub of televisions, used only with no credentials (dev and tests), and must
  never reach an associate as today's data. The host defaults to `api.jioretailer.com`. Reads only:
  `catalog.ts` can GET an allowlist of paths and nothing else, and the FDK is deliberately not
  installed because its handles carry write methods.
- Money is written `Rs 54,990`, never `₹`.
- Every user-facing string goes through `server/src/i18n.ts` in `en`, `hi` and `mr`.
- **Never read a secret.** Do not print, `cat`, `sed`, `grep` the value of, or interpolate anything
  from `.env`. Check presence only — `grep -c '^NAME=.\+' .env` — and edit the file with a script
  that echoes nothing. Ask the user to paste a new value rather than reading the old one. A key that
  reaches a transcript is a key that has to be rotated.
- Never commit `.env`, `web/dist`, `web/node_modules`, `data/runtime/`.
- The branch `fal-assets` is parked by instruction. Leave it.
