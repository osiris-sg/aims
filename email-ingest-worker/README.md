# AIMS Email Ingest Worker

Cloudflare Email Worker that receives inbound email (Cloudflare Email Routing)
and forwards it as JSON to the AIMS ingestion webhook, which classifies each
PDF/image attachment by issuer and creates DRAFT invoices (AR) or bills (AP).

```
sender → docs+{ORG_ID}@<your-domain> → Cloudflare Email Routing → this Worker
       → POST {AIMS_API} (X-Webhook-Secret) → EmailIngestLog + Document drafts
```

Standalone package — **not** part of the Nest build. Deployed with Wrangler.

## Deploy

```bash
cd email-ingest-worker
npm install
npx wrangler login                            # once per machine
npx wrangler deploy

# Secrets (prompted for the value):
npx wrangler secret put AIMS_API              # https://aims-ahwy.onrender.com/ingestion-email/email
npx wrangler secret put EMAIL_INGEST_SECRET   # the SAME value as EMAIL_INGEST_SECRET on Render
```

Reference values:
- `AIMS_API` = `https://aims-ahwy.onrender.com/ingestion-email/email`
- `EMAIL_INGEST_SECRET` = the value already set on the Render service (do not
  store the literal here — this file is committed).

## Bind to an email address

Cloudflare dashboard → your domain → **Email → Email Routing**:

1. Enable Email Routing for the domain (adds the required MX/TXT records —
   the domain's mail must be hostable by Cloudflare, e.g. a dedicated
   subdomain like `inbound.osiris.so`).
2. **Routing rules** → either:
   - **Catch-all address** → action **Send to a Worker** → `aims-email-ingest`
     (simplest — the webhook itself ignores anything not addressed to
     `docs+{ORG_ID}@…`), or
   - **Custom addresses** → create `docs+…` addresses per org → action
     **Send to a Worker** → `aims-email-ingest`. Note Cloudflare custom
     addresses match exact local parts, so the catch-all is the practical
     choice for plus-suffix routing.
3. The org's inbound address is `docs+{ORG_ID}@<your-domain>` — also served by
   `GET /email-ingest/address/:orgId` once `EMAIL_INGEST_DOMAIN` is set on
   Render.

## Behavior

- Parses MIME with `postal-mime`; base64-encodes each attachment.
- Skips attachments **>10MB** (mirrors the webhook's cap) and reports them in
  a `meta.skippedAttachments` field on the payload.
- `messageId` = the `Message-ID` header → the webhook's idempotency key
  (duplicate deliveries no-op with `{ok:false, reason:"duplicate"}`).
- Webhook **2xx** (even `{ok:false, …}` business rejections) → success, logged.
- Webhook **4xx** → misconfiguration (bad secret/payload): logged as an error,
  NOT retried (a retry can't fix config; throwing would bounce mail).
- Webhook **5xx / network failure** → the handler throws so Cloudflare retries
  delivery.

## Observe

```bash
npx wrangler tail aims-email-ingest
```

Each delivery logs `from`, `to`, attachment counts, and the webhook's HTTP
status + response body. Server-side, every email lands in `EmailIngestLog`
(status RECEIVED/PARSED/IGNORED/FAILED) queryable via
`GET /email-ingest/logs/:orgId`.

## Per-org enablement (server-side)

Ingestion is off by default per org. Enable via
`PUT /email-ingest/config/:orgId` with `{ "enabled": true, "watchedSenders":
["ap@supplier.com", "@trusteddomain.com"] }` (empty list = accept all senders).
