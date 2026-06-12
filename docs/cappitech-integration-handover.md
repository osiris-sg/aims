# Cappitech Engineering — AIMS Integration Handover

**Org**: Cappitech Engineering Pte. Ltd.
**organizationId**: `59802f75-262b-4f96-b8b2-09a9a071d882`
**Status** (as of 2026-06-12): catalog + workflow features built; client (Meijun) is mid-UAT; portal-prod deploy stuck on a stale build (Vercel domain-alias issue) so some features aren't visible in prod yet even though code + DB are ready.

This doc is a single-page handover covering every change made for Cappitech: data, schema, features, scripts, commits, and open items. Cross-references to other memory files in `~/.claude/projects/.../memory/` are noted where relevant.

---

## 1) Asset catalog imports

**Source**: `~/Downloads/Price List 2026 sample (1).xlsx` (4 sheets) + 19 phone photos for VRV (`~/Downloads/IMG_2252..2270.HEIC`).
**Org has 628 active assets** (post-VRV) across 7 categories.

| Sheet | Pattern | Script | Result |
|---|---|---|---|
| RKM-ZVMG (single-split) | CU root + paired FCU child (`parentAssetId`) | `scripts/import-cappitech-rkm.js` | 5 pairs → 10 assets |
| MKM-ZVMG (multi-split) | Flat, mix-and-match | `scripts/import-cappitech-mkm.js` | 19 atomic assets |
| MKM-ZVMG SET bundles | Combos whose discounted price isn't reproducible by summing | `scripts/import-cappitech-mkm-sets.js` | 10 SET SKUs (uom `SET`, category `Multi-split Set`) |
| SkyAir (light-commercial) | CU root + multiple FCU children, plus accessories | `scripts/import-cappitech-skyair.js` + `scripts/tag-skyair-accessories.js` | 16 CUs + 30 FCUs + 10 accessories |
| VRV (Daikin VRV 2026, R410A) | MKM-flat (no parent/child) | `scripts/import-cappitech-vrv.js` | 291 assets — VRV IV S, VRV S, VRV IV RQQ, VRV 6A RXQ, VRV 6X RXUQ + 146 indoor FCUs + 16 accessories |

### Pricing conventions (kept identical across all sheets)
- `Asset.price` = **List price**
- `Asset.customPrices` = `[{ label: "Discount Price", value: <Dealer> }]` — label is **"Discount Price"** (not "Dealer Price"). The QF totals math (`discountPriceOf` in `TabbedDocumentCreator`) keys off this exact label.
- `Asset.points` = points (1 pt = $1 off Unit Price; gated by org flag `enableAssetPoints`)
- `Asset.uom` = `"UNIT"` (SET bundles use `"SET"`)
- `Asset.isTracked` = `false`, `quantity = 0` — catalogue items, not inventoried units

### Categories (org-scoped)
- `Condensing Unit` (every CU)
- `Fan Coil Unit` (every FCU — including SkyAir cassette/streamer/duct/ceiling variants)
- `Multi-split Set` (10 MKM SET bundles)
- `Accessories` (panels, remotes, drain pumps)

### Accessory linking model (Sky Air)
- `Asset.accessoryIds: String[]` — defaults; auto-added to QF row when the FCU is picked
- `Asset.accessoryOptionIds: String[]` — swappable options; shown in scoped picker, not auto-added

Per-FCU-type rules in `scripts/tag-skyair-accessories.js` (by SKU prefix regex):
- streamer `FCTF*` — def: `BYCQ125EAF-S` + `BRC1H63W`, opt: black panel `BYCQ125EAK-S` + black remote `BRC1H63K`
- cass5 `FCFV*` — def: `BYCQ125EAF-S` + `BRC1E63-S`, opt: `BYCQ125EAK-S`
- cass4 `FCF*` — def: `BYCQ125EAF-S` + `BRC1E63-S`, opt: `BYCQ125EAK-S` + `BRC7M635F`
- ceil3 `FHFC*` — def: `BRC7GA56` only (3φ ceiling — corrected from earlier mistag)
- ceil1 `FHA*` — def: `BRC1E63-S`, opt: `BRC7M56`
- duct `FB*` — def: `BRC1E63-S`, opt: `BRC4C66`

### Points (1 pt = $1)
Script `scripts/update-cappitech-points.js` — sets `Asset.points` per series:
- RKM CUs = `20` (single-split: points only on CU/parent; FTKM children = 0)
- CTKM = `60`
- MKM = `700`
- CDKM / FDMF ducted / SET bundles / VRV = `0` (not on sheet)

Org `enableAssetPoints` flag = ON (lives in `OrganizationUIConfig.features`).

### New schema column for VRV: `Asset.capacityKw Float?`
Applied via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Outdoor capacity straight from the kW column; indoor derived from model class via `FCU_KW` map (20→2.2 … 500→56). Null for ventilators / kits.

### VRV-specific notes
- **List price only** — no Dealer/Discount column, no points → `customPrices` for `Discount Price` and `points` are NOT set.
- **Wired vs wireless FCUs** — each indoor priced twice on the sheet (wired BRC1E63 vs wireless remote). Imported as **ONE SKU at the WIRED price**; wireless bundle price stashed in `customPrices: [{label:"Wireless Price", value}]` (inert in current logic).
- **Combination outdoor units** — 2–3 outdoor modules + BHFP piping kit → stored as a single CU asset, combined-list price, combination string folded into `description` (`… — Combination: RXQ20BYMG + … + BHFP22R168-7`).

See also: `~/.claude/projects/.../memory/cappitech-pricelist-import.md` for the import handover doc covering recipe-for-new-sheets, conventions, and gotchas.

---

## 2) QF FCU-CU Quotation Template

**Template id** (Cappitech, prod): `097c9de7-7d52-4ad4-8b64-2c2cec6d91d4`. Variant `QF`, type `QUOTATION`.

### Custom column layout (`config.tableColumnOrder` set via `scripts/update-qf-template-config.js`)
`["location","cuModel","fcuModel","quantity","accessories","accessoryQty","masterQty","listPrice","discountPrice"]`

Column labels: `quantity="FCU Qty"`, `accessoryQty="Accessory Qty"`, `masterQty="Set Qty"`, `discountPrice="Dealer Price"`, `listPrice="Unit Price"`.

Internal (hidden from clean preview): `accessories`, `accessoryQty`, `discountPrice`.

### QF row structure
Each row represents one system:
- `cuAssetId`, `cuCode`, `cuName`
- `fcus: [{ assetId, code, name, qty }]`
- `accessories: [{ assetId, code, name, qty }]`
- `masterQty` (Set Qty — multiplies the whole set)
- Computed: `listPrice`, `discountPrice` (dealer), `costPrice`, `pointsTotal`, `unitPrice` (=list), `quantity` (=masterQty), `amount`

### Behaviour built into `TabbedDocumentCreator.tsx`
- **CU picker** (`openQfPicker(target:"cu")`):
  - Auto-pair: if a CU has exactly 1 child FCU in the hierarchy, picking the CU auto-pairs the FCU + merges its accessories.
  - VRV capacity rule (see §8 below).
- **FCU picker** (`fcuOptionsForCu`): scopes to the picked CU's children (`parentAssetId`); falls back to full FCU list when no CU picked.
- **Accessory picker** (`accessoriesForRow`): scopes to `Σ accessoryIds ∪ accessoryOptionIds` of the row's FCUs.
- **Stock-card keyboard nav**: ↑/↓ to highlight, Enter to select.
- **Per-FCU qty** + **per-accessory qty** + **master Set Qty** all multiply lines correctly.
- Doc-level **% / $ discount** support (only `%` mode currently used for QF).

### Math: pricing waterfall per order Type
The QF Type field (`documentInfo.orderType`: Project / Route Order) drives different math:

| Type | Math |
|---|---|
| **Project** | Gross = Σ list. Base = Gross. Discounted Price = Gross − doc discount. Nett = Discounted + GST. |
| **Route Order** | Gross = Σ list. Base = Σ dealer − Σ points. Discounted Price = base − doc discount. Nett = Discounted + GST. |

Live computation lives in `TabbedDocumentCreator.tsx`'s totals `useEffect` (gated on `isFcuCuVariant`); preview rendering mirrors in `CleanDocumentPreview.tsx`. Display order: **Gross Total → Discounted Price → GST → Nett Total**.

### Confirm-quotation flow
- `Confirm Quotation` button: gated by org flag `enableConfirmQuotation`.
- Requires Type field set (Project / Route Order) — toast blocks save if empty.
- Backend's `OrdersService.createFromQuotation` auto-creates an Order (`sourceQuotationId` set) and runs `itemizeQfRows` to explode each QF system row into individual products. Each emitted line carries: `itemCode`, `inventoryItemId`, `description`, `unitPrice` (list), `dealerPrice`, `discount`, `amount`, `points`, `category` (`CU` / `FCU` / `Accessory`), `tagGroupId` (CU heads), `taggedAssetCode/Id/Name` (FCUs tagged to CU, accessories tagged to first FCU).
- Lumping: duplicate models across rows are merged into one line; `quantity` summed; `taggedAssetCode` cleared if the model spans multiple parents.
- **Project orders**: doc-level discount % spread per-line (`it.discount` = effective %, `it.amount` recomputed).
- **Route Order orders**: doc-level discount NOT spread; points sit per-line.
- Post-confirm dialog has just two options now: **"Go to Order"** (jumps to the freshly-created order's detail page, fetched via sourceQuotationId) and **"Leave it"**.

See also: `~/.claude/projects/.../memory/qf-fcu-cu-quotation-template.md`.

---

## 3) Orders workflow + spin-off documents

### Order detail page (`/portal/orders/[id]`)
Editable items table (Project only), with:
- **Discount** column: editable % per line (Project orders only). Updates `amount` live.
- **Amount** column: editable; back-computes `discount` % from `gross − amount`; clamps to `[0, gross]`.
- **Total Discount** line + target invariant (= original cascade sum).
- **Recalibrate discount for other items** button: appears when current ≠ target AND there's a non-edited item. Distributes remaining discount across non-edited lines proportional to gross, in cents, last line absorbs residual → reconciles to target exactly to the cent.
- **Save** + **Reset** buttons. Persists via `PATCH /orders/:id/items`.
- Route Order shows **Total Points** line; Points column shown when isRouteOrder.

### Spin-off buttons + pricing rules (flat builder in `orders/[id]/page.tsx`)

| Outbound doc | Project order line price | Route Order line price | Per-line discount carried |
|---|---|---|---|
| **PO** (supplier-facing) | `lookupCost(it)` | `dealerPrice` (falls back to cost) | none |
| **SO / DO / Invoice** (customer-facing) | `unitPrice` (list) | `unitPrice` (list) | yes — see below |

**The per-line `discount` field on SO/DO/Invoice** absorbs both the dealer markdown AND the points into a single % so the standard totals math collapses to the same Discounted Price as the quotation:
- **Route Order**: `discount % = (1 − (dealer − points) / list) × 100`. Line amount = `qty × (dealer − points)`. Sum = Σ (dealer − points) = quote's Discounted Price.
- **Project**: `discount %` = the cascaded per-item % already on the order item.
- **Points** carried on the line too (audit + so a Route Order PO can still render its own "Less Points" line).

### Linked Documents bucket
`Order.linkedDocuments: { po: [], do: [], invoice: [], salesOrder: [] }`. `linkDocument` controller takes all 4 kinds. Idempotent on docId.

### `Order.orderType` (text)
Carries the quotation's Type onto the order so downstream gating (Route Order vs Project) works. Stored as `"Project"` or `"Route Order"`.

### Verified columns on the order page
Two columns next to Status: **Ver. DO**, **Ver. INV**. Show a `Verified` chip (solid green for ok / amber outlined for mismatch) when a supplier doc has reconciled against that line. Tooltip carries supplier name + doc number + date + verified-at timestamp + price-mismatch deltas (for amber). See §4 for the upload-and-verify flow.

---

## 4) Sales Order from order

**SO template id** (Cappitech):
- dev: `04d9a3f1-823e-45db-ab30-626cf5f3dad0`
- prod: `b096160f-d051-42d6-8bc2-ef3942fa6212`

Cloned from the PO template via `scripts/clone-po-to-so-cappitech.js`. Idempotent (`type='SO'` check before creating).

**Important fix**: the clone script now also sets `templateVariant: 'SO'`. Auto-numbering uses `templateVariant` as the doc-name prefix; without the override the SO would name itself `PO202606-NNN`. Now correctly names `SO202606-NNN`.

**Extract from quotation**: the doc editor already has this button gated on `documentType === "SO"` (`ExtractQuotationToSODialog`) — see line ~2326 of `TabbedDocumentCreator`. Filters source docs by type ∈ `{QUOTATION, QT, QO, QO1}`. QF templates land here as `QUOTATION`.

---

## 5) Supplier doc verification (upload-and-match flow)

End-to-end flow on the **orders list page** (`/portal/orders`):

### Frontend
`app/portal/orders/_components/VerifySupplierUploadPanel.tsx` — top-of-list panel with:
- **Drag-drop** zone + file picker (PDF / PNG / JPG, multi-select).
- **Single file**: existing single-shot flow with auto-navigate to the matched order's detail page.
- **Multi-file** (≥ 2 files): batch dialog opens.
  - **Concurrency limiter**: 3 in flight (`MAX_IN_FLIGHT`).
  - **Per-file state machine**: queued → extracting → done/error.
  - **Live counter chips** in dialog header: matched / mismatch / no-match / failed / pending.
  - **Per-row collapsible details**: matched order chip, supplier + doc number, side-by-side per-line table with status chips (ok / mismatch / missing / extra), totals view, points view (Route Order only), Download chip per file.
  - **Retry** on failed/unmatched, **Remove** on terminal rows, **Cancel pending** + **Close** in footer.

### Backend extraction
`DocumentExtractionService.extractForReconciliation(file)`:
- **Claude Sonnet 4.6** via `@anthropic-ai/sdk` (env: `ANTHROPIC_API_KEY`).
- PDFs go straight as `document` content block (no pdf-to-png step needed); images as `image` block.
- Returns `SupplierReconciliationData` with `docKind`, `docNumber`, `docDate`, `customerPoNumber`, `salesOrderNumber`, `projectName`, `items[{code, description, quantity, unit, unitPrice, amount}]`, `totals{subtotal, tax, taxPercent, total}`, `points{issued, redeemed}`, `supplier{name, gstRegNo}`.

### Match resolution (`OrdersService.findMatchingPo`)
1. **Exact PO-name match** — `Document.name` first (auto serial). Then `Document.documentNumber` (user-editable Purchase Order No.) for cases like Daikin's `26R/0304-5`.
2. **SKU-overlap scoring** — last 90 days of POs, dedupe codes, sniff code-like tokens out of description when the extractor put the SKU in the wrong field, score = overlap / max(po_codes, sup_codes). Threshold 0.5.
3. Returns confidence + reason.

### Checks (`runReconciliationChecks`)
Per-line items + qty (always); plus prices + amounts (invoice only, $0.01 / $0.02 tolerance); plus document totals (subtotal / GST / total, $1 tolerance — Route Order PO's GST is on subtotal−points, matching the preview); plus **Reward Points Issued** (Route Order invoice only — supplier's `points.issued` must equal `Σ points × qty` on PO).

### Soft stamping
Per-line ✓ flag on the order's items array. **Rule**: stamp if SKU + qty match — price/amount mismatches are surfaced in the dialog notes but don't gate the stamp. Stamp shape: `{ docNumber, date, supplier, at, fileUrl, fileKey, originalName, mimeType, lineStatus, mismatchNotes, supplierQty, supplierUnitPrice, supplierAmount }`. Order page renders:
- Green `Verified` chip when `lineStatus === 'ok'`.
- Amber outlined `Verified ⚠` chip when `lineStatus === 'mismatch'` — tooltip shows `Supplier unit X / Supplier amount Y / "unit A → B; amount C → D"`.

### S3 storage
- Bucket key: `supplier-uploads/{orgId}/{orderId}/{do|invoice}/{ISO-timestamp}_{safeName}`.
- Stamp carries `fileKey`. Order page's **Supplier Uploads** section (next to Linked Documents) renders one chip per upload (deduped by fileKey), click → `GET /orders/supplier-doc-url?key=...` mints a 1-hour signed URL, opens in a new tab.

### DO vs Invoice gating
- DO upload: skips price + totals + points checks; only items + qty matter. Per-line label changes to `"Items & quantities"`.
- Invoice upload: full waterfall, including points for Route Order.

### Orders list column
`Ver. DO` + `Ver. INV` columns show compact `N/M` chip — green when fully verified (e.g., `5/5`), amber outlined when partial.

### Cost estimate
~$0.02–0.03 per single-page upload (Claude Sonnet 4.6 input + JSON output). ~$0.05–0.07 for 3-page invoices.

---

## 6) Org-wide defaults (Company Profile page)

Added a new **Doc Defaults** tab + extended General/Tax sections on `/portal/settings/company-profile`.

### Tax defaults (org-wide, seed every new doc)
New columns on `Organization`:
- `taxApplicable Boolean @default(true)` — Y/N stored as `Boolean`, coerced to `"Y"`/`"N"` string when seeded onto `documentInfo.taxApplicable` (the form Select uses string values).
- `absorbTax Boolean @default(false)` — same Y/N coercion.
- `taxRate Float? @default(9)` — already existed.

### Currency
- `defaultCurrency String @default("SGD")` — surfaced as a **20-currency dropdown** on Company Profile General tab (SGD, USD, MYR, IDR, THB, PHP, VND, HKD, CNY, JPY, KRW, TWD, INR, AUD, NZD, EUR, GBP, CHF, CAD, AED). Stored as ISO code; uppercased on save.

### Quote round-down step
- `quoteRoundingStep Int @default(10)` — see §7 for usage.

### Per-doc-type defaults (T&Cs / Notes / Footer Message)
- `docTypeDefaults Json?` — map keyed by doc type code → `{ tnc, notes, footerMessage }`.
- Tab dropdown is **driven by what doc types Cappitech actually has templates for** (fetched via `POST /documentTemplates`, deduped, friendly labels for known codes, "set" chip indicates types with content already).
- Three multiline TextField inputs per type. "Clear defaults for this type" red link.
- `createBasicDocument` seeds `documentInfo.termsAndConditions / .note / .footerMessage` from org map; only fills empty fields.
- Form initialiser falls back through `documentInfo → top-level → org.docTypeDefaults[documentType]`.
- Clean preview gets a centred italic **footer message** block above the signature row when present.

---

## 7) Stage-aware quote round-down

Driven by `Organization.quoteRoundingStep`. Two stages, different lever per order Type:

| Type | Stage rounded | Absorbed where |
|---|---|---|
| **Project** | Discounted Price (pre-GST) | Folded into the Discount line — typed % becomes effective % in the rendered Discount |
| **Route Order** | Nett Total (post-GST) | Surfaced as a separate **"Round-down"** line below GST |

Round-DOWN only (never UP) — customer is never charged above unrounded math. step = 0 disables.

Code: `TabbedDocumentCreator.tsx` totals `useEffect` (~1224) + editor footer renderer (~4262), `CleanDocumentPreview.tsx` QF totals block (~2848).

Open question (memo): client confirmed before-GST / after-GST split, but the Excel template at `~/Downloads/Workflow Template (1).xlsx` shows the salesperson types the round figure manually (Excel L column for Route, G25 for Project). Current implementation auto-rounds. Six client-confirmation questions tracked in `~/.claude/projects/.../memory/cappitech-quote-rounding-pending.md`.

---

## 8) VRV capacity rule (CU dropdown filter)

In `TabbedDocumentCreator.tsx`'s QF picker (when `qfPicker.target === "cu"`):

- `fcuTotalKwForRow(row)` — sums `inventoriesForDocument.find(...).capacityKw × fcu.qty` for the active row.
- `cuOptionsForRow(row)`:
  - If `fcuKw <= 0` → return full `cuOptions` (non-VRV product lines, RKM/MKM/SkyAir — their FCUs have no `capacityKw` set).
  - Otherwise (VRV mode) → return CUs where `capacityKw` is set AND `fcuKw <= capacityKw × 1.3`.

Why the **strict** form (require CU to have `capacityKw` too): the Heat Recovery Ventilators (VAM*HVE) are mis-categorised under `Condensing Unit` but have no kW rating. The strict filter drops them from the list when any VRV FCU is picked. Non-VRV product lines stay unfiltered because their FCUs contribute 0 kW.

`FCU_TO_CU_RATIO = 1.3` constant.

---

## 9) Points ledger (per-org)

- `Organization.pointsBalance Float? @default(0)` — org-wide reward Points balance.
- **Inline editor** on Route Order PO footer (`RouteOrderPointsEditor.tsx`) — three lines:
  - `Less Points:` editable number input. Defaults to Σ `points × qty` across items.
  - `Balance:` X with pencil → inline TextField + ✓/✕.
  - `After confirm:` projected `balance − redeemed` (red if negative).
- `pointsRedeemed` (`documentInfo.pointsRedeemed`) is the user's chosen redemption; `pointsDeducted` mirrors it (legacy alias).
- **Confirm-PO trigger**: `documents.service.update` hooks into the status → `'confirmed'` flip on a Route Order PO, atomically decrements `Organization.pointsBalance` by `pointsRedeemed`. Never blocks the save if the debit fails.
- `GET /organizations/points-balance` + `PATCH /organizations/points-balance` endpoints feed the inline UI.
- **Math**: 1 point = $1 OFF the Nett Total (post-GST). GST is on the full subtotal; points come off the Nett directly. `nettTotal = subTotalAfterDiscount + gstAmount − poPointsRedeemed`.
- Route Order POs **skip the org's `enableNettRoundDown`** so per-tick edits to Less Points are visible (the user fine-tunes to specific cents).

---

## 10) Cappitech migration to prod

Done via `scripts/migrate-cappitech-dev-to-prod.js`. Idempotent (upserts on id). Scope:
- Organization + OrganizationUIConfig + OrganizationModule (8 modules)
- Roles (1 — `superadmin`) + permissions wired up
- UserOrganization + UserRole (1 each — the platform admin)
- Categories (7), Assets (628), DocumentTemplates (12), AssetTemplateTag (0)

**Permission gap fix**: 12 perms (`orders:*`, `bills:*`, `bankrec:*`, `xerosync:*`) existed on dev but not prod — colleagues had added these for new modules but not seeded prod. Copied across with the same ids and connected them back to Cappitech's `superadmin` role.

Backup created at `~/aims-backups/prod-20260606-182257.sql.gz` (1.2 MB) before the migration.

---

## 11) Prod DB schema deltas (cumulative, applied via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)

Applied 2026-06-06, 2026-06-09, 2026-06-12. All idempotent.

| Table | Column | Type | Default |
|---|---|---|---|
| Asset | accessoryOptionIds | `text[]` | `{}` |
| Asset | capacityKw | `double precision` | null |
| Order | orderType | `text` | null |
| Organization | pointsBalance | `double precision` | 0 |
| Organization | taxApplicable | `boolean` | true |
| Organization | absorbTax | `boolean` | false |
| Organization | defaultCurrency | `text` | `'SGD'` |
| Organization | quoteRoundingStep | `integer` | 10 |
| Organization | docTypeDefaults | `jsonb` | null |
| Customer | xeroId | `text` | null (+ partial unique idx on non-null) |
| Customer | xeroLastSyncAt | `timestamp(3)` | null |
| Supplier | xeroId | `text` | null (+ partial unique idx) |
| Supplier | xeroLastSyncAt | `timestamp(3)` | null |
| ChartOfAccount | xeroId | `text` | null (+ partial unique idx) |
| ChartOfAccount | xeroLastSyncAt | `timestamp(3)` | null |

### Still missing on prod (colleagues' accounting/Xero work — not blocking Cappitech but will 500 if anyone hits the endpoints)
```
AccountingSetting    missing: closeHistory, lockedThroughDate, enablePerpetualInventory, billApprovalThreshold
DocumentItem         missing: isFixedAsset
JournalEntryLine     missing: costCenterId

Missing TABLES (would need prisma migrate deploy): BankStatementImport,
  BankStatementLine, Bill, Budget, CostCenter, DepreciationEntry,
  FixedAsset, RecurringJournalTemplate, XeroAccountMapping, XeroSyncRun
```

---

## 12) Commits (yx/dev, chronological — Cappitech-related only)

| Commit | Summary |
|---|---|
| `0211d3f` | Tax defaults on Company Profile (taxApplicable/absorbTax) |
| `fa496dd` | Coerce org tax booleans to Y/N strings on seed |
| `c149499` | Default Currency on Company Profile (seeded onto new docs) |
| `9d1fce3` | Default Currency is now a dropdown of 20 currencies |
| `9448cd1` | Invoice/DO from Route Order uses dealer price (later reverted in `df97cd1`) |
| `f6a3bd8` | Sales Order from order — clone PO template + wire UI |
| `1b3dbb5` | Stage-aware quote round-down (Project at discount, Route at nett) |
| `29849fe` | Per-doc-type defaults — T&Cs / Notes / Footer Message |
| `e5a4fbe` | DO Delivery Date/Time + QO RE subject fields |
| `b5fc660` | Quote-preview clean layout for orgs with docTypeDefaults |
| `ac4a094` | Bump DO/PO/QO header field font 13px to 14px |
| `d7a1c54` | Set `templateVariant='SO'` on the SO clone (fix sales-order numbering) |
| `572a2f7` | SO/DO/Invoice carry list price + discount + points |
| `df97cd1` | SO/DO/Invoice Route Order absorbs dealer + points into line discount |
| `4ce374f` | CU picker hides under-capacity CUs (FCU_total ≤ CU × 130%) |
| `50944ae` | Strict CU capacity filter when any FCU has capacityKw set |
| `b1c50ca` | (chore) Re-touch TabbedDocumentCreator to force fresh Render build |

Plus colleague commits interleaved (Vercel project & related): `fa8351c`, `60c49a1`.

---

## 13) Open items (from client's Meijun email + current state)

### From Meijun's feedback (5-item list, 2026-06-11)

| # | Item | Status |
|---|---|---|
| 1 | Rounding pre-GST for Project, post-GST for Route | ✅ Done (`1b3dbb5`). Note Excel workflow shows manual entry; current impl auto-rounds. Six client-confirmation questions pending — see `cappitech-quote-rounding-pending.md`. |
| 2 | New draft should inherit "last edited data" instead of blank slate | ❌ Pending |
| 3 | Tie customer code + customer name on Quotation | ❌ Pending |
| 4 | SO doesn't take in discounted value | ✅ Done (`df97cd1`). SO/DO/Invoice carry list + absorb dealer-markdown + points into per-line discount %. Sub-total = quote's Discounted Price. |
| 5 | VRV: FCU total kW ≤ CU × 130% | ✅ Done (`50944ae`). Hidden behind capacityKw-based gate so non-VRV is unaffected. |

### Other open
- **Sheet 4 (VRV) point values** — CDKM/FDMF/SET bundle points are 0; user to confirm if Daikin sheet shows.
- **MKM shared-CU line + discount fields + sections** — deferred (per `qf-fcu-cu-quotation-template.md`).
- **$-amount document discount mode for QF** — only % at doc level supported today.
- **Round-down lever**: revisit when Cappitech confirms (manual entry vs auto, step granularity, project lever).

### Infrastructure (not a code issue but blocking visible features on prod)
- **Vercel domain alias** for `www.ai-ms.io` appears pinned to an older deployment (pre-`1b3dbb5`). Production tag has moved on but the public domain doesn't follow. Fix: Project Settings → Domains → re-assign `www.ai-ms.io` to "Production" / "Latest Production Deployment". Until then, everything from §6/§7/§8 plus the SO discount fix is in code + DB but not visible on prod.

---

## 14) Memory file cross-references

- `cappitech-pricelist-import.md` — sheet-by-sheet import handover; recipe for new sheets.
- `qf-fcu-cu-quotation-template.md` — QF totals math + custom UI behaviour.
- `cappitech-quote-rounding-pending.md` — the 6 questions for client to confirm round-down rules.
- `per-org-config.md` — pattern for org-level config (taxRate, customDocumentTypes, etc.).
- `feature-flags.md` — `enableAssetPoints`, `enableConfirmQuotation`, `enableNettRoundDown`, etc.

---

## 15) Key files map

| Area | Path |
|---|---|
| QF totals math + footer + form | `portal-production/containers/DocumentTemplates/components/TabbedDocumentCreator.tsx` |
| Preview totals + tax fields | `portal-production/containers/DocumentTemplates/components/CleanDocumentPreview.tsx` |
| Route Order points editor | `portal-production/containers/DocumentTemplates/components/RouteOrderPointsEditor.tsx` |
| Company Profile (Tax / Currency / Doc Defaults / Round step) | `portal-production/app/portal/settings/company-profile/page.tsx` |
| Orders list + verify-upload panel | `portal-production/app/portal/orders/page.tsx` + `_components/VerifySupplierUploadPanel.tsx` |
| Order detail page (editable items, spin-off buttons, Linked + Supplier Uploads) | `portal-production/app/portal/orders/[id]/page.tsx` |
| Orders service (createFromQuotation, itemizeQfRows, verifySupplierUpload, points debit hook) | `api-server-production/src/orders/orders.service.ts` |
| Documents service (createBasicDocument seeding, confirm-flip hooks) | `api-server-production/src/documents/documents.service.ts` |
| Document extraction (Claude reconciliation extractor) | `api-server-production/src/document-extraction/document-extraction.service.ts` |
| Organizations service + DTO (tax / currency / docDefaults / points / rounding step) | `api-server-production/src/organizations/organizations.service.ts` + `dto/create-organization.dto.ts` |
| Cappitech import scripts | `api-server-production/scripts/import-cappitech-*.js`, `tag-skyair-accessories.js`, `update-cappitech-points.js`, `update-qf-template-config.js` |
| Cappitech migration script | `api-server-production/scripts/migrate-cappitech-dev-to-prod.js` |
| Clone PO → SO script | `api-server-production/scripts/clone-po-to-so-cappitech.js` |
| QF template field definitions | `api-server-production/src/documentTemplates/templateFieldDefinitions.ts` |

---

## 16) Constraints + lessons (worth keeping)

- **Never `npm run db:push --accept-data-loss`** on a shared DB. It tried to drop `DeliveryLocationPing` (173 rows, a colleague's GPS feature branch). Use `prisma.$executeRawUnsafe('ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...')` + `npx prisma generate` + api-server restart instead.
- **Bash sandbox blocks outbound network** → DB scripts must run with `dangerouslyDisableSandbox: true`.
- **Always run DB scripts from `api-server-production/`** (cwd matters for `.env`/Prisma).
- **`customPrices` label is `"Discount Price"`** (not "Dealer Price"). The QF totals code keys off this exact string.
- **`templateVariant` drives auto-numbering**, not `type`. When cloning a template, override both.
- **xlsx npm module isn't installed** — read Excel via Python `openpyxl`.
- **Schema drift between dev and prod is the most common production crash class** — drift sweep query (in this doc, §11) catches it before it bites.
