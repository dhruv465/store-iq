# Store IQ

The AI partner of the Reliance Digital store associate, on one WhatsApp number.
Built for the Store IQ contest (28 Oct – 6 Nov 2026). Test data and a test WhatsApp number only.

The associate owns the conversation. Store IQ holds the facts.

## Run it

```bash
npm install
cp .env.example .env    # fill GEMINI_API_KEY to start; WhatsApp keys when the test number is ready
npm run dev
```

Iterate on the seven steps without WhatsApp (localhost only):

```bash
curl -s localhost:3000/try -H 'content-type: application/json' \
  -d '{"text":"Customer wants a TV for the hall, they sit about 8 feet away"}' | jq
```

`npm run check` runs the typecheck and the guard tests.

## Shape

| File | What it does |
| --- | --- |
| `server/src/webhook.ts` | Verifies Meta's HMAC over the original bytes, persists to the inbox, returns 200 |
| `server/src/worker.ts` | Leased inbox/outbox loops, instant acknowledgement for voice and photo, send-once |
| `server/src/brain.ts` | The turn: one model request for the search, one for the reply from what the store returned, then the guards |
| `server/src/pack.ts` | The live catalogue search, what the model is given, and every figure it is allowed to say |
| `server/src/db.ts` | PGlite: inbox, outbox, associate session with compare-and-set |

## What stops a reply reaching the wrong person

A contest build on a shared test number must not message a real person, so every outbound reply is
checked twice before it is sent:

1. **The 24 hour window** — Meta only permits a free-form reply within 24 hours of an inbound message
   from that number, so the inbox is asked before sending. This is the control that matters: Store IQ
   answers people who wrote to it and nobody else, and it needs no list to maintain. It is also what
   was missing when, during wiring, a signed test webhook caused Meta to accept a reply to a number
   nobody owned.
2. **`ALLOWED_PHONES`** — optional and **off by default**, so any associate can message the number and
   get an answer. Set it only to pin replies to named handsets, during a rehearsal say.

A refused reply is recorded as `skipped` with the reason, never silently dropped. `GET /health/recent`
(localhost only) shows what the provider actually accepted.

## Which model answers

`FAL_KEY` set: the turn goes through **fal.ai's OpenRouter router**, on the slug in `FAL_MODEL`
(default `google/gemini-2.5-flash`). A turn is about 3,200 tokens in and 50 out, which measured
**$0.0007 to $0.0015** on real turns — roughly a thousand turns to the dollar. `GET /health`
reports `spend_usd_since_start`, which is the only record there is: fal has no usage endpoint. `server/src/fal.ts` carries the table of
what the cheaper slugs did instead, including one that invented a brand warranty and two the
router refuses outright. The endpoint has no response schema, so the JSON shape is asked for in the system prompt and
read tolerantly; it takes no audio and no images.

A **voice note** goes to `fal-ai/elevenlabs/speech-to-text` on the same key, uploaded to fal storage
first because it takes a URL and not base64 inline. Whisper was dropped after it returned nothing for
a clear note and misheard Hindi on the same ten real notes. It returns the words and nothing else,
which is all the rest wants: the card is then read from those words exactly as from typed ones.
Proven on real audio in English and Hindi.

So **Gemini is now only the shelf-tag photo**, plus the turn when there is no `FAL_KEY` at all — on
a free tier of 20 requests a day, which is what answered an associate "I could not answer that just
now" twice on a real phone before this.

## What never reaches the model

Taps and whole-message commands: the reset, consent, the itemised total, the card read-back, the
brief and the review, answered in `steps.ts` before any request is spent. A sentence that merely
starts like one ("today's price of iPhone 17") is a question, and goes to the model.

Everything about a product is written by the model from what the store returned this turn, and every
figure in it is then checked against that. There are no written questions: the model asks.

The self-score uses the judges' scale: two marks per step of section 2, 14 in all. A step the model
*claims* does not score — `assess` needs four home facts on the card and `translate` needs the
demonstrated flag, or the mark is withheld.

## The guards are the product

Three rules are enforced in code, not asked of the model:

1. **No invented figures.** Every money amount, percentage and spec number in a reply must exist in what the catalogue returned this turn, be derivable from it (price + charge, price − offer, price ÷ months) or have been said by the associate. The model is told what it got wrong and gets one retry; a figure refused twice does not go out.
2. **The offer stays shut.** Offers, discounts, exchange and finance are not volunteered until four things are known about what the customer needs **and** a spec has been demonstrated, unless the associate asks outright, when they get the real answer. A line that leaks one is dropped and the rest of the reply stays.
3. **Floor shape.** At most three lines, at most three buttons. A button the model wrote says its own title when tapped, and is dropped rather than cut if it does not fit.

## Data pack

`data/pack.json` is a stub written to unblock the build: TV SKUs, offers, finance, charges, label
lines, myths and install requirements. It is only served with no catalogue credentials, for
development and tests. With credentials it is never read.

### Swapping in the real catalogue

The real catalogue will not use our field names, so nothing reads a catalogue field directly. One
file, `server/src/adapt.ts`, holds every name the loader looks for. Rupee signs, commas, units
inside the value (`"55 inch"`, `"144Hz"`, `"₹54,990.00"`) and spaced or capitalised headers
(`"Article Code"`, `"Selling Price"`) are already handled.

```bash
npm run pack:check -- /path/to/their-catalogue.json
```

It prints what loaded and every row it cannot serve, with the field to add and where to add it.
Work down the list until it says **Servable**, then:

```bash
PACK_PATH=/path/to/their-catalogue.json   # a file, or an https feed
PACK_TOKEN=...                            # only if the feed needs a bearer token
```

and restart. A field they name differently is one entry in `FIELDS` or `SPECS`.

### The live Jio Commerce catalogue

Put `CATALOG_APPLICATION_ID` and `CATALOG_APPLICATION_TOKEN` in `.env` and restart. Those two are
the whole credential: Jio Commerce runs on Fynd's platform, so the host is Fynd's and the
application pair selects the Reliance Digital sales channel — which is why the method reference
names no host. `CATALOG_HOST` overrides it if that ever stops being true. That is the whole switch.

Nothing is loaded at startup but a count, because a shop with 8,000 products cannot be held in a
prompt. Each turn, the model turns what was said into one search (`q`, `sort_on`, `page_no`, a price
ceiling and the kind of thing it is), `searchPack()` runs it through `getProducts` and
`getPromotionOffers` with the parameters the FDK documents, and the model writes the reply from the
rows. A row's own offers (`_custom_meta`: the bank offer, the offer line, pre-order) go with it. A
search that finds nothing is told to the model as nothing. If the store does not answer it is logged,
the model says it cannot check this second, and the number stays up. No file data is substituted.

To see what the store answers before the number serves it:

```bash
npm run pack:check -- live "iphone 18 pro"
```

It is a read and nothing else: `server/src/catalog.ts` can issue a GET to a short list of
`/service/application/` paths and has no write code in it at all.

## Logging a store visit

The visits of 10 and 11 October are why this product exists, and they were written up from memory
hours afterwards. Somebody standing in a competitor's shop cannot write, so they speak: say
`visit`, then send a voice note or type it. It is filed against the store its own words name —
"Croma CBD Belapur" out of a sentence that mentions it — with a reference, the associate's name and
the date, and the manager reads it in the portal. A visit is never read as a customer's home, even
though it is full of rooms and prices and brands.

## The manager portal

`web/` is a React app (Vite, Tailwind, shadcn/ui components) served by the same server at
`/manager`. The manager signs in with `ADMIN_PASSWORD` and sees one row per associate — customers
taken, home cards actually made, median and best out of 14, conversations at Guide, how often the
home came before the price, and when they were last seen — plus a box to tell the floor what is on.

```bash
npm run build:web     # build it; the server serves web/dist at /manager
npm run dev:web       # or run it on :5173 with the API proxied, for working on the portal
```

The portal is off unless `ADMIN_PASSWORD` is set, because it rides the same tunnel as the webhook
and it can message the whole floor. Its own files are public and hold no data; everything they ask
for needs the session cookie, which is `HttpOnly` and `SameSite=Strict`. Writes also need the
portal's own request header, which a page on another site cannot set.

## Hosting

Meta needs a public HTTPS callback URL. Two options, and the laptop one is currently the better demo:

**A stable ngrok domain (now).** The free tier includes one reserved domain, so the Meta callback URL is
pasted once and never changes:

```bash
# claim the domain at dashboard.ngrok.com -> Domains, put it in .env as NGROK_DOMAIN
npm run tunnel
```

This serves from the laptop, which means **no cold start** — the five-second rule in the brief is easier
to hold here than on a sleeping free dyno. The cost is that the laptop and its network have to be up.

**Render (when billing allows).** `render.yaml` and the `Dockerfile` are ready: free plan, Singapore,
in-memory Postgres (the home card is interaction-scoped, so nothing needs a disk, and there is no lock
file to go stale on restart). As of 28 Oct every service in the workspace, `smartbazaar-demo` included,
is `suspended` with suspender `billing`, so `render blueprints validate` returns `billing_suspended` and
no service can be created. Settle that and this deploys as it stands. Note that the free plan sleeps
after 15 idle minutes and takes about a minute to wake, which can lose a webhook delivery outright and
blows the five-second target on the first reply.

## Model

Pinned to `gemini-2.5-flash` in `.env`, not an alias, so demo day cannot shift under us. The newer
`gemini-3.x-flash` models are listed by the API but currently answer `503 UNAVAILABLE` ("experiencing
high demand"); re-test them before the demo and move the pin if they are serving. Gemini also emits
the literal characters `","` where the rupee sign belongs in JSON mode, which is why money is written
`Rs 54,990` and `moneySafe()` repairs the artifact.

Measured on the stub pack, one call per turn: **1.9 s to 3.1 s** per turn, inside the 5-second floor rule.

### Quota: the free tier cannot run this

The free tier allows **20 generate requests per day, per model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`).
One associate turn is one request, so twenty turns is the whole day; when it ran out Google asked for a
**68,708 second (19 hour)** retry delay. A ten-minute judged demo walks seven steps, so billing has to be
enabled on the API key before the demo, and before any serious iteration. A paid key also unlocks the
`gemini-3.x-flash` models that currently answer 503.

`429` is therefore not retried: on a per-day limit a retry only spends more of the day for a certain failure.
`503`, `504`, `500`, `502`, `404` and transport hangs are retried up to three times with a 9-second
per-attempt timeout and quadratic backoff. If every attempt fails, the associate gets one honest line
and the customer card is left untouched, rather than silence.

## Not done yet

A retry on Gemini `503`/timeout (one turn in this run died on a 30-second timeout and worked on retry — a dead turn mid-demo is the biggest live risk), a second Indian language, the department manager view, "ask an expert", the store-visit voice log, the step score, and hosting that holds the under-5-second first reply. Voice and photo input are wired but have not been tested with a real voice note or label photo.
