# whatsapp-dm-bridge

Mirrors one phone's **1:1** WhatsApp conversations into AIMS, plus any groups
it is explicitly told to watch. Read-only: it never sends a message and cannot
post into a group.

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
3. Relays the groups named in `WATCH_GROUPS`, and no others
4. Downloads attachments and stores them in S3, so a row has a file behind it
5. Reports the groups the phone is in to `POST /whatsapp/dm-bridge/groups`,
   at startup and hourly

Outbound matters as much as inbound: replies typed by hand on the phone are
relayed too, so the CRM thread is complete rather than half a conversation.

WhatsApp's own housekeeping (e2e key notices, membership notifications) is NOT
relayed — only real chat types. Those notices fire in a burst every time the
device is linked, and each one used to land in CRM as a message from a
stranger.

## Leads (read-only)

An org with `enableBridgeLeadCapture` on turns ad enquiries into Leads without
ever replying to them. CIEL's number takes enquiries off an Instagram ad, and
**the ad sends the intro** — this bridge still never sends anything.

The trigger is **that intro going out**, not a stranger writing in. Suppliers,
wrong numbers and the bank all write to a company phone; none of them are
leads.

1. AIMS sees the intro leave the line → a Lead is opened, named by the phone
   number, keeping whatever the enquirer opened with (on a click-to-WhatsApp
   ad, the pre-filled message) as its remarks. Nobody is notified yet: a bare
   number is not something a manager can act on.
2. Their next message names the lead (when it reads like a name rather than an
   enquiry) and releases the normal assign card to the org's notify number,
   where a designer is picked exactly as for every other lead source. That
   reply always releases the lead, even when it is not a name.

The intro text lives in the org's features as `bridgeLeadIntro`, so ad copy can
change without a deploy; it falls back to "Hi! Please let us know how we can
help you." Matching ignores case, spacing and smart quotes, but nothing else —
a near-miss fails rather than opening a lead for the wrong person.

Staff who have linked their number to AIMS are skipped — they are talking to
the line, not enquiring.

Rows land in the same `WhatsAppMessage` table the Cloud API writes to, so the
existing CRM views show them with no portal changes.

## Deploy

Render Background Worker, Docker, **its own persistent disk** (two bridges
sharing a session directory would fight over the same Chromium profile). See
`render.yaml`. Set `AIMS_GROUP_BRIDGE_TOKEN` in the dashboard; it is the same
secret the API checks as `WHATSAPP_GROUP_BRIDGE_TOKEN`.

The QR appears in the worker's logs whenever there is no session on the disk.

### Watching a group

`WATCH_GROUPS` is a comma-separated list of group jids (`120363…@g.us`) or
case-insensitive name fragments (`CIEL INVOICE`). **Empty means no groups**,
which is how this bridge behaved before groups existed as an option.

Opt-in per group is deliberate: the phone belongs to the company and sits in
plenty of chats that are none of AIMS's business. Watching everything would
ingest all of them.

To find a group's id, read what the bridge reports:

```
GET /whatsapp/dm-bridge/groups?key=<BRIDGE_LABEL>
     -H "X-Group-Bridge-Token: <token>"
```

`MAX_MEDIA_BYTES` caps what it will carry (default 15MB); anything larger is
logged and skipped rather than held in memory.

## Limits

- Unofficial. WhatsApp can log the device out; re-scan to recover.
- Media is downloaded and stored in S3 (`payload.media` holds the key, url,
  mimetype and filename). Files over `MAX_MEDIA_BYTES` are skipped.
- A group is relayed only if `WATCH_GROUPS` names it; the phone's other groups
  are never read.
- No automation yet. Adding replies means deciding what it should say, and that
  decision has not been made.
