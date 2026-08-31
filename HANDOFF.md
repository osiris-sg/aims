# AIMS — Project Handoff / Context Doc
_Last updated: 2026-09-01, at commit `4022ad11`. Maintainer: Elroy. This doc orients a fresh Claude/Claude Code session._

_Verification dates differ per section and are stated inline. §1–§3, §6–§8 and §12 were re-derived from the code at `4022ad11` on 2026-09-01. §11 (CIEL) was read from the CIEL docs that arrived in the same range and its DB claims were checked against all three Neon DBs on 2026-09-01. §9 carries its 2026-08-14 PROD verification date and has NOT been re-checked._

---

## 1. Repo + Deploy Topology

Monorepo at `~/Desktop/aims`. **Five deployables** (was four — `landing-production/` is new since the last revision of this doc):

| Deployable | Stack | Deploys to |
|---|---|---|
| `api-server-production/` | NestJS + Prisma + Neon + Clerk | **Render** from `main` |
| `portal-production/` | Next.js 14 portal + Capacitor Android field app | **Vercel** from `main` → **`app.ai-ms.io`** |
| `landing-production/` | Next.js marketing site (no auth, no MUI; copy in `app/_content/site.ts`) | **Vercel** from `main` → **`ai-ms.io`** |
| `email-ingest-worker/` | Cloudflare Email Worker | Cloudflare |
| `whatsapp-group-bridge/` | Node `whatsapp-web.js` | self-hosted |

- **The portal host changed.** It is `app.ai-ms.io`, not `www.ai-ms.io`. The apex `ai-ms.io` is now the **landing site**, which 301s legacy `/portal`, `/pay`, `/guest`, `/scan`, `/sign-in` to `app.ai-ms.io`. Anything in older notes about "www vs apex" is stale — the correct Capacitor production target is `CAP_SERVER_URL=https://app.ai-ms.io` (confirmed in `portal-production/capacitor.config.ts`).
- **Branch topology:** `main` = production. `elroy/dev` = staging/work branch (Vercel previews at `aims-mocha.vercel.app`). **YX pushes to `elroy/dev`**, not to `main` — the old note saying he pushes to `main` directly is wrong. Expect `elroy/dev` to be well ahead of your local copy: on 2026-09-01 a single `git pull` brought **16 commits, 84 files, +10,808 lines**. Always pull before you start.
- Backend build = `nest build && npx prisma db push` (see §3b — this MUTATES the DB on every deploy). `prebuild: npx prisma generate`. `start:prod: node dist/src/main`.
- Frontend→backend URL env: `NEXT_PUBLIC_BACKEND_API_URL` (NOT `NEXT_PUBLIC_API_URL`).
- Deeper docs: `docs-site/` (Mintlify). Root specs: `ACCOUNTING_ARCHITECTURE.md`, `EXTERNAL_API_AND_INGESTION_HANDOVER.md`, `EMAIL_INGESTION_PLAN.md`, `POSTING_QUEUE_AND_JSON_INGESTION_SPEC.md`, `WATER_SG_INTEGRATION.md`, and the CIEL trio (§11).
- Separate repo `~/Desktop/water-sg` (T3/Next.js, `apps/water-sg/`), branch `main`, Vercel, prod `app.biofuelindustries.sg`.

---

## 2. Working Rules

- **Investigate read-only first → report → build → audit diffs → STOP before commit → explicit approval → commit.**
- **Stage explicit file paths only. NEVER `git add -A`.** Persistent noise stays unstaged: `.DS_Store`, `.claude/settings.local.json`, both `package-lock.json`, `android/gradlew`, `public/company-stamp.jpg`, `public/eugene-signature.png`, and the ~40 `scripts/_*.js|ts` one-offs.
- **Sync discipline:** `git fetch origin && git rev-list --left-right --count origin/main...main` (want `0 0`) before push. Work on `elroy/dev`, then `git checkout main && git merge --ff-only elroy/dev && git push`. If a push rejects (YX raced), rebase and re-push — file overlap is usually zero.
- **DB scripts:** Neon WebSocket adapter (§12). Always DRY RUN printing a plan, then `APPLY=1`. **Target rows by exact ID, not name** (name collisions exist). **Host-guard prod scripts** with `if (!u.hostname.startsWith('ep-icy-moon-a19rnv5x')) abort` and print the host.
- **Prod testing:** the user tests on deployed prod (Render+Vercel). Deploy BEFORE testing. Hard-refresh — print CSS and document layouts cache aggressively.
- Match the commit trailer to whatever model is actually running.

---

## 3. ⚠️ Build & Deploy Gotchas

### 3a. The local `.env` points at DEV, not prod
`api-server-production/.env` `DATABASE_URL` = **`ep-steep-truth-a18pvr39-pooler`** (DEV). Prod/legacy URLs sit **commented out** above it. This has caused wrong-DB answers.

| Host | Role | How reached |
|---|---|---|
| `ep-steep-truth-a18pvr39` | **DEV** | active `DATABASE_URL` in `.env` — what plain scripts/`db:push` hit |
| `ep-odd-truth-a1gtcsmc` | **STAGING** | hard-coded in staging scripts |
| `ep-icy-moon-a19rnv5x` | **PROD** (Render prod, `app.ai-ms.io`) | commented in `.env`; hard-coded + host-guarded in prod scripts |
| `ep-gentle-bonus-a1hjwef9` | legacy pre-migration DB (~292k old docs) | `DATABASE_STAGING_URL` |

⚠️ **`.env.staging` and `.env.production` do NOT exist in the working copy**, though `package.json` (`db:push:staging`, `db:push:prod`, `db:studio:prod`) and the CIEL docs assume they do. Those npm scripts will fail until you create them. Scripts that "check prod" must use the ep-icy-moon URL explicitly.

### 3b. Render prod build runs `prisma db push` — schema drift blocks ALL deploys
The deploy build pushes `schema.prisma` to whatever `DATABASE_URL` Render points at, **on every deploy**. `--accept-data-loss` has been added and dropped several times; the current build has **none**, so a change requiring data loss makes `db push` refuse, the build fails, and **the whole backend stops deploying**. Migrations are abandoned (`db:push`, not `prisma migrate`).
- Additive nullable columns are safe. Destructive/renaming changes need care: apply the DDL to prod manually first (host-guarded), or temporarily restore `--accept-data-loss` for that one deploy and revert.
- **A red backend deploy is usually a schema-drift `db push` failure, not a code error.** Check the prisma step in the Render log.
- **Corollary that bit us:** because prod auto-pushes, a schema change merged to `main` reaches the prod DB before anyone runs a migration by hand — but **dev and staging do not auto-push**. After pulling a schema change, run `db:push` locally or Prisma will error against a stale DB.

### 3c. ⚠️ `nest build` is NOT a type gate — `tsc --noEmit` is
`nest build` uses SWC and **does not type-check**. A DTO using `@IsOptional()` without importing it (TS2304) built green and would have crashed at runtime on deploy.
- **Rule: `cd api-server-production && npx tsc --noEmit` before pushing any backend change.** Same for the portal.
- Pre-existing noise: `src/recurring-invoices/recurring-invoices.service.ts` (~4 `nextRunNo` errors) and `scripts/*` — filter to files you touched.

### 3d. The Capacitor field app loads JS from the server — only NATIVE changes need an APK
`capacitor.config.ts` sets `server.url` (prod = `https://app.ai-ms.io`). The shell does **not** bundle the Next build — it loads the deployed portal live.
- **JS/UI/flow changes ship via Vercel.** No APK rebuild.
- **Only native changes** (new plugin, `AndroidManifest`, Java/Kotlin, camera/NFC/printer native code, `server.url`) need `npx cap sync` + Gradle + `adb install -r`.

---

## 4. Org / Entity IDs

- **Biofuel** org: `52e90ba8-bfbd-48b0-bb76-4f9667bf74f1` — the live delivery/field customer.
- **Cappitech** org: `59802f75-262b-4f96-b8b2-09a9a071d882`.
- **CIEL INTERIOR** — one Clerk instance serves all three envs so **user ids are identical everywhere**; org ids differ: dev `5a12a9f9-f139-44e8-ab68-dd63f1c23ae3` · staging `25134abf-206f-4136-99e1-6d2e38af9bd9` · prod `09e55c23-e031-4254-8152-a373597b2cb3`.
- Field-tech roles (`name = 'field-tech'`) exist in 4 orgs: Osiris Technology `bfad387e…`, **Biofuel `4c2a3fb3…`**, osiris-platform `df3efff2…`, Test Org `877997f7…`.
- **ZZTEST re-bind rig (2026-08-14):** asset "ZZTEST Asset" (`ZZTEST-AST`, `976f1f1c…`) units 001..006 + **ZZTEST-SN-007** (`df39b6a5…`). Child types **ZZTestChild** (`569f4808…`) + **TEST123** (`1f045f08…`). Reset: `scripts/_zztest-0607-reset.js` (DRY default, `APPLY=1`, host-guarded).

---

## 5. FIELD DEVICES — Sunmi is retired (2026-09)

**The Sunmi V3 pivot is over. Field hardware is standard Android phones and tablets only.** Everything Sunmi-specific — the InnerPrinter virtual Bluetooth device, the HOME-launcher kiosk setup, the "no camera app so `getPhoto()` fails" workaround rationale — is **no longer operative**. Do not plan around it.

What survives the pivot and still matters:
- **Camera:** keep using `@capacitor/camera` **`Camera.takePhoto()`** (in-app CameraX) via `app/(field)/lib/nativeCamera.ts`. It works everywhere and avoids depending on a device having a camera app.
- **NFC** is present on the target phones/tablets.
- Branch **`bluetooth-printer-flow`** (`43e7aa2`) still preserves the full XP-58IIH Classic-SPP ESC/POS chain and `BLUETOOTH_PRINTER_FLOW.md`, if printing is ever revived.

### ⚠️ DECISION NEEDED: the field "Print DO" button has nothing to print to
`app/(field)/lib/btPrinter.ts` still assembles a **58mm ESC/POS byte stream** (`ESC 0x40` init, `ESC 0x61` align, 384 dots/line — written for XP-58IIH-class hardware) and ships it over the native `BtPrinterPlugin.java` Classic-SPP bridge. That targeted a built-in/paired thermal printer. **On a plain Android phone or tablet there is no such printer**, so the button either fails or silently does nothing.

Options, none chosen yet — **this needs a product decision before the next field rollout**:
1. Remove the button and the ESC/POS + native plugin stack entirely.
2. Keep it but gate it behind a per-org/per-device "has thermal printer" setting.
3. Repoint it at a paired external 58mm Bluetooth printer as an optional accessory (the `bluetooth-printer-flow` branch is the reference).
4. Replace it with share-a-PDF (the guest DO view already renders a correct A4 PDF — §6).

The itemized-receipt/reprint UI (`app/(field)/scan/deliveries/finished/[deliveryId]/page.tsx`) depends on the same stack and shares the fate of whichever option is taken.

---

## 6. THE BIOFUEL DO RESTRUCTURE (2026-08) — read before touching any DO layout

### 6a. ⚠️ It is BIOFUEL ONLY — the generic layout must not move
`CleanDocumentPreview.tsx` branches on `isBiofuel` (org id `52e90ba8…` or name "Biofuel Industries Pte Ltd"). The Biofuel arm is the paper-DO replica: letterhead, two-column info block, inline per-line proof photos, TIMELINE block, RECEIVED BY box, Biofuel footer. **Every other org keeps the generic arm.**

**The generic sub-layout is byte-identical to `b9aee590` and must stay that way.** Verified 2026-09-01: extracting the generic arm from both revisions gives the same 264 lines and the same sha (`dd8e3eb1…`). Other orgs on it: **Cappitech (3 confirmed DOs)**, Osiris, osiris-platform. Do not "tidy" it while working on Biofuel.

⚠️ **One honest caveat to that invariant.** The generic arm's own JSX is untouched, but both arms share ONE `<Paper data-print-paper>`, and the 2026-08-28 print fix changed that Paper's `@media print` geometry (§6d). So generic DOs now also print at 186×277mm with 20mm margins instead of full-bleed. That is a strict improvement (they were being clipped too) but it IS a change to Cappitech/Osiris print output — if byte-identical *print* output is required for them, the Paper needs to branch on `isBiofuel` as well.

Also: **the template branches on the SHORT code `DO`, not the stored `DELIVERY_ORDER`.** `public-document.service.ts` maps `DELIVERY_ORDER→DO` / `RETURN_DELIVERY_ORDER→RDO` before rendering. Pass the stored type by mistake and the layout silently falls through to the **generic priced layout** — no error, just the wrong document with prices on it.

### 6b. Proof photos are tied to their exact line — three objects all mean "a line on this DO"
This is the subtlest part of the system. Three different objects each represent one line, and they must be kept paired:

| Object | Identity | Notes |
|---|---|---|
| `config.items[]` line | `id` is a **throwaway `Date.now()`** | Not stable, not unique, never use it as a key |
| `DeliveryItem` row | real UUID | the run-side line |
| `MaintenanceServiceReport` (DO_START) | real UUID, `deliveryItemId` FK | holds `photos[]` |

**How the pairing is made (`b9aee590` onward):** `DeliveryItem` rows are now created with **pre-generated UUIDs**, and those UUIDs are **stamped onto the config lines at mint**. `documents.service.ts getById` then resolves the pairing **server-side** and hands the template `line.proofPhotos` — the template does no matching of its own. Resolution order in `getById` (never guess, never reorder):
1. `line.deliveryItemId === MSR.deliveryItemId` — exact, new mints
2. `line.inventoryItemId === MSR.inventoryId` — exact, unit lines
3. `line.serialNumbers` contains `MSR.subjectSku` — older unit lines, **only when unambiguous**
4. `line.description === MSR.description` (prefix-stripped) — fallback, **only when unambiguous**

⚠️ **Free-typed exactness only applies to runs scheduled AFTER this shipped.** Older documents have `deliveryItemId = null` on their MSRs and fall back to **description matching** — which cannot disambiguate two free-typed lines carrying the same text. Do not assume a historical DO has exact per-line proof.

### 6c. ⚠️ Do NOT "fix" the updateScheduled edit guard by claiming the run
`updateScheduled` **hard-deletes and recreates** `DeliveryItem` rows. Every recreated row gets a new UUID, which would **null every proof link** on the run. A guard therefore **blocks editing a run once proof exists**.

The tempting "fix" is to make `startFreeTypedItem` claim the run to `in_progress` so the guard trips earlier. **Do not.** **Five read sites depend on a partly-started run staying `scheduled`**, including the **rider pickup list**, the **assign step**, and **both merge paths**. Flipping the status there breaks all of them. If the guard needs to change, change the guard — not the run status.

### 6d. Print geometry — a Paper the exact size of the sheet has ZERO tolerance
Fixed 2026-08-28 (`86ae27b8`). The DO used to print as a rigid **210×297mm** block with its padding stripped — *exactly* the sheet. Measured slack was **0.0035mm across, 0.0011mm down**. Anything that shrank the printable area had nowhere to go, and the portal editor's own `@page margin: 20mm 15mm` shrank it to **180×257mm** — a **30mm horizontal, 40mm vertical** overflow.

- **Chrome CLIPS the overflow. Safari SHRINKS TO FIT.** That is the whole browser inconsistency. Chrome lost the right 30mm ("DELIVERY ORDER" cut mid-word, the Quantity column gone, right-aligned TIMELINE values trimmed) and paginated the footer away entirely; Safari silently rescued it and looked correct. **Never rely on either behaviour.**
- **Current geometry:** `@page { margin: 6mm }` reserves a printer ring → band **198×285mm**; the DO Paper is **186×277mm** inside it (6mm lateral / 8mm vertical slack); content column **170mm**, identical to the on-screen column; nearest ink **20mm** from every edge. Scoped via `data-print-sheet="do"` + a higher-specificity `[data-print-paper][data-print-sheet="do"]` rule in each print path, so other document types keep `[data-print-paper] { padding: 0 !important }` and the portal's `20mm 15mm` page margin.
- The page-1 wrapper's print `minHeight` is **261mm**, not 297mm. The old 297mm pinned the footer to the bottom of the **sheet** rather than the **printable area**: the flex spacer filled correctly but the frame was taller than any real page, so the footer (the last 25mm) paginated off and the RECEIVED BY box was cut. The spacer was never the bug — the reference frame was.
- Two print paths feed this and must stay in step: `app/guest/do/[token]/page.tsx` (`PRINT_PAGE_STYLE` + a `GlobalStyles` Cmd+P fallback) and `TabbedDocumentCreator.tsx` (DO/RDO get `6mm`, every other type keeps `20mm 15mm`).

### 6e. Guest DO view-link
`DocumentShareLink` → `/guest/do/<token>`, rendered by the same `CleanDocumentPreview` via a **whitelisted** payload (`public-document.service.ts`). Fit-to-width transform on screen, neutralised in print. Download-PDF button uses react-to-print.

---

## 7. THE DELIVERY FEATURE

Standalone run model decoupled from Delivery Orders. Backend `src/deliveries/`, `src/maintenance-reports/`; field UI `app/(field)/scan/`; office UI `app/portal/deliveries/`.

### Data model
- **`Delivery`** (a "run"): `deliveryNumber` (per-org), `status` (`scheduled`→`in_progress`→`delivered`→`completed`, or `cancelled`), `isDraft`, `direction` (`OUTBOUND`|`RETURN`), `riderUserId`, `scheduledFor`, nullable `projectId`/`customerId`/`siteAddress`. `documentId` is **FROZEN legacy**.
- **`DeliveryItem`**: `inventoryId`+`assetId` (plain UUIDs, no FK). **Free-typed items have BOTH null.** `deliveryStatus` (`not_delivered`→`delivering`→`not_installed`→`completed`), `installSkipped`, **`documentId`** = the per-item DO link. `@@unique([deliveryId, inventoryId])`. Rows now carry **pre-generated UUIDs** (§6b).

### Per-item DO linking
One run's items can fulfil **different DOs**. Run detail: tick items → "Link selected to existing DO" or "Create DO from selected". **Stock deduction + DO status stamping happen at DO CONFIRM.** Delivered units sit `reserved` until then. Linking does NOT create an invoice (by design). Per-item Rental/Sale toggle sets the unit's active `ProjectDeployment.type` only — never `Inventory.status`.

### Reservation semantics (`Inventory.status`)
`reserveUnit` (blocking guarded `instock→reserved`; the `updateMany` IS the availability check) · `reserveUnitNonBlocking` (DO-first arm) · `releaseUnit` (`reserved→instock` on cancel) · **ack-time flip** `reserved/instock → rental|sold` per the active deployment type, idempotent.

### Field-side flow — ONE signature, at the END of the run
`DO_START (guided condition photos) → assign to a SCHEDULED DELIVERY → "Installation needed?" → item MARKED DELIVERED`. No per-item signature. The **one** customer signature is captured by `finalizeRun`, which completes the run, commits the DO, fires the draft invoice, and **stamps the run's proof MSRs onto their born-linked DO**.

**Guided capture is 4 angles** — Front / Left / Back / Right, walk-around order (`d2f1324f`, 2026-08-26, dropped the old 5th "Top"). ACCESSORY = 1. Enforced client AND server via `minPhotosForAssetClass`, mirrored in `api-server src/common/asset-class.ts` and `portal helpers/assetClass.ts`. Angle labels ride in **`serviceData.photoAngles`, parallel to `photos`** (§13).

### Assign step is a SCHEDULED-DELIVERY PICKER
The rider picks one of the office's open scheduled runs by drop address (`GET /deliveries/scheduled-open?assetId=`). `assignItem({scheduledRunId})` `fieldDeploy`s with `deferStatusFlip:true` and merges the ad-hoc run into the chosen one, appending an extra line when there is no slot. EVERY open run is listed, never filtered by asset.

### Walk-through + skip
A scheduled run steps through every line in office order, qty-N expanded. **A skip is "not now, come back to it"** — it holds the run OPEN; the bulk "End all" NEVER touches skipped items.

### Free-typed lines run the FULL lifecycle
`assetId=null && inventoryId=null`, description only — same Start Delivery → guided photos → signature-at-end flow, and the same on returns. Absent only from asset/project service history.

### Returns / RDO
Scanning a rental unit OUT offers **Start Return**; guided capture goes one angle at a time, each shot beside its matching OUTBOUND angle **paired by stored angle key** (§13 — this is what `photoAngles` is for). `rental→instock` and off-hire only when it is the LAST unit on that deployment. Completing a return auto-creates a goods-only **RDO** (no prices, no GL). SOLD units blocked (raise a Credit Note).

### Guest run link
`DeliveryShareLink`, token `randomBytes(32).base64url`, typed state union (`ok|expired|revoked|completed|cancelled|notfound`), 200 body for GET, `assertActionable` 410 for POSTs. **In-memory per-`token::ip` rate limiter (60/min) — single Render instance only; move to Redis before scaling.** 2-day TTL around `scheduledFor`, auto-revoked on finalize.

### `enableUnifiedRuns` — still OFF
Gate on `OrganizationUIConfig.features.enableUnifiedRuns`. OFF (current, all orgs): a DO-first delivery creates NO `Delivery` row. ON: DO-first deliveries also get a run with **born-linked** items. Off-path is bit-identical to pre-U1.

---

## 8. ROUTE TRACKING — the map is right, the permission is missing

**Status: the map and the endpoint are CORRECT. Do not debug them again.** GPS pings are recorded against `kind=DO_START` MSRs (`DeliveryLocationPing`), surfaced by the TIMELINE "View route" link and `DeliveryRouteDialog`, and available token-scoped on the guest view.

**The actual bug: the field app stops recording when backgrounded, because `ACCESS_BACKGROUND_LOCATION` is never requested at runtime.** It is declared in `AndroidManifest.xml` (line 96) — and the manifest's own comment notes FINE/COARSE are runtime-prompted while background is not — but nothing ever prompts the user for it. Android therefore kills location updates the moment the app loses foreground.

- **`distanceFilter: 0` is correct and is NOT the cause.** Do not "fix" it.
- A **ping queue with retry** has shipped (`bddcc82f`), so pings survive transient network loss.
- Three things remain and **all require a native rebuild + sideload** (§3d — none of this ships via Vercel):
  1. request `ACCESS_BACKGROUND_LOCATION` at runtime (the two-step Android flow: foreground grant first, then background),
  2. prompt for **battery-optimisation exemption**,
  3. **surface foreground-service failures** instead of failing silently.
- ⚠️ The ping queue is **in memory only** — it does not survive an app kill.

---

## 9. KEY DATA FACTS (verified against PROD 2026-08-14 — NOT re-verified since)

- **Identifier-as-SKU.** The real-world serial is in **`Inventory.sku`**, NOT `serialNumber`. On Biofuel `serialNumber` is null on **261/281 units (92.9%)**. Field match logic keys off `sku`.
- **Deployments come from ASSIGN, not delivery.** Of 101 active unit-backed assignments on Biofuel, all 101 are rental/sold but only **4** ever appear on a `DeliveryItem` — **97 got their status purely from the assign-time flip.** The delivery-run flow is barely exercised in prod; any change moving the status flip onto delivery must reckon with the ~96% that never touch a run.
- **Run numbers are RECYCLED.** `deliveryNumber = max(existing)+1`; deleting the top run frees its number. **Reference a run by `id`, never by `#number`.**

---

## 10. NARROW PERMISSIONS (field-tech roles)

| Permission | Endpoint | Why narrow |
|---|---|---|
| `customers:create-by-name` | `POST /customers/create-by-name` | name only, code auto-generated |
| `assets:create-child` | `POST /assets/create-child` | child type under a parent, category inherited |
| `assets:create-basic` | `POST /assets/create-basic` | top-level product, forced to the org "New" bucket, dedupe-guarded |

`projects:create-by-name` exists on the same pattern. All seeded in `prisma/seed.ts` and granted to the 4 prod field-tech roles by host-guarded scripts.

---

## 11. CIEL INTERIOR — the new vertical (arrived 2026-08-29→31, 16 commits)

**What it is.** CIEL INTERIOR PTE. LTD. (UEN 202312049Z) is a Singapore **interior-design firm**, not GST-registered — a second vertical on AIMS with nothing rental-shaped. SOW: setup S$2,800 (50/50), optional extra month S$1,500, then S$100/mo (first 2 months S$50). Term started 31 Aug 2026. Source docs, all at repo root: **`CIEL_HANDBOOK.md`** (the orientation doc — read this first), **`CIEL_CUSTOMISATION_STATUS.md`** (item tracker), **`CIEL_WHATSAPP_AGENT.md`**.

**Business flow:** lead (EZiD email / Network Singapore PDF / manual) → qualify → convert → **ID quotation** (lettered trade sections A–J → rooms → lines with "* Includes" bullets, internal cost/margin guardrails, Letter-of-Intent print) → **e-sign** `/sign/<token>` → **project auto-created** → costing ledger / 10-40-45-5 payments / 35-step schedule / contract & P&L with 50% commission.

**State: built, essentially untested.** The tracker's legend distinguishes done-and-tested from built-untested, and **every one of its 37 status marks is 🟡 "built, not tested"** — there are no ✅ entries. Leads were verified end-to-end on **dev only**. Treat the whole vertical as unexercised.

### The eight new models

| Model | What it is for |
|---|---|
| `Lead` | EZiD/Network/manual lead. Status `unqualified→engaging→dead\|converted`; `deadProofUrl/Key` (mandatory screenshot proving the client never replied — replacement-claim evidence); `firstContactDeadline` (Network: 24h from distribution) and `replacementDeadline` (14 days); links out to `quotationId`/`projectId`. Org-scoped by plain `organizationId`, no FK. |
| `WorkSection` | The lettered trade sections (A Hacking … J Miscellaneous) backing the quotation editor and the Work Library. `letter`, `title`, `defaultNotes[]`, `sortOrder`. `@@unique([organizationId, title])`. **Seeded with 10 rows in dev, staging AND prod.** |
| `ProjectCost` | Subcontractor/supplier cost ledger row. `amount`, `supplierName`, `invoiceNo`, `sectionId` → `WorkSection`, S3 `attachmentUrl/Key`, `source` (`portal\|extract\|whatsapp\|bill`), `status` (`pending\|approved\|rejected`). Chat/WhatsApp-submitted costs land **pending**, never auto-approved (`903d2bc0`). |
| `ProjectMilestone` | The payment schedule. `kind` (`milestone\|vo\|refund`), `pct`, `amount`, `dueTrigger` (`confirmation\|rendering\|commencement\|carpentry\|handover`), `invoiceId`, `paidAmount/paidAt/paymentMethod`. Seeded 10/40/45/5 from the signed grand total. |
| `ProjectScheduleItem` | One row of the weekly Mon–Sun client calendar. `kind` (`work\|note\|holiday`), `startDate`/`endDate`, `sortOrder`. Populated from the 35-step standard sequence. |
| `DocumentSignLink` | Client e-signature link for a quotation (§ below). |
| `ProjectShareLink` | Public read-only project link; `kind` defaults to `"schedule"` (§ below). |
| `OrganizationMemberProfile` | Org-scoped extras on a Clerk user: `whatsappNumber`, `commissionPct`. `@@unique([organizationId, userId])`, indexed on `whatsappNumber` for inbound WhatsApp routing. Edited in User Management → Edit User. |

### ⚠️ `enableTopNav` gates nothing — the top nav shipped GLOBAL

The commit subject `7fd29765 feat(nav): top-nav layout behind enableTopNav` is **stale relative to the final state**. Verified at `4022ad11`:
- `TopNavBar` is rendered **unconditionally** in `app/portal/layout.tsx:99`.
- `PortalChrome` now returns only `<AppNavbar />` — **the left rail is retired.**
- `enableTopNav` appears **nowhere** in `default-features.ts` or `FEATURE_FLAG_DEFAULTS`, and no component reads it. It survives only in two one-off scripts, `_enable-topnav-dev.ts` (sets it) and `_remove-topnav-flag.ts` (deletes it) — the latter is the clean-up that made it global.

**Which shell renders by default:** desktop (`md+`) gets the Xero-style dark top bar, gated purely on breakpoint (`display: { xs: "none", md: "flex" }`); **mobile keeps the drawer** (`137c4016` made the mobile sidebar use the dynamic module-driven content). Visibility rules mirror `DynamicSidebarContent` (org modules ∩ role `allowedModules`, adminOnly submenus, `HIDDEN_MODULES`) — **keep the two in sync**.

The flag that *is* real is **`enableIdQuotation`**, default **OFF**, added to both `default-features.ts` and `FEATURE_FLAG_DEFAULTS` (`isIdQuotationEnabled`). It is the master switch for the whole ID experience: quotation editor, projects page, leads, work library.

### The 229-line schema change is applied EVERYWHERE (verified 2026-09-01)

All eight tables exist in **all three** Neon DBs:

| Env | Host | Tables | Seed state |
|---|---|---|---|
| dev | `ep-steep-truth-a18pvr39` | **8/8** | `WorkSection` 10 rows, `Lead` **2 rows** |
| staging | `ep-odd-truth-a1gtcsmc` | **8/8** | `WorkSection` 10 rows, `Lead` 0 |
| prod | `ep-icy-moon-a19rnv5x` | **8/8** | `WorkSection` 10 rows, `Lead` 0 |

Prod got them automatically from the Render build's `prisma db push` when `main` moved (§3b). **No manual prod DDL is outstanding.** Note the handbook's "Still to do #1" (push code, then run `db:push:prod` + the setup scripts) is partly stale: the schema and the work-library seed are already in prod. What is still outstanding there is the CIEL **org/user/email-config bootstrap** on prod (`setup-ciel-org.ts`, `seed-ciel-email-config.ts`, `setup-ciel-users.ts` — users exist on dev+staging only), company profile + PayNow QR, the real next quotation serial (currently 001), supplier price lists, and the EZiD/Network forwarding rules.

### ⚠️ Three share-link models now coexist, with DIFFERENT semantics

They look alike and are easy to confuse. `DocumentSignLink` and `ProjectShareLink` now sit **alongside** the pre-existing `DocumentShareLink`:

| | `DocumentShareLink` | `DocumentSignLink` | `ProjectShareLink` |
|---|---|---|---|
| Purpose | read-only DO view `/guest/do/<token>` | client e-signature on a quotation `/sign/<token>` | public project schedule `/schedule/<token>` |
| **Expiry** | **NONE** — no `expiresAt` column at all | **`expiresAt`, 14 days** (`VALIDITY_DAYS = 14`), enforced in `resolve()` | **NONE** — no `expiresAt` column |
| **Revocation** | `revokedAt` — the **only** way to disable it | `revokedAt`, plus **auto-revoke**: signing one link revokes every other unsigned link on that document | `revokedAt`; re-issue revokes the previous one |
| Single-use | no | **yes** — `signedAt` terminal, `state: 'signed'` refuses re-signing | no — always serves the **latest** schedule |
| States | `ok\|revoked\|notfound` | `active\|signed\|revoked\|expired\|notfound` | live or 404 |
| Reuse on mint | new link each time | **reuses** an existing unexpired, unrevoked, unsigned link | **reuses** the newest unrevoked `kind='schedule'` link |

**The consequence worth internalising:** a DO view link and a project schedule link **never expire**. Once issued they work forever unless somebody explicitly revokes them. Only the signature link ages out.

---

## 12. Neon DB Script Pattern

Host-guarded prod template (DRY default; `APPLY=1` to write). Run from `api-server-production/`:
```js
const { PrismaClient } = require('@prisma/client');
const { PrismaNeon } = require('@prisma/adapter-neon');
const { neonConfig } = require('@neondatabase/serverless');
const ws = require('ws'); neonConfig.webSocketConstructor = ws;
const PROD_URL = 'postgresql://…@ep-icy-moon-a19rnv5x-pooler.ap-southeast-1.aws.neon.tech/AIMS_DB';
const APPLY = process.env.APPLY === '1';
const u = new URL(PROD_URL);
if (!u.hostname.startsWith('ep-icy-moon-a19rnv5x')) { console.error('ABORT: not prod host'); process.exit(1); }
console.log('HOST:', u.hostname, APPLY ? '(APPLYING)' : '(DRY RUN)');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: PROD_URL }) });
// … findMany/count to print a plan; guard by exact ID; wrap writes in $transaction; print before/after …
```
Plain `pg` `Client` works too and is lighter for read-only checks. The ambient-`.env` variant hits **DEV** (§3a).

---

## 13. PARKED TASK — replacing the proof photos on DO202608-016

Investigated read-only 2026-08-28, **not executed**. Everything below is verified against PROD.

- **Target:** DO `4e120e5a-0dc6-4a41-a0be-26ce56dc3df9` (`DO202608-016`, Biofuel, TANGLIN CORPORATION PTE. LTD., project 18 Holland Drive, unit **MG20260172** `d1b99c8d…`).
- **The MSR holding the photos:** `42f43ab2-f6cc-4441-9480-9e6c31165149` — `kind=DO_START`, `deliveryItemId=null`, run `b2049e91…`. It is the **only** row with photos on this DO (the `DO_ACK` `5bf45c01…` has none, only the signature).
- ⚠️ **There are FIVE photos, not four.** They are from the old 5-angle flow: `photoAngles = ["front","left","back","right","top"]`. `d2f1324f` (2026-08-26) dropped "Top" from guided capture, and the DO's inline strip **caps at four** (`proofPhotos.slice(0, 4)`), so the 5th is stored and served but never appears on the DO. **The Field Reports tab on the project page renders `report.photos` uncapped**, so the 5th IS visible there. Any replacement must decide deliberately what happens to it.
- ⚠️ **The `photos` column stores bare S3 keys, not URLs** (`do-start/9197cfb4.jpg` etc.). The base URL is client-side only (`NEXT_PUBLIC_RESOURCE_URL` → `https://aims-osiris.s3.ap-southeast-1.amazonaws.com/`). Writing full URLs would not visibly break the DO but **would break `getSignedUrl(key)`** in the return-comparison path.
- ⚠️ **`serviceData.photoAngles` is parallel to `photos` and must match element for element.** Nothing enforces it. **The DO never reads it, so a mismatch is completely invisible there** — but the return flow (`getOutboundConditionPhotos` → `GuidedPhotoCapture.outboundFor`) looks the angle up **by name** and then indexes `photos` by the position it found. A stale or misordered array shows the returning rider a **confidently mislabelled** before/after comparison with no visual cue. Only these four labels are recognised now: `front`, `left`, `back`, `right`.
- If the new photos arrive in a different physical order, **do not reorder the files** — just make `photoAngles` describe the array you actually stored. But note the DO strip prints in **array order**, not angle order.
- **Nothing else references these keys.** A scan of every text/varchar/json/jsonb/array column in the prod schema found exactly one hit: `MaintenanceServiceReport.photos`, one row. Replacing the array orphans the objects and breaks no other row — but three live views read that same row: the return comparison, the project Field Reports tab, and the MSR/run detail screens.
- ⚠️ **The bucket is public-read and verified anonymous-readable** (anonymous `GET` returns 200 + JPEG bytes on all five). **Swapping the array does not retract the old photos** — anyone holding an old URL keeps byte-for-byte access forever. **Only `DeleteObject` retracts them.** There is also a live, unrevoked `DocumentShareLink` on this DO (token `fTJnNOSXKink6ukGv9-…`, created 2026-08-27), and DO view links never expire (§11).
- Upload path if this is executed: `POST /uploads/image` (multipart `file` + `key`, Clerk-auth, permission `uploads:upload-image`); keys follow `do-start/<8 hex>.jpg`. **Use fresh keys, archive the originals first, verify the new objects return 200 + `image/jpeg` before touching the DB, and set `updatedAt` explicitly** (Prisma manages it in the app layer, so raw SQL will not).

---

## 14. OPEN ITEMS

**Wrong output / correctness**
- ⚠️ **The negotiated rate gap — the only item currently producing WRONG INVOICES.** Highest priority.
- **Invoices, quotations and POs are all 210mm Papers on the portal's 180mm print band**, so **Chrome has been silently clipping their right 30mm** for as long as that page style has existed. The DO is fixed (§6d); these are not. Same fix pattern applies.

**Security / robustness**
- **Guest delivery photo upload validates neither file type nor size.** (The Customer-Information PO upload does — magic-byte sniffed, ≤10 MB — so there is a pattern to copy.)
- **Proof photos are public regardless of link revocation** — the bucket is public-read, so revoking a share link does not retract any photo already served (§13).
- **The ping queue is in memory only** — lost on app kill (§8).
- The guest-link rate limiter is in-memory, single-instance — move to Redis before scaling (§7).

**Tickets**
- **OSI-87**, **OSI-88**, **OSI-90**.

**Field**
- **"Print DO" has no printer** — decision needed (§5).
- Background-location grant, battery exemption, foreground-service error surfacing — all need a native rebuild (§8).

**CIEL**
- The entire vertical is 🟡 built-untested; prod org/user/email bootstrap outstanding (§11).

**Carried**
- `enableUnifiedRuns` DO-first soak on Biofuel (flag still OFF).
- Office resolution of free-typed delivery items (Phase 2) — still UNBUILT; the run detail shows a "Needs resolution" chip but no action.
- `/submit` async intake queue — shipped, untested end-to-end; blocked on creating a `normal_user` in Clerk + Biofuel role provisioning.
- Field create-top-level-product and the office per-item Rental/Sale toggle — shipped, never exercised on prod.
- OSI-8 quotation send-email is not type-aware; invoice cleanup (~2451 Xero-mirror invoices + orphaned auto-invoices); dead deps removable (`pdf-parse`, `pdf-to-png-converter`; keep `openai` for embeddings).

---

## 15. Known Gotchas & Hard-Won Lessons

### The short list
- **`tsc --noEmit` is the type gate. `nest build` uses SWC and does not type-check.** (§3c)
- **Migrations go BEFORE the merge, never after.** A schema change that lands on `main` first hits the prod DB on the next deploy, unreviewed.
- **Never derive identity from position.** A `lineIdx*100` scheme **collided at qty 100**. Use real UUIDs (§6b).
- **Public payloads must be dumped and read, not trusted.** The first DO view-link payload shipped **staff emails, prices, totals, customer emails, internal remarks and raw asset ids** behind an **unauthenticated, never-expiring** URL. Print the actual JSON and read every key before shipping any public endpoint.
- **The template branches on the short code `DO`, not the stored `DELIVERY_ORDER`.** A mismatch silently falls through to the generic **priced** layout (§6a).
- **A document Paper the exact size of the sheet has zero print tolerance. Chrome clips the overflow, Safari shrinks to fit. Never rely on either.** (§6d)
- **`min-width: auto` on a flex item defeats `margin: 0 auto`.** A flex child's automatic minimum size stops it shrinking, so the centring never engages — set `minWidth: 0`.
- **`.env` = DEV, not prod** (§3a). **The Render build mutates the DB** (§3b). **Capacitor loads JS live** (§3d).

### Longer-form
- **Count-based allocators break PERMANENTLY on a deletion gap.** An id allocated as `count()+1` reissues an existing id forever once any row below the top is deleted. Allocate from `max()+1` or a sequence; reference recyclable numbers by `id`.
- **`ALTER TYPE ADD VALUE` blocks deploys.** Never add a Postgres enum value via `prisma db push` on the deploy path — it has stalled the backend for hours. Model new states as `String`/`Boolean` (`Delivery.isDraft` is a bool for exactly this reason).
- **A field sent alongside a multipart upload can silently VANISH — verify server receipt, not just a 200.** The cause is a payload allowlist on the SENDING side, not `helpers/request.ts`. Append every field to the `FormData` explicitly and confirm the server received it.
- **Shallow config merges LOSE nested objects.** `{...oldConfig, ...fragment}` only overwrites keys the fragment re-emits; a nested object written once at mint (`config.customer`) survives stale forever. When you refresh a flat key, refresh its nested twin.
- **Preview and server PDF read DIFFERENT fields.** The DO preview reads `config.documentInfo.contactName`; `generateInvoiceHtml` reads `config.customer.attention`; the list reads `config.customerId`. Write EVERY key the list, preview AND PDF read — and remember stored proof resolves by `MSR.documentId`, which born-linked runs must have stamped.
- Document **name collisions exist** (an INVOICE named "DO202607-002") — select by TYPE + exact id.
- A DO revision ("Rev-1") can shadow the original (`getScanContext` resolves the newest DO).
- Field bind: SKU uniqueness is org-wide but the match path is per-asset → "already exists, retry to match" dead-loop if a unit is filed under a different asset. Fix = move the unit's `assetId`, don't delete.
- Attachments pasted into web chat sometimes arrive BLANK — paste terminal output as plain text.
- Clean-tree + `git branch --show-current` check before any build.
