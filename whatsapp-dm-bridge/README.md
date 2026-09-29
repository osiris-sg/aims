# whatsapp-dm-bridge

Mirrors one phone's **1:1** WhatsApp conversations into AIMS. Read-only: it
never sends a message and cannot post into a group.

## Why it exists

Some numbers cannot be connected to the Cloud API at all. Meta answers
*"already has an existing WhatsApp Business account"* on both signup paths —
new-number and coexistence — and there is no way through. CIEL's company phone
(+65 8987 8087) is one of these. A linked device needs no Meta involvement, so
it is the only route by which those conversations reach AIMS.

## Why it is not part of whatsapp-group-bridge

That service answers clients in **group** chats: trained templates, approval
drafts for uncertain replies, appointment capture, the PA conversation. Its
notions of staff, silence and mentions are all group rules. Two purposes in one
process means every change to one risks the other, which has already happened
once. This one stays small on purpose.

## What it does

1. Prints a QR on first boot (scan from the phone, Linked devices → Link a device)
2. Relays every 1:1 message, **both directions**, to
   `POST /whatsapp/dm-bridge/message`
3. Nothing else

Outbound matters as much as inbound: replies typed by hand on the phone are
relayed too, so the CRM thread is complete rather than half a conversation.

Rows land in the same `WhatsAppMessage` table the Cloud API writes to, so the
existing CRM views show them with no portal changes.

## Deploy

Render Background Worker, Docker, **its own persistent disk** (two bridges
sharing a session directory would fight over the same Chromium profile). See
`render.yaml`. Set `AIMS_GROUP_BRIDGE_TOKEN` in the dashboard; it is the same
secret the API checks as `WHATSAPP_GROUP_BRIDGE_TOKEN`.

The QR appears in the worker's logs whenever there is no session on the disk.

## Limits

- Unofficial. WhatsApp can log the device out; re-scan to recover.
- Media is recorded as `[image]`, `[document]` and so on. Files are not downloaded.
- No automation yet. Adding replies means deciding what it should say, and that
  decision has not been made.
