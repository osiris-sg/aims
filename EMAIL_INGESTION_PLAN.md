# Email Ingestion Agent — Build Plan (Handoff)

**Status:** Spec / ready to build
**Author context:** Written for a dev picking this up cold. Read this whole file before writing code.
**Goal:** An email agent that reads documents (Bills, POs, Quotations) arriving by email for each of our client orgs and auto-creates the corresponding `Document` rows in AIMS, routed to the correct org, extracted by AI, and dropped into the existing posting/review flow.

---

## 1. The decision: forwarding webhook, NOT direct mailbox reading

We evaluated three approaches. **We are building the forwarding-webhook approach.** Do not build direct IMAP or Gmail/Graph API reading. Here is why, so you don't "improve" it back into a harder design:

| Approach | Verdict | Reason |
|---|---|---|
| **Forwarding → webhook** (chosen) | ✅ Build this | Provider-agnostic (Gmail/Outlook/Yahoo all forward identically), **zero client credentials stored**, no Gmail security audit, no background workers, reuses code we already have. |
| Direct read via Gmail API / MS Graph | ❌ Reject | Client mailboxes are **external orgs on mixed providers**. No single API covers Google+Outlook+Yahoo (Yahoo has no read API). Gmail's `gmail.readonly` is a restricted scope → Google verification + annual CASA security assessment for external users. Would mean 3 integrations + credential vault + a token-renewal scheduler AIMS doesn't have. |
| IMAP polling (odysseus-style) | ❌ Reject | Stores every client's mailbox password, needs a persistent poll worker (AIMS has **no** cron/queue infra), basic-auth IMAP is being killed by Google/Microsoft. Scales as O(mailboxes) poll loops. |

**Key architectural fact:** AIMS has **no** `@nestjs/schedule`, no Bull/BullMQ, no cron, and runs on Neon serverless. Any "poll the mailbox" design forces us to add worker infra. The webhook approach is push-based and stateless, which fits the existing app.

**How "watch specific senders" still works:** the client sets a forwarding filter in *their own* mailbox (`from: supplierA OR supplierB → forward to <our inbound address>`). We also re-check the `From` header server-side against a per-org allow-list as a safety net. One-time setup per client, works on every provider.

---

## 2. High-level architecture

```
  Client's mailbox (Gmail / Outlook / Yahoo)
        │  forwarding rule: from watched senders → forward to
        ▼
  docs+{ORG_ID}@inbound.osiris.<domain>
        │  (an address on a domain WE control)
        ▼
  ┌─────────────────────────────────────────────┐
  │  Inbound receiver — Cloudflare Email Worker   │   (FREE, see §6)
  │  parses MIME → base64 attachments → HTTPS POST │
  └─────────────────────────────────────────────┘
        │  POST /ingestion/email   (X-Webhook-Secret)
        ▼
  ┌─────────────────────────────────────────────┐
  │  AIMS backend — IngestionEmailController      │
  │  1. verify shared secret                       │
  │  2. parse ORG_ID from `to` address             │
  │  3. load EmailIngestConfig (feature on?        │
  │     sender allowed? doc-type routing)          │
  │  4. dedup by Message-ID (EmailIngestLog)       │
  │  5. for each PDF/image attachment:             │
  │       AI-extract  →  classify type             │
  │       upload original to S3                     │
  │       createFromExtraction(...) → Document      │
  │  6. write EmailIngestLog row (audit + dedup)   │
  └─────────────────────────────────────────────┘
        ▼
  Draft/pending Document appears in the org's
  Documents list / Posting-Review queue.
```

Latency is a few seconds end-to-end; push-based, no polling.

---

## 3. What we reuse (do NOT rebuild these)

The 60%-existing reference implementation is `src/bills/bills-inbound.controller.ts` — read it first. It already does secret-verify + org-from-address + Claude extract + create-draft, but only for a single BILL and a single attachment. We are **generalizing** it into a multi-type, multi-attachment, config-driven endpoint.

| Need | Reuse this | File |
|---|---|---|
| Webhook auth + org-from-address parsing | `BillsInboundController` pattern | `src/bills/bills-inbound.controller.ts` |
| Bill extraction (Claude `claude-sonnet-4-6`, takes base64 PDF/image) | `BillsService.extractFromFile(orgId, base64, mediaType)` | `src/bills/bills.service.ts:709` |
| Generic doc extraction (invoice/PO/quotation/DO) | `DocumentExtractionService.extractForReconciliation` / `.processDocumentFile` | `src/document-extraction/document-extraction.service.ts` |
| Turn extraction JSON → a real Document (draft) | `DocumentsService.createFromExtraction(orgId, type, extracted, templateId?, sourceFileUrl?)` | `src/documents/documents.service.ts:1630` |
| Low-level document create + auto doc-number | `DocumentsService.createBasicDocument(templateId, type, orgId, config, projectId?)` | `src/documents/documents.service.ts:1296` |
| Store the original file | `S3Service.uploadFile(key, body, contentType)` → returns public URL; `getSignedUrl(key)` for reads | `src/common/services/s3.service.ts` |
| Bill draft creation (if type=BILL) | `BillsService.create(orgId, userId, dto)` | `src/bills/bills.service.ts:221` |

**Document facts you need:**
- Every doc type lives in the unified `Document` table (`type` is a free-form string: `INVOICE`, `BILL`, `PO`/`PURCHASE_ORDER`, `QUOTATION`, `DO`). There is no per-type table — do not create one.
- Org scoping is always by passing `organizationId` explicitly. Never trust it from a request body except here where it comes from the address and is validated against the DB.
- `Document.attachments` (JSON) holds `[{ fileKey, fileName, mimeType, uploadedAt, uploadedBy }]` — S3 keys, not bytes. Store the original email attachment here.

---

## 4. Backend build

### 4.1 New Prisma models

Add to `api-server-production/prisma/schema.prisma`. After editing, run `npm run db:push` (auto-push per project convention — additive, safe).

```prisma
// Per-org configuration for the email ingestion agent.
model EmailIngestConfig {
  id                String   @id @default(uuid())
  organizationId    String   @unique
  enabled           Boolean  @default(false)   // master on/off for this org
  // Allow-list of sender addresses/domains we accept documents from.
  // Match rule: exact email OR "@domain.com" suffix. Empty array = accept ALL
  // forwarded mail for this org (server-side filtering off; rely on the
  // client's forwarding rule only).
  watchedSenders    Json     @default("[]")     // string[]
  // How to decide the Document.type for an incoming attachment.
  //   "ADDRESS"  → read it from the address label suffix (docs+{org}+bill@)
  //   "AI"       → let Claude classify each attachment
  //   "FIXED"    → always use `defaultDocType`
  routingMode       String   @default("AI")
  defaultDocType    String   @default("BILL")   // used by FIXED, and as fallback
  // Draft (accountant reviews) vs auto-confirm. Keep DRAFT for v1.
  createMode        String   @default("DRAFT")  // "DRAFT" | "CONFIRM"
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}

// Audit log + dedup ledger for every inbound email we process.
model EmailIngestLog {
  id                String   @id @default(uuid())
  organizationId    String
  messageId         String?              // RFC-5322 Message-ID (dedup key)
  fromAddress       String?
  subject           String?
  status            String   @default("RECEIVED") // RECEIVED|PARSED|IGNORED|FAILED
  reason            String?              // why IGNORED/FAILED
  createdDocumentIds Json    @default("[]")        // string[] of Document.id
  attachmentCount   Int      @default(0)
  rawMeta           Json?                // { to, provider, headers... } for debugging
  createdAt         DateTime @default(now())
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, messageId])  // idempotency: same email never processed twice
  @@index([organizationId, createdAt])
}
```

Add the back-relations on `model Organization`:
```prisma
  emailIngestConfig EmailIngestConfig?
  emailIngestLogs   EmailIngestLog[]
```

> **Memory note — Org column guard gotcha:** these are new *relations*, not scalar columns on `Organization`, so the ClerkAuthGuard hand-rolled `select` issue does NOT apply here. But if you add any scalar column to `Organization`, you must add it to both hand-rolled selects in `ClerkAuthGuard` or non-admin users get a partial org object.

### 4.2 New module `src/ingestion-email/`

Create a dedicated module (keep it separate from the Biofuel `src/ingestion/` weighbridge module — different concern).

```
src/ingestion-email/
  ingestion-email.module.ts
  ingestion-email.controller.ts     // the public webhook
  ingestion-email.service.ts        // orchestration + config + dedup + routing
  email-config.controller.ts        // admin CRUD for EmailIngestConfig + logs (Clerk-guarded)
  dto/inbound-email.dto.ts
```

Module imports: `DocumentsModule`, `BillsModule`, `DocumentExtractionModule`, `CommonModule` (for `S3Service` + `PrismaService`). Provides the two services.

### 4.3 The public webhook — `ingestion-email.controller.ts`

Model it on `bills-inbound.controller.ts`. Key differences: multi-attachment, config-driven filtering, per-attachment type routing, dedup, and it writes an `EmailIngestLog`.

```ts
interface InboundEmailPayload {
  from: string;
  to: string;                 // docs+{ORG_ID}@... or docs+{ORG_ID}+{type}@...
  subject?: string;
  text?: string;
  messageId?: string;         // RFC-5322 Message-ID for dedup
  attachments?: Array<{ contentType: string; contentBase64: string; filename?: string }>;
}

@ApiTags('ingestion-email')
@Controller('ingestion-email')
export class IngestionEmailController {
  constructor(private readonly svc: IngestionEmailService) {}

  @Public()                                        // bypass Clerk (see src/decorators/public.decorator.ts)
  @Post('email')
  async inbound(
    @Headers('x-webhook-secret') secret: string,
    @Body() payload: InboundEmailPayload,
  ) {
    // 1. shared-secret check — fail closed if EMAIL_INGEST_SECRET unset
    // 2. parse ORG_ID (and optional type label) from payload.to
    // 3. delegate everything else to the service
    return this.svc.handleInbound(secret, payload);
  }
}
```

**IMPORTANT — return 200 on "ignored", never throw for business rejections.** Inbound-parse providers retry on non-2xx, which would re-process. Only throw for a bad/missing secret. Everything else (unknown org, disabled config, disallowed sender, no attachment, dedup hit) returns `{ ok: false, reason }` with HTTP 200. (Paylane learned this the hard way.)

### 4.4 The service — `ingestion-email.service.ts` — `handleInbound()` flow

```
1. secret !== process.env.EMAIL_INGEST_SECRET  → throw Unauthorized (only hard failure)
2. orgId = parse from payload.to  (regex: /docs\+([A-Za-z0-9-]+)(?:\+([a-z_]+))?@/i)
     - group 1 = orgId, group 2 = optional type label ("bill"|"po"|"quotation")
   if no orgId → 200 { ok:false, reason:'no-org-in-address' }
3. org = prisma.organization.findUnique(orgId); if none → 200 ignored
4. cfg = prisma.emailIngestConfig.findUnique({ organizationId: orgId })
     - if !cfg || !cfg.enabled → 200 { ok:false, reason:'ingestion-disabled' }
5. sender allow-list: if cfg.watchedSenders non-empty and payload.from matches none
     → 200 { ok:false, reason:'sender-not-watched' }   (also log it, status=IGNORED)
6. DEDUP: try prisma.emailIngestLog.create({ organizationId, messageId, status:'RECEIVED', ... })
     - on unique-constraint violation (same org+messageId) → 200 { ok:false, reason:'duplicate' }
     - if messageId missing, synthesize: hash(from|subject|attachmentNames) — best effort
7. attachments = payload.attachments.filter(pdf|image); if none → log IGNORED, 200
8. for each attachment:
     a. type = resolveType(cfg, addressTypeLabel, attachment)   // see §4.5
     b. extracted = extract(orgId, base64, mediaType, type)     // see §4.6
     c. if !extracted → record failure for this attachment, continue
     d. s3Key = S3Service.uploadFile(`email-ingest/${orgId}/${ts}_${filename}`, buffer, contentType)
     e. doc = createDoc(orgId, type, extracted, s3Url, cfg.createMode)   // see §4.7
     f. collect doc.id
9. update EmailIngestLog → status PARSED (or FAILED if 0 created), createdDocumentIds, attachmentCount
10. return { ok:true, orgId, created: [...docIds] }
```

### 4.5 Type routing — `resolveType(cfg, addressLabel, attachment)`

- `cfg.routingMode === 'ADDRESS'` → map the address label (`bill`→`BILL`, `po`→`PURCHASE_ORDER`, `quotation`→`QUOTATION`). Fallback `cfg.defaultDocType`.
- `cfg.routingMode === 'FIXED'` → always `cfg.defaultDocType`.
- `cfg.routingMode === 'AI'` (default) → one cheap Claude classification call per attachment returning one of `BILL|INVOICE|PURCHASE_ORDER|QUOTATION|DELIVERY_ORDER`, fallback `cfg.defaultDocType`. (You can fold this into the extraction prompt to avoid a second call — ask the model to also return a `documentType` field.)

### 4.6 Extraction — `extract(orgId, base64, mediaType, type)`

- If `type === 'BILL'` → `BillsService.extractFromFile(orgId, base64, mediaType)` (already bill-shaped).
- Else → `DocumentExtractionService.extractForReconciliation(...)` / `processDocumentFile(...)` which returns the generic `ExtractedDocumentData` shape (customer, document, references, items[], totals). Both accept base64 PDFs directly via Claude `claude-sonnet-4-6`.
- Keep the LLM key handling as-is (`ANTHROPIC_API_KEY`); both paths already degrade/throw cleanly if unset.

### 4.7 Create the document — `createDoc(orgId, type, extracted, sourceFileUrl, createMode)`

- If `type === 'BILL'` → `BillsService.create(orgId, undefined, {...})` exactly like `bills-inbound.controller.ts` does today (placeholder Supplier from the From address, `inboundChannel:'EMAIL'`).
- Else → `DocumentsService.createFromExtraction(orgId, type, extracted, /*templateId*/ undefined, sourceFileUrl)`. It resolves the org's active template, fuzzy-matches customer, and calls `createBasicDocument` (auto doc-number). Result is a **draft**.
- Push the S3 key onto `Document.attachments` so the original is retrievable.
- `createMode === 'CONFIRM'` is a later enhancement — for v1 always create as DRAFT and let the accountant confirm in the existing Posting-Review queue. (Consistent with the JSON ingestion feature which creates pending-GL docs for review.)

### 4.8 Admin API — `email-config.controller.ts` (Clerk-guarded)

Standard org-scoped CRUD used by the admin UI (§5). Guard these with the same admin permission the rest of `app/portal/admin/**` uses.

```
GET    /email-ingest/config/:orgId          → EmailIngestConfig (create default if missing)
PUT    /email-ingest/config/:orgId          → update (enabled, watchedSenders, routingMode, defaultDocType, createMode)
GET    /email-ingest/logs/:orgId?limit=50   → recent EmailIngestLog rows (audit feed)
GET    /email-ingest/address/:orgId         → computed inbound address string (for display/copy)
```

The inbound address is derived, not stored: `docs+${orgId}@${process.env.EMAIL_INGEST_DOMAIN}`.

### 4.9 Feature flag

Add `enableEmailIngestion: false` to `FEATURE_FLAG_DEFAULTS` in
`portal-production/app/portal/hooks/useOrganizationFeatures.ts`.
This gates whether the Email Ingestion admin tab (§5) is shown/active for an org. The per-org `EmailIngestConfig.enabled` is the *runtime* switch the webhook checks; the feature flag is the *product* switch that reveals the feature. (Both exist on purpose: flag = "this org bought the feature", config.enabled = "it's currently live".)

### 4.10 Env vars (backend)

```
EMAIL_INGEST_SECRET=<random 32+ char shared secret>   # webhook auth (like BILLS_INBOUND_SECRET)
EMAIL_INGEST_DOMAIN=inbound.osiris.<domain>           # domain we own for inbound addresses
# reuses existing: ANTHROPIC_API_KEY, AWS_* / RESOURCE_BUCKET, DATABASE_URL
```

---

## 5. Admin UI — how WE set this up for a customer

All of this goes in the existing admin org detail page:
`portal-production/app/portal/admin/organizations/[id]/page.tsx`
It already has a `<Tabs>` bar (Modules / Custom Fields / Documents / UI Configuration / Settings — see line ~1085). **Add a new tab: "Email Ingestion"** with an `<EmailIcon />`, and a matching `<TabPanel>`.

The admin flow is intentionally 3 fields + a copy button + a log. The goal is: an Osiris admin can turn this on for a client in under a minute.

### 5.1 Layout of the "Email Ingestion" tab

```
┌────────────────────────────────────────────────────────────────────┐
│  Email Ingestion — <Org Name>                    [ Enabled ● ]  ⓘ    │
│  Auto-import Bills / POs / Quotations that clients email in.         │
├────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ① The org's inbound address                                        │
│  ┌──────────────────────────────────────────────┐                   │
│  │  docs+8f3a...c21@inbound.osiris.co     [Copy] │                   │
│  └──────────────────────────────────────────────┘                   │
│  Tell the client to forward supplier emails here.                    │
│                                                                      │
│  ② Watched senders (allow-list)          [+ Add sender]              │
│  ┌──────────────────────────────────────────────┐                   │
│  │  accounts@supplierA.com              [✕]      │                   │
│  │  @supplierB.com    (whole domain)    [✕]      │                   │
│  └──────────────────────────────────────────────┘                   │
│  Leave empty to accept everything the client forwards.               │
│                                                                      │
│  ③ Document routing                                                 │
│    ( ) Let AI decide the type   [recommended]                        │
│    ( ) Always create as:  [ Bill  ▼ ]                                │
│    ( ) Use the address label (docs+org+bill@ …)                      │
│                                                                      │
│  ④ On import:  (•) Save as Draft (review first)  ( ) Auto-confirm    │
│                                                                      │
│  [ Save ]                                                            │
├────────────────────────────────────────────────────────────────────┤
│  ▸ How the client sets up forwarding   (collapsible, per provider)  │
│     Gmail:  Settings → Forwarding → add address → verify → filter…  │
│     Outlook: Rules → forward from <sender> → to <address>…          │
│     Yahoo:  Settings → filter → forward to <address>…               │
├────────────────────────────────────────────────────────────────────┤
│  Recent activity (last 50)                              [Refresh]    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ time      from                subject        status  docs   │    │
│  │ 10:32     accounts@supA.com   INV-8821       PARSED   1 →   │    │
│  │ 09:14     noreply@supB.com    Statement      IGNORED  —     │    │
│  │ 08:50     accounts@supA.com   PO 4471        PARSED   1 →   │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

### 5.2 Component behaviour

- **Enable toggle** (top-right `Switch`): writes `EmailIngestConfig.enabled`. When off, the webhook rejects with `ingestion-disabled`.
- **Inbound address** (`① `): read-only `TextField` + copy `IconButton`. Value from `GET /email-ingest/address/:orgId`. This is the single thing the admin hands to the client.
- **Watched senders** (`② `): an editable chip/list (`Autocomplete` free-solo or a simple list with add/remove — the page already imports `Chip`, `List`, `Autocomplete`). Stores `string[]` on `watchedSenders`. Accept either full emails or `@domain` entries; the backend matches both.
- **Routing** (`③ `): a `RadioGroup` → `routingMode` (`AI` / `FIXED` / `ADDRESS`). When `FIXED`, show the doc-type `Select` bound to `defaultDocType`.
- **On import** (`④ `): `RadioGroup` → `createMode` (`DRAFT` / `CONFIRM`). Default `DRAFT`. For v1 you can hard-lock this to DRAFT and mark CONFIRM "coming soon".
- **Save**: `PUT /email-ingest/config/:orgId`. Optimistic UI, toast on success. Match the existing page's save pattern (it already uses `request` helper + toasts elsewhere).
- **Setup instructions** (collapsible `Accordion`, already imported): static per-provider steps with the inbound address interpolated. This is copy-paste guidance the admin can send to the client. See §5.3.
- **Recent activity**: `GET /email-ingest/logs/:orgId`, a `Table` of `EmailIngestLog`. Status chip colors: PARSED=green, IGNORED=grey, FAILED=red. `docs` column links each `createdDocumentId` to the document editor. This is how the admin (and we) debug "why didn't my email come through" — the `reason` field tells them (`sender-not-watched`, `no-pdf`, `duplicate`, etc.).

> **Portal fetch gotcha (from memory):** every new portal fetch helper MUST inject `X-Active-Org-Id` from `sessionStorage("aims-admin-active-org")`, or admin "Viewing as <org>" silently returns home-org data. Use the existing `request` helper which already handles this — don't hand-roll `fetch`.

### 5.3 Client-facing setup copy (put in the Accordion)

> **To auto-import your documents into AIMS, forward them to:**
> `docs+<orgid>@inbound.osiris.co`
>
> **Gmail:** Settings → *See all settings* → *Forwarding and POP/IMAP* → *Add a forwarding address* → paste the address → Gmail sends a verification email (it'll appear in AIMS activity as an `IGNORED` "confirmation" — click the verify link) → then create a Filter: *From* `your suppliers` → *Forward it to* the address.
> **Outlook:** *Settings → Mail → Rules → Add new rule* → condition *From = supplier* → action *Forward to* the address.
> **Yahoo:** *Settings → More Settings → Filters → Add* → *From contains supplier* → *Forward to* the address (Yahoo Plus may be required for auto-forward).

(Optional nicety: detect provider verification emails in the webhook and surface the verify link in the activity log, like paylane does — nice-to-have, not v1.)

---

## 6. The inbound receiver (email → HTTPS POST)

We need something that receives mail at `docs+*@inbound.osiris.<domain>` and POSTs JSON to `POST /ingestion-email/email`. **Recommended: Cloudflare Email Workers (free).**

> **Pick exactly ONE receiver. CloudMailin is NOT required** — it's just the paid option the paylane project happened to use. We are using **Cloudflare Email Workers ($0)** instead. Whichever one is chosen, it produces the same JSON payload, so the AIMS backend and admin UI are identical regardless. This choice only affects the small receiver script + DNS/MX setup below — nothing else in the plan.
>
> Note this is only *our* side of the pipe. The client still sets up a **forwarding rule in their own mailbox** (Gmail/Outlook/Yahoo) either way — that's inherent to the forwarding approach and unavoidable, see §5.3.

### 6.1 Cloudflare Email Workers (recommended, $0)

1. Add the domain to Cloudflare, enable **Email Routing**.
2. Add a catch-all route for `*@inbound.osiris.<domain>` → send to a Worker.
3. Worker parses the MIME (use `postal-mime` npm package in the Worker) and POSTs our JSON shape with attachments base64-encoded.

Worker sketch:
```js
import PostalMime from 'postal-mime';

export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw);
    const attachments = (parsed.attachments || []).map(a => ({
      contentType: a.mimeType,
      filename: a.filename,
      contentBase64: Buffer.from(a.content).toString('base64'),
    }));
    await fetch(`${env.AIMS_API}/ingestion-email/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': env.EMAIL_INGEST_SECRET },
      body: JSON.stringify({
        from: message.from,
        to: message.to,                         // docs+{orgId}@...
        subject: parsed.subject,
        messageId: parsed.messageId,
        text: parsed.text,
        attachments,
      }),
    });
  }
};
```
Worker secrets: `AIMS_API`, `EMAIL_INGEST_SECRET` (must match backend).

### 6.2 Alternatives (only if we ever move off Cloudflare — not needed now)

- **SendGrid Inbound Parse** — free within a SendGrid account; posts multipart form-data (you'd adapt the DTO parsing). MX record → `mx.sendgrid.net`.
- **CloudMailin** — **NOT used / not required.** Paid (~$9/mo), most turnkey; posts "Multipart Normalized" JSON. Listed only because the paylane project uses it, as a reference. Ignore unless we deliberately switch.

Whichever provider: it just needs to produce `{ from, to, subject, messageId, attachments:[{contentType, contentBase64, filename}] }`. Keep the DTO the single contract so the provider is swappable.

### 6.3 DNS

- Pick and own a subdomain, e.g. `inbound.osiris.co`.
- Point its MX records at the chosen provider (Cloudflare Email Routing / SendGrid / CloudMailin).
- `EMAIL_INGEST_DOMAIN` on the backend must equal this subdomain.

---

## 7. Security

- **Shared secret** `EMAIL_INGEST_SECRET` on every webhook call; fail closed if unset (copy the exact guard from `bills-inbound.controller.ts` / `ingestion.controller.ts`).
- **Org from address, validated against DB** — never trust an org id that doesn't resolve to a real `Organization`.
- **Sender allow-list** (`watchedSenders`) is defense-in-depth against a leaked inbound address being spammed. Recommend admins set it for each client.
- **Anyone who learns the inbound address can POST forwarded mail** — but they still can't pass the shared secret directly (they can only go through the mail path), and the sender allow-list + DRAFT mode mean junk lands as a rejected log entry or an unconfirmed draft, never a posted document. Do **not** auto-confirm/auto-post in v1.
- **Attachment safety:** only accept `application/pdf` and `image/*`; cap size (match `document-extraction`'s 10MB limit); ignore everything else.
- **Rate/abuse:** rely on the provider + the dedup unique constraint. Optionally cap logs per org per hour.
- **PII:** attachments go to the existing S3 bucket under `email-ingest/{orgId}/…`; reuse `S3Service` (private bucket + signed URLs for reads).

---

## 8. Build checklist (suggested order)

**Phase 1 — backend core**
- [ ] Add `EmailIngestConfig` + `EmailIngestLog` models + Organization relations; `npm run db:push`.
- [ ] Scaffold `src/ingestion-email/` module (controller + service + DTO).
- [ ] Implement `handleInbound()` per §4.4 — start with BILL-only (reuse bills path), get one real forwarded email working end-to-end.
- [ ] Add generic-type routing (§4.5) + `createFromExtraction` for PO/QUOTATION (§4.7).
- [ ] Wire dedup via `EmailIngestLog` unique constraint (§4.4 step 6).
- [ ] Add `EMAIL_INGEST_SECRET`, `EMAIL_INGEST_DOMAIN` env vars.
- [ ] New-module permissions: grant any new `resource:action` perms to superadmin + Admin roles in every org (per project convention) — or reuse existing admin perms for the config controller so no new perm is needed.

**Phase 2 — inbound receiver + DNS**
- [ ] Stand up the subdomain + MX records.
- [ ] Deploy the Cloudflare Email Worker (§6.1); set its secrets.
- [ ] Test: forward a real supplier PDF → confirm a draft Document appears and an `EmailIngestLog` PARSED row is written.

**Phase 3 — admin UI**
- [ ] Add `enableEmailIngestion` to `FEATURE_FLAG_DEFAULTS`.
- [ ] Add admin config endpoints (§4.8).
- [ ] Add the "Email Ingestion" tab + panel to the org detail page (§5).
- [ ] Add the activity-log table + per-provider setup Accordion.

**Phase 4 — hardening / nice-to-haves**
- [ ] Provider verification-email detection → surface verify link in the log.
- [ ] `createMode: CONFIRM` (auto-confirm) option.
- [ ] Address-label routing (`docs+{org}+bill@`).
- [ ] Push notification to org on new ingested doc (there's a `PushNotification` mechanism referenced in the stack).

---

## 9. Open questions to confirm before building

1. **Domain** — which subdomain do we own/want for inbound (`inbound.osiris.co`? something else)? Needed for `EMAIL_INGEST_DOMAIN` + MX.
2. **Provider** — default is **Cloudflare Email Workers (free)**; confirm we're not using CloudMailin. Only revisit if Cloudflare Email Routing can't be enabled on our domain. Decides the receiver code + DNS.
3. **Default routing** — is "let AI classify" the right default, or do most clients send only bills (→ default `FIXED`/`BILL`)?
4. **Multiple attachments per email** — process all, or only the first PDF? (Plan assumes all; bills-inbound today does only the first.)
5. **Auto-confirm** — is DRAFT-only acceptable for v1? (Recommended yes; auto-post is risky.)
6. **Non-document emails** — silently log-and-ignore (plan) vs notify the admin?

---

## 10. TL;DR for the dev

Generalize `src/bills/bills-inbound.controller.ts` into a config-driven, multi-type, multi-attachment webhook in a new `src/ingestion-email/` module. Reuse `extractFromFile` / `extractForReconciliation` (Claude) → `S3Service.uploadFile` → `createFromExtraction`. Add two Prisma models (`EmailIngestConfig`, `EmailIngestLog`). Stand up a free Cloudflare Email Worker that POSTs forwarded mail to it. Add an "Email Ingestion" tab to the admin org page with: the inbound address (copy button), watched-senders list, routing radio, draft/confirm radio, and an activity log. No IMAP, no Gmail/Graph API, no cron. Everything is push-based and reuses existing AIMS building blocks.
