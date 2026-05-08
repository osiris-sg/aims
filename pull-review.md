# pull-review.md

What landed on `elroy_test_branch` from someone else's push (fast-forward pull on 2026-05-02 → 2026-05-03 local).

## Pull range

- **From:** `6cbe99e` 2026-05-01 — `fix: fixed db links, added asset-based assignments + backfill` (your Phase 2 commit)
- **To:** `3053bb5` 2026-05-02 — `feat: project deployments — group rentals/sales under DOs with billing rollups`
- Single commit, fast-forward, no merge needed.

## Commit

| Hash | Author | Date | Message |
|---|---|---|---|
| `3053bb5` | osirisAdmin-1 \<admin@osiris.so\> | 2026-05-02 19:03:58 +0800 | feat: project deployments — group rentals/sales under DOs with billing rollups |

## Files changed (`git diff --stat 6cbe99e..3053bb5`)

| File | +/− | Status |
|---|---|---|
| `api-server-production/package.json` | +3 / −1 | modified — adds two npm scripts |
| `api-server-production/prisma/schema.prisma` | ~+88 | modified — overlaps with Phase 2 |
| `api-server-production/scripts/backfill-biofuel-deployments.ts` | +363 | **new** |
| `api-server-production/src/documents/documents.service.ts` | +29 | modified |
| `api-server-production/src/projects/projects.controller.ts` | +46 | modified |
| `api-server-production/src/projects/projects.service.ts` | +239 | modified — overlaps with Phase 2 |
| `portal-production/app/portal/projects/[id]/page.tsx` | +/− 891 | **near-total rewrite** — overlaps with Phase 2 |

Total: 7 files, ~1274 insertions / 386 deletions.

## Per-file plain-English summary

### `api-server-production/package.json`
Adds two npm scripts:
- `backfill-biofuel-deployments` — runs the new deployment backfill script.
- `backfill-biofuel-deployments:dry` — same with `--dry-run`.

No dependency changes.

### `api-server-production/prisma/schema.prisma`
Big additive set of changes building on top of your Phase 2 schema. Nothing you added (`Assignment.assetId`, `quantity`, `documentId`, the new uniques and indexes) was removed.

- **Customer**: gets `projects: Project[] @relation("CustomerProjects")` back-relation.
- **Document**: gets `projectDeploymentId: String?` column + relations `projectDeployment` (incoming invoices) and `sourcedDeployments` (deployments started from this DO) + `@@index([projectDeploymentId])`.
- **Project**: substantial overhaul. New fields:
  - `projectNumber: String?` (unique within org via `@@unique([projectNumber, organizationId])`)
  - `customerId: String? @db.Uuid` — **direct customer FK** (closes the §10/§11 gotcha that the project had no `customerId`)
  - `customerPoNumber: String?`
  - new relations: `customer Customer? @relation("CustomerProjects", ...)` and `deployments ProjectDeployment[]`
  - new indexes: `@@index([organizationId, status])`, `@@index([customerId])`
- **NEW model `ProjectDeployment`** — groups one rental/sale/service event under a project. Fields: `id, organizationId, projectId, sourceDocumentId, type (DeploymentType, default RENTAL), description, monthlyRate, currency (default 'SGD'), deployedDate, offHiredDate, status (DeploymentStatus, default ACTIVE), notes, createdAt, updatedAt`. Relations: `project`, `sourceDocument` (the originating DO), `assignments`, `invoices` (recurring monthly invoices for the same rental). Indexes on `(projectId, status)` and `(organizationId)`.
- **NEW enums** `DeploymentType { RENTAL, SALE, SERVICE }` and `DeploymentStatus { ACTIVE, OFF_HIRED, COMPLETED, CANCELLED }`.
- **Assignment**: gets a new optional `projectDeploymentId: String?` column + `projectDeployment` relation + `@@index([projectDeploymentId])`. Your Phase 2 fields (inventoryId, assetId, quantity, documentId), uniques, and indexes are all intact.

### `api-server-production/scripts/backfill-biofuel-deployments.ts` (NEW, 363 lines)
Backfill that turns existing ImportInvoice rows into Project + ProjectDeployment + Document linkages.

What it does:
1. Pulls every Biofuel ImportInvoice with non-empty `projectName`.
2. Normalises project names (lowercase, collapse separators, strip "HDB"/"The" prefixes, expand shorthand like `rvr`→`river`, `pks`→`peaks`).
3. Groups rows under a canonical project key, then sub-groups by `doNumber` into deployment buckets.
4. Find-or-create a Project per group (matching on normalised name); patches `customerId` if missing on existing rows.
5. For each DO bucket, find the source DO Document by `name CONTAINS doNumber`, infer deployment shape (RENTAL if recurring, SALE if single), compute `monthlyRate` as median of grosses, parse off-hire dates from invoice references via regex (`Off-Hired on dd/mm/yy`).
6. Create or match a `ProjectDeployment` (idempotency key: `description STARTS WITH doNumber`).
7. For every invoice in the bucket, find its Document by `name CONTAINS invoiceNumber` and update `projectDeploymentId` + `projectId`.

Flags: `--dry-run`, `--org=<uuid>` (default Biofuel). Idempotent. Prints summary at the end (created/matched projects, deployments, linked/unmatched documents).

### `api-server-production/src/documents/documents.service.ts`
Adds 29 lines around line 1954 (in the invoice-confirm path). When a document is confirmed and has a `sourceDocumentId` (the originating DO), the service now reads the source DO's `projectId` and `projectDeploymentId` and inherits whichever the invoice doesn't already have, then writes them onto the invoice during the `prisma.document.update`. So an invoice extracted from a DO will automatically end up linked to the same project + deployment.

This is the only change in this file and it's purely additive — no other behavior modified.

### `api-server-production/src/projects/projects.controller.ts`
Adds four endpoints in a "Deployments" block, all permission-gated:
- `GET  /projects/:id/deployments` — `projects:read-one` — list deployments.
- `POST /projects/:id/deployments` — `projects:update` — create deployment.
- `POST /projects/deployments/:deploymentId/update` — `projects:update` — update deployment.
- `POST /projects/deployments/:deploymentId/off-hire` — `projects:update` — mark off-hired.

Each delegates to a new service method.

### `api-server-production/src/projects/projects.service.ts`
Two big things:

1. **`getProjectById` rewritten** to return a much richer view. Your Phase 2 includes (`inventory.sku/status`, `asset { id name skuKey uom }`, `document { id name }`) are preserved on the assignments include. New things added: `customer` direct include, `siteOffice` widened to include `address`, full `deployments` include with nested `sourceDocument`, `assignments`, and `invoices` (with `payments` and `config`), and `documents` widened with `projectDeploymentId`, `config`, and `payments`. The handler then computes:
   - per-deployment rollup: `totalBilled`, `totalPaid`, `outstanding`, `invoiceCount`, `lastInvoiceDate/Name`
   - project-level totals across every linked document
   - separate `standaloneDocs` (documents not bound to a deployment)
   - flat `allInvoices` list
   - resolved customer (direct FK first, falls back to `siteOffice.customer` for legacy rows)

   The return value is no longer the raw Prisma project — it's a transformed object: `{ id, projectNumber, name, description, status, startDate, endDate, customerPoNumber, customer, siteOffice, deployments, standaloneDocs, allInvoices, totals }`.

2. **Four new service methods** for the deployment endpoints: `listDeployments`, `createDeployment` (default type RENTAL, currency SGD, deployedDate now), `updateDeployment` (partial), `offHireDeployment` (sets `status = OFF_HIRED` + `offHiredDate`).

Plus a top-of-file utility `readDocAmount(config)` that tries several JSON keys (`nettTotal`, `netTotal`, `grandTotal`, `total`, `amount`, `totalAmount`) to pull a number out of `Document.config`. Used by the rollups.

`getProjects`, `addAssignmentsToProject`, `createProject`, `updateProject`, `deleteProject` are unchanged.

### `portal-production/app/portal/projects/[id]/page.tsx`
**Near-total rewrite** (~891 lines diffed). The previous file had ~210 lines; the new file has 597. The entire UI is now deployment-centric.

Top-level structure of the new file:
- type aliases `DeploymentStatus`, `DeploymentType`
- interfaces `Deployment` and `ProjectDetail` (matching the new `getProjectById` return shape)
- helpers `fmtMoney`, `fmtDate` (renders `"—"` for null — same null-guard goal as your "Not set"), `monthsBetween`, `statusChip`
- `ProjectDetailsPage` component:
  - fetches `/projects/:id` and reads the new transformed shape
  - renders breadcrumb (`Projects / {projectNumber} — {name}`)
  - header (project name + status chip, customer, site office + address, customer PO number, period)
  - summary stat row (totals from the rollup)
  - **Tabs:** Active deployments, Past deployments, Standalone docs, All invoices
  - Each Active/Past tab renders a list of `DeploymentCard`s; each card shows type/status/description/monthlyRate/period/billed/paid/outstanding/invoice list, plus an "Off-hire" button (calls `POST /projects/deployments/:id/off-hire`)
  - "Add Deployment" dialog (`NewDeploymentDialog`) — fields: type, description, monthly rate, currency, deployed date, source document, notes
- helper components `SummaryStat`, `DeploymentCard`, `NewDeploymentDialog`

The previous direct Assignments table (Item SKU / Qty / Source / Start / End / Status from your Phase 2 changes) is gone from this file. Assignment rows are now consumed inside `DeploymentCard` instead. The `1970-epoch` guard for project header dates that you added is replaced by the file-level `fmtDate("...") = "—"` helper, which preserves the same outcome via `"—"` fallback.

The old `setValue("assignments", ...)` flow, `useGetInventoryByAsset` integration, `selectedAssetId/selectedItem` state, and the old "Add Item" dialog that mutated assignments directly — all removed. New flow goes through deployments.

## Files in this pull that overlap your Phase 2 work

Phase 2 touched: `schema.prisma`, `import.service.ts`, `projects.service.ts`, `portal-production/app/portal/projects/[id]/page.tsx`, plus your new scripts in `api-server-production/scripts/`.

| File | Overlap | Pull's effect on your code |
|---|---|---|
| `prisma/schema.prisma` | Yes | **Additive.** All Phase 2 columns (`assetId`, `quantity`, `documentId`), uniques (`(projectId, assetId, documentId)`, `(projectId, inventoryId)`), indexes, and the back-relations on Asset/Document are intact. The pull adds `projectDeploymentId` to `Assignment` (nullable) and `Document`, plus the new `ProjectDeployment` model and two enums. |
| `src/import/import.service.ts` | **No.** | Not touched in this pull. Your Phase 2 rewrite of `importSingleInvoice` (mode A / mode B branching, `validateAssignmentMode`, per-line idempotency) is untouched. |
| `src/projects/projects.service.ts` | Yes | **Mostly additive.** Your Phase 2 changes were the includes on `getProjects`/`getProjectById` (inventory.sku+status, asset, document) and the removal of the `documentId`/`document: undefined` ghost fields in `addAssignmentsToProject`/`createProject`/`updateProject`. The pull preserves your include shape on `assignments` and adds more relations alongside. `getProjectById` now returns a transformed object instead of the raw Prisma row — callers expecting `project.assignments` directly will need the new shape. `getProjects`, `addAssignmentsToProject`, `createProject`, `updateProject` are unchanged from your Phase 2 versions. |
| `portal-production/app/portal/projects/[id]/page.tsx` | Yes | **Replaced.** Your Phase 2 changes (null-safe `a.inventory?.sku ?? a.asset?.skuKey ?? "—"`, the new Qty/Source columns, the date-guard `"Not set"` fallback) were on the old direct Assignments table. The new file no longer has that table — assignments are surfaced inside `DeploymentCard`. The 1970-epoch-date issue stays solved via the new `fmtDate` helper which renders `"—"` on null. |
| `api-server-production/scripts/check-and-clean.ts` | No | Untouched by pull. |
| `api-server-production/scripts/cleanup-import-tables.ts` | No | Untouched by pull. |
| `api-server-production/scripts/backfill-imports.ts` | No | Untouched by pull. The new `backfill-biofuel-deployments.ts` is a separate script with a different purpose (project + deployment grouping, not importSingleInvoice re-translation). |

No git conflicts, no overwrites, no Phase 2 logic reverted. The pull is built **on top of** your Phase 2 schema and reads cleanly with it.

## Net new surface area introduced by the pull

- 2 enums (`DeploymentType`, `DeploymentStatus`)
- 1 new Prisma model (`ProjectDeployment`)
- 4 new endpoints under `/projects/...`
- 2 new npm scripts
- 1 new TypeScript script (`scripts/backfill-biofuel-deployments.ts`)
- 1 reshape of `getProjectById`'s return type (transformed, no longer raw Prisma)
- 1 new behavior in document-confirm flow (project + deployment inheritance from source DO)
- 1 frontend page rewritten around the new shape
- 1 new direct customer FK on `Project` and `customerPoNumber` field
- 1 unique constraint on `(projectNumber, organizationId)`
