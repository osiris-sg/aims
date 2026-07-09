# AIMS Accounting — Session Handoff (2026-07-08)

Handoff for the next agent. Covers: (1) how the accounting system works, (2) what to **test now**, (3) tasks **deferred for later**, (4) deploy/data state. Org referenced throughout: **Biofuel Industries** = `52e90ba8-bfbd-48b0-bb76-4f9667bf74f1` (same org id across dev/staging/prod).

---

## 1. How the accounting system works

**Canonical tables**
- Every document type (INVOICE, BILL, QUOTATION, PO, CREDIT_NOTE…) lives in the unified **`Document`** table (`config` JSON holds line items etc.). Never make a per-type table.
- GL = **`JournalEntry`** + **`JournalLine`**. Chart of accounts = **`ChartOfAccount`**. Control accounts in **`AccountingSetting.controlAccounts`** (`debtorControl`=AR, `creditorControl`=AP, `salesAccount`, `taxLiabilities`).
- Sub-ledger (`Transaction`/`CustomerBalance`) is **RETIRED** — SOA / aging read `Document`(INVOICE/CREDIT_NOTE)+`Payment` directly (`statements.service.ts`).

**Posting (deterministic, NO AI at confirm)**
- `journal-auto-post.service.ts`: `postFromInvoice` (Dr AR / Cr revenue **per line** / Cr GST), `postFromBill`, `postFromPayment`.
- **Trigger = confirm only.** Setting a document `status: 'confirmed'` (`becomingConfirmed` in `documents.service.updateDocument`, or `confirmInvoice`) posts it. Auto-save of a **draft** does NOT touch the GL.
- Confirmed documents are **locked** (`documents.service` blocks edits when `status === 'confirmed'`).
- Idempotent — guards against double-posting.
- `journal.void()` exists: marks a JE VOID + posts a reversing entry (used for the future edit/reopen flow).

**Journal numbering** — `journal.service.nextJournalNumber`: canonical `JV-<6 digits>`. **FIXED this session** — it was always returning `JV-000001` because 23k imported `JV-XERO-*` journals dominated the old top-N scan; now reads the true max via `MAX(CAST(SUBSTRING…)) WHERE journalNumber ~ '^JV-[0-9]+$'`. This is a real regression fix — **any org with Xero-imported journals needs the deploy** or every posting after the first collides.

**Currency = cosmetic today.** `config.currency` seeds from `AccountingSetting.baseCurrency` (SGD) + shows on the PDF, but posting **ignores it** — posts face value as SGD, never sets `JournalLine.foreignAmount/exchangeRate`. Fine while all-SGD (Biofuel). See §3 multi-currency.

**Customer shape gotcha** — editor-created docs store customer **flat** (`config.customerId`/`customerName`); imported docs store **nested** (`config.customer.{id,name}`). Payment dialog + SOA read **both**; NOT yet normalized on save.

---

## 2. Shipped this session — WHAT TO TEST NOW

### A. Custom document numbering (pushed to `yx/dev`, needs prod deploy)
- `DocumentNumberFormat` table; `src/document-numbering/` module. Pattern tokens: `{YYYY}{YY}{MM}{DD}` + `{DOC}` (doc code INV/QO/DO…) + `{####}` (serial, padding = # count). Per-variant serial, reset never/daily/monthly/yearly.
- **Accounting Setup → Default Settings → "Document number sequences"** = visual **block builder** (type text; tap Year/Month/Day/Doc Code/Number chips; faint "+" between blocks inserts a dash; **"Apply to all document types"** fans one pattern to every type via `{DOC}`).
- **`useNumberFormatPicker`** (mirrors `useTemplatePicker`) fires in `DocumentListView` **before** the template picker: 0 formats→legacy, 1→auto, >1→"Choose number format" dialog. Normalizes template codes (TI2→INVOICE) via `canonicalType()`.
- **TEST:** `/sales/invoices` → Create → should show "Choose number format" (Jurong Port / Earth Works / Rental-Sales) → then "Choose a template" → invoice numbered e.g. `BIPL-JPSG-INV-20260708-0001`. Verify serial increments + `{DOC}` = INV.

### B. Revenue mapping (pushed; data seeded dev+prod)
- `Asset.salesAccountCode`/`rentalAccountCode`. Stock Card gains **Rental/Sales tabs** (product shows under a tab if it has that account; unmapped products stay visible). **Add Service** → services master file (`RevenueItem`). **Accounting Setup → Revenue Mapping** tab = inline account editor over Assets + services. `postFromInvoice` credits each line's `accountCode`.
- Line editor shows a `(rental)/(sale)/(service)` tag — visible in editor, hidden from the PDF/preview.
- **TEST:** invoice → Add Item → Stock Card Rental/Sales tabs self-code the line; confirm → journal credits the mapped account (verified: `TI2202607-003` → Cr 227 Advanced Illumination).

### C. Recurring Invoices (BUILT this session — **NOT committed/pushed**, dev only)
- `RecurringInvoiceTemplate` table; `src/recurring-invoices/` module. **AR, fully auto** (guru's choice: generate + confirm + email).
- **Token engine** (`resolveText`): `{MONTH}`, `{MONTH YEAR}`, `{PERIOD}`, `{YEAR}`, `{DATE}`, `{DAY}`, `{NEXT MONTH}`, `{NEXT MONTH YEAR}`, `{PREV MONTH}`, `{PREV MONTH YEAR}`. **GOTCHA:** `{YEAR}` is always the *run* year — for a Dec run, `{NEXT MONTH} {YEAR}` gives "January 2026", NOT 2027; use **`{NEXT MONTH YEAR}`** for the rolled-over year. (Confirmed by test.)
- `runDue(org)` = lazy scheduler (triggered on Accounting hub / recurring-invoices page load): for each active template past `nextRunDate` → `createBasicDocument` → `updateDocument(status:confirmed)` (posts) → `sendInvoiceEmail` (best-effort) → advance `nextRunDate`. Advances **only** after a successful post (email failure doesn't block; failed post retries, no double-post).
- Frontend: **Accounting → Recurring Invoices** button → list + create/edit dialog (customer, invoice template, optional number format, frequency, first-run/end dates, auto-email toggle, line items with tokens + live preview) + per-row "generate now".
- **TEST:** Accounting → Recurring Invoices → New (China Railway, monthly, line "Services for {MONTH YEAR}") → "generate now" → verify an invoice was created with "Services for July 2026", confirmed (Dr AR / Cr Revenue / Cr GST), emailed (needs customer email), and `nextRunDate` advanced one month. Token engine already unit-verified.
- Reuses existing perms (`documents:read` / `accounting:update`) — no new grants.

### D. Payment-customer fix (pushed)
- `RecordPaymentDialog` + `invoices/page.tsx` now read customer from flat **and** nested shapes, so Record Payment pre-fills the customer for editor-created invoices.

---

## 3. Deferred tasks (see memory `accounting-open-decisions.md`)

**Blocking model decisions (need guru):**
1. **Live GL posting** — guru REVERSED post-on-confirm; wants **auto-save to post live**. Planned two-layer model: journal per doc, `status` Pending (draft) vs Posted (confirmed); live/management view = Pending+Posted, official/GST = Posted only. **OPEN: guru yes/no on the Pending-vs-Posted split.** (`live-gl-posting-plan.md`)
2. **Multi-currency** — agreed: currency + accountant-**locked standing rate** on the customer master (one customer code per currency) → doc currency → GL converts to base SGD. Differs from Xero (per-txn rate). **OPEN: FX gain/loss on settlement — build or skip?** (`multi-currency-plan.md`)

**Known posting issues:** 3) PO↔Bill double-counts AP. 4) Purchases post to a single account (sales now per-line, purchases don't). 5) GST one shared account + the "not GST-registered but claim input tax" case. 6) Duplicated amount logic. (`auto-post-double-entry-issues.md`)

**Workflow:** 7) Posting-Review Queue (Feature B) + Batch Post (Feature C). (`posting-queue-plan.md`)

**Loose ends:** 8) `610` AR-control account (guru will revisit). 9) Biofuel AR still stale (no 02a invoice importer). 10) Normalize customer flat/nested on save. 11) Deploy prod. 12) Cappitech quote rounding (client answers). 13) Normalize `Document.type` variants. 14) Final Xero-parity completeness check.

---

## 4. Deploy / data state

- **`yx/dev` @ 1c03e7e** = custom numbering + revenue mapping + journal fix + payment fix + other agents' pagination/masterfiles WIP. Builds green.
- **Recurring invoices = NOT committed** (schema pushed to dev only; module + page uncommitted). Build + push when guru says.
- **Schemas pushed:** `DocumentNumberFormat` → dev+staging+prod; `RevenueItem`/`Asset` accounts → dev+prod; `RecurringInvoiceTemplate` → **dev only**.
- **Biofuel numbering variants seeded** into dev+staging+prod (14 rows: Invoice ×3 + "Default" ×11), counters at 1, seed idempotent.
- **⚠️ PROD DEPLOY PENDING** — journal-number fix + numbering + revenue mapping are pushed but **prod only picks them up after the branch deploys**. The journal fix is urgent (accountant hits `JV-000001` collisions until deployed).
- Only build/push when guru explicitly says "build" / "build and push". `db:push` runs automatically after schema edits.

**Key files:** `src/journal/journal-auto-post.service.ts`, `src/journal/journal.service.ts` (numbering), `src/documents/documents.service.ts` (createBasicDocument + confirm), `src/document-numbering/`, `src/recurring-invoices/`, `src/revenue-items/`; portal `app/portal/components/DocumentListView.tsx` + `useNumberFormatPicker.tsx` + `useTemplatePicker.tsx`, `app/portal/accounting/recurring-invoices/page.tsx`, `app/portal/settings/accounting-setup/components/`.
