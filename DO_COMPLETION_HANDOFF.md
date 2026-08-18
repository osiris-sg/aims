# DO Completion → Invoice: what data actually crosses the line

**Audience:** a developer building the invoicing/pricing layer downstream, with no prior context on this codebase.
**Status:** written 2026-08-18 against `elroy/dev` @ `e11f7e6`. Every claim below was read out of the code; file:line references are given so you can re-verify. Where I queried a database it was the **dev** Neon DB (`.env` → `AIMS_DB`), and that is called out explicitly — the dev DB is behind production in places.

---

## 0. Orientation — the five objects you need

| Object | What it is |
|---|---|
| **`Delivery`** ("run") | A physical trip. Has `direction` (OUTBOUND/RETURN), `scheduledFor`, `startedAt`, `completedAt`, and N `DeliveryItem` rows (one per physical unit). |
| **`Document`** | *Every* document type lives in this one table, discriminated by `type` (`DELIVERY_ORDER`, `INVOICE`, `QUOTATION`, `RETURN_DELIVERY_ORDER`, …). All the interesting content is in the untyped `config` JSON blob. |
| **`DocumentItem`** | Junction rows materialised from `config.items[]` — one row per *resolvable* line (needs an inventory or asset id). Carries per-item delivery state (`deliveryStatus`, `deductedAt`, `deliveredAt`, `completedAt`). |
| **`Inventory`** (a "unit") | One physical serialised unit. `sku` is the real-world nameplate identifier the office writes on paperwork; `serialNumber` is usually null. Belongs to an `Asset` (the catalog product). |
| **`ProjectDeployment`** | A rental/sale *event* on a project. Carries `type` (RENTAL/SALE), `deployedDate`, `offHiredDate`, `monthlyRate`, `status`. Units join it via `Assignment` rows. |

The DO is deliberately a **goods document** — Item / Description / Quantity only; its printed form renders no prices and its line amounts are always `0`. Pricing was moved onto the invoice in commit `c9d285e` ("auto-price delivery invoice lines from the asset; DO stays goods-only").

---

## 1. THE TRIGGER

### 1.1 The gate

`DocumentsService.maybeCompleteDeliveryOrderAndInvoice(documentId, organizationId)`
→ `api-server-production/src/documents/documents.service.ts:4356`

```ts
const items = await prisma.documentItem.findMany({ where: { documentId },
  select: { isService: true, deliveryStatus: true } });
const deliverable = items.filter(i => !i.isService);
const allDone = deliverable.length === 0 ||
                deliverable.every(i => i.deliveryStatus === 'completed');
if (!allDone) return null;

await prisma.document.update({ where: { id: documentId },
  data: { status: 'delivered_installed' } });

return this.createInvoiceFromDeliveryOrder(documentId, organizationId);
```

Three things to internalise:

1. **The gate reads `DocumentItem` rows, not `config.items[]`.** A config line with no `inventoryItemId` *and* no `assetId` (free-typed text, remarks, service descriptions) never becomes a `DocumentItem` — `syncDocumentItems` skips it at `documents.service.ts:401`. Such lines are invisible to the gate.
2. **Service items are excluded** (`isService: true` → auto-complete).
3. **`deliverable.length === 0` counts as "all done."** A DO whose lines are *all* free-typed therefore satisfies the gate on the very first call and gets invoiced immediately, with unpriced description-only lines.
4. There is no `completed` value in the `DocumentStatus` enum; **`delivered_installed` is the terminal DO status.**

### 1.2 The invoice creator

`createInvoiceFromDeliveryOrder` → `documents.service.ts:4386`

```ts
// Idempotency guard — skip if an INVOICE already points at this DO
const existing = await prisma.document.findFirst({
  where: { organizationId, type: 'INVOICE',
           config: { path: ['sourceDocumentId'], equals: documentId } },
});
if (existing) return existing;                       // never creates a second one

const invoiceConfig = {
  ...doConfig,                                        // whole DO config carried forward
  items: await this.priceInvoiceLinesFromAsset(doConfig.items ?? [], organizationId),
  date: new Date().toISOString(),                     // stamped NOW, not the delivery date
  sourceDocumentId: documentId,
  sourceDocumentNumber: doDoc.name,
  sourceDocumentType: 'DELIVERY_ORDER',
};

const invoice = await this.createBasicDocument(
  templateId, 'INVOICE', organizationId, invoiceConfig, doDoc.projectId ?? undefined);
```

There is **no `Document.sourceDocumentId` column**. The DO↔invoice link is a JSON path (`config.sourceDocumentId`) and it doubles as the idempotency key. Any query you write to find "the invoice for this DO" must use the JSON path form above.

### 1.3 What status does the invoice land in?

**`unconfirmed`.** `createBasicDocument` (`documents.service.ts:1816`, the `prisma.document.create` at :2009) never sets `status`, so it takes the schema default `DocumentStatus @default(unconfirmed)`. Several code comments and log lines call this "DRAFT" — that is loose language, not the enum value. A `draft` value does exist in the enum and is used by other flows; DO-sourced invoices do not use it.

Confirmed against dev DB: invoice `BI2026080115` (`85b0bf75-e976-4be1-a29f-75cd1b9507a9`), created from DO `83bdfa27-7bd0-4e69-b372-20b6c3aba893` → `status = 'unconfirmed'`.

**No GL journal is created at this point.** Journal posting for invoices happens in `repostGlForDocument` (`documents.service.ts:190`), which only runs from the editor-save path (`:1203`) when the payload carries a full `items` array. The auto-created invoice is never saved through that path, so it sits outside the GL until a human opens and saves/confirms it. `confirmInvoice` (`:4696`) then moves it straight to `pending_payment` (there is no resting `confirmed` state for invoices).

### 1.4 The four paths that DO fire it

| # | Entry point | File:line | Notes |
|---|---|---|---|
| 1 | Per-unit field flow, `install` or `skip` action | `documents.service.ts:3893` / `:3899` (inside `advanceDeliveryItem`, `:3791`) | Every unit that reaches `completed` re-fires the gate; the first one that satisfies it wins. |
| 2 | Office **bulk-complete** button (`POST /documents/:id/bulk-complete-do`) | `documents.service.ts:4583` (inside `bulkCompleteDeliveryOrder`, `:4543`) | For non-taggable goods the field can't scan. |
| 3 | **Scheduled run** reaches `completed` — run already linked to a pre-created draft DO | `deliveries.service.ts:1154` (inside `commitScheduledRunOnCompletion`, `:1151`) | Commits the existing DO, then fires the gate. |
| 4 | **Standalone run** reaches `completed` — no DO existed | `deliveries.service.ts:1207` (inside `autoCreateDoOnRunCompletion`, `:1184`) | Mints a DO from the run (`createDoFromDelivery`, `:1345`), commits it, then fires the gate. |

Paths 3 and 4 are mutually exclusive, dispatched in `recomputeRunStatus` (`deliveries.service.ts:1069`, branch at `:1122`) the *first* time a run's item-status fold reaches `completed`.

The office "Deliver all" button routes through `acknowledgeAll` (`deliveries.service.ts:1740`), which for OUTBOUND runs does `ack` then `skip` per unit — so it lands on path 1/3/4 like any other completion.

### 1.5 The paths that DO **NOT** fire it — read this before you debug a missing invoice

- **`ack` alone.** A unit acknowledged but not installed sits at `not_installed`. The gate is not even called (`advanceDeliveryItem` only calls it on `install`/`skip`). Delivered ≠ invoiced.
- **Partial completion.** Any single deliverable `DocumentItem` not at `completed` → gate returns `null`, DO status unchanged, no invoice.
- **RETURN runs.** `recomputeRunStatus` branches on `direction === RETURN` *before* the DO logic (`deliveries.service.ts:1126`) and calls `completeReturnRun` (`:1889`), which creates a `RETURN_DELIVERY_ORDER` and **no invoice, no GL**. See §6.
- **Office "Create DO from selected"** (`POST /deliveries/:id/create-do` → `createDoFromDelivery`). Creating a DO by hand never invoices; only the run-completion wrapper does.
- **Office DO confirm** (`confirmDeliveryOrder`, `documents.service.ts:4597`). Sets DO status `confirmed` and commits linked delivery items, but deliberately does not call the gate.
- **A DO that already has an invoice.** Idempotency guard returns the existing invoice. This is never unwound — reversal is a manual credit note.
- **Everything in paths 3 and 4 is best-effort.** Both wrappers are wrapped in `try/catch` that logs and swallows (`deliveries.service.ts:1157`, `:1211`). A failure there leaves the run completed with no DO and/or no invoice, and nothing retries. Check the server logs for `commitScheduledRunOnCompletion failed` / `autoCreateDoOnRunCompletion failed`.

---

## 2. THE DATA HANDED OVER

### 2.1 Document-level (`Document` columns)

| Column | Value | Source |
|---|---|---|
| `type` | `'INVOICE'` | literal |
| `status` | `unconfirmed` | schema default |
| `name` | e.g. `BI2026080115` | org's `DocumentNumberFormat` for INVOICE, else legacy `{prefix}{YYYY}{MM}-{NNN}` (`createBasicDocument`, `:1880-1917`) |
| `documentTemplateId` | resolved per org | `resolveTemplateIdForType('INVOICE', org)` — primary selection → isDefault → newest → org default → cross-org seeded default (`:4502`) |
| `projectId` | copied from the DO's `projectId` column | `createInvoiceFromDeliveryOrder` passes `doDoc.projectId` |
| **`projectDeploymentId`** | **`null`** | `createBasicDocument` never writes it. It is only backfilled later, at `confirmInvoice` (`:4823-4860`), by inheriting from the source DO — and delivery-created DOs don't have one either, so in practice it stays null unless the office attached it by hand. |
| `config` | see below | |

### 2.2 `config` (the JSON blob)

`{...doConfig}` spread, then three keys overwritten/added:

| Key | Value |
|---|---|
| `items` | re-priced (§3) |
| `date` | `new Date().toISOString()` — **the invoice-creation timestamp, not the delivery date** |
| `sourceDocumentId` | the DO's `Document.id` |
| `sourceDocumentNumber` | the DO's `name` |
| `sourceDocumentType` | `'DELIVERY_ORDER'` |

Everything else is whatever the DO carried. For a **delivery-created** DO (`createDoFromDelivery`, `deliveries.service.ts:1445-1483`) that is a thin set: `customerId`, `customerName`, `customer{id,name}`, `deliveryTo`, `attention{name,phoneNumber}`, `sourceDeliveryId`. For a **scheduled** DO (`createScheduled`, `:377-416`): `poNo`, `projectName`, `documentInfo.projectName`, `deliveryTo`, `customerId/Name/Code/Address/Email`. For an **office-editor** DO you get the full editor payload (`billTo`, `dueDate`, `paymentTerms`, `subTotal`, `gstAmount`, `nettTotal`, `termsAndConditions`, …).

`createBasicDocument` then seeds org defaults onto the config if absent (`:1924-1990`): `logo`, `stamp.company`, `tableColumnOrder`/`columnLabels` from the template, and the tax block —

```jsonc
"documentInfo": { "taxApplicable": "Y"|"N",   // org.taxApplicable, as a Y/N STRING
                  "absorbTax":    "Y"|"N",   // org.absorbTax
                  "gstPercent":   9,          // org.taxRate
                  "currency":     "SGD" }     // org.defaultCurrency
```

plus per-doc-type boilerplate (`termsAndConditions`, `note`, `footerMessage`) from `organization.docTypeDefaults['INVOICE']`.

**`sourceDeliveryId` is your best breadcrumb back to the physical run** — but it only exists on the delivery-created path (path 4). Scheduled DOs (path 3) don't carry it; for those you join `DeliveryItem.documentId → Delivery`.

### 2.3 Per-line fields in `config.items[]`

The invoice's lines are the DO's lines with pricing overwritten. What's present depends on which flow built the DO:

| Field | Delivery-created DO (path 4) | Scheduled DO (path 3) | Office-editor DO | Written by |
|---|---|---|---|---|
| `description` | ✅ `DeliveryItem.description` ?? `Asset.name` ?? `Inventory.sku` | ✅ `Asset.name` | ✅ free text | |
| `quantity` | ✅ `DeliveryItem.quantity` | ✅ always **1** (catalog lines are expanded to N × qty-1 slots) | ✅ | |
| `unitPrice` | **overwritten** by pricing | **overwritten** | **overwritten** | `priceInvoiceLinesFromAsset` |
| `price` | **added** (mirror of `unitPrice`) | **added** | **added** | same |
| `amount` | **overwritten** = `round(unitPrice × qty, 2)` | **overwritten** | **overwritten** | same |
| `inventoryItemId` | ✅ the unit id | ✅ *only after* a rider binds a unit into the slot (`bindUnitToUnboundDoSlot`, `:4205`, mirrors it into config at `:4278`) | ✅ if picked from stock | |
| `assetId` | ❌ **not written** | ✅ written at schedule time | usually ❌ | |
| `serialNumbers` | ✅ `[Inventory.sku]` — a 1-element array | ✅ added at bind time | ❌ | this fleet stores the nameplate identifier in `sku`; `serialNumber` is null for ~92% of units |
| `itemCode` | ✅ `Asset.skuKey` | ✅ `Asset.skuKey` | ✅ free text | |
| `skuKey` | ✅ `Asset.skuKey` | ✅ | ❌ | |
| `sku` | ❌ | ✅ `Asset.skuKey` | sometimes | |
| `deliveryGroup` | ✅ `Asset.id` — display grouping key only | ✅ `assetId` | ❌ | consumed by the preview to render "Rental of N units of X / Model: … / S/No.: …" |
| `deploymentType` | ✅ `'RENTAL'`\|`'SALE'` when the unit has an active deployment | ❌ **never written** | ❌ | drives pricing intent (§3) |
| `year` | ✅ only when `Inventory.year != null` (rare) | ❌ | ❌ | display only |
| `uom` | ❌ | ❌ | ✅ (`PCS`, `UNIT`, …) | |
| `discount` | ❌ | ❌ | ✅ | |
| `tax` | ❌ | ❌ | ✅ (string, e.g. `"9"`) | §4 |
| `isService` | ❌ | ❌ | ✅ if flagged | |
| `accountCode` / `revenueTag` | ❌ | ❌ | ✅ on some orgs' lines | GL revenue account — **absent on every auto-created line** |

Anything the pricing function doesn't recognise is passed through untouched (`return { ...it, unitPrice, price, amount }`), and lines with no resolvable asset are returned completely unchanged (still `unitPrice: 0, amount: 0`).

### 2.4 `DocumentItem` rows on the invoice

`createBasicDocument` calls `syncDocumentItems` (`:348`) for the new invoice, so the invoice gets its own junction rows:

| Column | Value |
|---|---|
| `itemId` / `itemType` | `inventoryItemId` → `INVENTORY`, else `assetId` → `ASSET`. **Line skipped entirely if neither resolves to a real row** (`:401-406`). |
| `inventoryId` / `assetId` | typed FK backfill of the above |
| `lineNumber` | 1-based position in `config.items[]` |
| `sku` | `item.sku \|\| item.skuKey \|\| null` |
| `description`, `quantity`, `unitPrice`, `amount` | from the priced config line |
| `discount` | `0` (delivery-created lines carry no discount) |
| `uom` | `null` (delivery-created lines carry no uom) |
| `isService`, `isFixedAsset` | `false` |
| `deliveryStatus` | `not_delivered` (default — the invoice's own rows are not part of any delivery) |
| `deductedAt`/`deliveringAt`/`deliveredAt`/`completedAt` | **all null** — the delivery timestamps live on the **DO's** rows, not the invoice's |

### 2.5 A real example

From the **dev** DB, the only DO-sourced invoice there:

```
Document  id=85b0bf75-e976-4be1-a29f-75cd1b9507a9  name=BI2026080115
          type=INVOICE  status=unconfirmed  createdAt=2026-08-02T20:00:51.227Z
          projectId=null  projectDeploymentId=null
          org=52e90ba8-bfbd-48b0-bb76-4f9667bf74f1

config.sourceDocumentId     = 83bdfa27-7bd0-4e69-b372-20b6c3aba893
config.sourceDocumentNumber = "DO-ZZTEST-DELIVERY-TEST"
config.sourceDocumentType   = "DELIVERY_ORDER"
config.date                 = "2026-08-03T04:00:51.074Z"
config.documentInfo         = { currency:"SGD", absorbTax:"N", gstPercent:9, taxApplicable:"Y" }
config.items = [
  { description:"ZZTEST Asset (slot A)", quantity:1, unitPrice:0, amount:0,
    assetId:"976f1f1c-e883-44bd-af94-2be873bc340a",
    inventoryItemId:"df0d0497-5322-470a-b015-8ef0d68a9325",
    serialNumbers:["ZZTEST-AST-001"] },
  { …slot B… }, { …slot C… }
]
DocumentItem rows: []       ← the test units were deleted afterwards, so syncDocumentItems
                              could not resolve them; normally you get one row per line
```

⚠️ **This row predates `c9d285e`** (pricing landed 2026-08-18; this invoice is from 2026-08-02), which is why every `unitPrice` is `0`. The dev DB has zero assets with a rental `customPrices` entry, so it cannot demonstrate the priced path. Production is where the ~14 "Monthly Rental" assets live (per the commit message for `c9d285e`) — I do not have production credentials in this workspace, so I have not observed a priced line in the wild. What the current code *emits* for a priced rental line, derived from `priceInvoiceLinesFromAsset`:

```jsonc
{ "description": "LION 125 kVA Generator",
  "quantity": 1,
  "unitPrice": 1200, "price": 1200, "amount": 1200,   // ← Asset.customPrices "Monthly Rental"
  "inventoryItemId": "eb5c12e2-…",
  "serialNumbers": ["MG20250114"],                     // Inventory.sku
  "itemCode": "LION135", "skuKey": "LION135",          // Asset.skuKey
  "deliveryGroup": "976f1f1c-…",                       // Asset.id, display grouping
  "deploymentType": "RENTAL" }
```

Note there is no `period`, no `from`/`to`, no `days`, no `months` — see §4.

---

## 3. PRICING AS IT WORKS TODAY

`priceInvoiceLinesFromAsset` → `documents.service.ts:4446`. One batched pass, no N+1.

### 3.1 Resolving the asset

```
assetId = line.assetId ?? Inventory[line.inventoryItemId].assetId
```
No asset resolved → **the line is returned untouched** (stays at `0`). This is how remarks/free-typed lines survive intact.

The `Inventory` lookup is `findMany({ where: { id: { in: unitIds } } })` — not org-scoped. The `Asset` lookup **is** org-scoped (`where: { id: { in: assetIds }, organizationId }`), so a cross-org unit id can never yield a price; the line just falls through to "no asset" and stays at 0.

### 3.2 Determining RENTAL vs SALE intent

Three-step fallback, per line (`:4478`):

```
intent = line.deploymentType                                   // set by createDoFromDelivery
      ?? Assignment{inventoryId, endDate:null, projectDeploymentId≠null}
           .orderBy(startDate desc).first.projectDeployment.type
      ?? 'RENTAL'                                              // a delivered unit is a rental
```

- Step 1 hits only on the **delivery-created** path — `createScheduled` never writes `deploymentType`, and neither does the office editor.
- Step 2 requires `line.inventoryItemId`. **A scheduled-DO line whose slot was never bound to a unit has an `assetId` but no `inventoryItemId`, so it skips step 2 entirely and is priced as RENTAL by default.**
- `ProjectDeployment.type` is the same field the office toggle writes (`setItemDeploymentType`, `deliveries.service.ts:859`, and `convertDeploymentToSale`, `projects.service.ts:992`). Note it mutates the *deployment*, which may cover several units — it is not a per-line override.

### 3.3 Which price field

| Intent | Field read | Fallback |
|---|---|---|
| `SALE` | `Asset.price` (a `Float?`; the schema comments call it "legacy: treated as the selling price") | `0` if null or non-numeric |
| `RENTAL` | `Asset.customPrices` — a JSON array `[{label, value}]`. Matched **`/monthly\s*rental/i` first, then `/rental\|hire/i`** (handles the "Rental Price" outlier). Value coerced via `Number()`. | `0` |

```ts
const qty    = Number(it.quantity) || 1;      // note: 0 quantity becomes 1
const amount = Math.round(unitPrice * qty * 100) / 100;
return { ...it, unitPrice, price: unitPrice, amount };
```

### 3.4 When no price matches

By design: **no guessing.** The line stays at `unitPrice: 0, amount: 0` on the still-editable unconfirmed invoice for the office to fill in. There is no error, no flag, no log line, and nothing in the payload distinguishes "priced at $0" from "no price found". If your layer needs to know, you have to re-derive it by checking whether the asset had a matching price entry.

`Asset.costPrice` is never consulted here (it's used only for COGS in perpetual-inventory GL posting).

---

## 4. ⚠️ WHAT IS NOT THERE

This is the important section. Everything below was searched for and is genuinely absent.

### 4.1 NO rental period. Nothing on the invoice bounds a billing window.

Not a single date on the invoice or its lines describes the hire period. Here is every date in reach, and where it actually lives:

| Date | Exists? | Where | Reachable from the invoice? |
|---|---|---|---|
| `config.date` | ✅ | invoice config | **On the invoice — but it's `new Date()` at creation time.** It is a "when we cut the invoice" stamp, not a delivery date. |
| Delivery/hand-off timestamp per unit | ✅ | **the DO's** `DocumentItem.deliveredAt` / `.completedAt` / `.deliveringAt` / `.deductedAt` | Only via `config.sourceDocumentId` → DO → its `DocumentItem` rows. **Not on the invoice's own rows** — those are all null. |
| Same, on the run side | ✅ | `DeliveryItem.deliveringAt` / `.deliveredAt` / `.completedAt` | Via `sourceDeliveryId` (path 4 only) or `DeliveryItem.documentId → DO`. |
| Run-level dates | ✅ | `Delivery.scheduledFor` (office-scheduled target date, null for ad-hoc runs), `Delivery.startedAt` (defaults to row creation), `Delivery.completedAt` | Same joins as above. |
| Rental start | ✅ | `ProjectDeployment.deployedDate` and `Assignment.startDate` | **Only via the unit** — invoice line → `inventoryItemId` → `Assignment{endDate:null}` → `ProjectDeployment`. There is no direct link. |
| Rental end | ✅ | `ProjectDeployment.offHiredDate` | Same indirect path. See §6. |
| Billing period start/end on the line | ❌ | nowhere | — |

**Recommendation if you're implementing proration:** `ProjectDeployment.deployedDate` is the truest "rental started" signal (written by `fieldDeploy` at `projects.service.ts:748` as `now`, or by `createDeployment` at `:619`). The DO's `DocumentItem.completedAt` is the truest "unit physically handed over and installed" signal. They can differ — assignment now happens at delivery *start*, not at ack (`deliveries.service.ts:1536` comment, "Assign is now the LAST step of STARTING a delivery … moved off after-ack 2026-08").

### 4.2 The rental rate is a flat monthly figure × quantity. There is no duration concept anywhere.

`amount = round(unitPrice × quantity, 2)`. That's the whole calculation. A unit delivered on the 28th is billed the identical amount as one delivered on the 1st. Nothing scales by days, and there is nowhere in the payload to express a partial month.

I grepped the entire backend and portal for `prorat`, `proration`, `perDiem`, `dailyRate`, `daily rate` — **zero hits.** The only duration math in the codebase is a display-only helper in the project page UI:

```ts
// portal-production/app/portal/projects/[id]/page.tsx:263
const monthsBetween = (start, end) =>
  Math.max(0, (e.getFullYear()-s.getFullYear())*12 + (e.getMonth()-s.getMonth()));
```

— calendar-month difference, floor'd, used only to render "(3 mth)" on a deployment card. It never touches money.

### 4.3 Two rate sources exist and nothing reconciles them

- `ProjectDeployment.monthlyRate` (`Float?`) — the *deployment's* agreed rate, with `currency` (default `"SGD"`), rendered on the project page as "Rate: $500 / mth".
- `Asset.customPrices[].value` where the label matches `/monthly rental/i` — the *catalog list rate*, which is what `priceInvoiceLinesFromAsset` actually uses.

**The invoice pricing ignores `ProjectDeployment.monthlyRate` entirely.** A negotiated per-deployment rate is silently overridden by the catalog rate. Worse: `fieldDeploy` (the flow that creates deployments from the field) never sets `monthlyRate` at all — in the dev DB, 4 of the 5 most recent deployments have `monthlyRate: null`. If your layer should honour negotiated rates, this is the gap to close first.

### 4.4 Tax/GST — confirmed, nothing at the line level

**Confirmed: DO→invoice lines carry no tax field.** Neither `createDoFromDelivery` nor `createScheduled` writes `tax`, and `priceInvoiceLinesFromAsset` doesn't add one. (Office-editor lines *do* carry `tax: "9"` as a string, and AI-extracted lines carry a numeric `tax` — so the field exists in the schema-less config, just never on this path.)

GST is handled **document-level**:
- `config.documentInfo.{taxApplicable, absorbTax, gstPercent, currency}` seeded from org defaults at creation (Y/N *strings*, not booleans — booleans render as empty in the form).
- The renderer computes it at display time (`CleanDocumentPreview.tsx:1610-1623`):
  ```
  gstAmount = absorbTax ? subtotal × pct/(100+pct)      // tax-inclusive
                        : subtotal × pct/100            // tax-exclusive
  ```
- The GL fallback does the same arithmetic server-side (`repostGlForDocument`, `:206-219`): `taxAmount = netAmount × gstPercent/100`.

`TaxRate` is a real model in the schema and the editor has a tax-code picker that drives `documentInfo.gstPercent` — but no tax code is ever attached to an auto-created invoice.

### 4.5 Everything else a pricing layer will look for and not find

| Expected | Reality |
|---|---|
| `config.subTotal` / `gstAmount` / `nettTotal` | **Not written.** The auto-created invoice has no totals block at all — the preview computes totals from `items[]` at render time, and the GL falls back to `Σ line.amount`. Only an editor save persists them. |
| Per-line GL revenue account (`accountCode` / `revenueAccountCode`) | Never written on this path, so `postFromInvoice` receives `accountCode: null` for every line and falls back to the org's default revenue account. `Asset.rentalAccountCode` and `Asset.salesAccountCode` exist on the catalog and are **not consulted** by the invoice creator. |
| Discounts | `Asset.points` (asset-level discount, 1 point = $1, feature-flagged) exists and is not applied. Line `discount` is `0`/absent. |
| Currency per deployment | `ProjectDeployment.currency` is not carried onto the invoice; the invoice takes the org default. |
| Customer-specific pricing / price lists | Does not exist. `customPrices` labels are per-asset, not per-customer. `PriceHistory` records past document prices but nothing reads it during pricing. |
| Minimum hire period, deposit, delivery/collection charge | No model, no field, nowhere. |
| Invoice ↔ deployment link | `Document.projectDeploymentId` is **null** at creation (§2.1). |
| A retry/repair path | If the auto-invoice fails, nothing retries and no flag records the failure. |
| Anything marking a line as "priced" vs "no price found" | Both are `0`. Indistinguishable in the payload. |

---

## 5. RELATED DATA REACHABLE FROM THE INVOICE

```
INVOICE (Document, type='INVOICE', status='unconfirmed')
 │
 ├─ config.sourceDocumentId ─────────────► DELIVERY ORDER (Document, type='DELIVERY_ORDER')
 │                                          │   status='delivered_installed'
 │                                          │
 │                                          ├─ .projectId ──────────► PROJECT
 │                                          │                          ├─ .customerId ──► CUSTOMER
 │                                          │                          ├─ .startDate / .endDate
 │                                          │                          └─ .address (site)
 │                                          │
 │                                          ├─ DocumentItem[] (documentId = DO.id)
 │                                          │    ├─ .inventoryId ────► INVENTORY (unit)
 │                                          │    ├─ .deliveringAt / .deliveredAt
 │                                          │    ├─ .completedAt      ◄── the real hand-off dates
 │                                          │    ├─ .deductedAt
 │                                          │    └─ .installSkipped
 │                                          │
 │                                          └─ DeliveryItem[] (documentId = DO.id)   ◄── the run link
 │                                               └─ .deliveryId ─────► DELIVERY (run)
 │                                                                      ├─ .direction (OUTBOUND/RETURN)
 │                                                                      ├─ .scheduledFor
 │                                                                      ├─ .startedAt / .completedAt
 │                                                                      ├─ .riderUserId / .riderName
 │                                                                      ├─ .siteAddress
 │                                                                      └─ .customerId / .projectId
 │
 ├─ config.sourceDeliveryId ─────────────► DELIVERY  (⚠ path-4 DOs only; absent on scheduled DOs)
 │
 ├─ config.items[].inventoryItemId ──────► INVENTORY (unit)
 │                                          ├─ .sku          ◄── the real-world serial on paperwork
 │                                          ├─ .serialNumber (usually null)
 │                                          ├─ .status  (instock/reserved/rental/sold)
 │                                          ├─ .assetId ────► ASSET
 │                                          │                  ├─ .price            (SALE source)
 │                                          │                  ├─ .customPrices[]   (RENTAL source)
 │                                          │                  ├─ .costPrice
 │                                          │                  ├─ .skuKey, .name, .uom
 │                                          │                  └─ .rentalAccountCode / .salesAccountCode
 │                                          │
 │                                          └─ Assignment (endDate = null → the ACTIVE one)
 │                                               ├─ .startDate / .endDate
 │                                               ├─ .projectId ──────► PROJECT ──► CUSTOMER
 │                                               └─ .projectDeploymentId ──► PROJECT DEPLOYMENT
 │                                                       ├─ .type          RENTAL | SALE
 │                                                       ├─ .deployedDate  ◄── rental START
 │                                                       ├─ .offHiredDate  ◄── rental END
 │                                                       ├─ .monthlyRate + .currency (unused by pricing)
 │                                                       ├─ .status  ACTIVE|OFF_HIRED|COMPLETED|CANCELLED
 │                                                       └─ .deploymentNumber ("Deployment 3")
 │
 ├─ Document.projectId ──────────────────► PROJECT (copied from the DO; may be null)
 └─ Document.projectDeploymentId ────────► null at creation (see §2.1)
```

### Queries you'll actually write

```sql
-- the invoice for a DO (there is no FK — this is the JSON path form)
SELECT * FROM "Document"
 WHERE type='INVOICE' AND "organizationId"=$org
   AND config->>'sourceDocumentId' = $doId;

-- the DO for an invoice
SELECT * FROM "Document" WHERE id = (
  SELECT config->>'sourceDocumentId' FROM "Document" WHERE id=$invoiceId)::uuid;

-- real hand-off dates per unit on that invoice
SELECT di."inventoryId", di."deliveredAt", di."completedAt", di."installSkipped"
  FROM "DocumentItem" di
 WHERE di."documentId" = $doId;

-- the active deployment (type + start + end) behind a unit on an invoice line
SELECT pd.* FROM "Assignment" a
  JOIN "ProjectDeployment" pd ON pd.id = a."projectDeploymentId"
 WHERE a."inventoryId" = $unitId AND a."endDate" IS NULL
 ORDER BY a."startDate" DESC LIMIT 1;
```

Caveat on `Assignment`: `@@unique([projectId, inventoryId])`, and `fieldDeploy` soft-closes assignments on other projects by stamping `endDate` — so "the active one" is `endDate IS NULL`, and there should be at most one. Every reader in the codebase still defensively takes `orderBy startDate desc, first`; do the same.

---

## 6. THE RETURN SIDE

A RETURN run is a `Delivery` with `direction = RETURN`. Its lifecycle is deliberately *not* the outbound one.

### What happens per unit, at collection-ack

`collectReturnUnit` → `deliveries.service.ts:1809`

```ts
DeliveryItem: deliveryStatus → completed, deliveredAt = now, completedAt = now
Inventory:    status rental → instock         (guarded, idempotent)
then → offHireDeploymentOnReturn(inventoryId)
```

`offHireDeploymentOnReturn` (`:1835`):
1. Find the unit's active `Assignment` (`endDate: null`, has a `projectDeploymentId`).
2. **Last-unit guard** — if any *other* unit on that same deployment is still `rental`, **return early**. Partial returns deliberately do not stop billing.
3. Otherwise call `projectsService.offHireDeployment(depId)`.

`offHireDeployment` (`projects.service.ts:953`):
```ts
ProjectDeployment.offHiredDate = now      // ← THE RETURN DATE
ProjectDeployment.status       = OFF_HIRED
// and: deactivate every RecurringInvoiceTemplate chained to this deployment
//      (isActive = false) so rent stops
```

### At run completion

`completeReturnRun` (`deliveries.service.ts:1889`) creates a `RETURN_DELIVERY_ORDER` document — goods-only, `unitPrice: 0`, `amount: 0`, same line shape as a delivery DO (description, quantity, `inventoryItemId`, `serialNumbers`, `skuKey`/`itemCode`, `year`, `deliveryGroup`). **No invoice, no credit note, no GL entry.** It stamps `DeliveryItem.documentId` on the run's items (which is also its idempotency guard).

### What a proration implementation can use from this

| Signal | Where | Quality |
|---|---|---|
| **Rental end date** | `ProjectDeployment.offHiredDate` | The best one. Written to `new Date()` at collection-ack, or to an explicit date if the office off-hires manually via `POST /projects/deployments/:deploymentId/off-hire` with `{ offHiredDate }` (`projects.controller.ts:144`). |
| **Rental start date** | `ProjectDeployment.deployedDate` | Paired with the above. `monthsBetween(deployedDate, offHiredDate)` is exactly the pair the project page already displays. |
| **Per-unit collection timestamp** | `DeliveryItem.deliveredAt` / `.completedAt` on the RETURN run | Finer-grained than the deployment date, and the only signal available for a **partial** return (where `offHiredDate` stays null by design). |
| **Run-level collection date** | `Delivery.completedAt` where `direction='RETURN'` | Coarse but reliable. |
| **The returned units themselves** | The RDO's `config.items[].inventoryItemId`, or `DeliveryItem.inventoryId` on the return run | |

### Three gaps to plan around

1. **Off-hire is all-or-nothing per deployment.** Return 3 of 5 units and `offHiredDate` stays null; billing continues at the full flat monthly rate for all 5 (nothing scales the rate by units-still-out either). The per-unit collection dates on `DeliveryItem` are the *only* record that 3 came back.
2. **The return is not reachable from the outbound invoice.** The RDO carries no `sourceDocumentId` and no link to the original DO or invoice. To connect them you must go invoice → line → `inventoryItemId` → `Assignment` → `ProjectDeployment`, and then find return runs by unit. There is no document-to-document edge.
3. **Off-hire is best-effort and silent.** `offHireDeploymentOnReturn` swallows every error into a `logger.warn`. A deployment can stay `ACTIVE` with a null `offHiredDate` after a genuine return.

### The existing monthly-billing mechanism, for context

`RecurringInvoiceTemplate` is how repeat rental billing happens today: `frequency` (`MONTHLY`, …), `nextRunDate`, `nextRunNo` (for "17th mth" tokens), `endDate`, `autoSend`, and `projectId`/`projectDeploymentId`/`sourceDocumentId` linking it to a deployment. Generated invoices inherit the deployment link (`recurring-invoices.service.ts:224-229`), and off-hire deactivates the template. It emits a **fixed config each period** — same amounts every run. It has no proration either; it is a repeat-the-same-invoice scheduler, not a rate engine.

---

## Appendix — file map

| What | Where |
|---|---|
| Completion gate | `api-server-production/src/documents/documents.service.ts:4356` |
| Invoice creation from DO | `documents.service.ts:4386` |
| Line pricing | `documents.service.ts:4446` |
| Generic document creation (numbering, org defaults, tax seed) | `documents.service.ts:1816` |
| `config.items[]` → `DocumentItem` reconciliation | `documents.service.ts:348` |
| Per-unit delivery advance (fires gate on install/skip) | `documents.service.ts:3791` |
| Office bulk-complete | `documents.service.ts:4543` |
| DO confirm (does **not** invoice) | `documents.service.ts:4597` |
| Invoice confirm (→ `pending_payment`, inherits project/deployment) | `documents.service.ts:4696` |
| Slot binding (writes `inventoryItemId`/`serialNumbers` into config) | `documents.service.ts:4205` |
| Run status fold + completion dispatch | `deliveries.service.ts:1069` |
| Scheduled-run commit → invoice | `deliveries.service.ts:1151` |
| Standalone-run auto-DO → invoice | `deliveries.service.ts:1184` |
| DO built from a run | `deliveries.service.ts:1345` |
| Scheduled DO built at schedule time | `deliveries.service.ts:292` |
| Return: per-unit collect + off-hire | `deliveries.service.ts:1809`, `:1835` |
| Return: RDO creation | `deliveries.service.ts:1889` |
| Off-hire (writes `offHiredDate`, kills recurring templates) | `projects.service.ts:953` |
| Deployment creation (office / field) | `projects.service.ts:590`, `:658` |
| GL posting for invoices | `documents.service.ts:190`, `journal/journal-auto-post.service.ts` |
| Schema | `api-server-production/prisma/schema.prisma` |
