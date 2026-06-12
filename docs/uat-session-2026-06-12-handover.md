# UAT Session Handover — 2026-06-12

Work done during the Cappitech UAT follow-up session, plus the running list of
client-requested changes and what's still outstanding. Companion to
`docs/cappitech-integration-handover.md`.

---

## 0) The change list (from client UAT feedback)

| # | Item | Status |
|---|---|---|
| 1 | Multiple POC ("Attn To") per customer + document dropdown | ✅ Code complete, verified locally — **not yet pushed** |
| 2 | Project = flexible discounted price up to 100; Route Order = 5/0 rounding | ❌ Not started |
| 3 | When editing a document, show who is editing it | ❌ Not started |
| 4 | Document revision / versioning ("Revision test") | ❌ Not started |
| 5 | Once a document is created, don't allow creating it again | ❌ Not started |
| 6 | Remove negative qty on all documents | ✅ Code complete — **not yet pushed** |

Plus two fixes that came up mid-session (below): the round-down guard fix and
the Biofuel-only project picker.

---

## 1) Round-down not showing for regular users — FIXED & PUSHED

**Symptom:** QF quote round-down worked when `admin@osiris.sg` viewed Cappitech
but not when `test@cappitech.sg` (a regular member) opened the same org.

**Root cause:** `ClerkAuthGuard` (`api-server-production/src/auth/clerk-auth.guard.ts`)
populates `req.userOrganization` (source of `GET /organizations/user`) using a
**hand-listed `select`**. It was never updated as Cappitech-era columns were
added, so regular users got an org object missing `quoteRoundingStep`,
`taxApplicable`, `absorbTax`, `defaultCurrency`, `docTypeDefaults`,
`pointsBalance`. Osiris-admins were unaffected because the org-switcher path
reads the full object from `GET /organizations` (`findAll` uses `include`, not
`select`).

**Fix:** added the six columns to **both** selects in the guard (membership-org
`findFirst` + admin org-switch-override `findUnique`).

- Commit: `b0db60d` on `yx/dev` — **already built + pushed**.
- Needs: api-server (Render) redeploy. DB already had the columns. No frontend
  change.
- Memory: `org-column-guard-select-gotcha.md`.

---

## 2) `Asset.isExternal` 500 on local — FIXED (DB only)

**Symptom:** `getAssets` 500 — "The column `Asset.isExternal` does not exist in
the current database."

**Root cause:** colleague Elroy added `Asset.isExternal Boolean @default(true)`
to the schema (commit `0393e0d`, Jun 3) and applied it to his DB, but the
local/dev DB (`ep-steep-truth`) never got the `ALTER TABLE`. Schema drift.

**Fix:** `ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "isExternal" boolean NOT
NULL DEFAULT true;` on the dev DB (existing rows backfilled to true). No code
change. **⚠️ Verify prod (`ep-icy-moon`) has this column too** — if missing,
prod `getAssets` will 500 the same way. (Not yet checked.)

---

## 3) Item #6 — No negative quantity on documents — DONE (not pushed)

All quantity inputs in the document editor now floor at 0 (can't type, paste, or
spin below zero; clearing reads as 0). Global — every org, every doc type.

File: `portal-production/containers/DocumentTemplates/components/TabbedDocumentCreator.tsx`

| Field | Used by | How |
|---|---|---|
| Main item `quantity` | DO, Invoice, PO, SO, QO — all standard docs | `Math.max(0, parseFloat(...) || 0)` + `inputProps min:0` |
| FCU Qty | QF quotation | clamp inside `setFcuQtyAt` |
| Accessory Qty | QF quotation | clamp inside `setAccessoryQtyAt` |
| Set Qty (`masterQty`) | QF quotation | clamp inside `setMasterQty` |
| Received Qty (×2 render spots) | PO/PR receiving | `Math.max(0, ...)` + `inputProps min:0` |

---

## 4) Item #1 — Multiple POC ("Attn To") per customer — DONE (not pushed)

A customer can now hold multiple Points of Contact. In the document editor,
picking the customer code shows an **"Attn To" dropdown**; selecting a POC fills
the **Contact** field with `Name - Phone`.

### Backend
- **New model `CustomerContact`** (`prisma/schema.prisma`): `name`, `phone?`,
  `email?`, `designation?`, `isPrimary`, `customerId` FK (onDelete: Cascade),
  `@@index([customerId])`. `Customer` gained `contacts CustomerContact[]`.
- **Table created on BOTH dev + prod DBs** via raw SQL (db:push is blocked).
  Idempotent migration: `scripts/apply-poc-and-projectflag.js`.
- **DTO** (`src/customers/dto/create-customer.dto.ts`): new `CustomerContactDto`
  + `contacts?: CustomerContactDto[]` (inherited by `UpdateCustomerDto` via
  `PartialType`).
- **Service** (`src/customers/customers.service.ts`):
  - `createCustomers` — nested `contacts.create` (filters blank-name rows).
  - `updateCustomers` — replace-on-update (deleteMany + createMany), mirrors the
    SiteOffice/ContactDetail pattern. Strips `id`/`contacts` from scalar update.
  - `getCustomers` + `getCustomerById` — now `include: { contacts: true }`.

### Frontend
- **Customer form** (`app/portal/customers/components/AddCustomer.tsx`): new
  "Points of Contact" section — `useFieldArray` add/remove rows (Name / Phone /
  Email / Designation). Loads existing POCs in edit mode; filters blank-name
  rows on submit.
- **Document editor "Attn To" dropdown** (`containers/DocumentTemplates/components/DynamicFormFields.tsx`,
  `CustomerCodeField`): renders when the selected customer has `contacts`; on
  pick sets `documentInfo.contact = "Name - Phone"` (helper `contactLabel`).
- **CRITICAL FIX — the editor's customer list was stripping `contacts`.** Four
  editor pages re-map customers into a trimmed `customersList`. Added
  `contacts: customer.contacts || []` to all four:
  - `app/portal/documents/[type]/[id]/[documentId]/page.tsx`
  - `app/portal/documents/edit/[type]/[id]/page.tsx`
  - `app/portal/documents/view/[type]/[id]/[documentId]/page.tsx`
  - `app/portal/invoices/edit/[type]/[id]/[documentId]/page.tsx`

### Notes
- Data flows via `useGetCustomers` (`app/portal/hooks/api/useCustomers.ts`,
  TanStack Query, POST `/customers`) → page `customersList` map → editor.
- `app/portal/projects/components/AddCustomer.tsx` is a **second copy** of the
  customer form used in the Projects flow — POCs were **not** added there yet
  (open question whether it's needed).

---

## 5) Project picker should be Biofuel-only — DONE (not pushed)

**Symptom:** the QUOTATION "Project" picker ("Select a project" / "Create new
project", top of the editor) showed for **all** orgs including Cappitech. Client
wants it for **Biofuel only**.

**Root cause:** the picker (`TabbedDocumentCreator.tsx` ~line 2888) was gated
only by `isQuotation && formData.customer?.id` — no org/flag check.

**Fix (per-org feature flag, the standard pattern):**
- New flag `enableQuotationProjectLink` (default **false**):
  - `portal-production/app/portal/hooks/useOrganizationFeatures.ts` —
    interface + `FEATURE_FLAG_DEFAULTS` + getter `isQuotationProjectLinkEnabled`.
  - `api-server-production/src/organizations/default-features.ts` — same default.
- Gated the picker: `isQuotation && isQuotationProjectLinkEnabled && formData.customer?.id`.
- **Enabled for Biofuel on BOTH dev + prod** (merged into
  `OrganizationUIConfig.features`) via `scripts/apply-poc-and-projectflag.js`.
- Auto-appears as a toggle in the admin config panel (since it's in the defaults).

---

## 6) DB state (what's applied where)

| Change | Local/dev (`ep-steep-truth`) | Prod (`ep-icy-moon`) |
|---|---|---|
| `Asset.isExternal` column | ✅ (this session) | ❓ **unverified — check before prod hits getAssets** |
| `CustomerContact` table | ✅ | ✅ |
| Biofuel `enableQuotationProjectLink` | ✅ | ✅ |

Migration helper: `api-server-production/scripts/apply-poc-and-projectflag.js`
(idempotent; `ENV_FILE=.env.production node scripts/...` for prod).

---

## 7) What's missing / next steps

### Deploy (nothing below is live on prod yet except the guard fix commit)
- **Build + push** the portal (Vercel) and api-server (Render). Uncommitted work:
  - api-server: `prisma/schema.prisma`, `customers.service.ts`,
    `dto/create-customer.dto.ts`, `default-features.ts`, `clerk-auth.guard.ts`
    (note: guard already committed in `b0db60d`), `scripts/apply-poc-and-projectflag.js`.
  - portal: `TabbedDocumentCreator.tsx`, `DynamicFormFields.tsx`,
    `AddCustomer.tsx` (customers), 4 editor pages, `useOrganizationFeatures.ts`.
- After deploy, POC contacts + project-picker gating + negative-qty clamp all go
  live on prod (DBs already prepared).
- **Verify `Asset.isExternal` on prod** (see §2/§6) before/with the deploy.

### Remaining change-list items (not started)
- **#2 — Order-type discount rules.** Project: flexible discounted price up to
  100 (% likely). Route Order: "5/0 rule" rounding. Ties into the existing QF
  round-down + discount logic in `TabbedDocumentCreator.tsx` totals `useEffect`
  + `CleanDocumentPreview.tsx`. Needs spec confirmation (what "up to 100" and
  "5/0" precisely mean).
- **#3 — Show who is editing a document.** Presence/lock indicator. Note the
  editor already tracks `savedBy`/`lastUsedBy`/`confirmedBy` (seen in
  `TabbedDocumentCreator.tsx` header ~line 2850) — decide live-presence vs
  last-editor display.
- **#4 — Document revision / versioning ("Revision test").** Behaviour TBD.
- **#5 — Prevent duplicate document creation.** Once created, block re-create.
  Trigger/scope TBD (double-submit guard vs once-per-source).

### Open question
- POC support on the **Projects-flow** customer form
  (`app/portal/projects/components/AddCustomer.tsx`) — add or not?

---

## 8) Constraints honoured (carried from cappitech handover)
- Never `db:push --accept-data-loss` on shared DB — used `CREATE TABLE / ALTER
  TABLE ... IF NOT EXISTS` + `prisma generate`.
- DB scripts run from `api-server-production/` with the Bash sandbox disabled
  (outbound network).
- `customPrices` label stays `"Discount Price"`; build only when asked.
