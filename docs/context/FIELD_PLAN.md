# AIMS Field module: native port plan

Rewritten 2026-11-21 (supersedes the adapter / API-contract version of the same day; `SITECLOCK_API_CONTRACT.md` is kept for reference only).

- **Goal:** SiteClock's office side runs natively in AIMS (AIMS repo, AIMS database) as the Field module. End state: one repo, one deployment.
- **SiteClock stays live and untouched** until the AIMS phone app exists, so workers keep clocking in. AIMS never writes to SiteClock, and no changes are made to the SiteClock repo.
- **Sources (read-only):**
  - `~/Desktop/siteclock` at main `62b7d9d`. Same as origin per `git ls-remote` on 21 Nov; nothing pulled, no branches.
  - `SITECLOCK_SPEC.md` (84 features).
  - AIMS main `1511f262`.

---

## 1. Ground rules

- **Port, don't redesign.**
  - Copy SiteClock's logic and its test cases into AIMS where the stack allows: both sides are TypeScript, luxon and Prisma, so most pure functions copy over almost unchanged.
  - Rewrite only where the stack differs: Express routers become Nest controllers, and SiteClock's `prisma` singleton becomes an injected `PrismaService`.
  - Each ported file names its source: `// ported from siteclock backend/src/... @62b7d9d`.
- **Same behaviour, oddities included.**
  - Every known SiteClock oddity is reproduced (§6) and shown as a **warning in the UI** (an info Alert or a chip), never fixed.
  - Exception: security leaks (§6.2). AIMS permissions apply instead. This is a deviation, listed so it can be reviewed.
- **Keep the selfie, face-match and device-binding rules** as SiteClock has them, both the settings and the data. Nothing enforces them until the clock-in endpoints arrive with the AIMS phone app.
- **Office side only.** Not now:
  - the worker phone app
  - clock-in / punch-creation endpoints
  - WhatsApp OTP
  - sending push or reminders
  - the AI assistant

  Their data models exist only where later phases need them (punches, device and face data, FCM token placeholder, reminder settings).

## 2. Safety

- **Flags.** Org flag `enableFieldModule` (default false). Area flags under it, all default false:
  - `enableFieldPeople` (workers, teams, sites)
  - `enableFieldJobs`
  - `enableFieldPunches`
  - `enableFieldTimesheets`
  - `enableFieldLeave`
  - `enableFieldPayroll`
  - `enableFieldReports` (reports, rules, overview, audit)

  An area is on only when `enableFieldModule` AND its own flag are true.
- **Flag off means:**
  - no nav entry
  - every `/field/*` API route returns 404 (a guard reads the flags)
  - portal `/portal/field/*` pages render a 404
  - no cron or queue work registers anything for that org
  - no change to any other screen
- **Crons need a second switch.** Ported crons (auto-close, and later reminders) also need `features.fieldEngineLive` (default false), because shadow-imported OPEN entries must never be auto-closed by AIMS while SiteClock is still the live engine.
- **Prod:** nothing is enabled for any org, WCT included. Prod data is read-only, then a DRY-RUN, then Elroy's APPLY.
- **Schema:** `Field*` tables and nullable columns only. The AIMS workflow is `db push` behind the push guard, not migration files, so "additive" = the guard passes with no `allow-destructive` entry. New tables go to dev with a raw-SQL script (memory `dev-db-push-per-org`). Prod gets them from Render's build.
- **No writes or pushes to SiteClock.** The shadow import only reads.

## 3. Where it goes (AIMS repo)

### 3.1 API: `api-server-production/src/field/`

| Area folder | Contents | Phase |
|---|---|---|
| `common/` | flag guard (`FieldAreaGuard`), scope service (supervisor sites + teams), time helpers (ported `lib/time.ts`), audit helper (Activity Log details), import base | 1 |
| `people/` | workers (on the existing `Worker`), teams (existing `WorkerTeam` + stints), sites, site assignments, trades, invites + join requests, photos on record, linked orgs | 1 |
| `jobs/` | Field job settings on calendar jobs, crews, needs, manning presets, day notes, working-hours templates + assignments + exceptions, copy day / week, publish, QR, import | 2 |
| `punches/` | punch list, flags review (approve / reject), marked, face log, auto-close + missed clock-out (ported, cron gated), off-site policy settings | 3 |
| `timesheets/` | computeEntry, crewSpan, workedFor (ported), entries list / detail / edit / manual / approve / bulk / reopen / delete, missed-entry requests, exports, shared hours | 4 |
| `leave/` | types, entitlements, balances (ported `lib/leave.ts`), requests + documents (S3), decide, record, calendar | 5 |
| `payroll/` | pay profiles, public holidays, monthly run (ported `payroll.service.ts`), export, payslip | 6 |
| `reports/` | attendance XLSX, attendance summary, fraud summary, overview, rules page, audit viewer | 7 |
| `import/` | SiteClock shadow import (scripts + services), parity runner | 1-7 |

Every write lands in the Activity Log through the interceptor. Workflow verbs (approve, reject, reopen, publish, notify, import) go into `VERB_ACTIONS`, and list POSTs into `VIEW_POST_RE`. The ported SiteClock audit actions go into the Activity Log `details.action` (e.g. `ENTRY_APPROVED`).

### 3.2 Portal: one nav group "Field"

`app/portal/field/<area>/` with React Query:
- Overview
- Workers
- Teams
- Sites
- Working hours
- Flagged
- Timesheets
- Leave
- Payroll
- Reports
- Settings (rules, roles map, terms, invites)

Rules for every page:
- The Jobs calendar stays under Jobs; Field job settings live in its dialogs.
- Settings > Workers & Teams moves to Field > Workers / Teams **only when the flag is on**. Otherwise it stays where it is.
- UI copy: no em-dashes, no subtitles under page headings, no helper text.
- Tables follow the Deliveries pattern: row click, kebab menu, click-anchored menus.
- Reports follow the Print / Export standard.

### 3.3 Data: reuse first

| SiteClock | AIMS (reuse / new) | Note |
|---|---|---|
| User (worker) | **reuse `Worker`** (round 39: `siteclockId`, `userId` login link, `active`) + new `FieldWorkerProfile` 1:1 | Profile: employeeNo, tier, companyRole map, per-worker overrides, attendanceExempt, payslipVisible, sharedWithLinked, device {deviceId, boundAt}, faceDescriptor, photo-on-record S3 key, verifyRequested, termsAcceptedVersion |
| Team | **reuse `WorkerTeam`** | archive = `active` |
| TeamMembership (dated) | new `FieldTeamStint` (startDate, endDate) | `WorkerTeamMember` is unique per team + worker with no dates, and dropping that index is destructive. It stays "current members", kept in step with the open stints by one service. |
| TeamSupervisor | new `FieldTeamSupervisor` | |
| Site, SiteAssignment | new `FieldSite`, `FieldSiteAssignment` | AIMS has no sites table (jobs carry a free-text `siteAddress`) |
| Job, JobCrew, JobNeed | new `FieldJob` (+ `FieldJobCrew`, `FieldJobNeed`), `deliveryId` nullable 1:1 with the AIMS calendar job (`Delivery`) | Calendar jobs stay the one job list. FieldJob holds the attendance side (site, clocking, QR, crew, expected minutes). SiteClock-own jobs from the shadow import have no Delivery: history only, never on the sales calendar. |
| DayNote | **reuse AIMS calendar notes** where they exist; new `FieldDayNote` for SiteClock's one-text-per-day | |
| Trade, UserTrade, ManningPreset(+Item) | new `FieldTrade`, `FieldWorkerTrade`, `FieldManningPreset`, `FieldManningPresetItem` | |
| ShiftTemplate, ShiftAssignment | new `FieldShiftTemplate`, `FieldShiftAssignment` | |
| Punch, TimeEntry | new `FieldPunch`, `FieldTimeEntry` | Selfie paths become S3 keys (files not copied in the shadow import) |
| OvertimeRule, BreakRule, Company settings | new `FieldOvertimeRule`, `FieldBreakRule`, `FieldSettings` (org 1:1) | |
| LeaveType, LeaveEntitlement, LeaveRequest | new `FieldLeaveType`, `FieldLeaveEntitlement`, `FieldLeaveRequest` | documents in S3 |
| PayProfile, PublicHoliday | new `FieldPayProfile`, `FieldPublicHoliday` | |
| InviteLink, RegistrationRequest, PhotoUpdate | new `FieldInvite`, `FieldRegistration`, `FieldPhotoUpdate` | |
| CompanyLink | new `FieldOrgLink` (AIMS org to AIMS org) | |
| CompanyRole + permissions | **reuse AIMS roles + custom access** (`tab-access.ts`), plus new tab keys | |
| AuditLog | **reuse Activity Log** + new `FieldAuditImport` for SiteClock's history | |
| Assistant, OTP, ApiClient, Webhook*, ProcessedWebhook, Roster* (dead) | not ported | |

Every Field table has `organizationId` and `siteclockId String?` with `@@unique([organizationId, siteclockId])`, so the import is re-runnable with no duplicates.

### 3.4 Roles and permissions

New custom-access tab keys:
- `fieldPeople`
- `fieldJobs`
- `fieldPunches`
- `fieldTimesheets`
- `fieldLeave`
- `fieldPayroll`
- `fieldReports`
- `fieldSettings`

| Preset | Gets |
|---|---|
| Operations | People View, Jobs Edit, Punches Edit (review), Timesheets Approve, Leave Approve, Reports View |
| Accounting | Timesheets View, Payroll Edit, Reports View |
| Admin | everything |

**Supervisors** (an AIMS user linked to a Worker who supervises sites or teams) see only their supervised sites and their teams' members. This is ported from `lib/supervision.ts` and applied to every list and every write.

---

## 4. Phases (order 1-7 kept, the 55 features from the old §2 table)

Each phase delivers:
- schema (additive)
- ported logic + ported SiteClock test cases (jest)
- API behind its area flag
- portal pages
- the shadow-import slice for its data
- parity results
- Guide knowledge lines
- Activity Log rows
- a commit by explicit paths
- a short report

| Phase | Features (spec §1 #) | Native work |
|---|---|---|
| 1 Workers, teams, sites | 3, 4, 15, 16, 18, 19, 20, 21, 22, 23, 25, 26, 27 | profiles + overrides, dated teams + supervisors, geofence + base sites + assignments, invites + join requests (office side: list, approve, reject), photos on record (review), linked orgs, roles map. **Fix:** the Workers & Teams list does not refresh after Hide. |
| 2 Jobs + scheduling | 24, 29, 30, 31, 32, 33, 34, 35, 36, 38, 42, 47, 55 | Field job settings on calendar jobs (clocking OFF / ARRIVE / ARRIVE_LEAVE, QR, crew, needs), working-hours templates + assignments + exceptions, copy day / week, publish (records notifiedAt, no push), day notes, QR rotate, spreadsheet import (ported `jobs-import.ts` + `jobs-plan.ts`), attendance view |
| 3 Punch review | 28, 41, 43, 44, 45, 46, 48, 49, 50, 52, 79 | punch list + detail, flagged (13 reasons) approve with corrected time / reject, marked, face log, off-site REVIEW / MARK / BLOCK, base and linked site settings, auto-close + missed clock-out (ported `missedClockOut.ts` + `autoclose.ts`, cron gated), live view (from imported data until the app) |
| 4 Timesheets | 54, 63, 64, 65, 66, 77 | computeEntry, crewSpan, workedFor (ported exactly), list / detail / edit / manual / approve / bulk / reopen / delete, missed-entry requests (office side), exports, shared hours |
| 5 Leave | 59, 60, 61, 62 | types, entitlements, balances, requests with documents (office records on behalf, decides, cancels), leave calendar (also bars on the Jobs calendar) |
| 6 Payroll | 68, 69, 70 | pay profiles (MONTHLY / DAILY / HOURLY, premium modes, rest days, overrides), public holidays, monthly run + export, payslips (no CPF, same as SiteClock) |
| 7 Reports, rules, overview, audit | 7, 76, 78, 79, 81 | attendance XLSX (≤92 days), attendance summary, fraud summary, rules page (OT, breaks, punch rules, crew margins, share workers), overview, audit viewer (Activity Log Field rows + imported SiteClock audit), terms (edit + acceptances, data only) |

Remaining features from the 55 that need the worker app (53 reminders, 71 / 73 push and realtime, 75 assistant): data model only (settings), no sending.

---

## 5. Shadow import and parity (reference org WCT (S))

### 5.1 Reading SiteClock data (proposal, waiting for Elroy)

Three options:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Read-only DB user on SiteClock prod (recommended)** | Elroy creates a Postgres role with `SELECT` only on the SiteClock prod DB (Railway). AIMS reads it from env var `SITECLOCK_RO_DATABASE_URL`, set by Elroy (local `.env` only, never Render). Every session runs `BEGIN TRANSACTION READ ONLY` and filters `companyId = <WCT company id>` | Live, simple, re-runnable, no files lying around | Needs a role on Railway Postgres; reads hit prod (small, off-hours) |
| B. One-off export | Elroy runs `pg_dump --data-only` of the WCT rows (or the whole DB) into a file, restored into local pg :5433 | Zero load on prod during the work; also lets us run SiteClock's own code on the copy for golden outputs | Snapshot ages; re-export for each refresh; a file with personal data on disk |
| C. Read replica | Railway replica + read-only URL | No load on primary | Cost, setup; overkill for one company |

**Recommendation:** A for the import, plus a local snapshot taken through the same read-only user into pg :5433. SiteClock's own `payroll.service` / `timesheets.service` then run on that copy (locally, from the untouched repo) to produce the golden outputs. Credentials go in env vars set by Elroy, never in chat or commits. Files (selfies, leave documents, photos on record) are not copied in the shadow import; paths only.

### 5.2 Import script

`scripts/field-siteclock-import.ts --env dev|prod --org <aims org id> --siteclock-company <id> [--dry-run | --apply] [--areas people,jobs,punches,timesheets,leave,payroll]`

- **Dry run** prints counts per table (SiteClock rows / would create / would update / unchanged / skipped with reason) and 3 masked samples each (names shortened, phones masked, no face data printed).
- **Apply** upserts by `(organizationId, siteclockId)`, in one transaction per area, under an advisory lock taken on apply only (memory `pooled-advisory-lock`). Log JSON goes to `_imports/wct/logs/`.
- **Workers** match the existing `Worker` rows by `siteclockId`, which round 39 already set. AIMS hides and `userId` links are kept.

### 5.3 Parity

- **SiteClock's own test cases** (`test/e2e.ts`, 3,774 lines, an HTTP script) are translated into jest specs of the ported services, case by case. Each spec names its e2e line range.
- **Golden tests:**
  - **What's compared:** for WCT's last 3 months:
    - per entry: gross, break, regular, OT, late, early, left early, paid span, needsReview, workedFor
    - per worker per month: OT totals, leave balances (per type, per year), payroll rows (every money column in cents)
  - **How:** both sides are computed from the same snapshot. SiteClock's stored entry values and its own payroll / leave code run on the copy, against the AIMS port on the imported rows.
  - **Report:** every mismatch is listed (entry id, field, SiteClock value, AIMS value, reason once found). The goal is zero unexplained mismatches.

---

## 6. SiteClock oddities (reproduced, shown as warnings)

### 6.1 Behaviour oddities (ported as-is, UI warning)

| # | Oddity | Source | AIMS warning |
|---|---|---|---|
| 1 | Bulk approve skips entries that need review and reports them only as a per-id result | `timesheets.router.ts` approve-bulk; web shows "N approved" | Result dialog: "3 approved. 2 need review and were not approved." |
| 2 | No leave over-balance check (approve / record go through when remaining < 0) | `leave.router.ts`, `lib/leave.ts:51` | Chip "Over balance by 2 days" on the request and on approve |
| 3 | Approved no-lunch-break (NLB) adds no pay: `nlbCreditMinutes` defaults to 0 | `BreakRule`, computeEntry | Entry chip "NLB approved, no credit set" when nlb and credit = 0 |
| 4 | Pay follows crew stops on any entry with an edit, including the worker's own missed request and every punch-approval reclose (`editedById` overloaded) | spec §6.30 #8 | Entry chip "Paid as edited; crew hours not applied" |
| 5 | Leave balance counts calendar days, payroll counts workdays | `lib/leave.ts` vs `payroll.service.ts` | Note on the leave balance and payslip |
| 6 | Monthly salary is not prorated (joiners / leavers mid-month) | `payroll.service.ts` | Payroll row chip "Not prorated" when the worker joined / left in the month |
| 7 | Admins (COMPANY_ADMIN tier) are left out of payroll | `payroll.service.ts` | Payroll footnote listing the admins left out |
| 8 | No weekly OT threshold, only a weekly OT cap | `OvertimeRule.weeklyCapOtMin` | Rules page note |
| 9 | A worker's leave cancel ignores dates (past leave can be cancelled) | `leave.router.ts` | Request history shows "cancelled after it started" |
| 10 | A new leave request writes no audit and sends no notification | spec §6.30 #7 | Audit viewer note |
| 11 | Shift assignments have no overlap check | `schedules.router.ts` | Chip "Overlaps another assignment" |
| 12 | AUTO_CLOSED entries are included in the timesheet export (despite the comment) | `autoclose.ts:16`, export | Export dialog note "Auto-closed entries are included" |
| 13 | Timezone slips: fraud summary uses UTC day bounds; invite-approved shift start uses the server date; reminders fall back to Asia/Singapore | spec §6.30 #9 | Report footnote "Days are counted in UTC" |
| 14 | `FACE_MISMATCH` flag reason is never set (face match result is stored but never flags) | spec §6.30 #2 | Face log note |
| 15 | Phone uniqueness: create allows the same phone in another company, change refuses any company | spec §6.30 #6 | Message on change-phone refusal |
| 16 | `PATCH /companies/platform/users/:id {role}` changes the tier without the role row | spec §6.30 #4 | Not ported (platform admin) |
| 17 | `POST /jobs/:id/qr` and publish do not exclude external / cancelled jobs | spec §6.30 #16 | Ported; QR button shown on cancelled jobs with a chip "Cancelled" |
| 18 | Day notes in a linked company's job view come only from the home company | spec §6.30 #17 | Note on linked jobs |
| 19 | Legacy fields read as fallbacks (`ShiftTemplate.siteId`, `payEarly`, `OvertimeRule.countEarlyAsWork`) | spec §6.30 #2 | Ported as fallbacks; no UI |
| 20 | Spreadsheet import: with no "Work" column, a "Workers" column is read as the work (`/work/` is tried before `/worker/`) | `jobs-import.ts` mapHeaders | Template has both columns; spec pins it |
| 21 | Bulk import "replace" deletes the day's jobs | `jobs.router.ts` /import | Not offered in AIMS (would delete calendar jobs); "add" only |
| 22 | (more found while porting are appended here with file:line) | | |

### 6.2 Security leaks NOT reproduced (AIMS permissions instead; deviation for review)

- ASSIGNED scope not applied by SiteClock to: payroll, summary and fraud reports, the schedules / assignments list, the leave calendar with `siteId`, site edits, worker edits. Also the punch photo route honours site supervision only, not teams. In AIMS every Field list and write applies the supervisor scope.
- `workers.manage` can grant the Admin role. In AIMS the role comes from AIMS roles; Field never grants it.
- Full user rows (device id, FCM token, face descriptor) in list responses: AIMS returns only what the screen shows.
- CSV formula injection: AIMS exports use the shared Print / Export helpers.

---

## 7. Retire checklist (in order)

1. **AIMS phone app live**: store builds out; clock-in / punch endpoints, offline queue, selfie + face match, device binding and push all native; WCT workers onboarded on a pilot crew first.
2. **WCT cutover**:
   - Final shadow import, then a parity run with zero unexplained mismatches.
   - `fieldEngineLive` on and all Field flags on for WCT (S).
   - The office stops using SiteClock web; workers switch apps on a set date.
   - Open SiteClock entries are closed or carried over.
   - The first native pay month is reconciled against SiteClock.
3. **SiteClock read-only**: SiteClock web and app for WCT made read-only (writes refused), kept for 1 pay cycle as a fallback view; SiteClock app `APP_MIN_BUILD` raised so old builds point to the AIMS app.
4. **Repo archived**: final history import (punches, entries, leave, payroll months, audit, files from `UPLOAD_DIR` to S3); the SiteClock GitHub repo archived (read-only); docs moved into AIMS.
5. **Server and DB off**:
   - Last full DB dump kept for the retention period.
   - The Railway service is stopped, then the DB.
   - In AIMS: the `SiteClockConnection`, calendar feed, Workers & Teams sync button and inbound photo / delivery endpoints are removed.
   - Keys are revoked, and the WhatsApp / FCM / Clerk settings tied to SiteClock are cleaned up.

---

## 8. Questions still open (do not block phase 1 code)

1. Reading SiteClock data: option A, B or C (§5.1). Blocks the shadow import and parity, not the build.
2. SiteClock files (selfies, leave documents, photos on record): copy them into S3 at the shadow import, or only at cutover?
3. Linked orgs: WCT (S)'s SiteClock links (if any) map to which AIMS orgs?


## 9. Status at the end of the build (2026-11-21, branch elroy/field, main be4defb4 + follow-ups)

Legend: **done** = ported and tested in AIMS (behind the flags); **partial** = office side done, the rest waits for the AIMS phone app or a decision; **skipped** = deliberately not ported now (the user's "not now" list); **not needed** = AIMS already has it, or SiteClock never had it working.

| # | Feature | Status | Reason / where |
|---|---|---|---|
| 1 | Phone OTP login | skipped | Worker app + WhatsApp OTP: not now |
| 2 | Web login code from the app | not needed | Office signs in with AIMS (Clerk) |
| 3 | Device binding / move phone | partial | Data kept; office Reset device done; binding itself is the app |
| 4 | One phone, account per company | partial | Linked orgs done (#15); the app switcher is the app |
| 5 | Sign in with AIMS (Clerk satellite) | not needed | Field is inside AIMS |
| 6 | Clerk webhook sync | not needed | AIMS users are Clerk users already |
| 7 | Terms acceptance gate | partial | Terms text, versions and who accepted: Field > Rules > Worker terms; the gate is the app |
| 8 | Delete my account | skipped | Worker app |
| 9 | Store-review login | skipped | Worker app |
| 10 | App update prompt | skipped | Worker app |
| 11 | Company self-signup | not needed | AIMS orgs are set up by Osiris |
| 12 | Platform: companies CRUD | not needed | AIMS admin panel |
| 13 | Platform: all users, superadmins | not needed | AIMS admin; Reset device per org done |
| 14 | "View as" a company | not needed | AIMS "Viewing as org" |
| 15 | Linked companies, share workers, shared workers page | done | Field > Settings links, share workers, Timesheets "Others' workers / Our workers" tabs |
| 16 | Company roles (permission sets) | partial | AIMS roles + Field presets (Admin / Operations / Accounting / supervisor grant) replace custom sets |
| 17 | Legacy tier + supervisor switches | done | Read as fallbacks (FieldWorkerProfile.tier, FieldSettings legacy switches) |
| 18 | Worker CRUD | done | Field > Workers (reuses Worker) |
| 19 | Per-worker rule overrides | done | Workers > Rules tab |
| 20 | Invite links + join requests | done | Field > Invites (approve / reject) |
| 21 | Photo on record | done | Request / approve / reject; photo capture is the app |
| 22 | Reset device, change phone | done | Workers kebab |
| 23 | Teams with dated memberships | done | FieldTeamStint, history, supervisors, archive |
| 24 | Trades + manning presets + headcount | done | Trades, presets, job needs |
| 25 | Sites with geocode + geofence | done | Field > Sites (OneMap / OSM, radius, accuracy) |
| 26 | Site kinds PERMANENT / JOB / BASE | done | |
| 27 | Site assignments + supervisor flag | done | |
| 28 | Live site presence | done | Clock-ins > On site now |
| 29 | Job create / edit / delete | done | On the AIMS calendar (one job list); Field side per job |
| 30 | Several jobs for one team | done | Same crew on several calendar jobs |
| 31 | Copy day / week | done | Calendar quick jobs only |
| 32 | Publish / notify | partial | "Mark crews as told" records it; nothing is sent (push: not now) |
| 33 | Day notes | done | |
| 34 | Spreadsheet import | partial | Template / preview / add done; replace not offered (oddity 21); client must be an AIMS customer |
| 35 | Job QR | done | Show / new code |
| 36 | Jobs views Plan / Attendance / Week | partial | Plan + Who turned up; the week is the AIMS Jobs calendar; worker strip is the app |
| 37 | Recurring jobs | not needed | Never existed in SiteClock |
| 38 | Working hours templates + assignments | done | Field > Working hours |
| 39 | Old Roster tables | not needed | Dead in SiteClock |
| 40 | AIMS (external) jobs in SiteClock | not needed | Native now: the calendar is the job list |
| 41 | Day clock in / out | skipped | Clock-in endpoints: not now (rules and data ported) |
| 42 | Job clocking | partial | Engine (auto-leave, end day) ported + tested; endpoints wait for the app |
| 43 | Selfie policy + face match | partial | Settings, per-worker override, face log review; capture is the app; FACE_MISMATCH never set (oddity 14) |
| 44 | Off-site REVIEW / MARK / BLOCK | partial | Rules + review done; enforcement at clock-in is the app |
| 45 | Base sites clocking | partial | Rule + data; enforcement at clock-in |
| 46 | Linked-company site clocking | partial | Data + workedFor done; clock-in is the app |
| 47 | QR required at job | partial | Setting + code done; scan is the app |
| 48 | Group punches | partial | Rules done; the punch is the app |
| 49 | Offline punch queue | skipped | Worker app |
| 50 | Flags review approve / reject | done | Clock-ins > To review (13 reasons, corrected time) |
| 51 | Fraud policy BLOCK | partial | Setting kept; enforcement at clock-in |
| 52 | Auto-close + missed clock-out rule | done | Engine + 15-min cron, runs only with enableFieldModule AND fieldEngineLive |
| 53 | Reminders | skipped | Sending push / reminders: not now |
| 54 | Missed-entry request by worker | partial | Office review of the PENDING entry done; the request is sent from the app |
| 55 | Job progress from arrive / leave | done | jobStatus on Plan |
| 56 | Job photos to AIMS | not needed | AIMS job photos already native |
| 57 | Delivery / DO / service report relay | not needed | AIMS-native flow |
| 58 | PTW | not needed | Never existed in SiteClock |
| 59 | Leave types | done | Field > Leave |
| 60 | Entitlements / balances | done | Calendar days (oddity 5) |
| 61 | Request leave with documents; cancel | partial | Office record + cancel done; worker request is the app; existing documents stay in SiteClock until files are copied (question 2) |
| 62 | Approve / reject, record, calendar | done | |
| 63 | Time entry computation | done | computeEntry ported, 23 SiteClock cases |
| 64 | Timesheets list / approve / bulk / edit / reopen | done | Bulk skip of needsReview shown (oddity 1) |
| 65 | Paid hours follow the crew | done | crewSpan + notes kept verbatim |
| 66 | workedFor split for shared workers | done | |
| 67 | Worker history | skipped | Worker app |
| 68 | Pay profiles + public holidays | done | Field > Payroll |
| 69 | Monthly payroll + export | done | No CPF, not prorated (oddity 6), Print / Export |
| 70 | Worker payslip | partial | Office payslip view done; the worker's own is the app |
| 71 | FCM push | skipped | Not now |
| 72 | WhatsApp OTP / templates | skipped | Not now |
| 73 | Realtime socket | not needed | Pages refetch (On site now polls) |
| 74 | Email | not needed | Never existed in SiteClock |
| 75 | AI assistant chat | skipped | Not now (AIMEE knows the Field screens through app-knowledge) |
| 76 | Reports: attendance / summary / fraud | done | Field > Reports; supervisors scoped (6.2) |
| 77 | Timesheet export | done | Print / Export, auto-closed included (oddity 12) |
| 78 | Rules page | done | Field > Rules |
| 79 | Overview dashboard | done | Field > Overview |
| 80 | In-app guides | not needed | AIMEE + app-knowledge lines |
| 81 | Audit log | done | Field > Audit log (Activity Log + imported SiteClock history); SiteClock had no viewer |
| 82 | Machine API /v1 | not needed | AIMS api-v1 |
| 83 | Outbound webhooks | not needed | Dead in SiteClock |
| 84 | Clerk backfill scripts | not needed | AIMS users are Clerk users |

Totals: done 36, partial 18, skipped 11, not needed 19 (84). Partial = the office side is done and the rest is the worker app or a decision.
