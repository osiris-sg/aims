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

## AIMS Operator in chosen chats (off by default)

The same worker can hand chosen chats to the AIMS Operator (the assistant that
books deliveries and drafts documents), bound to a different org than the
group agent. Nothing changes until `OPERATOR_ENABLED=true`.

- API: `WA_WEB_BRIDGES={"<token>":{"orgId":"<org>","chats":["<id>@g.us","dm"],"label":"San"}}`.
  The API refuses any chat not listed; `"dm"` allows 1:1 chats.
- Bridge: `OPERATOR_TOKEN=<token>`, `OPERATOR_CHATS=<id>@g.us`, `OPERATOR_ENABLED=true`
  (and `OPERATOR_DMS=true` to take DMs from non-staff senders).
- In an operator chat, a message goes to AIMS when it tags this account or says
  `@San`, is `confirm 1234` / `cancel 1234`, quote-replies one of San's
  messages, or comes from the person San just asked something (their next
  message within 10 minutes; everyone else still tags). Images and PDFs up to
  10 MB are passed along (a customer's PO becomes a Sales Order card). Replies
  come back as quoted replies. Those chats never reach the group agent.
- Heartbeat every 60 s; AIMS rings the office bell after 5 min of silence.
- On reconnect, triggered messages from the last 30 min are caught up
  (`operator-last-seen.json` on the disk; AIMS drops any it already handled).
- `LIST_GROUPS=true` logs `GROUP:: <name> -> <id>` for every group at boot, to
  find a chat id. It sends nothing.
