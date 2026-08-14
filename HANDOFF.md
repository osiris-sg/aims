# AIMS — Project Handoff / Context Doc
_Last updated: 2026-08-14. Maintainer: Elroy. This doc orients a fresh Claude/Claude Code session. Everything below was re-verified against the code + PROD DB on 2026-08-14, not carried over on trust._

---

## 1. Repo + Deploy Topology
- Monorepo at `~/Desktop/aims`. Four deployables: `api-server-production/` (NestJS+Prisma+Neon+Clerk), `portal-production/` (Next.js 14 portal + Capacitor Android field app), `email-ingest-worker/` (Cloudflare), `whatsapp-group-bridge/` (Node).
- **Branch topology:** `main` = production. `elroy/dev` = Elroy's staging/work branch (Vercel previews at `aims-mocha.vercel.app`). Teammate **YX** pushes to `main` directly — expect races.
- **Backend → RENDER** from `main`. Build = `nest build && npx prisma db push` (see §3 — this MUTATES the DB on every deploy). `prebuild: npx prisma generate`. `start:prod: node dist/src/main`.
- **Portal → VERCEL** from `main` (prod domain `www.ai-ms.io`). Vercel requires commit author email `2300950@sit.singaporetech.edu.sg`.
- Frontend→backend URL env: `NEXT_PUBLIC_BACKEND_API_URL` (NOT `NEXT_PUBLIC_API_URL`).
- Separate repo `~/Desktop/water-sg` (T3/Next.js, `apps/water-sg/`), branch `main`, Vercel, prod `app.biofuelindustries.sg`.

---

## 2. Working Rules (follow these)
- **Investigate read-only first → report → build → audit diffs → STOP before commit → explicit approval → commit.**
- **Stage explicit file paths only. NEVER `git add -A`.** Persistent noise stays unstaged: `.DS_Store`, `.claude/settings.local.json`, both `package-lock.json`, `android/gradlew`, `public/company-stamp.jpg`, `public/eugene-signature.png`.
- **Sync discipline:** `git fetch origin && git rev-list --left-right --count origin/main...main` (or `...elroy/dev`) before push (want `0 0`). If a push to `main` rejects (YX raced), rebase the single commit and re-push — file overlap is usually zero.
- **DB scripts:** Neon WebSocket adapter (§10). Always DRY RUN printing a plan, then `APPLY=1`. **Target rows by exact ID, not name** (name collisions exist). **Host-guard prod scripts** with `if (!u.hostname.startsWith('ep-icy-moon-a19rnv5x')) abort` and print the host.
- **Commit trailer used this session:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (prior sessions used Fable 5 — match whatever model is actually running).
- **Prod testing:** user tests on deployed prod (Render+Vercel). Deploy BEFORE testing.

---

## 3. ⚠️ Build & Deploy Gotchas (each of these bit us — read before shipping)

### 3a. The local `.env` points at DEV, not prod
`api-server-production/.env` `DATABASE_URL` = **`ep-steep-truth-a18pvr39-pooler`** (DEV). The prod and legacy URLs sit **commented out** right above it. This caused wrong-DB answers in an earlier session (querying "prod" that was actually dev). **The three Neon hosts:**

| Host | Role | How reached |
|---|---|---|
| `ep-steep-truth-a18pvr39` | **DEV** (YX's working DB) | active `DATABASE_URL` in `.env` — what plain scripts/`db:push` hit |
| `ep-icy-moon-a19rnv5x` | **PROD** (Render prod, `www.ai-ms.io`) | commented in `.env`; hard-coded + host-guarded in prod scripts |
| `ep-gentle-bonus-a1hjwef9` | **STAGING / legacy** pre-migration DB (~292k old docs, no Biofuel inventory) | staging Render service; `DATABASE_STAGING_URL` |

**Any script that "checks prod" must use the ep-icy-moon URL explicitly** — the ambient `.env` will silently answer from dev.

### 3b. Render prod build runs `prisma db push` — schema drift blocks ALL deploys
The deploy build is `nest build && npx prisma db push` — **it pushes `schema.prisma` to whatever `DATABASE_URL` Render points at, on every deploy.** History (`git log -p -- package.json`): the flag `--accept-data-loss` was **added** (for an OAT unique-constraint change that dropped/rebuilt a column), later **dropped**, temporarily **re-added**, and **dropped again**. Current build has **no `--accept-data-loss`** — which means a schema change requiring data loss makes `db push` refuse, the build fails, and **the entire backend stops deploying** (this happened, for hours). Migrations are abandoned (`db:push` workflow, not `prisma migrate`).
- Additive nullable columns are safe. Destructive/renaming changes need care: apply the DDL to prod manually first (host-guarded), or temporarily restore `--accept-data-loss` for that one deploy, then revert.
- **A red backend deploy is often a schema-drift `db push` failure, not a code error.** Check the Render build log for the prisma step.

### 3c. ⚠️ `nest build` is NOT a type gate — `tsc --noEmit` is
This session a DTO used `@IsOptional()` **without importing it** (TS2304). `nest build` (via `@nestjs/cli` 10, default tsc builder — no `.swcrc`/swc builder configured, despite the "SWC" shorthand in older notes) **did not fail the build**, and it would have **crashed the assets module at runtime on deploy**. `tsc --noEmit` catches it.
- **Rule: run `cd api-server-production && npx tsc --noEmit` before pushing any backend change.** A green `nest build` (or a green Render deploy of the *compile* step) is NOT proof the code type-checks.
- Pre-existing noise: `src/recurring-invoices/recurring-invoices.service.ts` has ~4 `nextRunNo` errors (client/schema drift) and `scripts/*` has many — filter to the files you touched.

### 3d. The Capacitor field app loads JS from the server — only NATIVE changes need an APK
`capacitor.config.ts` sets `server.url` (prod = `https://www.ai-ms.io`, via `CAP_SERVER_URL`). The native shell does **not** bundle the Next.js build — it loads the deployed portal live. **So:**
- **JS/UI/flow changes ship via Vercel** (`main` deploy) — the installed app picks them up on next load. No APK rebuild.
- **Only native changes** (new Capacitor plugin, `AndroidManifest`, Java/Kotlin, camera/NFC/printer native code, `server.url` target) need `npx cap sync` + a Gradle APK build + sideload (`adb install -r`).
- Prod `server.url` must be the **`www.` host, not the apex** — `ai-ms.io` 301s to `www`, and the redirect reloads the origin before Capacitor injects `window.Capacitor`, killing NFC/geo/printer bridges.

---

## 4. Org / Entity IDs
- **Biofuel** org: `52e90ba8-bfbd-48b0-bb76-4f9667bf74f1` (the live customer; all field/delivery work targets this).
- **Cappitech** org: `59802f75-262b-4f96-b8b2-09a9a071d882`.
- Field-tech roles (`name = 'field-tech'`) exist in 4 orgs: Osiris Technology `bfad387e…`, **Biofuel `4c2a3fb3…`**, osiris-platform `df3efff2…`, Test Org `877997f7…`.
- **ZZTEST re-bind test rig (current, 2026-08-14):** asset "ZZTEST Asset" (`ZZTEST-AST`, `976f1f1c…`) with units ZZTEST-AST-001..006 (instock, tags bound) + **ZZTEST-SN-007** (`df39b6a5…`, instock, tag `99:3a:4d:01:00:00:02`, on TEST Project deployment `442cd967…` but assignment closed). Child ASSET types kept for testing: **ZZTestChild** (`569f4808…`) + **TEST123** (`1f045f08…`), both `autoCreateOnParentUnit`. Child units: **TEST1** (`f9b8d1f4…`, tag `99:37:37…`, child of 007) + **TEST123-PENDING-ZZTEST-SN-007** (`568a328d…`, pending placeholder). Reset script: `scripts/_zztest-0607-reset.js` (DRY default, APPLY=1, host-guarded; resets units, keeps assets + tags per last run).

---

## 5. THE DELIVERY FEATURE (as it stands 2026-08-14)
The delivery system is now a **standalone run model** decoupled from Delivery Orders. Backend in `src/deliveries/`, `src/maintenance-reports/` (field scan-context + MSR proof), field UI in `app/(field)/scan/`, office UI in `app/portal/deliveries/`.

### Data model
- **`Delivery`** (a "run"): `deliveryNumber` (per-org), `status` (`DeliveryRunStatus`: `in_progress`→`delivered`→`completed`, or `cancelled`), `riderUserId`, nullable `projectId`/`customerId`/`siteAddress`. `documentId` is **FROZEN legacy** (never read/written — per-item linking replaced it).
- **`DeliveryItem`**: `inventoryId`+`assetId` (plain UUIDs, no FK). **Free-typed items have BOTH null** — description-only lines awaiting office resolution. `deliveryStatus` (`not_delivered`→`delivering`→`not_installed`→`completed`), `installSkipped`, and **`documentId`** = THE per-item link (the DO this item fulfils). No `deductedAt` here — deduction stays on the DO's `DocumentItem`. `@@unique([deliveryId, inventoryId])`.

### Per-item DO linking (the core of the office flow)
- One run's items can fulfil **different DOs**. Office run detail (`/portal/deliveries/[id]`): tick items → "Link selected to existing DO" (picker defaults to the run's project's DOs) or "Create DO from selected" (makes a DRAFT DO, opens the editor to price + Confirm). Repeat for the rest.
- **Stock deduction + DO status stamping happen at DO CONFIRM** (linking to an already-confirmed DO applies immediately). Delivered units sit `reserved` until then. Linking does NOT create an invoice (manual, by design).
- **Per-item Rental/Sale toggle** on the run detail (shipped this session): sets that unit's active `ProjectDeployment.type` **only** — never flips `Inventory.status`. SALE disabled until the unit is assigned to a project (no deployment to write). RENTAL default. The reserved→rental/sold flip still happens at DO confirm/ack, which reads this type — one flip path, no duplication.

### Reservation semantics (`Inventory.status`: instock/reserved/rental/sold/maintenance/pending)
- `reserveUnit` — **blocking** guarded claim `instock→reserved` (the `updateMany` IS the availability check + anti-double-scan guard; a rental/sold/reserved unit doesn't match → rejected).
- `reserveUnitNonBlocking` — DO-first arm: claim if `instock`, else log + carry on (never blocks the rider).
- `releaseUnit` — `reserved→instock` on run cancel.
- **Ack-time hand-off flip** (`advanceDeliveryItem`, action `ack`): `reserved/instock → rental|sold` per the unit's active `ProjectDeployment.type` (default rental). Idempotent (only from instock/reserved), so a prior DO deduction is a no-op.

### Field-side flow (per unit; signature LAST)
`mandatory condition photo at DO_START → acknowledge (GPS + photos, saved UNSIGNED) → assign-to-project/customer in-flow (creates the deployment; skippable; customer & project pickers have inline "+ Create") → "Installation needed?" prompt (install photos if yes) → ONE customer signature covering delivery + installation → "Confirm and Print DO"`. Leaving mid-flow is resumable (the item's basket button becomes Continue at the right step).

### Assign-at-start-delivery + `deferStatusFlip`
In-flow assign (`/deliveries/:id/assign` → `projects.fieldDeploy` with `deferStatusFlip:true`) creates the Assignment + ProjectDeployment **without** flipping `Inventory.status` — the unit is still `reserved` on the truck; the flip waits for ack. The office/walk-around/bind callers omit `deferStatusFlip` and flip immediately.

### Itemized receipt + reprint
Thermal ESC/POS receipt is itemized (`SERIAL (Asset)` label format, ASCII-only). Reprint from `app/(field)/scan/deliveries/finished/[deliveryId]/page.tsx`. Print stack: `app/(field)/lib/btPrinter.ts` + native `BtPrinterPlugin.java` (see §6).

### `enableUnifiedRuns` — **still OFF** (default) — "U1+items"
Org gate on `OrganizationUIConfig.features.enableUnifiedRuns` (`maintenance-reports.service.ts unifiedRunsEnabled`). **When OFF (current for all orgs): a DO-first delivery creates NO `Delivery` row** — the DO flow runs off `MaintenanceServiceReport.documentId` alone. **When ON**: DO-first deliveries ALSO get a `Delivery` run whose items are **born-linked** (`DeliveryItem.documentId` set from birth), appear in `/portal/deliveries`, and never enter the "Unlinked only" queue. Flag-off behavior is bit-identical to pre-U1.

---

## 6. THE SUNMI V3 MIGRATION (printing/camera escape route)
The field handheld pivoted from an external **XP-58IIH Bluetooth** thermal printer to a **Sunmi V3** all-in-one. Verified working approach — the escape route if the app misbehaves on the device:
- **Printing = ZERO new code.** The Sunmi's built-in printer exposes itself as a **virtual "InnerPrinter" Bluetooth (Classic SPP) device**. Pair it, point the existing ESC/POS stack at it — the same chain that drove the XP-58 prints on the Sunmi unchanged.
- **NFC** confirmed present on the V3.
- **Camera** requires `@capacitor/camera` **`Camera.takePhoto()`** (the Ion in-app CameraX-backed camera). **Do NOT use `Camera.getPhoto()`** — it delegates to `ACTION_IMAGE_CAPTURE`, and the Sunmi has no camera app to satisfy that intent, so it fails. `app/(field)/lib/nativeCamera.ts` already uses `takePhoto()` (with the runtime CAMERA grant); the file's header documents exactly this.
- The app is set as the device **HOME launcher** on the V3 (kiosk-style).
- **Branch `bluetooth-printer-flow` (commit `43e7aa2`)** preserves the full XP-58IIH Bluetooth (Classic SPP / ESC/POS) chain — files, APK requirement, RFCOMM tuning — for a clean restore if the Sunmi path is abandoned. `BLUETOOTH_PRINTER_FLOW.md` lives on that branch.

---

## 7. NEW NARROW PERMISSIONS (granted to field-tech roles)
Field roles get **narrow, purpose-built** permissions instead of the office-wide equivalents, so a rider can self-serve in the field without holding the full create/edit surface. All three are seeded (`prisma/seed.ts`) AND granted to the 4 prod field-tech roles by host-guarded scripts:

| Narrow permission | Endpoint | vs office equivalent | Why narrow |
|---|---|---|---|
| `customers:create-by-name` | `POST /customers/create-by-name` | `customers:create` | Field creates a customer with **name only** (code auto-generated); no contact/GST/pricing surface. |
| `assets:create-child` | `POST /assets/create-child` | `assets:create` | Creates a **child asset type** (name+skuKey) under a parent, category inherited; not the full catalog editor. |
| `assets:create-basic` | `POST /assets/create-basic` | `assets:create` | Creates a **top-level product** (name+skuKey) when a scanned nameplate matches nothing; category forced to the org **"New"** bucket, no pricing/GL. Dedupe-guarded (see §8). |

`projects:create-by-name` (`POST /projects/create-by-name`) exists on the same pattern for the in-flow project picker.

---

## 8. KEY DATA FACTS (verified against PROD 2026-08-14 — internalize these)
- **Identifier-as-SKU.** The unit's real-world serial is stored in **`Inventory.sku`**, NOT `serialNumber`. On Biofuel, `serialNumber` is **null on 261 / 281 units (92.9%)**. Field-resolve/match logic keys off `sku`. Don't assume `serialNumber` is populated.
- **Deployments come from ASSIGN, not delivery.** Of **101** active unit-backed assignments (endDate=null) on Biofuel, **all 101 are rental/sold**, but only **4 ever appear on a `DeliveryItem`** — **97 got their commercial status purely from the assign-time flip**, never from a delivery run or DO deduction. (This drifts a little as test units are reset — it was 98/101 earlier this session.) Implication: the delivery-run flow is barely exercised in prod; "assign = deploy" is the dominant path. Any change moving the status flip off assign onto delivery must reckon with the ~96% that never touch a run.
- **Run numbers are RECYCLED — not stable identifiers.** `deliveryNumber = (max existing) + 1`. Deleting the top run frees its number for reuse; `@@unique([organizationId, deliveryNumber])` only enforces point-in-time uniqueness. Biofuel runs today: `[2, 3, 6, 7, 8, 9, 10]` with gaps `[1, 4, 5]` from deleted test runs. **Reference a run by `id`, never by `#number`.**

---

## 9. OPEN ITEMS / THREADS
- **`enableUnifiedRuns` soak.** Built, flag default OFF. Needs a deliberate ON soak on Biofuel (DO-first delivery → confirm a `Delivery` run is born-linked, items carry the DO, deduction/completion behave) before flipping on. Off-path is proven bit-identical.
- **Untested surface (shipped this session, not yet exercised on prod):**
  - Field **create top-level product** from the bind page (`/assets/create-basic` + "did you mean" dedupe gate + "New" category). Grant is live; walk a real unknown-nameplate scan through it.
  - Office **per-item Rental/Sale toggle** on `/portal/deliveries/[id]`.
  - Scan-chooser "can't start delivery" reasoned messaging.
- **`/submit` async intake queue (normal_user) — shipped, untested end-to-end.** `app/(submit)/submit/page.tsx`: pick type → add photos/files → upload to the **async intake (202)**; a **server-side worker** extracts → DRAFT (BILL routed to the bills pipeline server-side). Job status via `GET /submit/jobs/mine`. Still blocked on the same thing as the old HANDOFF §5: create a **normal_user in Clerk** + run the Biofuel role-provisioning, then walk login → /submit → photo → "Submitted!" → admin sees the draft.
- **Office resolution of free-typed delivery items (Phase 2) — UNBUILT.** A `DeliveryItem` with `assetId=null && inventoryId=null` (description only) has no office UI to resolve it to a real asset/unit yet. The run detail shows a "Needs resolution" chip but no action.
- Carried from before: OSI-8 quotation send-email is not type-aware; invoice cleanup (~2451 Xero-mirror invoices + orphaned auto-invoices); dead deps removable (`pdf-parse`, `pdf-to-png-converter`; keep `openai` for embeddings).

---

## 10. Neon DB Script Pattern (all DB work uses this)
Host-guarded prod template (DRY default; `APPLY=1` to write). Run from `api-server-production/` with `NODE_PATH=.../api-server-production/node_modules node scripts/_x.js`:
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
// … findMany/count to print a plan; guard by exact ID; wrap writes in prisma.$transaction; print before/after …
```
The ambient-`.env` variant (`npx dotenv -e .env -- node -e "…process.env.DATABASE_URL…"`) hits **DEV** (§3a) — only use it when you mean dev.

---

## 11. Known Gotchas
- **`nest build` ≠ type gate** — run `tsc --noEmit` (§3c).
- **`.env` = DEV, not prod** (§3a). **Render build mutates the DB** (§3b).
- **Capacitor loads JS live** — JS via Vercel, native via APK (§3d).
- Document **name collisions exist** (an INVOICE named "DO202607-002") — select by TYPE + exact id.
- A DO revision ("Rev-1") can shadow the original (`getScanContext` resolves newest DO) — if scans show the wrong doc, check for revisions.
- Field bind: SKU uniqueness is org-wide but the match path is per-asset → "already exists, retry to match" dead-loop if a unit is filed under a different asset. Fix = move the unit's `assetId` (keeps assignments), don't delete.
- Run numbers recycle — reference runs by id (§8).
- Attachments pasted into web chat sometimes arrive BLANK — paste terminal output as plain text.
- Clean-tree + `git branch --show-current` check (elroy/dev for work, main for prod-bound pushes) before any build.
