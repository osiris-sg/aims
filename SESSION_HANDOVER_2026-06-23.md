# Session Handover — Biofuel Xero Migration + AP Refactor

**Session date:** 2026-06-22 → 2026-06-23 SGT
**Org focus:** Biofuel Industries Pte Ltd (`52e90ba8-bfbd-48b0-bb76-4f9667bf74f1`)
**Working dir:** `/Users/guru/Documents/GitHub/aims/`

This doc lists every change I made so the next agent can pick up cleanly.

---

## 1. Current State (verified at handover)

| Thing | Count / Status |
|---|---|
| Biofuel CoA accounts | **169** (167 from Xero + auto-added 499 "Realised Currency Gains", 999 "Contra Clearing AP/AR") |
| Biofuel JournalEntries | **10,550** ($167,895,315.85 Dr = Cr — balanced) |
| Biofuel JournalEntryLines | **33,669** |
| Biofuel Customers | **418** (90 with running balance via Transaction backfill) |
| Biofuel Suppliers | **346** |
| Biofuel Documents (INVOICE) | **1,797** — Apr 2026 stale (guru flagged real AR ≈ $12M vs AIMS $7.5M; needs refresh) |
| Biofuel Documents (BILL) | **2,442** (1,797 Paid, 642 Approved/unpaid, 3 Draft) |
| Biofuel Transactions (AR ledger) | **3,220** |
| Biofuel BillPayments | 0 (manual payment voucher feature shipped but unused) |

**Xero OAuth state:** Connected (refresh token valid 60 days from 2026-06-23, scopes include `offline_access`).
- Tenant: `31a8a2d1-37e8-4787-a187-a2da3564f549` (Biofuel Industries Pte Ltd)
- ⚠️ Daily API quota was exhausted (~24h cooldown) — Xero migration is now XLSX-based, not API.

---

## 2. Xero → AIMS Migration Strategy (PIVOTED to XLSX)

API path hit Xero's daily rate-limit (5,000/day) hard during bill import. **Switched to XLSX export → custom importer** for bulk data. API is now reserved for attachments only (deferred).

### XLSX exports from Xero
Drop files in `/Users/guru/Downloads/`:

| File | Source in Xero | Imported by |
|---|---|---|
| `ChartOfAccounts.csv` | Settings → Chart of Accounts → Export | `scripts/import-biofuel-coa.ts` ✓ done |
| `Biofuel_Industries_Pte_Ltd_-_General_Ledger_Detail.xlsx` | Reports → General Ledger Detail | `scripts/import-biofuel-gl.ts` ✓ done |
| `Contacts.csv` | Contacts → Export | `scripts/xero-migration/01a-contacts-from-csv.ts` ✓ done |
| `Biofuel_Industries_Pte_Ltd_-_Payable_Invoice_Detail.xlsx` | Reports → Payable Invoice Detail | `scripts/xero-migration/03a-bills-from-xlsx.ts` ✓ done |
| `Biofuel_Industries_Pte_Ltd_-_Receivable_Invoice_Detail.xlsx` | Reports → Receivable Invoice Detail | **NOT YET BUILT** — needed to refresh AR |
| Credit Notes | Business → Invoices/Bills → Credit Notes tab → Export | Not yet imported (low priority; GL already has the math) |

### Run order (idempotent — re-run safe)

```bash
cd /Users/guru/Documents/GitHub/aims/api-server-production

# Foundation (re-run anytime; uses XLSX/CSV exports in ~/Downloads)
npx ts-node scripts/import-biofuel-coa.ts                       # 169 CoA
npx ts-node scripts/import-biofuel-gl.ts                        # 10,550 JEs (~13 min)
npx ts-node scripts/xero-migration/01a-contacts-from-csv.ts     # Contacts
npx ts-node scripts/xero-migration/03a-bills-from-xlsx.ts       # AP Bills
npx ts-node scripts/xero-migration/_backfill-transactions.ts    # AR Transaction cache (for SOA)
```

### What's still missing (to-do list for next agent)

1. **Refresh AR invoices** — Real Biofuel AR ≈ $12M but AIMS shows $7.5M (data from Apr 2026 API import is stale). Need to:
   - Export Xero "Receivable Invoice Detail" (cap 500 per export — guru hit "too many items" error; may need date-bucketed exports)
   - Write `scripts/xero-migration/02a-invoices-from-xlsx.ts` mirroring `03a-bills-from-xlsx.ts` pattern
   - Re-run `_backfill-transactions.ts` after to refresh SOA + CustomerBalance
2. **Credit Notes import** — `scripts/xero-migration/04-credit-notes.ts` exists (uses Xero API) but never run; convert to XLSX path if needed.
3. **Payments import** — Skipped per guru's call. GL JEs cover the math.
4. **Attachments (PDFs)** — Use the API once daily quota resets (`scripts/xero-migration/_common.ts` has the token + throttling helpers).
5. **Migration playbook** — Originally task #56; this doc plus the inline comments in `scripts/xero-migration/_common.ts` cover most of it.

---

## 3. Schema Changes (Prisma — already pushed to dev DB)

```prisma
model Bill {           // legacy table — kept for back-compat, NO LONGER WRITTEN TO
  ...existing fields...
  attachments    Json?  // NEW: supplier PDF + supporting docs
  // bill payments relation removed — BillPayment.bill FK dropped
}

model Document {       // canonical doc table for ALL types
  ...existing fields...
  attachments         Json?  // NEW: generic file attachments
}

model Payment {        // AR side — unchanged + attachments
  ...existing fields...
  attachments    Json?  // NEW: AR payment proof
}

model BillPayment {    // NEW table — AP-side payment voucher
  id              String   @id @default(uuid())
  organizationId  String
  billId          String   // → Document.id where type='BILL' (NO Prisma FK relation)
  supplierId      String   @db.Uuid
  amount          Float
  paymentDate     DateTime
  paymentMethod   String   // cash | cheque | transfer | giro | paynow | other
  reference       String?
  notes           String?
  bankAccountId   String   // → ChartOfAccount.id
  journalEntryId  String?
  attachments     Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  createdBy       String

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  supplier     Supplier     @relation(fields: [supplierId], references: [id])

  @@index([organizationId, paymentDate])
  @@index([billId])
  @@index([supplierId])
}
```

**Important:** `BillPayment.billId` is **NOT** a Prisma FK relation — it's a plain string pointing at `Document.id` (since bills now live in Document, not Bill). Memory note: `document-table-is-canonical.md`.

---

## 4. Backend Refactor — Bills now use the unified Document table

**Per guru's directive:** "all reads from documents, there should be a separate table for any documents" — `Bill` table is dead, every doc type lives in `Document`.

### File rewritten end-to-end
`/Users/guru/Documents/GitHub/aims/api-server-production/src/bills/bills.service.ts`

Mapping:
| Bill model field | Document equivalent |
|---|---|
| `billNumber` | `Document.name` |
| coarse status | `Document.status` (`draft` / `confirmed` / `cancelled`) |
| `BillStatus` enum (DRAFT / PENDING_APPROVAL / POSTED / PAID / VOID) | `config.billStatus` |
| `billDate`, `dueDate`, `reference`, `description` | `config.*` |
| `subtotal`, `taxAmount`, `totalAmount`, `amountPaid`, `currency` | `config.*` |
| `lines` | `config.lines` (also mirrored to `config.items`) |
| `supplierId` | `config.supplierId` (+ `config.supplier.id`) |
| `sourcePoId`, `matchStatus`, `matchDetails`, `inboundChannel`, `inboundMeta` | `config.*` |
| `journalEntryId`, `approvedBy/At`, `postedAt/By`, `voidedAt/By` | `config.*` |
| `attachments` | `Document.attachments` (now a real column) |

Key helper: `toBill(doc, supplierName?)` reshapes a Document → Bill-shaped response. Handles both AIMS-native bills (full config) and Xero-imported bills (uses `config.xeroGross` / `xeroBalance` / `xeroStatus`).

`getOrCreateBillTemplate(orgId)` auto-creates a `DocumentTemplate(type='BILL')` for orgs that don't have one. Cached per-org.

All flows preserved: `list, findOne, create, update, submit, approve, reject, post, voidBill, createFromPo, extractFromFile, apAging, recordPayment, listPayments, addAttachments`.

### New endpoints (in `bills.controller.ts`)
- `GET /bills/:id/payments` — list `BillPayment` rows for a bill
- `POST /bills/:id/payments` — record a payment, auto-post JE, update bill (the AP "Payment Voucher" flow)
- `POST /bills/:id/attachments` — append files to bill (already-uploaded via `/uploads/image`)

### Payments service (AR)
`src/payments/payments.service.ts` + `dto/create-payment.dto.ts` extended to accept `attachments[]` (same shape as bills).

### Statements service (NEW reports)
`src/statements/statements.service.ts` — three new methods:
- `generateSupplierSOA(dto, orgId)` — reads Document(type=BILL) for the supplier, builds running balance, includes BillPayment rows
- `salesByCustomer(orgId, startDate?, endDate?)` — aggregates INVOICE Documents per customer
- `purchasesBySupplier(orgId, startDate?, endDate?)` — aggregates BILL Documents per supplier

Corresponding endpoints in `statements.controller.ts`: `POST /statements/supplier-soa`, `GET /statements/sales-by-customer`, `GET /statements/purchases-by-supplier`.

---

## 5. Backend — Other fixes

### Dynamic cash/bank detection
`src/journal/journal.service.ts` — added shared `isCashOrBankAccount(account)` helper:
1. Match AIMS-default code patterns (CA004 / CA006 / CA600 / CA1xx)
2. Match `accountType === 'FOREIGN_BANK'`
3. Fallback: `accountType === 'CURRENT_ASSET'` AND name matches `/\bbank\b/i` or `/\bcash\b/i`

Used by: `hubSnapshot` (Hub cash card), `cashFlowReport`, `bank-rec.service.ts listBankAccounts`. Fixes Biofuel where bank accounts are coded 100-104.

### Anomaly detector improvements
`src/anomalies/anomalies.service.ts` — `detectMissingTax`:
- Anchors on `controlAccounts.debtorControl` (per-org dynamic)
- Only flags **receivable** invoices (JE debits AR control account) — skips vendor bills
- Only flags **unpaid** receivables (no later PAYMENT JE references the same invoice number) — skips already-settled
- Adds `items[]` field to AnomalyFinding (per-JE breakdown: `{journalNumber, label, amount, date}`)
- Link now passes `?journalNumbers=` so the audit-trail page can filter

### Audit Trail filter
`app/portal/accounting/audit-trail/page.tsx` reads `?journalNumbers=A,B,C` query param → filters to those JEs + shows a yellow banner with "Clear filter" button.

⚠️ Pre-existing TS nit at line 254: `[...pinnedJournalNumbers]` (Set spread). Works, but if TS target complains: change to `Array.from(pinnedJournalNumbers)`.

---

## 6. Frontend — Active-Org Header Fix

Multiple portal fetchers were ignoring the admin "Viewing as <Org>" override. Fixed:
- `app/portal/settings/accounting-setup/page.tsx` (`authedFetch`)
- `app/portal/accounting/_lib/api.ts` (`useAccountingApi`)
- `app/portal/context/ConfigurationContext.tsx`

Pattern (memorized in `portal-fetch-active-org-header.md`):
```ts
if (typeof window !== "undefined") {
  const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
  if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
}
```

The shared `helpers/request.ts` already does this auto-inject; raw `fetch()` calls anywhere else need the same snippet.

---

## 7. Frontend — Payment Voucher + Attachment Feature

### New shared component
`components/AttachmentUploader.tsx` — drop-in reusable file uploader. Uses `helpers/fileUploader.ts` (new, handles any MIME type via existing `/uploads/image` endpoint).

### New dialog
`app/portal/inventory/bills/_components/RecordBillPaymentDialog.tsx` — AP Payment Voucher (mirror of `RecordPaymentDialog`). Bank-account picker filtered via `/bank-rec/accounts`. Includes attachment uploader for cheque scan / TT advice / PayNow screenshot.

### Wired into existing flows
- Bills page row action: 💳 "Record Payment" icon button (when POSTED + outstanding > 0)
- `BillEditorDialog`: "Source Documents" attachment section (supplier PDF attaches after first save)
- `RecordPaymentDialog` (AR): "Payment Proof" attachment section
- `usePayments` hook accepts `attachments?` param

---

## 8. Frontend — PageTable Migration

Refactored 11 list-style pages to use the standard `components/PageTable.tsx`:

| Page | Status |
|---|---|
| `app/portal/inventory/bills/page.tsx` | ✓ refactored — has `availableFilters={["status", "createdOn"]}` |
| `app/portal/accounting/audit-trail/page.tsx` | ✓ refactored (preserved pinned-journal banner, JE detail dialog) |
| `app/portal/accounting/bank-reconciliation/page.tsx` | ✓ refactored (kept account picker + recon UI) |
| `app/portal/accounting/fixed-assets/page.tsx` | ✓ refactored |
| `app/portal/accounting/general-ledger/page.tsx` | ✓ refactored (footer search collapsed into PageTable's built-in search) |
| `app/portal/accounting/recurring/page.tsx` | ✓ refactored |
| `app/portal/accounting/sales-by-customer/page.tsx` | ✓ refactored |
| `app/portal/accounting/purchases-by-supplier/page.tsx` | ✓ refactored |
| `app/portal/accounting/supplier-statement/page.tsx` | ✓ refactored |
| `app/portal/reports/statement-of-account/page.tsx` | ✓ refactored |
| `app/portal/reports/price-history/page.tsx` | ✓ refactored (preserved server-side pagination) |

**Reports-style pages** (Trial Balance, P&L/BS, Cash Flow, AR Aging, AP Aging, GST, Budget, Budget vs Actual) were **intentionally NOT migrated** — they're matrix/statement layouts, not list views, and PageTable doesn't fit.

### Open follow-up: filter configs
Only Bills page has `availableFilters` set. The other 10 refactored pages got pagination + search "for free" but the filter funnel won't appear until they pass `availableFilters` or `filterConfig`. Add per-page based on what filters make sense (status/date for most).

---

## 9. Frontend — Accounting Reports Tabs

`app/portal/accounting/reports/page.tsx` — added 6 new tabs:

| Tab key | Label | Component |
|---|---|---|
| `soa` | Customer Statement | StatementOfAccountPage |
| `sbc` | Sales by Customer | SalesByCustomerPage |
| `supp-soa` | Supplier Statement | SupplierStatementPage |
| `pbs` | Purchases by Supplier | PurchasesBySupplierPage |
| `fa` | Fixed Assets | FixedAssetsPage |
| `recurring` | Recurring | RecurringPage |

Total: **17 tabs** under Accounting → Reports. Two pages have card-style + favourites layout that guru added (sales-by-customer, supplier-statement, purchases-by-supplier intentionally edited).

---

## 10. Org Config Patches (DB)

### Roles (dev + prod patched same)
`scripts/patch-bf-roles.ts` — added `ACCOUNTING`, `SUPPLIERS`, `MAINTENANCE` to Biofuel's `Admin` + `Manager` role `allowedModules` arrays. They predated the Accounting module rollout so the tab was invisible to admin@osiris.sg viewing as Biofuel.

**Memory note:** `role-allowed-modules-rollout.md` — every new MODULE_CATALOG entry needs this backfill for all orgs.

### Module display name + submenus
Patched all orgs' `OrganizationModule` row where `moduleCode='ACCOUNTING'`:
- `displayName: 'Accounting'` (was "General Ledger")
- `config.subMenus`: collapsed from legacy 8 items → 3 items (Dashboard / Reports / Setup)

Script: `scripts/patch-all-acc-submenus.ts`.

---

## 11. Scripts Inventory

All in `api-server-production/scripts/`:

### Active (use these)
| Script | Purpose |
|---|---|
| `import-biofuel-coa.ts` | CoA import from `~/Downloads/ChartOfAccounts.csv` |
| `import-biofuel-gl.ts` | GL Detail import from `~/Downloads/Biofuel_Industries_Pte_Ltd_-_General_Ledger_Detail.xlsx` |
| `xero-migration/_common.ts` | Shared: token refresh + `xeroGet()` throttled API helper (1.1s/req) |
| `xero-migration/01a-contacts-from-csv.ts` | Contacts import from `~/Downloads/Contacts.csv` |
| `xero-migration/03a-bills-from-xlsx.ts` | AP Bills import |
| `xero-migration/_backfill-transactions.ts` | AR Transaction + CustomerBalance backfill |
| `xero-migration/_seed-bill-template.ts` | One-off — but bills.service auto-creates it now |

### Deprecated (kept for reference)
| Script | Status |
|---|---|
| `xero-migration/01-contacts.ts` | API path — works but daily quota issue |
| `xero-migration/02-sales-invoices.ts` | API path — never completed; guru chose to skip |
| `xero-migration/03-purchase-bills.ts` | API path — never completed; XLSX won |
| `xero-migration/04-credit-notes.ts` | API path — built but never run |
| `xero-migration/_count-invoices.ts` | API path — diagnostic |
| `xero-migration/clear-biofuel-xero.ts` | One-off OAuth reset |

### Diagnostic
Many one-off check scripts under `scripts/check-*.ts`. Safe to delete later but harmless.

---

## 12. Production Notes

- Prod URL: `https://www.ai-ms.io/portal`
- Prod DB: separate Neon branch (`ep-icy-moon-a19rnv5x-pooler...`); use `.env.production`
- Prod Biofuel ACCOUNTING module: same patches applied (`scripts/patch-bf-roles.ts` was also run via `npx dotenv -e .env.production --`)
- ⚠️ Prod sidebar may show OLD layout ("General Ledger" with 8 sub-items) — that's because deployed code predates the consolidated MODULE_CATALOG entry. A redeploy of api-server-production picks up the new catalog.

---

## 13. Outstanding Issues / To-Do List for Next Agent

1. **AR refresh** (highest priority) — guru reports real AR ≈ $12M, AIMS shows $7.5M. Need to import a fresh Receivable Invoice Detail XLSX.
2. **5 bill rows failed import** — unique constraint on same bill number across different suppliers. Need to inspect and resolve (maybe append supplier prefix to bill number).
3. **Add `availableFilters` props** to the 10 migrated pages that don't have them yet (funnel button missing on most).
4. **Credit Notes XLSX importer** — script `04-credit-notes.ts` is API-based; convert to XLSX if needed.
5. **Stage 5 Payments** — deferred per guru. GL math already has it; only useful if per-invoice cross-reference is needed for SOA precision.
6. **Stage 6 Attachments (PDFs)** — Xero API only. Needs the daily quota to be clear.
7. **Order model refactor** — guru's "everything in Document" rule technically applies to `Order` table too (1 row in Biofuel). Low priority.
8. **Bill table cleanup** — `Bill` model is dead but still in schema. Safe to drop in a future migration (was 0 rows everywhere at refactor time).

---

## 14. Memory Notes Added (in `~/.claude/projects/-Users-guru-Documents-GitHub-aims/memory/`)

| File | What it covers |
|---|---|
| `portal-fetch-active-org-header.md` | Inject `X-Active-Org-Id` in any new portal fetch helper |
| `role-allowed-modules-rollout.md` | Backfill `Role.allowedModules` for new MODULE_CATALOG entries |
| `document-table-is-canonical.md` | All document types live in `Document` table — never make a per-type table |

---

## 15. Key Codebase Anchors (for the next agent's grepping)

- Bills service: `api-server-production/src/bills/bills.service.ts` (700 lines — fully Document-based)
- Statements service: `api-server-production/src/statements/statements.service.ts` (~600 lines)
- Hub stats / Cash Flow: `api-server-production/src/journal/journal.service.ts`
- Module catalog: `api-server-production/src/configuration/module-catalog.ts`
- Auth guard (active-org header): `api-server-production/src/auth/clerk-auth.guard.ts:115`
- PageTable (canonical list table): `portal-production/components/PageTable.tsx`
- Filter drawer (used by PageTable): `portal-production/components/FilterDrawer.tsx`
- Sidebar render: `portal-production/components/Sidebar/DynamicSidebarContent.tsx`
- Accounting reports hub: `portal-production/app/portal/accounting/reports/page.tsx`
- Accounting Hub (Finance Dashboard): `portal-production/app/portal/accounting/page.tsx`
