# Importing a customer's legacy data into AIMS — handover runbook

Read this before porting ANY new client's old-system data (master files + GL +
stock + open balances) into AIMS. It is the recipe we used for **Chong Aik
International** (the first full legacy port from Excel) and for **WCT** (ERP
history import). Follow the same shape for the next customer: copy a script,
swap the org id, remap the columns.

The scripts live in `api-server-production/scripts/`. Run them from **inside
`api-server-production`** with ts-node:

```bash
cd api-server-production
npx ts-node --transpile-only scripts/<name>.ts --env dev            # dry run (prints, writes nothing)
npx ts-node --transpile-only scripts/<name>.ts --env dev --apply    # write
```

**No `--apply` = dry run.** Always dry-run first and read the counts. `guru runs
every prod script himself` — never run `--env prod --apply`; hand guru the exact
command.

---

## 0. The golden rules (do not break these)

1. **One org id per customer**, a fixed UUID baked into the script as a const
   (Chong Aik = `ca100000-0000-4000-8000-ca1000000001`). Every row written
   carries `organizationId = ORG_ID`. A guard (`assertOrgOnly`) refuses any row
   whose `organizationId` is not that id — keep it, it is what stops a script
   from poisoning another tenant.
2. **Idempotent, keyed on the legacy code.** Every stage keys on a legacy
   identifier (customerCode, supplierCode, skuKey, `config.legacyKey`,
   `journalNumber`) and only inserts what is missing. Re-running a stage must
   never duplicate. `createMany({ ..., skipDuplicates: true })`.
3. **The ported GL IS the general ledger — nothing auto-posts.** Imported
   invoices/bills/receipts are written with `createdBy: 'legacy-import'`, their
   own numbers and money, and a single matching POSTED `JournalEntry` whose
   `journalNumber` is the legacy reference. **Do not let the app post them
   again** — that double-counts against the imported GL. Historical docs are
   stamped PAID and carry no native journal of their own (the GL journal is the
   only one). See the accounting guards memo — `aims_je_guard` will throw if a
   second journal is attempted; that means the flow is wrong, do not drop the
   trigger.
4. **Money is stamped, never hand-set.** Write document money only through
   `stampDocumentMoney()` from `src/common/document-money.ts` (stamps
   `outstandingBalance` / `paidToDate` / `totalWithTax` + legacy twins). Never
   set those config keys directly.
5. **Dry-run, verify, hand to guru for prod.** Ship a `verify` stage that
   re-reads the DB and proves journals balance and control accounts tie.

---

## 1. Two DB layouts — the scripts must handle both

Use `scripts/lib/tenancy-clients.ts`. It hides the difference:

- **dev** = per-org tenancy. Platform-level rows (Organization, OrgTenant,
  OrganizationUIConfig, OrganizationModule, UserOrganization, DocumentTemplate)
  go through the `plat` client; org-scoped rows (Role, Permission, UserRole,
  Supplier, Asset, Category, Document, DocumentItem, AccountingSetting, TaxRate,
  DocumentNumberFormat) go through the `org` client, which points at the
  `org_<name>` Postgres schema. The org schema must already exist
  (`prisma/tenancy/orgs/<name>.prisma` pushed + client generated via
  `npm run tenancy:generate`).
- **staging/prod** = the single `public` schema. `plat` and `org` are the
  **same** client.

Boilerplate every import script starts with:

```ts
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';
const ENV = (argVal('--env', 'prod') || 'prod') as Env;
loadEnv(ENV);                                  // MUST call before clientsFor; validates the Neon host
const { plat, org: p, layout, disconnect } = clientsFor(ENV, 'org_<name>');
```

`loadEnv` reads `.env` (dev) / `.env.staging` / `.env.production` and refuses to
run if the DATABASE_URL host is not the expected Neon endpoint for that env
(dev=ep-steep-truth, staging=ep-odd-truth, prod=ep-icy-moon). This is the seatbelt
against pointing a dev script at prod.

---

## 2. The Chong Aik precedent — scripts, in run order

The customer handed over two zips (`testdata1.zip` + `retestdata2.zip`) of Excel
exports from their legacy trading system, unpacked into
`~/Downloads/chongaik-books/`. Order matters — later stages need earlier ones.

| # | Script | What it does |
|---|--------|--------------|
| 1 | `setup-chongaik-org.ts` | Builds the **config shell only** — feature flags, modules, roles+permissions, GST tax codes, number formats, accounting settings — copied from a trading-company source org. Admin is a Clerk user by phone (OTP). No COA, stock or documents. |
| 2 | `import-chongaik-books.ts` | The master import. Multi-stage (below). Reads the master files + GL + stock + sales. |
| 3 | `import-chongaik-stock-details.ts` | 5 years of **purchase history** from `STOCK_DETAILS 2.xlsx` → item master (Asset), Suppliers, Categories, historical BILL documents + DocumentItems. No journals/stock/AP. |
| 4 | `import-chongaik-creditor-balances.ts` | Brings the legacy **CREDITOR LISTING** into document-level AP (re-opens newest bills to match each supplier's owed balance; remainder → one header-only `BAL <code>` bill). |
| 5 | `chongaik-invoice-template.ts`, `chongaik-do-template.ts` | Seed the org's invoice / DO document templates to match the legacy layout. |
| — | `chongaik-ui-tweaks.ts`, `chongaik-email-login.ts` | Per-org UI knobs and login method. |
| — | `_peek-ca-*.ts`, `_chongaik-demo-census.ts`, `_verify-import.ts` | Throwaway inspection/verification scripts (prefix `_`). |

### `import-chongaik-books.ts` stages (`--stage`, default `all`)

Run in this order (each needs the ones before it):

```
coa        ChartOfAccount (legacy codes kept, typed by prefix) + AccountingSetting
           (control accounts, code ranges, FY) + Organization address/reg no.
customers  Customer by customerCode (numeric legacy codes zero-padded to 5: 123 -> 00123)
suppliers  Supplier upsert by supplierCode (fills address/phone/email on the
           ones the purchase import already created)
items      Asset upsert by skuKey from the STOCK LISTING: qty on hand, costPrice,
           selling price, category, uom + one QuantityAdjustment (SET, "Opening
           stock") per item with stock = the audit trail
sales      INVOICE (INV/POS) + CREDIT_NOTE per legacy ref, lines + DocumentItem
           (ASSET link). Header money from the GL; lines from the sales analysis;
           paid/outstanding from receipts allocated in the GL
bills      Supplier invoices the GL carries for the current FY, header-only, PAID
receipts   OFFICIAL_RECEIPT per legacy REC + one Payment per allocation to an
           invoice we hold (older ones kept as legacyAllocations)
gl         One POSTED JournalEntry per legacy document (journalNumber = legacy
           ref; opening balances = "OB 2026-01-01" dated 31/12 prior FY),
           sourceDocumentId -> the doc. createdBy 'legacy-import'. THIS is the GL.
verify     Re-reads DB: journals balance, each account movement == sheet, AR
           control vs invoice outstanding, counts
```

Extra flags: `--dir <folder>` (source), `--asof YYYY-MM-DD` (opening-stock
adjustment date), `--limit <n>`.

---

## 3. The source Excel files and their columns

The legacy exports Chong Aik gave us (a new customer's will be named differently
— **map, don't assume**):

| File | Holds | Key columns |
|------|-------|-------------|
| `CHART_OF_ACCOUNTS.xlsx` | 433 GL accounts | code, name, currency |
| `GENERAL_LEDGER.xlsx` | 80k posting lines incl. "BALANCE B/F" | Document, Accn, Description, Date, X-Reference, Remark, Debit, Credit |
| `CUSTOMER.xlsx` | customer master | code, Name, Curr, Tel, Add1..Add5, (Terms/Contact/Fax not stored) |
| `SUPPLIER.xlsx` | supplier master | code, name (may carry a `(JPY)` currency tag), Curr, Tel, Add1..Add5 |
| `SALESMAN.xlsx` | salesman code -> name | **no AIMS model** — names are stamped onto the invoices they sold |
| `INVENTORY.xlsx` | STOCK LISTING | stock code, Description, qty on hand, Cost, Unit Price, Category, Uom |
| `DETAILED_SALES_ANALYSIS.xlsx` | every invoice/POS/CN **line** | per-line qty, price, amount, customer, ref |
| `STOCK_DETAILS 2.xlsx` | 5yr purchase lines | Reference, Date, Supplier, Supplier Name, Stock Code, Description, Quantity, Uom, Category(=brand), Cost(unit), Total Cost |
| `CREDITOR_LISTING.xlsx` | AP owed per supplier | code, name, Local Amount (negative = owed) |
| `DEBTORLISTING.xlsx`, `SOA.pdf` | reference only | (DEBTORLISTING was a mislabelled copy of the creditor listing — check!) |

---

## 4. Reusable sheet-reading mechanics (copy these verbatim)

All in `import-chongaik-books.ts` — lift them into the next import:

- **`readTable(file, headers[])`** — legacy report sheets have ~6 title rows,
  then a header row, data, then a `TOTAL` row, and may not start at column A.
  This reads with `sheet_to_json(ws,{header:1})`, finds the header row by
  matching all the names you pass, maps columns by name, and stops at blank /
  `TOTAL`. **Always locate columns by header name, never by fixed index.**
- **`excelDate(v)`** — SheetJS shifts SGT calendar days to UTC (a `2026-01-04`
  cell reads `2026-01-03T16:00Z`). This re-pins the Singapore day to UTC
  midnight. Use it for every date cell or you lose a day.
- **`legacyCode(v)`** — numeric customer codes come back as numbers; zero-pad to
  5 (`123 -> "00123"`) to match how the legacy SOA prints them.
- **`CURRENCY_MAP` / `CURRENCY_RE` / `supplierName()`** — parse a currency out of
  a name tag like `"FJT PARTS (SGD)"` and strip it from the name. Maps aliases
  (JY->JPY, RMB->CNY, HK$->HKD...). Default SGD.
- **`UOM_MAP` / `mapUom()`** — normalise units (PC/PCS -> PCS, PR -> PAIR).
- **`addressOf(r)`** — join `Add1..Add5` with newlines.
- **`emailOf(v)`** — only keep a cell that is actually an email.
- **`num()` / `clean()` / `s()`** — comma-tolerant number, whitespace-collapsed
  string, trimmed string.
- **`assertOrgOnly(rows,label)`** + **`createMany(model,label,rows)`** — the
  org-scope guard and chunked insert with `skipDuplicates`.

Field mappings used (adapt to the new schema fields — all org-scoped):

- **Customer**: `{ id, organizationId, customerCode, name, email, phone, address, currency }`
  (Terms, Contact person, Fax have no AIMS field — logged, not stored).
- **Supplier**: `{ supplierCode, name, currency, email, phone, address }`.
- **Asset** (item master): `{ skuKey, name, description, categoryId, uom, costPrice, price, isTracked:false, isExternal:true, assetClass:'EQUIPMENT', quantity }`.
  Parts are **not** serialised — `isTracked:false`; on-hand qty comes from the
  STOCK LISTING, opening stock recorded as a `QuantityAdjustment` (SET).
- **Category**: one per brand, `{ name }`.
- **ChartOfAccount**: `{ code, name, isControlAccount, isSystem:false, isActive:true }` (legacy codes kept, typed by code prefix).

---

## 5. How to do the NEXT customer

1. **Get the source files.** Ask guru for the customer's exports (zips of Excel
   + any listings). Unpack into a `~/Downloads/<customer>-books/` folder. Open
   each sheet and **read the real header names** — do not assume they match
   Chong Aik.
2. **Create the org shell.** Copy `setup-chongaik-org.ts` -> `setup-<cust>-org.ts`,
   pick a new fixed `ORG_ID` UUID and name, set the admin (phone/email), choose
   the source org to copy config from. On dev, create the tenancy schema first
   (`prisma/tenancy/orgs/<name>.prisma`, push, `npm run tenancy:generate`).
3. **Copy `import-chongaik-books.ts` -> `import-<cust>-books.ts`.** Change
   `ORG_ID`, `ORG_NAME`, `SOURCE`, the default `--dir`, and the `org_<name>`
   schema. Then go sheet by sheet and **re-map columns** in each stage's
   `readTable(...)` header list and the field builders. Keep the stage order and
   the helpers.
4. **Decide the cut-off / opening-balance date** from the GL's "BALANCE B/F"
   row. Opening balances post as the `OB` journal dated the last day of the
   prior FY.
5. **Dry-run every stage on dev**, read the counts and the "not stored" notes,
   then `--apply` on dev. Run the `verify` stage. Eyeball the AR/AP control
   accounts against the customer's debtor/creditor listings.
6. **Templates + UI**: seed the invoice/DO templates to match their old layout;
   set per-org feature flags and modules for anything customer-specific (new
   features go behind an org flag, default OFF).
7. **Update AIMS knowledge**: if the import turns on any user-facing behaviour,
   add/adjust the line in `api-server-production/src/guide/app-knowledge.ts`.
8. **Hand guru the exact prod commands** (setup org, then each import stage,
   then creditor balances, then verify). Guru runs prod. Do not run prod
   `--apply` yourself, and do not commit — guru pushes.

---

## 6. ERP "history only" documents (the WCT pattern)

When a customer's old docs should exist **as read-only history** (their own
numbers/totals, never posting to the GL, posting queue, Xero or AI index), stamp
them with `config.erpImport = { source, batch, erpId, originalNumber, status,
balanceAtImport }` — see `src/common/erp-import.ts` (+ the portal twin
`portal-production/helpers/erpImport.ts`). `isErpImported(config)` /
`erpImportOf(config)` read it. Imported delivery orders become read-only
`DELIVERY_ORDER` rows with **no `DocumentItem`** (so no stock can move) and every
DO entry point calls `assertNotErpImportedDo`. Payments on an open imported
invoice still reduce its balance. The money signature helpers
(`moneySignature` / `erpStoredTotalsOf`) make the editor show the stored
subtotal/GST/total verbatim instead of recomputing — needed when the old system
rounded GST differently.

Chong Aik's port is the heavier "becomes the live books" model (real GL,
documents, stock). WCT's is the lighter "history only" model. Pick per customer:
is their old data the live ledger going forward, or just reference?

---

## 7. Gotchas log

- SheetJS date shift (see `excelDate`) — always re-pin to SGT midnight.
- Legacy numeric codes come back as numbers; zero-pad.
- A "debtor listing" file may actually be a copy of the creditor listing — check
  the contents, not the filename.
- Tenancy client rejects `Prisma.sql` fragments in `$queryRaw`; use positional
  params only (large-org perf memo).
- Don't `createMany` without `skipDuplicates` — re-runs will throw or double.
- Control-account sign: a creditor listing's "owed" is a negative Local Amount;
  trade-creditors control can net to a debit when suppliers carry prepayments —
  list and skip debit balances, AIMS aged payables has no supplier-debit row.
- The `aims_je_guard` DB trigger blocks a second native journal per
  (org, sourceDocumentId, type) — if an import throws "AIMS guard: ...", the
  flow is posting twice; fix the flow, never drop the trigger.

---

_Reference scripts (all in `api-server-production/scripts/`):
`setup-chongaik-org.ts`, `import-chongaik-books.ts`,
`import-chongaik-stock-details.ts`, `import-chongaik-creditor-balances.ts`,
`import-wct-customers.ts`, `wct-erp-import.js`, `onboard-client.ts` (generic new-client
bootstrap). Shared lib: `scripts/lib/tenancy-clients.ts`. Money:
`src/common/document-money.ts`. ERP marker: `src/common/erp-import.ts`._
