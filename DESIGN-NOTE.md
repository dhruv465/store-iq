# Store IQ — design note

One WhatsApp number for the Reliance Digital associate. The associate owns the conversation; Store IQ
holds the facts, from the live Reliance Digital catalogue, and checks every figure it says.

## The idea

The store visits found a median of 6 of 14 against our best 13, price spoken first in 6 of 6
conversations, and two questions before the first product. The problem is **order**, not knowledge.
Store IQ is the floor manager the associate messages by voice, photo or text, and it keeps them in our
best associate's order without turning the product into a form.

## The turn

What the associate said (a voice note is transcribed first) becomes one search of the live catalogue.
The store's rows, with today's promotions, are the only facts the model sees; the model writes the
reply. Products already on screen stay in those facts, so "any offers on these" means those three TVs.
A shelf-tag photo is read for its printed text and treated as if the associate had said it, so a
misread tag can never become a price.

## Enforced in code, not asked of a model

1. **No invented figures.** Every amount, percentage and spec must be in this turn's rows, derivable
   from them, or said by the associate. Figures with units are checked as pairs in English, Hindi and
   Marathi: `2 year` passes, `1 year` does not. One retry; refused twice, it does not go out.
   Installation, delivery or a mount is never "free" or "included" unless the data says so.
2. **The offer gate.** No offer, exchange or EMI before needs are known and a difference shown. Asked
   outright, the associate gets the real offer, or "none is running on it today".
3. **Consent is a tap.** Nothing reaches a customer without "They agreed". A new product or a new
   customer withdraws it.
4. **A reason is the customer's need.** The model names the need it serves; the code prints the
   customer's own words first ("cricket: a fast-moving ball is the thing to show"). A reason it cannot
   tie to the customer is not shown.

## Section 2, step by step

| Step                    | How                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Before the shift        | `brief`: televisions in stock, prices and today's offers, live                            |
| Assess                  | Voice note → needs filed on a card; the model asks only what would change what is shown   |
| Validate                | Confirms the true part, then corrects; the doubt is logged for the manager                |
| Translate               | Shelf-tag photo → printed specs → a line for this home                                    |
| Recommend + demonstrate | Three options from the store, a reason each, and what to show                             |
| Complete                | Tap a product: itemised total in code, plus the brand's real wall mount at its real price |
| Close                   | Behind the gate: real bank offers and no-cost EMI where the store lists them              |
| Follow through          | Consent tap → summary, a task with an owner, a check-back                                 |
| Review                  | `review`: the visits' 0–14 card from what the session proves, and one thing to try next   |

## Built for the floor

At most three lines and three buttons on every reply. Words to say, `Ask:` for a question to the
customer. Replies in the language just used: English, Hindi or Marathi, typed or spoken. Text turns
take 3–5 s, and a request that hangs is re-asked at 4.5 s; voice and photo are acknowledged at once
and answered in 7–8 s. Replies go only to numbers that wrote first, inside Meta's 24-hour window. Each
customer starts a fresh card.

## Extra points

**Hindi and Marathi** throughout. **Ask an expert**: "Find out for me" logs the question to a named
owner with a reference and a line to say. **Manager view**: `manager` on WhatsApp and a `/manager`
portal with each associate's step marks. **Store visit log**: `visit`, then speak.

## Limits, honestly

The catalogue has no installation charges (one TV row at Rs 0, none for ACs), no training video or
quiz, and no installer site needs; Store IQ says so rather than inventing them. Reads only: the
catalogue client can call an allowlist of GET paths. One key (fal.ai) runs the turn, the voice note and
the photo. Hosting is a laptop behind a reserved tunnel.
