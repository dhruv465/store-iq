# Handoff: Meta/WhatsApp configuration for Store IQ

For the agent taking over the Meta side. Written 28 Oct 2026. Everything below was verified by
read-only Graph API calls on that date; re-verify before acting, config drifts.

**The goal:** messages sent to +91 95189 56645 must reach the local Store IQ server, and the number
must stop presenting itself as Smart Bazaar.

## What you are working with

| Thing | Value |
| --- | --- |
| Project | `/Users/dhruvsmac/Desktop/store-iq` |
| Secrets | `/Users/dhruvsmac/Desktop/store-iq/.env` — read values from there, never paste them into a file, a commit, a log or a chat |
| Meta app id | `1089500453683232` (not secret) |
| Phone number id | `1411155978745660` (`WHATSAPP_PHONE_NUMBER_ID`) |
| Display phone | +91 95189 56645 |
| Graph version | `v25.0` (`WHATSAPP_GRAPH_VERSION`) |
| Access token | `WHATSAPP_ACCESS_TOKEN` — system user "Smartbazaar bot", `expires_at: 0`, never expires. Scopes: `whatsapp_business_management`, `whatsapp_business_messaging` |
| App access token | build as `<app-id>|<WHATSAPP_APP_SECRET>` — needed for the subscription calls, **not** the user token |
| Public URL | `https://andrew-unpredisposing-nonsymbiotically.ngrok-free.dev` (reserved ngrok domain, `NGROK_DOMAIN` in `.env`, survives restarts) |

Number state as of 28 Oct: `status: CONNECTED`, `code_verification_status: VERIFIED`,
`quality_rating: GREEN`, `messaging_limit_tier: TIER_250`, `throughput: STANDARD`,
`is_official_business_account: false`.

## Already done, do not redo

- Profile `about`, `description` and `vertical` are already Store IQ / `RETAIL`. Verified by read-back.
- The app **is** already subscribed to the `whatsapp_business_account` object with `messages` among its
  fields, and `active: true`. The subscription is not the problem.
- The local server handles Meta's verification handshake correctly: a GET with the right
  `hub.verify_token` echoes the challenge, a wrong one returns 403, and an unsigned POST returns 401.
  All three were verified through the public URL with a `facebookplatform/1.0` user agent.

## Task A — repoint the webhook callback URL (this is the blocker)

The app-level subscription still points at the dead Smart Bazaar service, so nothing reaches Store IQ:

```
callback_url: https://smartbazaar-demo.onrender.com/webhook
```

That Render service is `suspended` (suspender: `billing`), along with every other service in the
workspace, so messages are currently delivered nowhere.

**Precondition, or the call will fail:** Meta fetches the callback URL synchronously to verify it
before saving. Both of these must be running first:

```bash
cd /Users/dhruvsmac/Desktop/store-iq && npm run dev     # one terminal
cd /Users/dhruvsmac/Desktop/store-iq && npm run tunnel  # another terminal
curl -s https://andrew-unpredisposing-nonsymbiotically.ngrok-free.dev/health   # must return 200
```

Then, reading the secrets out of `.env` rather than hardcoding them:

```bash
cd /Users/dhruvsmac/Desktop/store-iq
APP_ID=1089500453683232
APP_SECRET=$(grep -E '^WHATSAPP_APP_SECRET=' .env | cut -d= -f2-)
VERIFY=$(grep -E '^WHATSAPP_VERIFY_TOKEN=' .env | cut -d= -f2-)
DOMAIN=$(grep -E '^NGROK_DOMAIN=' .env | cut -d= -f2-)

curl -s -X POST "https://graph.facebook.com/v25.0/$APP_ID/subscriptions" \
  -d "object=whatsapp_business_account" \
  -d "callback_url=https://$DOMAIN/webhook" \
  -d "verify_token=$VERIFY" \
  -d "fields=account_alerts,account_review_update,account_update,calls,message_template_quality_update,message_template_status_update,messages,phone_number_name_update,phone_number_quality_update,security" \
  -d "access_token=$APP_ID|$APP_SECRET"
```

**`fields` replaces the whole list, it does not merge.** The ten values above are exactly what was
subscribed on 28 Oct. Re-read the current list first and pass back what you find, or you will silently
drop subscriptions.

Verify:

```bash
curl -s "https://graph.facebook.com/v25.0/$APP_ID/subscriptions?access_token=$APP_ID|$APP_SECRET"
```

`callback_url` must be the ngrok URL, `active` true, `messages` present.

Then the real test: send `brief` to +91 95189 56645 from a phone and confirm a reply. Check
`GET http://localhost:3000/health/recent` (localhost only) for what the provider actually accepted —
status `sent` with a `wamid` provider id is the proof, not the message appearing on the handset.

## Task B — rotate the verify token (recommended, cheap)

The current `WHATSAPP_VERIFY_TOKEN` was printed into a chat transcript, so treat it as disclosed. It
only gates webhook subscription, so severity is low, but rotating costs nothing while you are in Task A:
generate a new random value, write it to `.env`, restart the server, and pass the new value as
`verify_token` in the same POST above. Do both in one sitting or Meta's verification will fail.

## Task C — replace the profile photo (needs an image)

The contact card still shows the Smart Bazaar logo. It **cannot be cleared** — an empty
`profile_picture_handle` is rejected with `131009 / uploaded media handle is invalid`. It can only be
replaced, which needs an actual file. Ask the owner for a Store IQ image before starting; do not invent
branding. Once you have one, it is the resumable upload flow:

1. `POST /v25.0/<app-id>/uploads?file_name=...&file_length=...&file_type=image/png` with the app token → returns an upload session id
2. `POST /v25.0/upload:<session-id>` with header `file_offset: 0` and the bytes → returns `h`, the handle
3. `POST /v25.0/<phone-number-id>/whatsapp_business_profile` with `{"messaging_product":"whatsapp","profile_picture_handle":"<h>"}`

Verify with `GET /v25.0/<phone-number-id>/whatsapp_business_profile?fields=profile_picture_url`.

## Task D — display name, UI only, cannot be done over the API

`verified_name` is still `SmartbazarAI` and `name_status` is `AVAILABLE_WITHOUT_REVIEW` (available for
use, never formally approved — there is no blue badge). **The Cloud API exposes no field for this.** It
is WhatsApp Manager only:

**business.facebook.com/wa/manage/phone-numbers** → +91 95189 56645 → Settings → Profile → Display name
→ set `Store IQ` → Submit.

If you have no browser automation, stop and hand this one back to the owner rather than attempting a
workaround. Notes for whoever does it:

- Submitting starts a name review. `name_status` goes `PENDING_REVIEW` and **the old name keeps working
  throughout**. Approved → header becomes Store IQ. Declined → stays SmartbazarAI, no harm.
- Meta requires a display name related to the real business behind the account, so declined is a real
  possibility. That costs nothing but the attempt.
- Name changes are rate-limited (historically about two per 30 days), so do not burn attempts.
- Nothing about this touches `phone_number_id`, the token or the number's `CONNECTED` state, so the
  build keeps running during the review.

## Guardrails

- **Never send a WhatsApp message to a number that did not message first.** This already went wrong once:
  a signed test webhook built from a made-up number caused Meta to accept a reply to a stranger. The
  server now checks the 24-hour window, but do not fabricate inbound webhooks from numbers nobody owns.
  If you need to test the transport, use a phone you control, or use a signed webhook and check the
  outbox row rather than letting it send.
- `ALLOWED_PHONES` in `.env` is intentionally **empty**, which means no allowlist: any associate who
  messages the number gets a reply. The owner asked for it that way. Do not reinstate a list.
- Do not set a display name or profile text carrying the Reliance Digital brand. This WABA belongs to the
  owner, not Reliance, and the number will message real associates. The current copy says "electronics
  store associates" deliberately.
- Do not change `phone_number_id`, re-register the number, or touch the other eight Render services.
- Keep secrets out of commits, logs and chat. `.env` is gitignored; keep it that way.
- The contest rules say test data and a test number only, and no messages to real customers.

## If the subscription POST fails

| Symptom | Cause |
| --- | --- |
| `(#2200) callback verification failed` | Server or tunnel not running, or `verify_token` mismatch between the POST and `.env`. Check `/health` through the public URL first. |
| `Missing Permission` | You used the system user token instead of the `<app-id>|<app-secret>` app token. |
| Subscription saved but still no messages | `fields` was replaced without `messages`. Re-read and re-POST the full list. |
| Nothing in ngrok's request log | Meta never called you. The subscription did not save, or the URL is wrong. `GET /api/requests/http` on `localhost:4040` shows every inbound request. |

---

## Remaining work, 28 Oct — needs a browser, cannot be done by API

Verified by read-only Graph calls at the time of writing. Everything the API can change has been
changed already: `about`, `description` and `vertical` all read as Store IQ / RETAIL. Two things
are left, and neither has an API.

### 1. Display name: `SmartbazarAI` → `Store IQ`

The chat header still shows **SmartbazarAI** to every associate and judge. The Cloud API has no
field for this; it is WhatsApp Manager only.

- **business.facebook.com/wa/manage/phone-numbers** → **+91 95189 56645** → Settings → Profile →
  Display name → set `Store IQ` → Submit.
- Submitting starts a name review. `name_status` goes `PENDING_REVIEW`; the old name keeps working
  until it clears. Declined costs nothing but the attempt.
- Current state: `name_status: AVAILABLE_WITHOUT_REVIEW`, `new_name_status: AVAILABLE_WITHOUT_REVIEW`,
  `is_official_business_account: false`.
- Meta wants a display name that relates to the real business behind the account, so a decline is
  possible. Display-name changes are also rate limited, historically about two per 30 days.

### 2. Profile photo: still the Smart Bazaar logo

Meta refuses to clear it — `profile_picture_handle: ""` returns `131009, uploaded media handle is
invalid`. It can only be **replaced**, which needs an actual image file:

- Easiest: WhatsApp Manager → the same Profile page → change the photo there.
- By API it needs a resumable upload to get a handle, then
  `POST /<phone-number-id>/whatsapp_business_profile` with `profile_picture_handle`.

### Do not change

- **The callback URL.** It is working. Changing it silently breaks inbound messages, and a failed
  "Verify and save" leaves the old one in place with no warning.
- The phone number id, the system user token, or the `messages` field subscription.
- **Never use Reliance Digital branding.** This WABA belongs to the owner, not to Reliance. The
  contest entry is built for them; the number does not represent them. A display name or profile
  claiming otherwise is a false brand claim on a number that messages real associates.

### Verifying afterwards

```bash
cd /Users/dhruvsmac/Desktop/store-iq
T=$(grep -E '^WHATSAPP_ACCESS_TOKEN=' .env | cut -d= -f2-)
P=$(grep -E '^WHATSAPP_PHONE_NUMBER_ID=' .env | cut -d= -f2-)
curl -s "https://graph.facebook.com/v25.0/$P?fields=verified_name,name_status,status" -H "authorization: Bearer $T"
curl -s "https://graph.facebook.com/v25.0/$P/whatsapp_business_profile?fields=about,description,vertical,profile_picture_url" -H "authorization: Bearer $T"
```

Done looks like: `verified_name: Store IQ` (or `PENDING_REVIEW` while it clears), `status: CONNECTED`
unchanged, and a `profile_picture_url` that is not the Smart Bazaar logo.
