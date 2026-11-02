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

## The model talks; the code checks every figure

The associate says what they want in their own words. The model turns that into one search of the
live store, the store's rows are all the model is given, and the model writes the reply. There is no
written list of questions and no written product sheet: both were written about a television, and
both answered about one when the customer wanted an iPhone.

Every figure in a reply is then checked against what the store returned this turn. A figure with a
unit is checked as a pair in all three languages, so `2 year` passes and `1 year` does not, however
many 1s the data holds. A refused figure gets one retry that names it; what is refused twice does not
go out. That division is the design: the model writes, the store is the source, the code refuses.

What the code still composes, in **1–15 ms**, is what is a tap or arithmetic: the consent draft, the
itemised total, the card read-back, the brief and the score.

## The close, on real offers

The visits found we open with price and then have nothing left to say. Real offers come with each
row: the bank's no-cost EMI and its saving, the offer line, a free gift from the promotion. They stay
out of the reply until the associate asks or a difference has been shown. Nothing reaches a customer
without a tap.

## Built for the floor

At most three lines and three buttons, enforced in the renderer rather than asked of a prompt. The
associate is handed words to say — `Ask: "Which colour would you like?"` — never instructions about
selling, and Store IQ never addresses the customer. Replies go
only to numbers that messaged first, inside Meta's 24-hour window. What is noted about a
customer is interaction-scoped, so the next customer never inherits the last one's. The associate sets the
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
