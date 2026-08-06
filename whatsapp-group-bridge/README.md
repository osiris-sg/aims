# AIMS WhatsApp Group Bridge (unofficial)

Lets the PA reply **inside WhatsApp groups**, which the official Cloud API cannot
do. Runs as a separate worker (a `whatsapp-web.js` linked device) on the **same
number** used for 1:1, but handles **group messages only** — 1:1 stays on the
official Cloud API, so the two never collide.

> ⚠️ **Unofficial / against WhatsApp ToS.** The linked number can be banned by
> Meta's automated detection (low-volume + warm-contact use lowers the odds, not
> to zero). Run only on a number the operator accepts is at-risk. **Do not** run
> it on a client's number without that understanding. Not part of the main
> Render/Vercel deploy — it needs a persistent host with a real browser.

## How it works

```
group message ──▶ bridge (linked device) ──▶ POST /whatsapp/group-agent ──▶ trained AIMS agent
                        │  (only if body matches the @pa trigger)                    │
                        ◀──────────────── reply text ◀──────────────────────────────┘
                        └─▶ sends reply INTO the group
```

- **Summon-only:** stays silent unless a message contains the trigger (default `@pa`).
- **Same brain as 1:1:** replies come from the org's trained agent (voice + QnA + customer context), via the token-gated `/whatsapp/group-agent` endpoint.
- **Logged in CRM:** group messages/replies are stored as `WhatsAppMessage` rows (counterparty = group id) so they show in CRM.

## Run

1. On the API server set `WHATSAPP_GROUP_BRIDGE_TOKEN` (a long random secret).
2. Here: `cp .env.example .env` and fill `AIMS_ORG_ID`, `AIMS_GROUP_BRIDGE_TOKEN` (same value), `AIMS_API_BASE`.
3. `node bridge.js` → open `qr.png` → scan from the number's phone (Linked devices → Link a device).
4. Add that number to a group and type `@pa please intro`.

The `.wwebjs_auth/` session persists across restarts (don't commit it).
