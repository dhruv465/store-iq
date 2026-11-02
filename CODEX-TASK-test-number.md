# Task for Codex: put Store IQ on the Meta test number

**UPDATED 2 Nov 15:40 IST — the credentials are done. Only steps 4 and 5 are left: the To list and
the webhook.** The user has chosen to stay on temporary tokens, so the one in `.env` dies at
**17:30 IST today** and a fresh one must be copied from API Setup before any demo. Original brief
follows.

Written 2 Nov 2026 by Claude. **You have what I do not: click and type access to Dia.** Browsers are
granted to me read-only, so I can see the screen but cannot navigate it. Everything below that needs
a click is yours; everything that needed a Graph call I have already done, and the results are here.

## The goal

The real number **+91 95189 56645** is being verified at Meta and is showing **Pending**. Until it
clears, Store IQ should run on the Meta **test number +1 555-653-9206**, with the real number's
settings kept so switching back is uncommenting two lines.

## DONE — do not repeat

`.env` now holds the test number and Meta accepts it:

```
GET /{phone_number_id} -> 200
{"display_phone_number":"+1 555-653-9206","verified_name":"Test Number","quality_rating":"GREEN"}
```

- **`WHATSAPP_PHONE_NUMBER_ID=1434770349717434`** — the user's first paste was `4122603248049288`,
  which is the WhatsApp Business Account id, not the phone number id. The WABA is
  `1599060721971579` ("Test WhatsApp Business Account") and that one number is all it holds.
- **`WHATSAPP_ACCESS_TOKEN`** — temporary API Setup token, app **StoreIQ** `1089500453683232`,
  scopes `whatsapp_business_management` and `whatsapp_business_messaging`, granular target
  `1599060721971579`. **Expires 2026-11-02 12:00 UTC (17:30 IST).**
- Both live values are parked as `#LIVE` comment lines; switching back is uncommenting two lines
  and deleting two.
- Verified end to end: the server starts with `whatsapp on`, and `POST /try` with "customer wants a
  washing machine for a family of four" answers in 5.3 s with the model's own two buttons.

**Steps 1–3 below are therefore complete.** Start at step 4.

## What was true before that, verified by read-only Graph calls

| | |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` in `.env` | **the test number's id** — the user pasted it; 16 digits, well formed |
| `WHATSAPP_ACCESS_TOKEN` in `.env` | **still the live number's token** — valid, but wrong for this id |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | unchanged, still correct |
| `#LIVE WHATSAPP_PHONE_NUMBER_ID=1411155978745660` | I parked the real id as a comment in `.env` (it was overwritten; I recovered it from `META-HANDOFF.md`) |

```
GET /{phone_number_id}                        -> 400  Authorization Error (code 100)
GET /me                                       -> 200  {"name":"Smartbazaar bot","id":"122102339661512286"}
GET /{me}/assigned_whatsapp_business_accounts -> 200  {"data":[]}
```

**Read that last line carefully.** The token in `.env` is valid, but the system user it belongs to
has **no WhatsApp Business Account assigned any more**, so it cannot reach *any* number — not the
test one and not the live one. `META-HANDOFF.md` says this token never expires and once had
`whatsapp_business_management` and `whatsapp_business_messaging`; that assignment is gone now.

So **a token and a phone number id must come from the same app.** Pointing the old token at the new
id is what produced the 400.

## What to do

All of it on `developers.facebook.com`, in Dia.

1. Open **developers.facebook.com → the app that owns the test number → WhatsApp → API Setup**.
   The old app id is `1089500453683232`; confirm whether the test number sits under that app or a
   newer one, because the token must come from whichever it is.
2. In the **From** dropdown choose the test number **+1 555-653-9206**. Read the **Phone number ID**
   shown under it and check it matches what is already in `.env` — if it does not, the user pasted
   the wrong one and yours wins.
3. Copy the **temporary access token** from the box at the top. **Do not paste it into a chat, a
   commit, a log or a file you print.** Put it into `.env` with a command that echoes nothing, for
   example `printf 'WHATSAPP_ACCESS_TOKEN=%s\n' "$(pbpaste)"` appended, and comment the existing
   token line out as `#LIVE WHATSAPP_ACCESS_TOKEN=...` rather than deleting it.
4. In the **To** field, register every handset that will be used. **A test number only delivers to
   numbers registered there, up to five.** This is the step that most often makes a working build
   look broken.
5. Check the webhook: callback URL must be the reserved ngrok domain in `NGROK_DOMAIN`
   (`https://andrew-unpredisposing-nonsymbiotically.ngrok-free.dev/webhook`), the verify token must
   match `WHATSAPP_VERIFY_TOKEN`, and **`messages` must be subscribed**. A test number will accept
   messages and never reach the server otherwise, which looks identical to the agent being broken.

## How to prove it worked

```bash
# 1. Meta agrees the pair is valid and names the test number. Prints no secret.
node --env-file-if-exists=.env -e '
 const t=process.env.WHATSAPP_ACCESS_TOKEN, v=process.env.WHATSAPP_GRAPH_VERSION||"v23.0";
 const u=`https://graph.facebook.com/${v}/${process.env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`;
 fetch(u,{headers:{authorization:`Bearer ${t}`}}).then(r=>r.text().then(b=>console.log(r.status,b.split(t).join("<token>"))))'
# expect: 200, display_phone_number "+1 555-653-9206"

npm run check          # 262 tests must still pass — nothing here touches code
npm run dev            # the startup banner names the provider and the pack source
```

Then one turn through **`POST /try`** on localhost, which never queues a real WhatsApp send, before
any handset is involved. Only after that, a real message from a registered handset.

## Rules that are not yours to relax

- **Never read or print a secret.** Check a name is set (`grep -c '^NAME=.\+' .env`), never its
  value. A key that reaches a transcript has to be rotated — that already happened once here.
- **Never commit `.env`** (it is gitignored), `web/dist`, `web/node_modules` or `data/runtime/`.
- **The Jio catalogue is read-only.** It is a production store. Do not write, create or delete
  anything on it, and do not use real contact details from it.
- Do not message real numbers while testing. `POST /try` exists for this.
- Leave the branch `fal-assets` alone.

## Worth raising with the user

The temporary token **expires in 24 hours**. If the demo is Friday 6 November, it will need
regenerating that morning, or better, a **System User token with no expiry** assigned to the right
WhatsApp Business Account — which is what the live number used to have, per `META-HANDOFF.md`, and
what stopped working when the assignment was removed.
