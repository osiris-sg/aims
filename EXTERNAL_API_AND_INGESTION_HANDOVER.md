# External API & Document Ingestion — Handover

**Written:** 2026-07-23 · **Author context:** agent that built the weighbridge ingestion (Feature A), the Posting Queue (B/C), and the external /v1 API.
**Audience:** the next agent taking over this area. Read alongside `POSTING_QUEUE_AND_JSON_INGESTION_SPEC.md` (the original spec, partially superseded by what's actually built).

---

## 1. The big picture — three ways documents enter AIMS from outside

| Path | Route | Auth | Org scope | Status |
|---|---|---|---|---|
| **A. Bespoke Biofuel ingestion** | `POST /ingestion/invoices/ingest-batch` | `X-Ingest-Token` header vs env `INGEST_API_TOKEN` (one global secret) | Hardcoded Biofuel (`52e90ba8-bfbd-48b0-bb76-4f9667bf74f1`), payload must carry `platform.uen=200303416N` | **SHIPPED** (prod, tested) |
| **B. Generic external /v1 API** | `POST /v1/documents` (+ GETs) | Per-org DB `ApiKey` (`Authorization: Bearer aims_…` or `X-Api-Key`) | Key **is** the org | **BUILT on dev, UNCOMMITTED** (2026-07-23) |
| **C. Email ingestion** | `docs+{org}@` inbound webhook | webhook secret | per-address | **OFF-LIMITS — guru's explicit boundary (2026-07-23): do NOT touch, migrate, or fold this path into anything.** |

All three converge on the same core model: documents land in the unified `Document` table (never per-type tables), and **GL posting is deferred** — documents carry `config.glPosting.status='pending'` and wait in the accountant **Posting Queue** unless explicitly auto-posted.

There is also `src/public-api/` — **do not confuse it with the /v1 API**. That is the water-sg pull API (env shared secret `WATER_SG_INBOUND_API_KEY`, read-only SIDS units). Different trust model, different owner. Leave it alone.

---

## 2. Prepaid vs postpaid — the business model that drives the accounting

Biofuel's weighbridge/JPSG platform bills clients under two commercial models. **This distinction decides what GL entries a document needs.**

### Prepaid (`type: "prepaid_daily"` — the shipped feed)
Clients top up **account credits in advance**; each disposal/JP-pass transaction is deducted from those credits. The daily invoice batch says *"This amount has been deducted from your account credits"* — i.e. **the money is already collected when the invoice reaches AIMS.**

Accounting consequence — a prepaid document needs **two** entries (design locked with guru 2026-07-23, NOT yet built):
1. **Revenue**: `Dr 610 Accounts Receivable / Cr revenue (+ Cr 820 GST if taxed)`
2. **Settlement** in the same queue-post action, split by payment rail:
   `Dr 106-1 Airwallex (greenCharged) + Dr <bank acct — TBD> (redCharged) / Cr 610 AR`
   → AR nets to zero; cash sits in the correct asset account per rail.

**green/red semantics (guru, 2026-07-23):** `greenCharged` = collected via **Airwallex** → account `106-1 Airwallex`. `redCharged` = collected by **bank transfer** → bank account **guru has NOT yet named** (candidates: 100 OCBC, 101 HLB, 102 StanChart, 104 UOB; may vary). Airwallex fees have their own expense account `405`.

**Open nuance:** Biofuel's chart has per-customer deposit accounts (`CD000` control + `CD001–CD022`, CURRENT_ASSET). Because prepaid invoices consume *credits*, the settlement may need to run through the customer's CD account rather than (or in addition to) the bank rails. **Ask guru/the accountant for the exact Dr/Cr before building** — do not guess.

### Postpaid (`type: "postpaid_consolidated"` — SPEC PROVIDED 2026-07-23, not yet built)
The invoice-first model: client is billed for a **whole period** (e.g. weekly), pays later. Sample saved at `src/ingestion/sample-payload.postpaid_consolidated.json`. Key structural differences vs the daily batches:
- **ONE consolidated invoice per request** (no `invoices[]` array): `invoice{ invoiceNumber, invoiceDate, periodFrom, periodTo, currency }` + one `client`.
- Lines = `materialSummaries[]` (`description, qtyTonnes, rate, gstPercent, subtotal, gst, amount`); `dailyBreakdowns[]` is a per-day appendix (`date, items[{materialType, tonnes, loads}]`) for the invoice rendering; `transportSummaries` nullable; `totals`; `transactionCount` (underlying weighbridge txns, e.g. 337).
- **Dates are `DD/MM/YYYY`** (not ISO) — parse accordingly.
- **Idempotency key = `invoiceNumber`** (no transactionId).
- **`paymentMethod`** (`"bank_transfer"` | `"airwallex"`) replaces the green/red split — the money is NOT collected yet; it's the expected rail.
- Accounting = revenue entry only; **AR stays open** until a real payment arrives (normal payments flow / bank rec). No settlement JE at posting time.
- Rendering: needs its own consolidated invoice layout (period header, material summary lines, daily-breakdown table) — a new template variant, NOT the per-transaction JPSG one. Not designed yet.

### Current state of the shipped ingestion vs this design
The shipped weighbridge ingestion (path A) currently creates the invoice **only** (revenue side, pending in the queue). The split-settlement (2nd JE) is **designed but unbuilt** — blocked on guru naming the red-rail bank account and resolving the CD-deposit question. Scope decision: split settlement applies to **both** prepaid feeds (weighbridge + JP passes).

---

## 3. Path A — Biofuel weighbridge ingestion (shipped)

**Files:** `api-server-production/src/ingestion/` (`ingestion.controller.ts`, `ingestion.service.ts`, `dto/ingest-batch.dto.ts`, `sample-payload.prepaid_daily.json` = real payload sample).

**Flow per invoice in the batch:**
1. Validate envelope (`platform.uen` must be Biofuel's; anything else → 400).
2. Resolve customer: UEN → `Customer.gstRegNo` (case-insensitive) → fuzzy name (normalize → strip Pte/Ltd suffixes → substring/Jaccard, accept ≥0.6, same algorithm as `bills.matchSupplier`) → **create** (client's `attention/mobile/email` go on a primary `CustomerContact`, NOT on the Customer's own fields — guru's rule).
3. Build `Document(type='INVOICE', status='confirmed')` with:
   - **JPSG item keys** (`vehicleNo`, `vehicleTimestamp`, `materialType`, `weightT`, `unitRate`, `minLoad`, `amount`) for the bespoke render, **plus** standard keys (`description/quantity/unitPrice/amount/taxAmount/accountCode`) for GL posting.
   - `accountCode: '209'` ("Sales - Disposable of waste materials") on every line.
   - Canonical totals `subTotal` / `gstAmount` / `nettTotal` (these exact names — the posting flow reads them).
   - `glPosting: { status:'pending', source:'weighbridge_json' }` — **no JE is created at ingestion.**
4. **Field-name gotchas (real feed)**: per-invoice subtotal arrives as **`soilSubtotal`** (legacy `subtotal` kept as fallback); min-load arrives as **`minLoadKg`** (÷1000 → the `Min. Load (T)` column; legacy `minLoadTonnes` fallback). `pickupLocation`/`transport` are preserved in the `weighbridge` audit block. `transport` (optional extra charge, `total = soilSubtotal + transport + gst`) is stored but **not yet given its own line/account**.
5. **Idempotency**: upsert keyed on `config.weighbridge.transactionId`, falling back to invoice `name`. Re-sending a batch updates in place; an already-**posted** invoice's `glPosting` is never clobbered.

**Rendering:** invoices point at the JPSG template (`DocumentTemplate.templateVariant='JPSG_DISPOSAL'`, resolved by variant, ids differ per DB — seeded in dev/staging/prod via `scripts/create-jpsg-invoice-template.ts`, idempotent). The custom columns render via a dedicated branch in `portal-production/containers/DocumentTemplates/components/CleanDocumentPreview.tsx` (trigger: `documentType==='JPSG_DISPOSAL' || tableColumnOrder.includes('vehicleNo')`), inside the TI2/INVOICE block. Field definitions for the editor live under the `JPSG_DISPOSAL` key in `src/documentTemplates/templateFieldDefinitions.ts`.

**Env:** `INGEST_API_TOKEN` must be set per environment (dev `.env` has one; prod/staging set in Render).

### JP passes (`jp_passes_daily`) — PARKED, partially spec'd
Second payload type for the same feed. Sample + all decisions in memory note `jp-passes-ingestion-plan`. Locked: same endpoint branching on `payload.type`; Biofuel; **GST-exempt**; idempotency key `ledgerEntryId`; split settlement per §2. Still open (guru to name): red-rail bank account, JP-pass revenue account, invoice-number source (payload has no `invoiceNumber`). Payload shape: `items[]` with `client{name,uen}`, `description`, `quantity`, `unitPrice`, `totalAmount`, `greenCharged`, `redCharged`, `timestamp`.

---

## 4. Path B — external /v1 API (built on dev, uncommitted)

**Files:** `api-server-production/src/api-v1/` — `api-v1-key.guard.ts`, `api-keys.service.ts`, `api-keys.admin.controller.ts`, `v1-documents.controller.ts`, `v1-documents.service.ts`, `dto/v1-document.dto.ts` (Swagger-annotated classes). Registered in `app.module.ts`.

### Auth model
- `ApiKey` Prisma table (pushed to dev): `organizationId`, `name`, `prefix`, `keyHash` (**sha256 only — plaintext never stored, shown once at mint**), `scopes[]` (default `documents:create`, `documents:read`), **`autoPost`**, `lastUsedAt`, `revokedAt`.
- v1 routes are `@Public()` (skips the global ClerkAuthGuard) then guarded by `ApiV1KeyGuard`, which injects `req.userOrganization = {id, name}` — the exact shape Clerk-guarded controllers use, so downstream services need zero changes. `RequireScope('…')` decorator per endpoint.
- Admin management: `/admin/organizations/:orgId/api-keys` (GET/POST/PATCH/`:id/revoke`), Clerk + `req.isOsirisAdmin` (AdminController pattern). Portal UI: **"API Keys" tab** on the admin org page (`app/portal/admin/organizations/[id]/ApiKeysTab.tsx`, mirrors EmailIngestionTab). Feature flag `enableExternalApi` exists in `FEATURE_FLAG_DEFAULTS` (product switch; the real gate is key existence).

### Endpoints & contract
- `POST /v1/documents` — types **INVOICE / BILL / CREDIT_NOTE** (aliases CN, TI). Canonical payload (see Swagger at `/api`, fully schema'd with examples): `type`, `externalId` (idempotency), `number` (omit → auto-numbered via `DocumentNumberingService`; 400 if the org has no format for the type), `date`, `customer`/`supplier` party block, `lines[{description, quantity, unitPrice, amount, taxAmount}]`, `taxAmount`, `totalAmount`, `metadata`.
- **`accountCode` is deliberately NOT in the external contract** (guru, 2026-07-23): GL accounts are an internal concern. External lines land uncoded (`accountCode: null`); accounts come from the AI/learned suggestion engine + accountant review in the Posting Queue. Any accountCode an external caller sends is silently ignored.
- `GET /v1/documents/:id`, `GET /v1/documents?type=&search=&page=&limit=` — read-back incl. `glPosting` state.
- Responses wrapped by the app interceptor: `{success, data, message}`. `data.outcome` = `created` | `updated` | `skipped`.

### Behavior by type
- **INVOICE / CREDIT_NOTE**: customer resolve-or-create (same rules as path A) → `Document` with canonical totals + `glPosting: pending` (source `api-key:<name>`) → Posting Queue. Template resolved: `OrganizationActiveTemplate` (primary first) → legacy `isActive` → any → auto-create minimal.
- **BILL**: supplier resolve-or-create → `BillsService.create()` (DRAFT, normal AP lifecycle); lines go in uncoded — the AP review assigns accounts. Re-send on a posted bill → `outcome: 'skipped'`.
- **Idempotency**: `config.externalApi.externalId` first, then document number. Posted docs never clobbered.
- **`autoPost` per key** (default OFF): ON ⇒ INVOICE first resolves per-line accounts via `PostingPreviewService.preview` (AI + learned AccountMemory — the same engine behind the accountant's review dialog), stamps them via `postingQueue.applyAccounts`, then posts per-line; CN via `journalAutoPost.postFromCreditNote`; BILL via `bills.post()` (uncoded lines fall back to the first PURCHASE account — acceptable because autoPost bills are an edge case). Posting failures degrade gracefully (`posting.status:'pending'` + `error` in response — the request itself still succeeds).

### Verified on dev (Test Org `7e570e60-…`)
create→pending ✓, idempotent re-send ✓, 401 bad key ✓, bill draft + supplier auto-create ✓, CN queues ✓, autoPost → balanced per-line JE `Dr 610 / Cr 209 / Cr 820` ✓. Admin tab **not yet visually verified** (browser was signed out).

---

## 5. The Posting Queue (the accountant gate everything flows into)

**Backend** `src/posting-queue/` · **UI** `app/portal/accounting/posting-queue/page.tsx` (Accounting sidebar → "Posting Queue"). Shipped (commit `cbeca7d`).

- `GET /posting-queue` — pending `INVOICE` **and** `CREDIT_NOTE` (CN support added with /v1, uncommitted), grouped by ingest batch in the UI.
- `GET /posting-queue/:id/preview` — reuses `PostingPreviewService` (AI + learned AccountMemory suggestions) → editable Dr/Cr dialog (`PostingPreviewDialog`, `onLearn` → `/posting-preview/learn` side `SALES`).
- `POST /posting-queue/:id/accounts` — persists accountant's account picks onto `config.items[].accountCode`.
- `POST /posting-queue/post-batch` `{documentIds[]}` — per doc: idempotency via `alreadyPostedForDocument`; INVOICE → **per-line JE** (`Dr debtorControl gross / Cr each line's accountCode / Cr taxLiabilities`) via `journal.create(..., {autoPost:true})`; CREDIT_NOTE → `postFromCreditNote` (reversed). Partial failures never abort the batch. Stamps `glPosting={status:'posted', journalEntryId, postedAt}`.
- `POST /posting-queue/:id/reject` — `glPosting.status='rejected'` + reason (audit stays).

**Why per-line matters:** Biofuel's `AccountingSetting.controlAccounts` has **no `salesAccount`**, so the older single-account `postFromInvoice` would fall back to the first SALES account (200 — wrong). The queue's per-line path posts each line to its own `accountCode` (209 for disposal). Control accounts: debtor `610`, tax `820`.

**`glPosting` states:** `pending` → (`posted` | `rejected`). Absence of the key = ordinary AIMS document (auto-posted on confirm via the legacy flow).

---

## 6. Gotchas the next agent WILL hit

1. **TS4053**: a controller method whose inferred return type references a non-exported interface breaks the build (`Return type … cannot be named`). Export every interface a service returns. Hit twice already (`PerInvoiceResult`, `PostResult`).
2. **Nest watch + new modules**: after adding a module, if routes 404 with the `{success:false}` wrapper, the watch is serving a stale build — check for a TS error first (it silently keeps the old process), and beware duplicate stale `nest --watch` processes holding port 4040.
3. **Editor wipes ingested docs** (known issue, fix deferred): opening a Xero-imported/**ingested** document in the portal editor autosaves a lossy round-trip that can wipe items/customer/custom config. Agreed future fix = read-only editor for such docs. Until then: don't open ingested invoices in the editor; preview is safe.
4. **Template ids differ per DB** — always resolve JPSG by `templateVariant='JPSG_DISPOSAL'`; seed new DBs with the script.
5. **`npm run build` in api-server also runs `prisma db push`** against the env's DB — never run it casually (guru's release checklist). Schema changes: `db:push` is auto-run per guru's standing instruction; additive only.
6. **Amount field names**: sales-doc configs must use `subTotal`/`gstAmount`/`nettTotal` (bills use `subtotal`/`taxAmount`/`totalAmount`). Mixing them breaks posting/preview totals.
7. **Fuzzy matching can over-match**: "API Test Customer Pte Ltd" matched existing "Test Customer Pte Ltd" (substring rule, 0.95). Same threshold as bills; accepted behavior, but keep in mind for near-name clients.
8. **Org context**: portal fetches must send `X-Active-Org-Id` (admin "Viewing as") — use `useAccountingApi`/`request` helpers, never raw fetch.

---

## 7. Status board & what's next

| Item | Status |
|---|---|
| Weighbridge prepaid ingestion + JPSG template + real-payload field fix | SHIPPED (prod) |
| Posting Queue B/C (invoices) | SHIPPED |
| /v1 API + ApiKey + admin tab + Swagger + CN-in-queue | **UNCOMMITTED on dev** (deploy auto-pushes the additive `ApiKey` schema) |
| Admin "API Keys" tab visual check | pending (needs a signed-in session) |
| Prepaid **split settlement** (green→106-1 / red→bank, both feeds) | designed, **blocked on guru**: red bank account, CD-deposit treatment |
| JP passes ingestion | PARKED — blocked on: revenue account, invoice-number source (+ settlement above) |
| **Postpaid** feed (`postpaid_consolidated`) | **BUILT on dev 2026-07-23 (uncommitted)** — ingestion branch (DD/MM/YYYY, idempotency by invoiceNumber, materialSummaries→items @209, `config.consolidated{dailyBreakdowns, transactionCount, paymentMethod}`), `JPSG_CONSOLIDATED` template seeded dev+staging+prod, CleanDocumentPreview consolidated branch (material summary + Daily Breakdown appendix + payment note). E2E-verified data-level; render not visually checked |
| Deferred nice-to-haves | per-key rate limiting, request audit logging, `postedBy` empty when osirisadmin posts |

**Related memory notes:** `external-api-v1`, `jp-passes-ingestion-plan`, `json-ingestion-feature`, `posting-queue-plan`, `accountant-posting-review-direction`, `auto-post-double-entry-issues`, `xero-imported-docs-editor-wipe`.
