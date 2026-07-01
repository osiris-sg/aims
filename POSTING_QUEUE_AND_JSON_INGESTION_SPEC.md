# Spec — JSON Batch Ingestion + Accountant Posting-Review Queue + Batch Post

**Status:** NOT built. This document is the implementation spec for the next agent.
**Author context:** written 2026-07-01 during the Biofuel Xero-takeover work.
**Org driving this:** Biofuel Industries Pte Ltd (weighbridge disposal invoices), but build it generic/per-org.

---

## 1. What we're building (three linked features)

1. **JSON Batch Ingestion** — an endpoint that accepts a batch of invoices as JSON (e.g. the weighbridge `prepaid_daily` payload below), creates AIMS `Document(type='INVOICE')` rows, **but does NOT post them to the GL**. They land in a "pending posting" state.
2. **Posting-Review Queue** — an accountant-facing screen listing every invoice that is **created but not yet posted to the GL**, with the AI Dr/Cr preview so the accountant can review before posting.
3. **Batch Post** — the accountant selects many (or all) queued invoices and posts them to the GL in one action.

**The whole point:** a non-accountant (or an automated feed) creates invoices; the accountant reviews and posts them to the GL later. This is the "Model B / posting queue" pattern from memory `accountant-posting-review-direction.md`.

---

## 2. How AIMS posting works TODAY (and what to reuse — do NOT rebuild)

- **Every document lives in the unified `Document` table** (`type` discriminator, rich data in `config` JSON). Never make a per-type table. See memory `document-table-is-canonical`.
- **Invoices currently AUTO-POST on confirm.** `documents.service.ts → confirmInvoice()` (~line 3200+) calls `journalAutoPost.postFromInvoice(...)` immediately. We must add a path that creates the invoice WITHOUT calling that.
- **Reuse these (already built):**
  - `src/journal/journal-auto-post.service.ts`
    - `postFromInvoice({ organizationId, documentId, invoiceNumber, entryDate, customerName, netAmount, taxAmount, grossAmount, userId })` → creates the balanced JE **Dr Accounts Receivable / Cr Revenue / Cr GST** and returns it. **This is the exact call Batch Post makes per invoice.**
    - `alreadyPostedForDocument(organizationId, documentId, type)` → returns an existing non-void JE for the doc, or null. **Use for idempotency** (never double-post).
  - `src/posting-preview/posting-preview.service.ts` + `POST /posting-preview` (controller) → returns the AI-suggested Dr/Cr entry for a draft document WITHOUT posting. Body: `{ type, lines[], taxAmount, totalAmount, documentNumber }`. **Reuse this to show the accountant the proposed entry in the queue.**
  - `portal-production/components/PostingPreviewDialog.tsx` → shared editable Dr/Cr review dialog (used by bills + invoices). **Reuse in the queue.**
  - `src/anomalies/anomalies.service.ts` → already has a "confirmed invoices with no matching POSTED journal entry" detector. **The queue is the full, actionable version of that signal.**
- **Control accounts** come from `AccountingSetting.controlAccounts` (debtorControl / taxLiabilities / salesAccount). `postFromInvoice` already resolves these.
- **New-module permission gotcha:** any new backend module needs `resource:action` perms granted to superadmin + Admin + Manager roles in every org, or users hit 403. See memory `feedback_new-module-permissions`.

---

## 3. Data model — how to mark "created but not posted"

**Do NOT add a value to the `DocumentStatus` enum** (it's the operational/delivery lifecycle: draft, confirmed, pending_payment, paid, …). Track GL posting separately.

Add to each invoice's `config`:
```jsonc
{
  "glPosting": {
    "status": "pending",        // "pending" | "posted" | "rejected"
    "journalEntryId": null,      // set when posted
    "postedAt": null, "postedBy": null,
    "rejectedAt": null, "rejectedBy": null, "rejectReason": null,
    "source": "weighbridge_json" // or "manual", "ui", etc.
  }
}
```

**"Unposted" definition for the queue** (be robust — use both):
- `config.glPosting.status == 'pending'`, AND
- no non-void `JournalEntry` with `sourceDocumentId == document.id` (double-check via `alreadyPostedForDocument`).

**Org toggle (recommended):** add `AccountingSetting.requirePostingApproval: Boolean @default(false)` (additive schema; run `db:push` per memory `feedback_run-db-push-after-schema`). When ON, the normal `confirmInvoice()` flow ALSO stops auto-posting and routes to the queue (sets `glPosting.status='pending'` instead of calling `postFromInvoice`). When OFF, current auto-post behavior is unchanged. **JSON ingestion always creates `pending` regardless of this flag.**

**Optional `IngestBatch` table** (nice-to-have, not required — can also just tag each invoice's config): `{ id, organizationId, type, date, sentAt, totalInvoices, grandTotal Json, createdAt }`, and stamp `config.ingestBatchId` on each invoice for grouping in the UI.

---

## 4. Feature A — JSON Batch Ingestion

### Endpoint
`POST /invoices/ingest-batch` (or `/documents/ingest-batch`) — Permissions `invoices:create` (or a new `posting:ingest`). Accept the payload, create invoices, return a summary.

### Request payload (the weighbridge `prepaid_daily` shape)
```jsonc
{
  "type": "prepaid_daily",
  "date": "2026-06-26",
  "sentAt": "2026-06-28T06:00:00+08:00",
  "platform": { "name": "Biofuel Industries Pte. Ltd.", "uen": "200303416N", "address": "...", "contactNumber": "..." },
  "invoices": [
    {
      "transactionId": "2959be51-...",           // UNIQUE — idempotency key
      "invoiceNumber": "BIPL-JPSG-INV-20260626-0054",
      "client": { "name": "SHENGYI DEVELOPMENT SG PTE LTD.", "uen": "201917012D", "address": "...", "attention": "Zhong Kun", "mobile": "9368 6044", "email": "..." },
      "subClient": null,
      "licensePlate": "XD6280M",
      "materialType": "Mixed Soil",
      "entryWeightKg": 28510, "exitWeightKg": 11500, "disposedWeightKg": 17010, "chargedWeightKg": 17010,
      "ratePerTonne": 18.00,
      "subtotal": 306.18, "gstAmount": 27.56, "totalCharge": 333.74,
      "timestamp": "26/06/2026, 14:50"
    }
    // ... up to totalInvoices
  ],
  "totalInvoices": 19,
  "grandTotal": { "subtotal": 5957.28, "gst": 536.16, "total": 6493.44 }
}
```

### Per-invoice mapping → `Document(type='INVOICE')`
- `name` = `invoiceNumber`.
- `status` = `'confirmed'` (created and confirmed operationally, just not GL-posted).
- `documentTemplateId` = the org's INVOICE template (resolve/auto-create like `bills.service.getOrCreateBillTemplate` does for bills; there's an existing INVOICE template id used by the Xero importer — see `scripts/xero-migration/02-sales-invoices.ts`).
- `config`:
  - `date` = `date` (batch date) → ISO.
  - `customer` = `{ id, name }`, `customerId` = resolved AIMS customer (see resolution below).
  - `items` = **one line**:
    - `description` = e.g. `"{materialType} disposal — {chargedWeightKg} kg @ ${ratePerTonne}/tonne (plate {licensePlate})"`.
    - `quantity` = `chargedWeightKg / 1000` (tonnes), `unitPrice` = `ratePerTonne`, `amount` = `subtotal`.
    - `taxAmount` = `gstAmount`.
    - `accountCode` = a **disposal-revenue account** — make configurable per org (e.g. `AccountingSetting.controlAccounts.disposalRevenue` or default to `salesAccount`). For Biofuel, likely `209 "Sales - Disposable of waste materials"` — confirm with the user, don't hardcode blindly.
  - `subtotal`, `taxAmount` (= gstAmount), `totalAmount` (= totalCharge), `gstPercent` (derive: round(gst/subtotal*100)).
  - Weighbridge metadata (keep for audit): `weighbridge = { transactionId, licensePlate, materialType, entryWeightKg, exitWeightKg, disposedWeightKg, chargedWeightKg, ratePerTonne, timestamp }`.
  - `glPosting = { status: 'pending', source: 'weighbridge_json' }` (per §3).
  - `ingestBatchId` (if using the batch table) or `ingestBatch = { type, date, sentAt }`.
  - `xeroImported: false` (these are AIMS-native, not from Xero).

### Customer resolution
- Match AIMS `Customer` by **UEN first** (client.uen → `Customer.registrationNumber`/UEN field — check the model; add a UEN field if missing), then by **name** (case-insensitive, tolerant of punctuation — reuse the fuzzy approach in `bills.service.matchSupplier`).
- If none found, **create** the customer from the client block (name, uen, address, attention, mobile, email). Stamp its details.
- Cache resolved customers within the batch to avoid duplicate creates.

### Idempotency
- Upsert by `config.weighbridge.transactionId` (preferred) OR `name == invoiceNumber`.
- Re-running the same batch must **update in place, not duplicate** (mirror the Xero importer's upsert-by-id pattern in `02-sales-invoices.ts`).

### Response
`{ batchId?, totalInvoices, created, updated, skipped, failed, errors: [...] }`.

### Do NOT
- Do **not** call `postFromInvoice` here. These invoices are `glPosting.status='pending'` and wait for the queue.

---

## 5. Feature B — Posting-Review Queue (accountant screen)

### Backend
`GET /posting-queue` — Permissions `journal:read` (or new `posting:review`). Returns invoices (and later bills/CN) that are **unposted** (§3), newest first, with:
- `id, name, date, customerName, subtotal, taxAmount, totalAmount, status, glPosting, ingestBatch, source`.
- Support filters: `type` (INVOICE/BILL/CN), `batchId`, `from/to` date, `search`.
- Pagination.

Per-row **AI preview on demand:** the UI calls the existing `POST /posting-preview` with `{ type:'INVOICE', documentNumber, taxAmount, totalAmount, lines }` from the invoice's config to show the proposed **Dr AR / Cr Revenue / Cr GST** entry. (Revenue account per line via the AI, as already built.)

### Frontend
- New page under **Accounting → Accounts Receivable** (or a dedicated **"Posting Queue"** submenu). Follow the section pattern in `app/portal/accounting/_lib/AccountingReportsView.tsx` and the redesigned GL page for styling.
- Table: checkbox (multi-select), Invoice #, Date, Customer, Amount, Source/Batch, a **"Review"** button that opens the shared `PostingPreviewDialog` (already built), and a status chip (Pending/Posted/Rejected).
- Group by ingest batch (collapsible) when `ingestBatchId` present — shows the daily batch (e.g. "prepaid_daily 2026-06-26 · 19 invoices · $6,493.44").
- Bulk action bar: **"Post selected"**, **"Post all in batch"**, **"Reject"**.

---

## 6. Feature C — Batch Post

### Endpoint
`POST /posting-queue/post-batch` — Permissions `journal:post` (or `posting:approve`). Body `{ documentIds: string[] }` (or `{ batchId }` to post a whole batch).

### Logic (per document, sequential or small-concurrency)
1. Load the invoice; verify org scope + it's `type='INVOICE'` + `glPosting.status != 'posted'`.
2. **Idempotency:** `alreadyPostedForDocument(org, docId, 'INVOICE')` — if a non-void JE exists, skip (mark posted, don't double-post).
3. Compute net/tax/gross from `config` (prefer explicit `subtotal`/`taxAmount`/`totalAmount`; fall back to summing items — mirror the logic already in `confirmInvoice()`).
4. Call `journalAutoPost.postFromInvoice({ organizationId, documentId, invoiceNumber, entryDate: config.date, customerName, netAmount, taxAmount, grossAmount, userId })`.
   - **If the accountant edited accounts in the Review dialog**, write those per-line accountCodes back onto `config.items` before posting so the JE uses them. (NOTE: `postFromInvoice` currently credits a SINGLE sales account and ignores per-line `accountCode` — see memory `auto-post-double-entry-issues` item #2. For this feature to honor the reviewed per-line accounts, EITHER extend `postFromInvoice` to post per-line by account, OR post a manual JE built from the reviewed preview lines. Decide with the user; per-line posting is the correct end state.)
5. On success: set `config.glPosting = { status:'posted', journalEntryId, postedAt, postedBy }`.
6. Collect per-invoice result.

### Response
`{ total, posted, skipped, failed, results: [{ documentId, invoiceNumber, ok, journalEntryId?, error? }] }`. Partial failures must NOT abort the whole batch — post what can post, report the rest.

### Reject / hold
`POST /posting-queue/:id/reject` `{ reason }` → set `glPosting.status='rejected'`. Rejected invoices leave the active queue but remain auditable.

---

## 7. Permissions
Add and grant (to superadmin + Admin + Manager in EVERY org — see memory `feedback_new-module-permissions`; reuse `scripts/grant-accounting-perms-biofuel-roles.ts` as the pattern):
- `posting:ingest` (or reuse `invoices:create`) — JSON ingestion.
- `posting:review` (or reuse `journal:read`) — see the queue.
- `posting:approve` (or reuse `journal:post`) — batch post / reject.

---

## 8. Edge cases & rules
- **Idempotent ingestion** (re-send safe) and **idempotent posting** (`alreadyPostedForDocument`).
- **Never double-post**; posting a already-posted invoice is a no-op.
- **Balanced check:** `postFromInvoice` already enforces Dr=Cr; if net+tax≠gross, surface a warning in the preview (the preview service already returns `warnings` + `balanced`).
- **Zero/negative amounts:** skip posting `gross <= 0` (postFromInvoice already guards).
- **Missing control accounts:** postFromInvoice returns null + logs; surface as a per-invoice failure, don't crash the batch.
- **Voided later:** voiding a posted invoice's JE should flip `glPosting.status` back appropriately (reuse existing void flow).
- **Multi-tenant:** everything org-scoped; respect the admin "Viewing as <org>" header (memory `portal-fetch-active-org-header`).

---

## 9. Acceptance criteria
1. `POST /invoices/ingest-batch` with the sample payload creates 19 `Document(INVOICE)` rows, all `glPosting.status='pending'`, correct customer resolution, correct amounts (subtotal/gst/total), **and no JournalEntry is created**.
2. Re-posting the same batch updates in place (still 19, no duplicates).
3. The Posting Queue lists those 19 (grouped as the 2026-06-26 batch), each with a working AI Dr/Cr preview.
4. Selecting all + "Post" creates 19 balanced JEs (Dr AR / Cr Revenue / Cr GST), sets each `glPosting.status='posted'` with its `journalEntryId`, and the invoices leave the queue.
5. Re-running the batch post is a no-op (idempotent).
6. Trial Balance / AR aging reflect the new postings; GL balances (Dr=Cr).
7. Reject moves an invoice out of the queue with an audit trail.

---

## 10. Key files to read/reuse
- `src/journal/journal-auto-post.service.ts` — `postFromInvoice`, `alreadyPostedForDocument`.
- `src/posting-preview/posting-preview.service.ts` + `posting-preview.controller.ts` — AI Dr/Cr preview (`POST /posting-preview`).
- `portal-production/components/PostingPreviewDialog.tsx` — shared review dialog.
- `src/documents/documents.service.ts` — `confirmInvoice()` (current auto-post; mirror the amount computation), `create/update` for Documents.
- `scripts/xero-migration/02-sales-invoices.ts` — invoice→Document(config) mapping + upsert-by-id pattern + INVOICE template id.
- `src/bills/bills.service.ts` — `matchSupplier` (fuzzy contact match to reuse for customers), `getOrCreateBillTemplate` (template auto-create pattern), `previewPosting`.
- `src/anomalies/anomalies.service.ts` — the "confirmed but not posted" detector (the queue's seed).
- `src/accounting/accounting-settings.*` — where to add `requirePostingApproval` + a `disposalRevenue` control account.
- Nav: `api-server-production/src/configuration/module-catalog.ts` (ACCOUNTING submenus) + `app/portal/accounting/_lib/AccountingReportsView.tsx`.

## 11. Related memory notes
- `accountant-posting-review-direction` — the design rationale (non-accountant creates → accountant posts).
- `auto-post-double-entry-issues` — #2 (per-line account posting) is directly relevant to Feature C step 4.
- `document-table-is-canonical`, `feedback_new-module-permissions`, `feedback_run-db-push-after-schema`, `portal-fetch-active-org-header`.
