# Store IQ — design note

One WhatsApp number. The associate owns the conversation; Store IQ holds the facts.

## The idea

The store visits found our median associate scores 6 of 14 while our best scored 13, that we spoke
about price first in 6 of 6 conversations while at the competitors the customer asked first, and
that a median of 2 questions came before the first product. The problem is not knowledge, it is
**order**. Store IQ enforces the order our best associate already follows and refuses to skip ahead.
It scores itself on the visits' own card — Validate, Assess, Translate, Demonstrate, Complete,
Close, Follow through, 0 to 2 each — so a conversation here and one in that workbook are the same
number.

## Three rules, enforced in code rather than asked of a model

1. **No invented figures.** Every amount, percentage and specification must exist in the data pack,
   be derivable from it, or have been said by the associate. Matching is on exact values, so `999`
   is not excused by `79990` containing it. Anything else becomes "that figure is not in today's
   data pack".
2. **The offer stays shut** until the home is assessed *and* a difference demonstrated. The gate
   fires on an offer word beside a figure, so declining to discuss offers is not a leak.
3. **Nothing is sent without consent.** The summary waits for a tap, and changing the product
   withdraws consent again.

## The model talks; the code owns every figure

The manager answers in its own words and asks whatever this customer makes worth asking. There is
no written list of questions: one existed, six in order with their buttons, and a written list can
only ever be about a television.

Everything that states a number is composed in code, in **1–15 ms**: the product sheet, a claim or
objection matched to the pack's own confirm/correct pair, three options ranked by scored rules over
distance, light, console, sport and sound, the itemised total, the net payable after offers, the
saving off MRP, the finance terms, the brief and the score. A figure with a unit is checked as a
pair in all three languages, so `2 year` passes and `1 year` does not, however many 1s the pack
holds. That division is the design: the model is never the source of a figure, the code is never
the source of a question.

A model is needed for two things: a **voice note** phrased beyond the extractor, and the **text on
a label photo** — and there it only reads the tag, in one small call. The answer is then written
from the pack, so a misread model number cannot become an invented price.

## The close, in the pack's own figures

The visits found we open with price and then have nothing left to say. So the close says what an
associate usually improvises, each line a fact from the pack: the net payable with the saving off
MRP; one accessory the card justifies, taken by tap and never offered twice; the three objections
that lose the sale, answered in the same confirm-then-correct shape as a spec myth, in English,
Hinglish and Devanagari; and an option over the budget kept on the card with the gap stated. With
the home unknown, none of these lines exist.

## Built for the floor

At most three lines and three buttons, enforced in the renderer rather than asked of a prompt. Every
answer carries its reason. The associate is handed words to say — `Ask: "How far will you sit from
the TV?"` — never instructions about selling, and Store IQ never addresses the customer. Replies go
only to numbers that messaged first, inside Meta's 24-hour window. The home card is
interaction-scoped, so the next customer never inherits the last one's home. The associate sets the
starting level; nothing is inferred from appearance.

## Extra points

**Ask an expert** routes a question by subject and logs it against a named owner with a quotable
reference. **The department manager view** answers "team" with the visits' own table, computed live,
and a browser portal adds each associate's seven step marks, so the gap is a person and a step
rather than a median. Hindi and Marathi throughout, not only the greetings.

## Limits, honestly

Built against a stub pack; the real one is read through a single adapter, so its field names are a
few minutes' work and a restart, and `npm run pack:check` names every row it cannot serve first.
Ranking weights will need retuning on real data. A voice note and a label photo have not been
exercised with real media. Hosting is a laptop behind a reserved tunnel: no cold start, but the
laptop has to be up. No live inventory, payment, CRM or customer messaging, per the brief's
implementation boundary.
