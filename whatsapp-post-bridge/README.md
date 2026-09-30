# whatsapp-post-bridge

Posts signed AIMS deliveries into WhatsApp groups: after each customer sign-off
(partial trip or final), AIMS queues a post with a caption, the sign-off's
photos and the signed DO as a PDF; this worker sends it into the project's
group. Runs as a linked device (whatsapp-web.js) on the Osiris number.

## What it does, and what it never does

- Posts queued deliveries (`GET /wa-post/jobs` → claim → send → done).
- Reports the groups the number is in (`POST /wa-post/groups`, every 10 min),
  which feed the portal's "WhatsApp group" dropdowns.
- Heartbeat every 60 s (`POST /wa-post/heartbeat`); AIMS rings the office bell
  after 5 minutes of silence.
- **Never reads or answers messages.** There is no message handler: DMs stay on
  the official Cloud API on the same number, so nothing is answered twice.

## Never double-posting

AIMS gives each post to one claimer (atomic claim, 10-minute lease). The worker
journals every part it has sent (`post-journal.json` on the disk, fsynced)
before acknowledging. A post re-offered after a crash resumes after the last
part sent; one that was fully sent is only acknowledged.

## Deploy (Render)

Background Worker, Docker, its own 1 GB disk at `/data` (see `render.yaml`).
Env: `AIMS_API_BASE`, `AIMS_POST_TOKEN` (a key of the API's `WA_POST_BRIDGES`),
`POST_ENABLED` (kill switch, default false), `SESSION_DIR=/data/.wwebjs_auth`,
`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`. The QR appears in the logs when
there is no session: scan it from the phone running the WhatsApp Business app
(Linked devices → Link a device).

## Limits

Unofficial (against WhatsApp's terms): keep volume low. `POST_ENABLED=false` or
the API's `WA_POST_PAUSED=true` stops posting at once.
