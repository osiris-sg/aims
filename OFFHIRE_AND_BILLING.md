# Off-hire and billing

**Audience:** the developer building the invoicing layer.
**Status:** written 2026-08-18, updated the same day after the off-hire fixes landed (see the CHANGED markers). Every claim below was read out of the code on `main`, with file:line references so you can re-verify. Where I checked live data it was the PROD database (`ep-icy-moon`), read-only, and it is called out.

This is the companion to `DO_COMPLETION_HANDOFF.md`. That document covers what happens when a rental **starts**. This one covers what happens when it **ends**, and what that does (and does not do) to billing.

---

## 0. The one-paragraph version

Off-hire is a **switch, not a calculation**. It stamps a date, flips a status, and deactivates any recurring schedule chained to the deployment. It never prorates, never adjusts an invoice already issued, and never writes a billing end date anywhere the invoicing layer reads. `offHiredDate` is recorded and then read by exactly one thing: a label on the project page. If you need money to follow the hire period, you are building that from scratch.

---

## 1. Every path that off-hires a deployment

There are **four** routes that end a rental commercially. They now share one rule (§1a), but they still differ in what else they touch.

### 1a. Office action on the deployment card

`POST /projects/deployments/:deploymentId/off-hire` → `projects.controller.ts:167-176` → `offHireDeployment` (`projects.service.ts:966`).

Body optionally carries `{ offHiredDate }`; omitted means "now".

```ts
// projects.service.ts — offHireDeployment is now a delegate
async offHireDeployment(deploymentId, organizationId, offHiredDate?) {
  return this.updateDeployment(deploymentId, organizationId, {
    offHiredDate: offHiredDate ?? new Date().toISOString(),
    status: DeploymentStatus.OFF_HIRED,
  });
}

// updateDeployment owns the whole rule, in ONE transaction:
const endsRental = data.status === DeploymentStatus.OFF_HIRED || !!data.offHiredDate;
return this.prisma.$transaction(async (tx) => {
  const updated = await tx.projectDeployment.update({ /* status + offHiredDate */ });
  const deactivatedRecurringTemplates = endsRental
    ? await this.deactivateDeploymentSchedules(tx, deploymentId, organizationId)
    : [];
  if (endsRental) {
    await tx.assignment.updateMany({
      where: { projectDeploymentId: deploymentId, endDate: null },
      data: { endDate: updated.offHiredDate ?? new Date() },
    });
  }
  return { ...updated, deactivatedRecurringTemplates, assignmentsClosed };
});
```

**Sets:** `ProjectDeployment.offHiredDate`, `status = OFF_HIRED`, `isActive = false` on every linked active template, and `endDate` on every open assignment.

✅ **CHANGED.** This is now one transaction, and the deactivation lives in a shared `deactivateDeploymentSchedules` helper that `updateDeployment` runs whenever a write ends a rental. `offHireDeployment` is a two-line delegate. The status change, the billing stop and the assignment closure commit together or not at all.

### 1b. Off-hire on return (automatic, at collection)

`collectReturnUnit` → `offHireDeploymentOnReturn` (`deliveries.service.ts:~2267`), which delegates to the same `offHireDeployment` above.

Fires when a rider collects a unit on a RETURN run, **after** the unit flips `rental → instock`. Subject to the last-unit guard in §3.

⚠️ **Best-effort.** The whole body is wrapped in `try/catch` that logs a warning and swallows. A failure here leaves the unit back in stock with its deployment still ACTIVE and its schedule still billing, and nothing surfaces to the office.

**Verified on PROD:** for `ZZTEST-SN-007` this path did fire. Deployment #1 shows `status=OFF_HIRED`, `offHiredDate=2026-08-18T10:04:32.442Z`.

### 1c. Convert to sale

`POST /projects/deployments/:deploymentId/convert-to-sale` → `convertDeploymentToSale` (`projects.service.ts:992`).

Guarded to `type=RENTAL` **and** `status=ACTIVE`, one-way.

```ts
await this.prisma.$transaction(async (tx) => {
  await tx.projectDeployment.update({
    where: { id },
    data: { type: DeploymentType.SALE, status: DeploymentStatus.OFF_HIRED, offHiredDate: new Date() },
  });
  // units instock|reserved|rental -> sold
  await this.deactivateDeploymentSchedules(tx, deploymentId, organizationId);
});
```

**Sets:** `type = SALE`, `status = OFF_HIRED`, `offHiredDate`, units to `sold`, templates deactivated. Fully transactional.

✅ **CHANGED.** It now sets `status = OFF_HIRED` and `offHiredDate` inside the same transaction, and reuses the shared helper. A converted sale is findable as an ended rental like any other.

⚠️ Knock-on that had to ship with it: closing the assignment (§1e) means the sold unit no longer has an OPEN assignment, so `priceInvoiceLinesFromAsset` cannot read `SALE` from it. Its intent lookup now falls back to the newest CLOSED assignment. Without that, a sold unit would price at its monthly rental rate instead of its sale price.

### 1d. The gap: the generic update endpoint

`POST /projects/deployments/:deploymentId/update` → `updateDeployment` (`projects.service.ts:944`) accepts **`offHiredDate` and `status` directly**:

```ts
data: {
  description: data.description,
  monthlyRate: data.monthlyRate,
  notes: data.notes,
  offHiredDate: data.offHiredDate ? new Date(data.offHiredDate) : undefined,
  status: data.status ? (data.status as DeploymentStatus) : undefined,
}
```

✅ **CHANGED. The back door is closed.** `updateDeployment` now runs the shared deactivation whenever `status === OFF_HIRED` or an `offHiredDate` is written, so this route behaves exactly like the dedicated one.

| Path | offHiredDate | status | units | templates | assignments | atomic |
|---|---|---|---|---|---|---|
| office off-hire (1a) | ✅ | OFF_HIRED | untouched | deactivated | closed | ✅ |
| off-hire on return (1b) | ✅ | OFF_HIRED | already instock | deactivated | closed | ✅ write, ⚠️ still swallowed by the caller |
| convert to sale (1c) | ✅ | OFF_HIRED | → sold | deactivated | closed | ✅ |
| generic update (1d) | ✅ if passed | as passed | untouched | deactivated when it ends a rental | closed | ✅ |

### 1e. Assignment closure

✅ **CHANGED.** Ending a rental now closes its open assignments (`Assignment.endDate` stamped with the same instant as `offHiredDate`). Previously they were left open, so an off-hired deployment still listed its units as on it and the unit still read as on a project.

⚠️ **External contract note:** the water-sg projection (`public-api.service.ts:37`) reads the unit's OPEN assignment. A returned or sold unit now reports `deployedDate: null` and no deployment `type`, where it previously reported stale values. That is more truthful but it is a visible change to a consumer outside this repo.

---

## 2. What off-hire does to billing

Exactly one thing: **it deactivates recurring invoice schedules chained to that deployment.** Nothing else in the money path is aware off-hire happened.

**The link** is `RecurringInvoiceTemplate.projectDeploymentId` (nullable). It is set only from the DTO at create/update (`recurring-invoices.service.ts:114`, `:139`), i.e. by the "Confirm and make recurring" flow that seeds a schedule off a confirmed invoice. Generated invoices inherit `projectId`/`projectDeploymentId` so the chain stays intact (`:224-229`).

**The query** is narrow and exact:

```ts
where: { organizationId, projectDeploymentId: deploymentId, isActive: true }
```

### What can be missed

1. **A template with `projectDeploymentId = null`.** The column is nullable and the DTO field is optional, so a schedule created directly (rather than through "Confirm and make recurring") has no deployment link and is **invisible to off-hire forever**. This is the most likely real-world miss.
2. **A template linked only by `projectId`.** The filter keys on `projectDeploymentId` alone. A project-level retainer covering the same units keeps running.
3. ~~Off-hire via the generic update endpoint~~ — **fixed** (§1d).
4. **A partial return** never reaches the deactivation at all (§3). Still true, and now surfaced (below).
5. ~~The non-transactional gap~~ — **fixed** (§1a).

Items 1 and 2 remain live and nothing reconciles them. The audit query in §7 finds case 1.

---

## 3. ⚠️ The last-unit guard

`offHireDeploymentOnReturn` (`deliveries.service.ts:~2267`):

```ts
const assignment = await prisma.assignment.findFirst({
  where: { inventoryId, endDate: null, projectDeploymentId: { not: null } },
  orderBy: { startDate: 'desc' },
  select: { projectDeploymentId: true },
});
const depId = assignment?.projectDeploymentId;
if (!depId) return;                                   // not on a deployment: nothing to off-hire

const siblings = await prisma.assignment.findMany({
  where: { projectDeploymentId: depId, endDate: null, inventoryId: { not: inventoryId } },
  select: { inventoryId: true },
});
const stillOut = sibIds.length
  ? await prisma.inventory.count({ where: { id: { in: sibIds }, status: InventoryStatus.rental } })
  : 0;
if (stillOut > 0) return;                             // partial return: keep billing
await this.projectsService.offHireDeployment(depId, organizationId);
```

**"Last" is computed from `Inventory.status`, not from assignment closure.** A sibling counts as still out only if its `Inventory.status` is literally `rental`. A sibling that is `sold`, `maintenance`, `pending` or already `instock` does **not** hold the deployment open.

### What a partial return does to billing

**Nothing. Billing continues unchanged, at the full amount.**

Return 2 of 5 units and: the deployment stays `ACTIVE`, `offHiredDate` stays null, every linked template stays `isActive: true`, and the next cron run generates the **same invoice as last month**. The recurring template's `config.items` are a **fixed snapshot** captured when the schedule was created (§5); nothing recomputes them from what is still on hire. There is no per-unit proration and no partial credit.

So a customer who returns most of a fleet keeps being billed the full monthly amount until the **last** unit comes back. That is the single most consequential billing behaviour in this document.

✅ **CHANGED: it is now visible, but still not corrected.** A Finance Hub Action Queue detector (`detectPartiallyReturnedRentals`) raises a warning on `/portal/accounting` for any ACTIVE deployment with live schedules where some units are back and some are still out: "3 of 5 units returned, still billing in full". It links to the project.

The amount is deliberately **not** auto-adjusted. A recurring template stores an opaque `config.items` snapshot with **no link from any line to a unit** (§5), so there is nothing to reduce against and any recomputation would be guesswork on money. Fixing it properly needs per-unit template granularity, which is filed separately and depends on assignment closure (§1e) as its signal.

Two adjacent facts worth knowing:

- **Off-hire does not close the assignment.** Verified on PROD: `ZZTEST-SN-007`'s deployment is `OFF_HIRED` with an `offHiredDate`, yet its `Assignment.endDate` is still `null`. So "active assignment" and "live rental" are not the same thing, and the sibling query above (`endDate: null`) counts assignments that belong to already-off-hired deployments.
- Because the guard reads `Inventory.status`, anything that flips a unit's status outside the return flow silently changes who is "last".

---

## 4. ⚠️ What is NOT handled

This is the section to read before designing anything.

### No proration, anywhere

Grepping the whole backend and portal for `prorat`, `proration`, `perDiem`, `dailyRate`, `daily rate` returns **zero hits**. The only duration arithmetic in the codebase is display-only:

```ts
// portal-production/app/portal/projects/[id]/page.tsx:263
const monthsBetween = (start, end) =>
  Math.max(0, (e.getFullYear()-s.getFullYear())*12 + (e.getMonth()-s.getMonth()));
```

Calendar-month difference, floored, used to render "(3 mth)" on a deployment card. It never touches money.

### No billing end date on the invoice side

- The invoice carries `config.date` (the issue date) and nothing else temporal. There is no period start, no period end, no service-from/service-to.
- `RecurringInvoiceTemplate.endDate` exists, but it stops the **schedule**, not a period: `runDue` deactivates the template when `endDate < nextRunDate` (`recurring-invoices.service.ts:~312`). It never appears on the document.
- **`offHiredDate` is never read by anything financial.** The only readers in the entire repo are `projects.service.ts` (returning it in a payload) and two lines on the project detail page that render it and feed `monthsBetween`. The invoicing layer does not consult it.

### An invoice already issued for a period the unit was returned partway through

**It stands, unchanged.** Nothing looks back at issued documents when a return happens. There is no adjustment, no credit, no flag on the invoice, and no link from the return to the invoice that covered that period. The only correction mechanism is the one the field flow already documents for sold units: **raise a credit note manually**.

### Other things a billing layer will expect and not find

| Expected | Reality |
|---|---|
| A hire period on the invoice | Not modelled. See `DO_COMPLETION_HANDOFF.md` §4: the invoice carries no rental period at all. |
| Deployment → invoice link at creation | `Document.projectDeploymentId` is **null** on an auto-created invoice; it is only backfilled at `confirmInvoice`, and only from the source DO, which usually has none either. |
| A "final invoice" concept at off-hire | Does not exist. Off-hire stops future invoices; it does not generate a closing one. |
| Minimum hire period, notice period, deposit | No model, no field. |
| Anything reconciling `offHiredDate` against issued invoices | Does not exist. |

---

## 5. The recurring-invoice cron

**Schedule:** `@Cron('*/2 * * * *')` on `runDueAllOrgs` (`recurring-invoices.service.ts:283`). Registered via `ScheduleModule.forRoot()` in `app.module.ts:71`.

⚠️ **Single-instance only.** The code comments it explicitly: "Single-instance deploys only — if the API ever scales out, this needs a lock." There is no advisory lock. Scaling Render past one instance will double-bill.

**Selection, in two stages:**

```ts
// 1. which orgs have work
const due = await prisma.recurringInvoiceTemplate.findMany({
  where: { isActive: true, nextRunDate: { lte: new Date() } },
  select: { organizationId: true }, distinct: ['organizationId'],
});
// 2. per org
const due = await prisma.recurringInvoiceTemplate.findMany({
  where: { organizationId, isActive: true, nextRunDate: { lte: now } },
});
```

**Per template:**

1. If `endDate < nextRunDate`, set `isActive: false` and skip.
2. `generateOne(org, template, template.nextRunDate)`.
3. On success only, advance: `nextRunDate = advanceDate(nextRunDate, frequency)`, `nextRunNo++`, stamp `lastRunAt` and `lastRunDocumentId`.
4. On failure, log and **leave `nextRunDate` untouched** so it retries on the next sweep. No document is posted.

`advanceDate` is naive calendar arithmetic (`setMonth(+1)` for MONTHLY, etc.), so it inherits JavaScript's month-end rollover behaviour.

**What `generateOne` reads:** `template.config` (the fixed line items and text, with `{TOKEN}`s resolved against the run date), `customerId`, `numberFormatId`, the customer's currency, and the org tax rate as a per-line default. **It does not price anything from the catalog.** The amounts are whatever was snapshotted into `config.items` when the schedule was created.

**How an off-hired deployment drops out:** purely through `isActive: false`. Both queries filter on it, so a deactivated template is invisible to the sweep from the next tick onward. There is no deployment join in the cron at all — it never checks `ProjectDeployment.status`. **If the template was not deactivated (any miss in §2), off-hire has no effect on the cron whatsoever.**

---

## 6. ⚠️ The negotiated-rate gap

This affects every rental invoice, not just off-hire, and it is documented here because it is where the money actually comes from.

**There are two rate sources and they disagree:**

1. `ProjectDeployment.monthlyRate` (`Float?`, with `currency` defaulting to `"SGD"`) — the per-deployment negotiated rate. Rendered on the project page as "Rate: $500 / mth".
2. `Asset.customPrices[]` — the catalog list rate, matched `/monthly\s*rental/i` first, then any `/rental|hire/i` label.

**Invoice pricing reads (2) and ignores (1) entirely.** `priceInvoiceLinesFromAsset` (`documents.service.ts`) resolves the asset and takes `Asset.price` for SALE lines or the `customPrices` rental entry for RENTAL lines. `ProjectDeployment.monthlyRate` appears nowhere in that function.

**And `fieldDeploy` never populates `monthlyRate`.** A deployment created from the field carries `null`, so even a layer that wanted to prefer the negotiated rate would usually find nothing there.

**Verified end-to-end on PROD**, on the invoice generated when run #17 completed:

```
deployment SCHEDULE TEST AUG18 #1: type=RENTAL status=ACTIVE monthlyRate=null
ZZTEST asset: price=5000  customPrices=[{"label":"Monthly Rental","value":500}]

invoice BIPL-EW-INV-20260818-0037:
  ZZTEST Asset   unitPrice=500  qty=1  amount=500   <- catalog rate, not the deployment
  free-typed     unitPrice=0    qty=1  amount=0
```

The invoice priced at **500** from `customPrices` while the deployment's own `monthlyRate` was null. Had someone negotiated 450 on the deployment, the invoice would still have said 500.

**Note the two pricing paths do not share code.** A DO-completion invoice is priced live by `priceInvoiceLinesFromAsset`; a recurring invoice replays a frozen `config.items` snapshot. Changing catalog pricing moves the first and not the second.

---

## 7. Quick reference: what to join to

```
ProjectDeployment
  ├─ .status          ACTIVE | OFF_HIRED | COMPLETED | CANCELLED
  ├─ .type            RENTAL | SALE          (convert-to-sale leaves status ACTIVE)
  ├─ .deployedDate    rental start
  ├─ .offHiredDate    rental end  (written by 1a/1b/1d; never by convert-to-sale;
  │                                never read by anything financial)
  ├─ .monthlyRate     negotiated rate, usually NULL, ignored by pricing
  │
  ├─ assignments[]    Assignment.endDate = null means "active"
  │                     ✅ now closed when the rental ends, stamped with offHiredDate
  │                     └─ .inventoryId -> Inventory.status is still the safest
  │                        liveness signal (the last-unit guard uses it)
  │
  └─ RecurringInvoiceTemplate.projectDeploymentId  (nullable, the ONLY billing link)
       ├─ .isActive      the single switch off-hire flips
       ├─ .nextRunDate   what the cron selects on
       ├─ .endDate       stops the schedule, never appears on a document
       └─ .config.items  FROZEN prices; not recomputed from the catalog or the fleet
```

**Useful predicates**

- Rentals that have genuinely ended: `status = 'OFF_HIRED'` now covers converted sales too.
- Units genuinely out right now: `Inventory.status = 'rental'`, **not** `Assignment.endDate IS NULL`.
- Schedules that off-hire can never stop: `RecurringInvoiceTemplate.isActive = true AND projectDeploymentId IS NULL`. Worth running as an audit.
