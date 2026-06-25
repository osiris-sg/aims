# AIMS Accounting Module — Full Reference

A complete map of how the accounting module works inside AIMS — the data model, the post flows, every screen, every report, and what each smart feature actually does.

> Companion to `SESSION_HANDOVER_2026-06-23.md` (which lists only what was changed this session).

---

## Table of Contents
1. [Architecture & Data Model](#1-architecture--data-model)
2. [Chart of Accounts](#2-chart-of-accounts)
3. [Journal Entries (the GL)](#3-journal-entries-the-gl)
4. [AR — Customer Invoices & Payments](#4-ar--customer-invoices--payments)
5. [AP — Supplier Bills & Payment Vouchers](#5-ap--supplier-bills--payment-vouchers)
6. [Financial Reports](#6-financial-reports)
7. [Bank Reconciliation](#7-bank-reconciliation)
8. [Tax / GST](#8-tax--gst)
9. [Fixed Assets & Depreciation](#9-fixed-assets--depreciation)
10. [Budgets](#10-budgets)
11. [Cost Centers](#11-cost-centers)
12. [Recurring Journals](#12-recurring-journals)
13. [Smart / AI Features](#13-smart--ai-features)
14. [Period Close](#14-period-close)
15. [Migration Pipeline (Xero → AIMS)](#15-migration-pipeline-xero--aims)
16. [Permissions & Role Model](#16-permissions--role-model)
17. [URL / Sidebar Map](#17-url--sidebar-map)
18. [Implementation Status](#18-implementation-status)

---

## 1. Architecture & Data Model

### Stack
- Backend: NestJS (`api-server-production/`) + Prisma + Postgres (Neon, serverless driver via WebSocket)
- Frontend: Next.js App Router (`portal-production/`) + MUI v6 + Redux/Saga
- Auth: Clerk (no local User table; users live in Clerk)
- Multi-tenant: every row carries `organizationId`

### Core accounting tables

| Table | Role | Notes |
|---|---|---|
| `Organization` | Tenant root | Has `taxRate`, settings |
| `AccountingSetting` | Per-org config | Base currency, fiscal year end, control accounts JSON, bill approval threshold |
| `ChartOfAccount` | One row per GL account per org | code (string), name, accountType, category (PNL/BALANCE_SHEET), normalBalance |
| `JournalEntry` + `JournalEntryLine` | The GL | Every JE has lines that balance Dr = Cr |
| `Document` | **All document types** (INVOICE, BILL, QUOTATION, PO, DELIVERY_ORDER, SALES_ORDER, CREDIT_NOTE) | `type` field discriminates; rich data in `config` JSON |
| `Customer` | AR side counterparty | Links to Document via `config.customerId` |
| `Supplier` | AP side counterparty | Links to Document via `config.supplierId` |
| `Payment` | AR cash receipts | FK to Customer + Document (invoice) |
| `BillPayment` | AP cash disbursements | Plain-string `billId` → `Document.id` (no Prisma FK) |
| `Transaction` | Denormalized per-customer ledger | Used by SOA + AR Aging |
| `CustomerBalance` | Per-customer running outstanding | Updated when Transaction rows insert |
| `BankStatementImport` + `BankStatementLine` | Bank rec workspace | One import = one statement upload |
| `CostCenter` | Department / dimension tag | Optional tag on JournalEntryLine |
| `FixedAsset` + `DepreciationEntry` | Asset register + depreciation schedule | Auto-posts JEs |
| `Budget` | Per-account per-period | Used by Budget vs Actual |
| `RecurringJournalTemplate` | Templates for repeating JEs | Lazy run on hub load |

### Canonical doc table rule
**Every "document" lives in `Document` with a `type` field.** Never make a parallel table per type. The legacy `Bill` table was refactored out 2026-06-23 — every bill is now `Document(type='BILL')`. Type-specific fields live in `config` JSON. See memory note `document-table-is-canonical.md`.

---

## 2. Chart of Accounts

### Account types (enum-as-string)
- **PNL:** `SALES`, `PURCHASE`, `INCOME`, `EXPENSE`, `TAX`, `EXTRAORDINARY`, `EXCHANGE_GAIN_LOSS`
- **BALANCE_SHEET:** `FIXED_ASSET`, `INTANGIBLE_ASSET`, `CURRENT_ASSET`, `CURRENT_LIABILITY`, `TAX_LIABILITY`, `MEDIUM_TERM_LIABILITY`, `LONG_TERM_LIABILITY`, `SHARE_CAPITAL`, `RETAINED_PROFIT`, `CAPITAL_RESERVE`, `DIVIDEND`, `DEPRECIATION_PROVISION`, `FOREIGN_BANK`, `WORK_IN_PROGRESS`

Each account has `code` (string, unique per org), `name`, `accountType`, `category`, `normalBalance` (DEBIT/CREDIT), `isActive`, `isControlAccount`, `isSystem`.

### Control accounts
`AccountingSetting.controlAccounts` is a JSON map of role → CoA code:
```json
{
  "debtorControl": "610",        // AR control (Trade Receivables)
  "creditorControl": "800",      // AP control (Trade Payables)
  "taxLiabilities": "820",       // GST Payable
  "retainedProfits": "960",      // Retained Earnings (close-out destination)
  "openingStock": "...",
  "cashAccount": "...",
  "bankAccount": "...",
  "inventoryAccount": "...",
  "depreciationExpense": "...",
  "depreciationProvision": "..."
}
```

All accounting flows read from these, NOT hardcoded codes. Falls back to AIMS-default codes (CA001/CL001/etc.) only if not set.

### Bank/Cash detection
Single source of truth: `JournalService.isCashOrBankAccount(account)`. Three layers:
1. AIMS-default code patterns (CA004/CA006/CA600/CA1xx)
2. `accountType === 'FOREIGN_BANK'`
3. `accountType === 'CURRENT_ASSET'` AND name matches `/\bbank\b/i` or `/\bcash\b/i`

Used by Hub stats, Cash Flow report, Bank Rec account picker.

### UI
- **Settings → Accounting Setup** (`/portal/settings/accounting-setup`)
- Tabs: Account Definition (CoA + ranges + control accounts), Numbering, Tax, Opening Balances, Misc
- "Seed default accounts" button uses `default-chart-of-accounts.ts` (SG SME standard)
- Per-account: code/name/type/category/normalBalance/active/isControl

---

## 3. Journal Entries (the GL)

### Lifecycle
```
DRAFT ──post()──> POSTED ──void()──> VOID (reversing entry auto-created)
```

### Anatomy
```ts
JournalEntry {
  journalNumber: "JV-000123"      // unique per org, auto-incremented (or supplied)
  entryDate
  type                            // MANUAL | INVOICE | PAYMENT | CREDIT_NOTE | DEBIT_NOTE | OPENING_BALANCE | ADJUSTMENT | BILL
  status                          // DRAFT | POSTED | VOID
  reference                       // source doc # / payment ref
  description
  totalDebit + totalCredit        // must be equal to post
  sourceDocumentId / sourcePaymentId
  reversesEntryId                 // set on auto-reversal
  lines: JournalEntryLine[]
}

JournalEntryLine {
  accountId        // FK to ChartOfAccount
  debit / credit
  description
  costCenterId?    // optional dimension tag
  foreignAmount? + exchangeRate?  // multi-currency
}
```

### Numbering
`nextJournalNumber()` scans top 200 entries with the prefix, filters to those whose tail is purely numeric, picks max + 1. Has 5-attempt retry loop on P2002 (collision under concurrency).

### Auto-post pipeline
`JournalAutoPostService` posts JEs from source documents:
- `postFromInvoice(documentId)` → Dr AR + Cr Sales + Cr Tax
- `postFromPayment(paymentId)` → Dr Bank + Cr AR
- `postFromBill(billId)` → Dr Expense + Dr Tax + Cr AP
- `postFromBillPayment(billPaymentId)` → Dr AP + Cr Bank
- Inventory perpetual mode (feature-flagged): Dr COGS + Cr Inventory on invoice; Dr Inventory + Cr AP on bill

### Audit Trail UI
- `/portal/accounting/audit-trail` (or Reports → Audit Trail tab)
- Filterable by type / status / date range / search text
- Accepts `?journalNumbers=A,B,C` to filter to specific JEs (used by Hub Action Queue links)
- Drill-in dialog shows full line breakdown
- New JE button → JournalEntryDialog

---

## 4. AR — Customer Invoices & Payments

### Sales Invoice flow (AIMS-native)
1. Create from `/portal/invoices` (or via PageTable "New Invoice" button)
2. Pick customer, template variant, fill items + tax
3. Save as DRAFT (status='draft')
4. Confirm → status='confirmed' (or `pending_payment`)
5. Auto-post JE (Dr AR control / Cr Sales / Cr Tax)
6. Display on AR Aging + Customer Statement

### Storage
`Document(type='INVOICE')` with `config`:
```json
{
  "date", "dueDate", "customer": { "id", "name" }, "customerId",
  "items": [{ "description", "quantity", "unitPrice", "amount", "taxAmount", "accountCode", "itemCode" }],
  "subtotal", "taxAmount", "totalAmount", "currency", "gstPercent",
  // Xero-imported invoices add:
  "xeroImported": true, "xeroInvoiceId", "xeroInvoiceNumber",
  "xeroStatus", "xeroGross", "xeroBalance", "xeroAmountPaid"
}
```

### Record Payment flow
`RecordPaymentDialog.tsx` → `POST /payments` creates a Payment + Transaction + auto-updates invoice status (PARTIAL/PAID), updates CustomerBalance.
- Supports attachments (deposit slip, bank screenshot)
- Auto-flips invoice status when cumulative payment ≥ total

### AR Aging
`/portal/accounting/ar-aging` — reads from `CustomerBalance` + Transaction table. Bucket columns: Current (0-30) / 31-60 / 61-90 / 91-120 / 120+.

### Customer SOA
`/portal/reports/statement-of-account` or `Reports → Customer Statement` tab.
- Pick customer + date range → generate
- Renders: opening balance, every invoice + payment chronologically, running balance, aging panel
- Backend: `POST /statements/soa` reads from Transaction table
- Export to PDF/CSV

---

## 5. AP — Supplier Bills & Payment Vouchers

### Bill lifecycle
```
DRAFT ──submit()──> PENDING_APPROVAL ──approve()──> POSTED ──recordPayment()──> PAID
                                                                            \─voidBill()─> VOID
                                                                                          (auto-reverse JE)
```

`PENDING_APPROVAL` step skipped if `accountingSetting.billApprovalThreshold` not set or bill total below it.

### Storage
**Refactored 2026-06-23** — all bills live in `Document(type='BILL')`. Storage:
```json
{
  "supplierId", "supplier": { "id", "name" },
  "billDate", "date", "dueDate", "reference", "description", "currency",
  "subtotal", "taxAmount", "totalAmount", "amountPaid",
  "lines": [{ "description", "quantity", "unitPrice", "amount", "accountId?", "taxAmount?" }],
  "items": [...],  // mirrored from lines (different readers use different keys)
  "billStatus": "DRAFT|PENDING_APPROVAL|POSTED|PAID|VOID",
  "sourcePoId", "matchStatus", "matchDetails",
  "inboundChannel": "MANUAL|UPLOAD|EMAIL|FROM_PO|XERO",
  "inboundMeta",
  "journalEntryId",
  "approvedBy/At", "postedAt/By", "voidedAt/By",
  // Xero-imported add:
  "xeroImported": true, "xeroBillNumber", "xeroBillId",
  "xeroStatus", "xeroGross", "xeroBalance"
}
```
Also `Document.attachments` (Json) for supplier PDFs.

### Create paths
1. **Manual** — Bills page → "New Bill" → BillEditorDialog
2. **PDF upload** — Drag PDF into BillEditorDialog → Claude extracts → review/save (`POST /bills/extract`)
3. **From PO** — convert a PURCHASE_ORDER Document → bill with 3-way match check
4. **Xero import** — `scripts/xero-migration/03a-bills-from-xlsx.ts` from Xero Payable Invoice Detail XLSX

### Payment Voucher (NEW in this session)
- Row action: 💳 "Record Payment" icon button on POSTED bills with outstanding > 0
- `RecordBillPaymentDialog.tsx` → `POST /bills/:id/payments`:
  - Validates outstanding
  - Resolves bank account via `isCashOrBankAccount` check
  - Posts JE: Dr AP control / Cr selected bank
  - Creates `BillPayment` row with attachments (cheque scan, TT advice, PayNow screenshot)
  - Updates `Document.config.amountPaid`, flips to PAID if fully settled

### AP Aging
`/portal/accounting/ap-aging` — same shape as AR Aging. Reads from `Document(type='BILL')` via `bills.service.apAging()`.

### Supplier SOA (NEW in this session)
`/portal/accounting/supplier-statement` or `Reports → Supplier Statement` tab.
- Pick supplier + date range → generate
- Backend: `POST /statements/supplier-soa` reads Document(BILL) + BillPayment
- Synthesizes payments for Xero-imported paid bills (same-date as bill)
- Includes aging panel

---

## 6. Financial Reports

All under **`/portal/accounting/reports`** as tabs (17 total). Categorized:

### Receivables
| Report | Purpose |
|---|---|
| **Accounts Receivable** | List of invoices with AR tabs (All / Awaiting / Overdue / Paid) |
| **AR Aging** | Per-customer aging matrix (current / 31-60 / 61-90 / 91-120 / 120+) |
| **Customer Statement (SOA)** | Per-customer statement with running balance + aging |
| **Sales by Customer** | Aggregated invoice totals + paid + outstanding per customer |

### Payables
| Report | Purpose |
|---|---|
| **Accounts Payable** | Bills page (same component, embedded in tab) |
| **AP Aging** | Per-supplier aging matrix |
| **Supplier Statement** | Per-supplier statement with running outstanding + aging |
| **Purchases by Supplier** | Aggregated bill totals + paid + outstanding per supplier |

### Ledger
| Report | Purpose |
|---|---|
| **General Ledger** | All JE lines grouped by account; click to drill-in |
| **Trial Balance** | Dr/Cr by account, as-of-date snapshot |
| **Audit Trail** | Chronological JE log; filterable; click-in dialog |

### Financial Statements
| Report | Purpose |
|---|---|
| **P&L / Balance Sheet** | Combined statement with subtotals, retained-earnings rollover |
| **Cash Flow** | Operating + investing + financing sections; opening + closing cash reconciliation |
| **Budget vs Actual** | Per-account variance vs `Budget` table |

### Tax & Other
| Report | Purpose |
|---|---|
| **GST** | IRAS-format GST return (Box 1-15); period drilldown |
| **Fixed Assets** | Asset register + depreciation schedule |
| **Recurring** | List of `RecurringJournalTemplate` rows |
| **Bank Reconciliation** | Statement-line matching workspace |

---

## 7. Bank Reconciliation

`/portal/accounting/bank-reconciliation` (also Reports tab).

### Workflow
1. Pick a bank account (filtered via `isCashOrBankAccount`)
2. Upload bank statement: CSV with column mapping, OR PDF (Claude vision extracts)
3. Backend creates `BankStatementImport` + `BankStatementLine[]` rows
4. Auto-match each PENDING line against unmatched `JournalEntryLine` on that bank account: same signed amount + date within ±3 days
   - Exact 1 match → MATCHED
   - Multiple candidates → SUGGESTED (user picks)
   - No match → unmatched (user posts as new JE or ignores)
5. User UI: Recon summary, status chips (PENDING/SUGGESTED/MATCHED/POSTED/IGNORED), Re-run match button, Post-as-new dialog

### Endpoints
`GET /bank-rec/accounts` (uses `isCashOrBankAccount`), `POST /bank-rec/imports`, `POST /bank-rec/imports/:id/rematch`, `POST /bank-rec/lines/:id/match`, `POST /bank-rec/lines/:id/post-as-new`, `POST /bank-rec/lines/:id/ignore`, `POST /bank-rec/lines/:id/unmatch`, etc.

---

## 8. Tax / GST

`/portal/accounting/gst` — Singapore GST return (IRAS Form GST F5).

### Output
Standard boxes:
- Box 1: Total value of standard-rated supplies (sales subject to GST)
- Box 5: Total value of taxable purchases
- Box 6: Output tax (GST collected)
- Box 7: Input tax (GST paid)
- Box 8: Net GST payable / refundable

### Source
Reads JEs where lines touch the tax control account (`controlAccounts.taxLiabilities`, e.g. CL900 for default / 820 for Biofuel). Per-invoice tax amounts derived from the matching-side gross.

### Configuration
- `Organization.taxRate` — default GST rate (e.g. 9 for SG post-2024)
- `AccountingSetting.taxRegistrationNumber` — GST reg # for the return
- `AccountingSetting.taxDefaultPercentage` — fallback rate

---

## 9. Fixed Assets & Depreciation

### Asset register
`FixedAsset` table: assetCode, name, category, acquisitionCost, acquisitionDate, usefulLifeMonths, depreciationMethod (STRAIGHT_LINE / DECLINING_BALANCE / NONE), salvageValue, status.

### Auto-creation
When a PO line has `isFixedAsset: true` and the PO is confirmed, the journal-auto-post pipeline auto-creates a `FixedAsset` from the line. User completes method + useful life on the FA detail page.

### Depreciation
- `DepreciationEntry` rows track each period's depreciation
- Auto-posts JE: Dr Depreciation Expense / Cr Depreciation Provision
- Schedule generated up-front; run monthly via UI or recurring job

### UI
`/portal/accounting/fixed-assets` (or Reports tab) — register + schedule + post-depreciation button.

---

## 10. Budgets

`Budget` table: per-account per-period (year/month) amount.

`/portal/accounting/budget` — budget entry UI.
`/portal/accounting/budget-vs-actual` — variance report (Budget vs Actual values per account per period).

---

## 11. Cost Centers

`CostCenter` table — hierarchical via `parentId`, code + name + description.

Optional `costCenterId` on `JournalEntryLine` tags each posting line. Enables P&L-by-cost-center reporting (not yet a tab, but data is there).

---

## 12. Recurring Journals

`RecurringJournalTemplate`: name, frequency (DAILY/WEEKLY/MONTHLY/QUARTERLY/YEARLY), nextRunDate, lines (Json), enabled.

### Lazy hub-load trigger
On every Finance Hub load, checks for templates with `nextRunDate <= now AND enabled = true`, posts the JE, advances `nextRunDate`. Catches up missed runs in one shot (cron-free).

UI: `/portal/accounting/recurring` (or Reports tab) — list + create + run-now.

---

## 13. Smart / AI Features

### Anomaly Detector (`AnomaliesService`)
Five deterministic checks run on every Hub load, results surfaced in the "Action Queue" card:
1. **Duplicate invoices** — same amount + reference combo within 14 days
2. **Stale drafts** — DRAFT documents > 30 days old
3. **Missing tax on customer invoices** — receivable invoice (debits AR control), no tax line, still unpaid (no later PAYMENT JE with same reference). Item list + filtered audit-trail link.
4. **Unusual journal amounts** — recent expense/revenue line > 3× the account's historical average
5. **Stale unposted journals** — DRAFT JEs > N days old

Each `AnomalyFinding`:
```ts
{
  severity: 'info' | 'warning' | 'error',
  title, detail?, count?,
  link?,                              // /portal/...?journalNumbers=A,B,C
  items?: [{ journalNumber, label, amount, date }]  // per-row drill list
}
```

### LLM Categorization
Bill PDF extraction: drop PDF → Claude Sonnet 4.6 extracts supplierName / billNumber / dates / lines / totals via `POST /bills/extract`. User reviews + saves.

### Bank Statement OCR
PDF bank statement uploads → Claude vision extracts line items (date, description, amount).

### Smart Insights
Hub card surfacing month-over-month changes ("Revenue up 23% vs last month"). Currently lightweight.

### Smart Close Wizard
Period-close flow that detects unposted drafts, missing recurring runs, suspense balances, then posts the close JE (rollover P&L → Retained Earnings).

### "Ask Anything" bar (Hub)
Natural-language query box. Suggested chips for common asks. Backend not yet wired (placeholder shown).

---

## 14. Period Close

`CloseService` — locks a period (year + month):
1. Validates: all JEs POSTED, no DRAFT bills/invoices, recurring templates caught up
2. Calculates period net income (revenue - expenses)
3. Posts close JE: Dr Revenue accounts / Cr Expense accounts / Cr Retained Earnings (rolls P&L to BS)
4. Creates `PeriodClose` record marking the period locked
5. Future postings into closed period are rejected (or routed to reopening flow)

UI: `/portal/accounting` Hub → "Close Period" quick action.

---

## 15. Migration Pipeline (Xero → AIMS)

### Two paths
1. **API path** — `xero-node` SDK + OAuth 2.0. Rate-limited (60/min, 5000/day). Reserved for attachments.
2. **XLSX path** — Xero report exports → custom parsers. No rate limit. **Used for all bulk data.**

### XLSX flow
1. Export from Xero (Reports / Contacts / etc.) → drop CSV/XLSX in `~/Downloads/`
2. Run importer scripts (see SESSION_HANDOVER §2 for order)
3. Idempotent — re-running upserts, never duplicates

### What's imported
| What | Source | Target |
|---|---|---|
| CoA | ChartOfAccounts.csv | ChartOfAccount table |
| GL (5 yrs) | General Ledger Detail XLSX | JournalEntry + JournalEntryLine |
| Customers + Suppliers | Contacts CSV | Customer / Supplier tables (xeroId stamped) |
| AP Bills | Payable Invoice Detail XLSX | Document(type='BILL') |
| AR Invoices | Receivable Invoice Detail XLSX | Document(type='INVOICE') — NOT yet built |
| Credit Notes | Credit Note Detail XLSX | Document(type='CREDIT_NOTE') — NOT yet built |
| Attachments | API only (`/Invoices/{id}/Attachments`) | S3 + `Document.attachments` — NOT yet built |

### Key importer convention
Every imported row gets `config.xeroImported: true` + the Xero record's UUID (e.g. `xeroInvoiceId`, `xeroBillId`) so re-syncs match exactly.

---

## 16. Permissions & Role Model

### Tables
- `Role` per org, has `name`, `description`, `allowedModules: String[]`, `permissions` (many-to-many)
- `Permission` rows: `resource:action` (e.g. `bills:read`, `bills:update`, `accounting:read`)
- `UserRole` joins Clerk userId → Role + organizationId

### Decorators
- `@Permissions('bills:read')` on controllers — enforced by `PermissionsGuard`
- `osiris-admin` users bypass all permission checks (special case in guard)

### Visibility model (two layers)
1. **OrganizationModule** — per-org module on/off toggle (ACCOUNTING enabled or not)
2. **Role.allowedModules** — per-role module whitelist (empty array = allow all)

A user sees a sidebar item only if BOTH: org has it enabled AND at least one of the user's roles allows it.

### Sidebar (DynamicSidebarContent)
Reads merged modules from `useConfiguration()` (which calls `/configuration/complete`). Filters via `isModuleAllowed(moduleCode)` from `useUserPermissions()`.

### Common gotchas (memorized)
- New module added → backfill every org's restrictive roles' `allowedModules` (see memory note `role-allowed-modules-rollout.md`)
- New portal fetch helper → must inject `X-Active-Org-Id` from sessionStorage for admin "Viewing as <Org>" to work (memory note `portal-fetch-active-org-header.md`)

---

## 17. URL / Sidebar Map

### Sidebar parent
**Accounting** module — 3 submenus:
- **Dashboard** → `/portal/accounting` (Finance Hub)
- **Reports** → `/portal/accounting/reports` (17-tab page)
- **Setup** → `/portal/settings/accounting-setup`

### Hub (`/portal/accounting`)
- KPI cards: Revenue MTD, Net Profit MTD, Cash & Bank, GST Payable, AR, AP
- Ask-Anything bar with suggested-question chips
- Action Queue (anomaly findings)
- Smart Insights
- Quick Actions: New Invoice, New Journal Entry, View Journal Log, Close Period, Recurring, Fixed Assets, Budgets, Bills (AP), Bank Rec, Xero, All Reports, Settings

### Reports tabs (`/portal/accounting/reports?tab=...`)
| `tab=` | Label |
|---|---|
| `gl` | General Ledger |
| `tb` | Trial Balance |
| `pl` | P&L / Balance Sheet |
| `cf` | Cash Flow |
| `ar` | Accounts Receivable |
| `ar-aging` | AR Aging |
| `soa` | Customer Statement |
| `sbc` | Sales by Customer |
| `ap` | Accounts Payable |
| `ap-aging` | AP Aging |
| `supp-soa` | Supplier Statement |
| `pbs` | Purchases by Supplier |
| `bankrec` | Bank Reconciliation |
| `ba` | Budget vs Actual |
| `gst` | GST |
| `fa` | Fixed Assets |
| `recurring` | Recurring |
| `audit` | Audit Trail |

### Standalone (also reachable from sidebar / Hub quick-actions)
- `/portal/invoices` — Sales Invoice list
- `/portal/inventory/bills` — Bills list
- `/portal/payments` — Payments dashboard
- `/portal/reports/statement-of-account` — Customer SOA (duplicates the tab)
- `/portal/reports/price-history` — Price history report
- `/portal/admin/configuration` — Module toggles per org (admin only)

---

## 18. Implementation Status

### ✅ Shipped & working
- Full GL: JE create/post/void with auto-reverse, balanced enforcement, retry on numbering collisions
- Trial Balance, P&L, Balance Sheet, Cash Flow, AR/AP Aging, Audit Trail
- AR side: invoice → payment → SOA → aging (full E2E)
- AP side: bill → payment voucher → aging (full E2E, refactored to Document table)
- Smart anomaly detector (5 detectors) with per-item drill links
- Bank reconciliation (CSV + PDF upload, auto-match)
- GST return (IRAS Form F5)
- Fixed Assets register + depreciation
- Budgets + Budget vs Actual
- Cost Centers (data model + tagging)
- Recurring journals (lazy hub-load trigger)
- Period Close
- Customer Statement, Supplier Statement, Sales by Customer, Purchases by Supplier (NEW)
- Payment Voucher (AP) + AttachmentUploader (NEW)
- 11 list pages on standard PageTable component (consistent pagination + search)
- Xero → AIMS migration pipeline: CoA, GL, Contacts, Bills via XLSX

### 🟡 Partial / needs follow-up
- AR refresh from Xero (real $12M vs AIMS $7.5M — stale Apr-2026 data)
- Filter configs on the 10 newly-migrated PageTable pages (only Bills has it)
- Credit Notes XLSX importer
- 5 failed bill imports (bill-number collisions across suppliers)

### ⏳ Deferred / unbuilt
- P&L by Cost Center report
- Comparative reports (period vs prior period)
- Statement of Changes in Equity
- Attachments via Xero API (waiting on daily quota reset)
- Payments cross-reference per invoice (Stage 5 of migration)
- Order model refactor → Document(type='SALES_ORDER')
- LLM-categorization on the Ask-Anything bar (backend wiring)

---

**Last updated:** 2026-06-23 (handover session)
