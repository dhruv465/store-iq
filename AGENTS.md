# Store IQ — agent instructions

A WhatsApp copilot for a **Reliance Digital store associate**, not for customers. The associate is
on the shop floor with a customer in front of them; every reply is a question for them to ask out
loud, prefixed `Ask:`, or a line for them to say. Never address the customer. Never greet.

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
   `data/pack.json`, be derivable from it, or have been said by the associate. The guard matches
   exact numeric tokens.
2. **The offer gate.** No offer, discount, exchange, EMI or finance figure before the home is
   assessed *and* a difference demonstrated.
3. **Consent.** Nothing reaches a customer without an explicit tap. Changing the product withdraws it.
4. **Deterministic first.** The Gemini free tier is 20 requests a day. If it can be answered from
   the pack, answer from the pack. All nine stages currently do, in 1–15 ms.
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
- Money is written `Rs 54,990`, never `₹`.
- Every user-facing string goes through `server/src/i18n.ts` in `en`, `hi` and `mr`.
- Never commit `.env`, `web/dist`, `web/node_modules`, `data/runtime/`.
- The branch `fal-assets` is parked by instruction. Leave it.
