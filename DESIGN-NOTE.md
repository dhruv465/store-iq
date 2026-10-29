# Store IQ — design note

One WhatsApp number. The associate owns the conversation; Store IQ holds the facts.

## The idea the build rests on

The store visits of 10 and 11 October found that our median associate scores 6 of 14 while our best
scored 13 and 12, that we open with price in 6 of 6 conversations against the customer asking first
at the competitors, and that a median of 2 questions come before the first product. So the problem
is not knowledge, it is **order**. Store IQ enforces the order our best associate already follows,
and refuses to skip ahead. It scores itself on the visits' own card — Validate, Assess, Translate,
Demonstrate, Complete, Close, Follow through, 0 to 2 each — so a conversation here and a conversation
on that workbook are the same number.

Three rules are enforced in code, not asked of a model:

1. **No invented figures.** Every money amount, percentage and specification in a reply must exist
   in the data pack, be derivable from it, or have been said by the associate. Matching is on exact
   values, so `999` is not excused by `79990` containing it. Anything else becomes "that figure is
   not in today's data pack".
2. **The offer stays shut** until the home is assessed *and* a difference has been demonstrated.
   The gate fires on an offer word next to a figure, so declining to discuss offers is not a leak.
3. **Nothing is sent without consent.** The customer summary waits for an explicit tap, and changing
   the selected product withdraws consent again.

## What does not need a model

All nine stages answer from the pack and the session, in **1–15 ms**, spending nothing:

| Stage | How |
| --- | --- |
| Before the shift | Read from the pack |
| Assess | Card read from plain words, or filled by tap, with the next question from a fixed floor order |
| Validate | The pack carries the confirm/correct pair for each known claim |
| Translate | The pack carries the sentence for each label spec; the figure is read off the words |
| One set named | Matched by SKU, by the model code on the tag, or by brand and size, then read out of the pack |
| Recommend + demonstrate | Scored rules over the pack: distance, light, console, sport, sound, budget |
| Complete | The itemised total is arithmetic, so it is computed rather than generated |
| Close / follow through | Consent gate, the site asked about before the installer is booked, task owner, the check that it works |
| Review | The store visits' own scorecard: seven steps, 0 to 2 each, Guide at 11 |

A model is needed for exactly two things: reading a **voice note** in phrasing the extractor cannot,
and reading the **text off a label photo** — and even there it only reads the tag, in one small call;
the answer is then written from the pack, so a misread model number cannot become an invented price.
A photo whose caption names the set needs no model at all. That keeps the quota small, the latency
low, and the invented-figure surface near zero.

## Built for the floor

At most three lines and three buttons, enforced in the renderer, not requested in a prompt. Every
answer carries its reason. The associate is handed words to say — `Ask: "How far will you sit from
the TV?"` — never instructions about selling, and Store IQ never addresses the customer. Voice notes
and photos get an acknowledgement inside the five-second rule while the real answer is prepared.

## Safety

Replies go only to numbers that messaged first, inside Meta's 24-hour window. Test data and a test
number throughout. The home card is interaction-scoped, so the next customer never inherits the last
one's home. The associate sets the starting level; nothing is inferred from appearance.

## Extra points

**Ask an expert** routes a question by subject, logs it against a named owner with a reference the
associate can quote, and returns a line to hold the customer with. **The department manager view**
answers "team" with today's volume, median score, how often the home was actually assessed, the step
the floor skips most, and open questions — delivered on the same number, because a manager on the
floor carries the same phone as everyone else.

## Limits, honestly

Built against a stub data pack; the real pack will need the ranking weights retuned, and its
`good_for` / `weak_for` words are English, so those two words stay English in a Hindi reply. A voice
note still needs the model, and has not been exercised end to end; a photo is answered from the pack
once its tag or caption names the set, and asks for the model number when it cannot be read. Hosting is a laptop behind a reserved tunnel,
which has no cold start but does need the laptop up. No live inventory, payment, CRM or real customer
messaging — per the brief's implementation boundary.
