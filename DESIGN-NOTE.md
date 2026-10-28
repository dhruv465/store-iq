# Store IQ — design note

One WhatsApp number. The associate owns the conversation; Store IQ holds the facts.

## The idea the build rests on

The store visits found that our median associate scores 6 of 14 while our best score 13, that we
open with price in 6 of 6 conversations, and that a median of 2 questions come before the first
product. So the problem is not knowledge, it is **order**. Store IQ enforces the order our best
associate already follows, and refuses to skip ahead.

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

Eight of the nine stages answer from the pack and the session, in **0–24 ms**, spending nothing:

| Stage | How |
| --- | --- |
| Before the shift | Read from the pack |
| Assess | Card read from plain words, or filled by tap, with the next question from a fixed floor order |
| Validate | The pack carries the confirm/correct pair for each known claim |
| Recommend + demonstrate | Scored rules over the pack: distance, light, console, sport, sound, budget |
| Complete | The itemised total is arithmetic, so it is computed rather than generated |
| Close / follow through | Consent gate, task owner, site needs from the pack |
| Review | Coverage of the nine stages, mapped to the judges' 0–14 |

A model is needed for exactly two things: reading a **voice note** in phrasing the extractor cannot,
and reading a **label photo**. It extracts facts; the code writes the reply. That keeps the quota
small, the latency low, and the invented-figure surface near zero.

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

Built against a stub data pack; the real pack will need the ranking weights retuned. Voice and photo
input are wired but have not been exercised end to end. Hosting is a laptop behind a reserved tunnel,
which has no cold start but does need the laptop up. No live inventory, payment, CRM or real customer
messaging — per the brief's implementation boundary.
