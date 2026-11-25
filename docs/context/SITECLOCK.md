# SiteClock — reference for AIMS agents

Read-only survey of the SiteClock repo (`~/Desktop/siteclock`), main @ `62b7d9d` (2026-11-14), written 2026-11-16. Paths are relative to the repo root. "(?)" = not verified / inferred. No secrets, keys or customer data here; env var NAMES only.

---

## 0. Latest code

- `git fetch --all` + `git pull --ff-only` on main: was 52 behind, now at `origin/main` `62b7d9d`. No uncommitted code changes (only untracked `docs/design-reference/`, `docs/do-clone-compare/`).
- Tags: only `v1.0.16` (= `5d91ff8`, 2026-11-11, "App 1.0.16 (build 26): Delivery flow for AIMS jobs, sign-off by customer or link, all-day jobs; also carries 1.0.15").
- Commits since `v1.0.16` / `5d91ff8` (6, all on main, **all unreleased to stores**; backend/web deploy status unknown (?)):
  - `3226be5` 11-12 Assistant: a Roles change resets the chat (stale "I can't create jobs" refusals).
  - `f23d0ad` 11-13 Selfie rule per worker (`User.selfiePolicy` overrides company rule).
  - `8b06a0d` 11-13 Paid hours follow the crew's jobs (`User.payFollowsCrew`, margins, `TimeEntry.needsReview`/`crewNote`).
  - `c27ad88` 11-13 One login, an account per company (`@@unique [companyId, phone]`, `POST /auth/switch`); app 1.0.17 build 27.
  - `2d5fffe` 11-14 Base sites (`Site.kind BASE`, `allWorkers`, `Company.baseClocking`).
  - `62b7d9d` 11-14 Linked companies share workers (`CompanyLink`, `Company.shareWorkers`, `TimeEntry.workedFor`, Shared workers page).
- Other branches: every remote/local feature branch (`elroy/sc-deliveries`, `sc-delivery-ui*`, `sc-flow-*`, `job-photos*`, `siteclock-jobs-api`, `siteclock-jobs-calendar`, `siteclock-do-link*`, `clerk-migration`, `clerk-web-fallback`, `step1-on-main`, `elroy/sc-photos-unsorted`, `elroy/apk-delivery-allday`) is fully merged into main (0 commits ahead).
  - Only exception: `clerk-prod-relink` (1 commit, 2026-10-27): script to rewrite stored Clerk user ids dev → prod. Not merged (?whether still needed).
- App release: `app/pubspec.yaml` = 1.0.17+27, release note `docs/release-1.0.17.md`. No `v1.0.17` tag. `docs/release-1.0.16.md` says last store release = 1.0.14 (build 24); 1.0.15 went to internal testing/TestFlight only. Whether 1.0.16 reached the stores isn't recorded (?) — WCT_STATE says store build blocked on signing keys.

---

## 1. Overview

### What it is
- Multi-tenant geofenced time-clock + job scheduling SaaS ("SiteClock API - multi-tenant geofence timesheet SaaS", `backend/package.json`). Built by Osiris; prod at `siteclock.osiris.sg`.
- **Workers** (phone app): see their jobs, clock in/out at sites with GPS + selfie/face check, job photos, AIMS delivery/DO flow, leave, payslip, history.
- **Supervisors** (app + web): live site view, flagged punches, crew jobs, group clock-in.
- **Office/admins** (web, some in app): jobs/rosters, timesheets approval + export, payroll, leave, sites, workers, teams, roles, rules, reports, AI assistant.
- **Platform admin** (SUPERADMIN, web): companies, linking companies, all users, "view as" (`web/src/pages/Companies.tsx`, `PlatformUsers.tsx`, `PlatformOverview.tsx`).
- Platforms: Android + iOS Flutter app (`app/`), React web office (`web/`), Node API (`backend/`). Admin and supervisor shells exist in the same app (`app/lib/main.dart`).

### Repo layout / stack
- `backend/` — Node/TS, Express 4, Prisma 5, Postgres, zod, luxon, socket.io, node-cron, firebase-admin, exceljs, `@anthropic-ai/sdk`, `@vladmandic/face-api` + tfjs-wasm + sharp (`backend/package.json`).
  - `src/modules/*` routers (auth, jobs, punches, timesheets, payroll, leave, rosters, schedules, sites, teams, workers, roles, rules, reports, links, assistant, v1, webhooks, invites, signup, companies, photos, terms).
  - `src/lib/*` shared logic (`externalJobs.ts`, `aimsDelivery.ts`, `jobPhotos.ts`, `apiKeys.ts`, `webhooks.ts`, `links.ts`, `accounts.ts`, `clerk*.ts`…), `src/jobs/*` crons, `src/scripts/*` (`issue-api-key.ts`, `set-aims-link.ts`, `clerk-backfill.ts`).
  - Schema `backend/prisma/schema.prisma` (1135 lines), 72 migrations.
- `web/` — React 19 + Vite + TS, Leaflet, socket.io-client, `@clerk/react` (`web/package.json`). Pages in `web/src/pages`.
- `app/` — Flutter `siteclock_app` 1.0.17+27, dio, socket_io_client, firebase_messaging (`app/pubspec.yaml`). Android id + iOS bundle `com.osiris.siteclock` (`app/android/app/build.gradle.kts`, `app/ios/Runner.xcodeproj/project.pbxproj`).
- No shared packages between app/web/backend; no root README (READMEs in `app/`, `backend/`, `web/`).

### Hosting / infra
- API on **Railway** (`backend/railway.json`): build `prisma generate && tsc`, start `prisma migrate deploy && npm start` (migrations on every boot), health `/health`. One process runs HTTP + socket.io + all crons (`backend/src/index.ts`).
- Web on **Vercel**, project `siteclock-web` (`web/.vercel/project.json`, `web/README.md`).
- DB: **Postgres** via Prisma (`DATABASE_URL`, `schema.prisma:6-7`).
- File storage: **local disk** `UPLOAD_DIR` (default `uploads/`) — selfies `punches/`, device/worker photos `binds/`, `registrations/`, `leave/`, `job-photos-tmp/` (`backend/src/modules/punches/punches.router.ts:20-21`, comment: "mount a persistent volume… Railway FS is ephemeral"). Whether a Railway volume is mounted (?). No S3.
  - Job photos are stored **in AIMS** (S3 on AIMS side); SiteClock only keeps a temp file until AIMS confirms (`backend/src/lib/jobPhotos.ts:10-25`).
- Push: Firebase Cloud Messaging via firebase-admin (`backend/src/lib/push.ts`; `FIREBASE_SERVICE_ACCOUNT` / `_B64`; disabled with a warning if unset).
- Realtime: socket.io rooms `user:`/`company:`/`site:` (`backend/src/realtime/socket.ts`), no Redis adapter.
- OTP: WhatsApp Cloud API (Meta) or console (`backend/src/lib/otp.ts`, `whatsapp.ts`; `SMS_PROVIDER`, `WHATSAPP_*`).
- Geocoding: OneMap SG + OSM Nominatim (`backend/src/lib/geocode.ts`), backfill cron.
- AI assistant: Claude via `@anthropic-ai/sdk` (`backend/src/modules/assistant/assistant.service.ts:15`; `ANTHROPIC_API_KEY`).
- Crons (node-cron, in-process, UTC expressions, `backend/src/jobs/autoclose.ts:79-120`): auto-close every 15 min; clock reminders every 5 min; every minute job reminders + webhook outbox + job-photo delivery to AIMS; daily failed-photo purge (03:30 SGT) and flagged-punch reminder (09:00 SGT); geocode backfill every 10 min.

### Auth (who logs in how)
- Workers/admins: **phone + 6-digit OTP** (WhatsApp) → own HS256 JWT `{sub, role, companyId}`, 30 days (`backend/src/lib/auth.ts:34-35`, `modules/auth/auth.router.ts`). Role/company/active re-read from DB on every request (`lib/auth.ts:103-157`).
- Device binding: first device binds; another device gets `409 DEVICE_MISMATCH` + bind ticket; rebind via OTP (`auth.router.ts:99-136,180-226`). Friction + audit, not a hard security boundary (`app/README.md`).
- One phone, several companies: one `User` row per company; `/auth/me` lists `accounts`; `POST /auth/switch` (`backend/src/lib/accounts.ts`, commit `c27ad88`).
- Web only: optional **Clerk** login "Sign in with your AIMS account" — SiteClock web is a Clerk satellite of `app.ai-ms.io` (`web/src/lib/clerk.tsx`, flags `VITE_CLERK_LOGIN`, `VITE_CLERK_SIGN_IN_BUTTON` default off). Backend accepts Clerk RS256 tokens when `CLERK_ENABLED=true`, mapped via `User.clerkUserId`, else 403 `NO_SITECLOCK_ACCOUNT` (`backend/src/lib/clerk.ts`, `lib/auth.ts:86-92`). The Flutter app never uses Clerk.
- Web code login from the app (`POST /auth/app-code`); store-review account `REVIEW_PHONE`/`REVIEW_OTP`.
- Platform admin: SUPERADMIN with `companyId` null; "view as" = 8 h COMPANY_ADMIN token (`lib/auth.ts:43-44`).
- Machine clients (AIMS): API keys `sck_live_…`, SHA-256 hashed, scoped, one company per key (`backend/src/lib/apiKeys.ts`). See §4.

### Environments (no secrets)
- Prod API `https://api.siteclock.osiris.sg` (`app/lib/services/api.dart:9-10`, `web/.env.production`).
- Prod web `https://siteclock.osiris.sg` (`backend/src/config.ts:11`, `WEB_BASE_URL`); Vercel fallback URL (?exact).
- AIMS web `https://app.ai-ms.io` (`AIMS_WEB_URL`); AIMS base URL for SiteClock→AIMS calls is per company in `ApiClient.aimsBaseUrl` (example `https://api.ai-ms.io`, `backend/src/scripts/set-aims-link.ts`) (?which host prod uses — AIMS prod API per `_common.md` is `aims-ahwy.onrender.com`).
- Dev: API `http://localhost:4100`, web `http://localhost:5173`, Android emulator `10.0.2.2:4100` (`web/src/api.ts:1`, `web/README.md`, `app/README.md`). No staging found (?).
- Stores: Play `com.osiris.siteclock`, App Store id `6803246353` (`backend/src/config.ts`).

### Build + release
- Backend: push → Railway build/deploy; migrations run on boot (`backend/railway.json`). Web: Vercel. No CI config in repo (?).
- Tests (run locally against dev DB, `backend/README.md`): `npm run test:e2e` (~897), `test:v1` (~120 per last API commit), `test:photos` (~59), `test:delivery` (~40) (`backend/test/*.ts`); app `flutter test` (57) + `flutter analyze`.
- App update gate: `GET /app-version?platform=` with `APP_LATEST_BUILD_ANDROID/_IOS`, `APP_MIN_BUILD_ANDROID/_IOS` (fallback `APP_LATEST_BUILD`/`APP_MIN_BUILD`) (`backend/src/app.ts:47-71`; app side `app/lib/services/update_check.dart` — "Later" below latest, forced below min). After store approval, raise latest to 27; min stays 20 (`docs/release-1.0.17.md`).
- Android signing: `app/android/key.properties` + upload keystore, both gitignored; **missing key.properties silently produces a debug-signed build** (`app/android/app/build.gradle.kts:22-65`). iOS: automatic signing, team set in pbxproj, upload .ipa to TestFlight (`docs/release-1.0.16.md`).
- **Store blocker**: this Mac has no full Xcode, no signing identities and no SiteClock upload keystore; the SiteJobs keystore must never be used for SiteClock (memory note `app-release-signing.md`). Version bumps are committed by another dev (yixuan0922) who probably holds the keys (?).

---

## 2. Data model (`backend/prisma/schema.prisma`)

General
- IDs: `cuid()` strings everywhere (exceptions: `WebhookDelivery.id` = `evt_<hex>`, `ProcessedWebhook.id` = Svix id, `UserTrade` composite key).
- `updatedAt` only on **Job** (965, indexed with companyId 977), JobPhoto, PayProfile, AssistantSession. **User, Site, Team, Punch, TimeEntry have only `createdAt`** → no change-tracking for sync.
- Tenant isolation is **in code** (each query filters `companyId`), not DB-enforced. Child tables without `companyId` (SiteAssignment, JobCrew, JobNeed, TeamMembership, RosterEntry…) are reached through a parent.

Entities
- **Company** (107-160): `active`, `timezone` (default Asia/Singapore), rules (selfie, off-site review REVIEW/MARK/BLOCK, job clocking OFF/ARRIVE/ARRIVE_LEAVE, group clocking, missed clock-out, crew pay margins, base clocking), terms, `shareWorkers` NONE/ALL/SELECTED.
  - **CompanyLink** (166-177): symmetric link between two companies (platform admin sets it); shared workers can be crewed on the other company's jobs; punches/entries/payroll stay with home company (`backend/src/lib/links.ts`).
- **User** (185-258): `companyId` (null = SUPERADMIN), `phone` unique **per company** (255), `name`, `employeeNo`, `role` tier WORKER/SUPERVISOR/COMPANY_ADMIN/SUPERADMIN + `companyRoleId` → **CompanyRole** (37-51: name, permission keys, scope COMPANY/ASSIGNED; keys in `backend/src/lib/permissions.ts:13-104`). `clerkUserId` (unique, null until linked), device/face fields, `fcmToken`, per-worker rule overrides, `active` (soft deactivate, `workers.router.ts:220`), `sharedWithLinked`.
- **Team** (862-906): `active`; **TeamMembership** dated (`startDate`/`endDate`), never rewritten; **TeamSupervisor**.
- **Site** (299-343): `kind` PERMANENT / JOB (one-off place, hidden from Sites list) / BASE (office/yard/dorm); `lat`,`lng`,`radiusM`,`maxAccuracyM`,`timezone`,`autoCloseAfterH`,`active`; `externalRef` unique per company (set by AIMS via `/v1/sites/by-ref`); **SiteAssignment** (user↔site, `isSupervisor`).
  - "Customers" don't exist in SiteClock — only sites/places. Customer data lives in AIMS.
- **Job** (917-988): `date` (yyyy-MM-dd), `startTime`, `allDay`, `expectedMinutes`, `title`, `location`, `siteId` (geofence), `description`, `instructions`, `teamIds`/`exceptUserIds` (labels), `clocking`, `qrRequired`/`qrToken`, `createdById`.
  - External (null on SiteClock's own jobs): `externalSource` ("aims"), `externalRef` (unique per company, 975), `apiClientId`, `startAt`/`endAt`/`timezone`, `status`, `startedAt`/`completedAt`/`cancelledAt`/`cancelReason`, `externalUrl`/`externalUrlLabel` ("View DO"), `deliveryEnabled` (963).
  - **JobStatus** SCHEDULED → IN_PROGRESS → COMPLETED, or CANCELLED — external jobs only; set only by AIMS (`backend/src/lib/externalJobs.ts:6-27`).
  - **JobCrew** (1047): job↔user (+teamId, tradeId, notifiedAt) = assignments. AIMS jobs = one lead (first row), plus the rest of the crew when AIMS sends `crewWorkerIds` (2026-11-25). **JobNeed** (headcount per trade). **DayNote** (per company+date free text).
  - Delete: SiteClock jobs are **hard-deleted** (`backend/src/lib/jobs.ts:394-398`); AIMS jobs are soft-cancelled and hidden everywhere by `liveJob` (`externalJobs.ts:21`).
- **Rosters / working hours**: Roster (820, site+date+name) + RosterRequirement/RosterEntry, Trade/UserTrade, ManningPreset; ShiftTemplate (463) + ShiftAssignment (485) (`backend/src/modules/rosters`, `schedules`).
- **Punch** (345-401) = clock-in/out: `type` IN/OUT, server/original/device time, GPS + `insideFence`, `faceScore`, mocked/rooted, `photoPath` (selfie), `workerNote`/`reviewNote`, `jobId` (job clocking), `endsDay`, `recordedById` (group clock), `qrScanned`, `autoLeft`, `offlineSynced`, `idempotencyKey` (unique). Status OK/FLAGGED/APPROVED/REJECTED (`punches.service.ts:293,586-729`).
- **TimeEntry** (403-461) = timesheet day: `workDate`, `clockInAt`/`clockOutAt`, minutes (gross/break/regular/OT/late/early), NLB, edit trail, approval, crew-pay fields (`paidFromAt`…`crewNote`, `needsReview`), `workedFor` {companyId: minutes}. Status OPEN → PENDING (clock-out) → APPROVED/REJECTED; OPEN → AUTO_CLOSED by cron; reopen → OPEN (`timesheets.service.ts`, `timesheets.router.ts:192-239`, `jobs/autoclose.ts`).
- **Leave**: LeaveType (`archived`), LeaveEntitlement, LeaveRequest PENDING/APPROVED/REJECTED/CANCELLED (528-576, `leave.router.ts`).
- **Payroll**: PayProfile (MONTHLY/DAILY/HOURLY, cents SGD), PublicHoliday (`payroll.service.ts`).
- **JobPhoto** (1066-1110): AIMS jobs only; `clientId` (dedupe), `tag` UNSORTED/SIGNED_DO/STAMPED_DO/SERVICE_REPORT/SITE/OTHER, `aimsPhotoId`, status QUEUED → STORED / FAILED, soft delete `deletedAt` + `aimsDeletedAt`.
- **Deliveries / DO / service reports / signatures**: **not stored in SiteClock** — all in AIMS, keyed by `Job.externalRef`. SiteClock only has `deliveryEnabled`, `externalUrl` and photo tags.
- **PTW (permit to work)**: **does not exist in SiteClock** (no match for `ptw`/`permit` in app, web, backend, schema). PTW is AIMS-only (AIMS jobs calendar colours by PTW, `WCT_STATE.md`).
- Notes/attachments: no table; DayNote + text fields (`Punch.workerNote`, `TimeEntry.editNote`, `JobPhoto.note`…) and file paths (`LeaveRequest.documentPaths`, `Punch.photoPath`).
- Integration tables: **ApiClient** (993-1016: one per company, `keyHash`, `keyPrefix`, `scopes`, `webhookUrl`/`webhookSecret`, `aimsBaseUrl`, `aimsInboundKeyEnc` (AES-256-GCM, `lib/secretBox.ts`), `source` default "aims", `active`, `lastUsedAt`); **WebhookDelivery** outbox (1021-1045, idle); **AuditLog** (631-645; API writes as `api:<clientId>`, e.g. API_JOB_CREATE/UPDATE/STATUS/CANCEL).

### SiteClock company ↔ AIMS org
- Mapping = the company's **ApiClient** row (AIMS holds the key; SiteClock holds `aimsBaseUrl` + AIMS inbound key). **No `aimsOrgId` field** anywhere in SiteClock.
- AIMS side holds `SiteClockConnection` and `OrganizationMemberProfile.siteclockUserId` (per `docs/do-into-siteclock-discovery.md:24,126`; AIMS code, not this repo).
- Users: `User.clerkUserId` (shared Clerk instance); with `CLERK_WRITE_THROUGH`, Clerk `publicMetadata.siteclock = {userId, role, companyId}` (`backend/src/lib/clerkAdmin.ts:19,31`).
- Linked companies today: **only WCT** is named (`docs/release-1.0.15.md:17`, `docs/release-1.0.16.md:28`, `docs/do-into-siteclock-discovery.md:26,94`, commit `b75fd31` "WCT's 5 prod jobs"). Which WCT entity (presumably WCT (S) Systems) (?).
- **WCT Racking, BC Air: no SiteClock company found in repo** (company rows live only in the prod DB (?)). AIMS notes: BC Air won't use SiteClock for now (`WCT_STATE.md:74`). Biofuel: not linked (`Biofuel_STATE.md:11`); listed as a future candidate in the discovery doc.

---

## 3. Worker app flows (`app/lib`)

- **Shell by role** (`app/lib/main.dart`): admin → AdminShell; role with permissions → SupervisorShell; none → WorkerShell (Jobs / Clock / Profile). All behind TermsGate (accept company terms).
- **Login** (`app/lib/screens/login_screen.dart`): phone → `POST /auth/request-otp` (WhatsApp) → `POST /auth/verify-otp {phone, code, deviceId}`; device bound; mismatch → "Move to this phone?" → `/auth/bind-device` (next punch needs selfie + review). Switch company in Profile (`profile_screen.dart:186`, `POST /auth/switch`).
- **See jobs**: `GET /jobs/mine?from&to` (`backend/src/modules/jobs/jobs.router.ts:44`) → Jobs tab (2-week strip, time column, crew, instructions, "View DO", delivery + photos sections; `app/lib/screens/worker/jobs_screen.dart`) and today's jobs card on Clock (`app/lib/widgets/today_jobs_card.dart`). Linked company jobs show "For <company>".
  - On AIMS jobs `/jobs/mine` adds `externalSource`, `externalStatus`, `startAt/endAt`; `status` there = SiteClock's own arrive/leave progress (`externalJobs.ts:84-89`).
- **Clock in/out** (`app/lib/screens/worker/home_screen.dart` ~650-1000, `app/lib/services/job_clock.dart`):
  - Day clocking vs job clocking (`Job.clocking` OFF/ARRIVE/ARRIVE_LEAVE); `nextStep()` = dayIn / jobIn / jobOut / jobOutEndDay / dayOut.
  - Site auto-picked from today's jobs/own sites (workers only see their own places + bases if allowed, `auth.router.ts:327`).
  - GPS geofence (`radiusM`, `maxAccuracyM`); off-site → REVIEW / MARK / BLOCK per rule.
  - Selfie when off-site, poor GPS, policy ALWAYS, or server demands (`SELFIE_REQUIRED`); on-device face check (`app/lib/services/face_check.dart`) + server face match (`backend/src/lib/face.ts`).
  - QR sign-in when `qrRequired` (`qr_scan_screen.dart`); group clock by crew/supervisor (`app/lib/widgets/group_clock_sheet.dart`, `POST /punches/group`).
  - Day clock-out: "no lunch break" tick; flagged punches go to supervisor.
- **Start/finish a job**: SiteClock jobs — clocking at the job *is* the record (no separate start/finish). AIMS jobs — status is reported by AIMS only; clocking never changes it (`externalJobs.ts:5-18`). With delivery on, start/finish happens in the Delivery section (below).
- **PTW**: none in SiteClock.
- **Job photos** (AIMS jobs with photos enabled, `app/lib/widgets/job_photos.dart`): camera/gallery, sent UNSORTED, from clock-in to 23:59 of job day, offered after clock-out; relayed to AIMS (§4).
- **Delivery / DO signing** (AIMS jobs with `deliveryEnabled`, `app/lib/delivery/*`): native screens, every call relayed through SiteClock backend to AIMS.
  - Open job (= start, AIMS claims the run) → tick items → optional photos → sign-off: customer signs on phone (`signature_pad.dart`) or Skip → AIMS sends sign link → Done: view/share/print DO PDF → "Done, clock out" (`delivery_run_screen.dart`, `delivery_finish_screen.dart`, `delivery_done_screen.dart`, `do_actions.dart`).
  - "Can't finish today" + reason → AIMS `not-finished`; clock-out blocked until done or excused (`clock_out_guard.dart`).
  - Pending Sign list for service reports awaiting customer signature (`pending_sign_screen.dart`); WCT service report template (`wct_service_template.dart`); WCT wording driven by AIMS's `enableWctOrders` in the run (`delivery_ui.dart:38`).
  - Without delivery: "View DO" opens `externalUrl` in an in-app browser (`jobs_screen.dart:1468-1482`).
- **Offline**:
  - Punches queued in SharedPreferences with idempotency key + `queuedAt` (`app/lib/services/punch_queue.dart`); server dedupes, back-dates up to 48 h, flags >60 min late (`punches.service.ts:93,133-145,224`). 4xx/5xx on sync drops the punch. Group punches not queued.
  - Job + delivery photos queued with `clientId` (`app/lib/services/photo_queue.dart`).
  - Not offline: login, job list (not cached (?)), delivery steps (retried twice with same key, not queued), leave, payslip.
- **Other**: leave requests + documents (`leave_screen.dart`), month-to-date payslip (`payslip_screen.dart`, `GET /payroll/me`), history + missed-entry request (`history_screen.dart`), FCM pushes (job created/changed/cancelled, 15-min reminder, roster, approvals… `app/lib/services/push_service.dart`), forced update (`update_check.dart`).

### Office / admin side
- Web (`web/src/pages`, tabs by permission `web/src/lib/permissions.ts`):
  - **Jobs** (`Roster.tsx`): Plan / Attendance / Week; create/edit jobs (place, teams + individuals, clocking, QR), copy day/week, publish day, day notes, spreadsheet import (`web/src/components/ImportSchedule.tsx`, `backend/src/modules/jobs/jobs-import.ts`), AIMS job photo strip.
  - **Timesheets** (`Timesheets.tsx`): approve/reject, bulk approve (skips `needsReview`), edit/reopen, export CSV/XLSX (`GET /timesheets/export`).
  - **Payroll** (`Payroll.tsx`): pay profiles, holidays, export CSV/XLSX. **Leave** (`Leave.tsx`). **Reports** (`Reports.tsx`): attendance XLSX (`/reports/attendance-export`, ≤92 days), attendance/fraud summaries.
  - **Overview / Live Site / Flagged**, **Sites**, **Workers** (invites, approvals, device reset, roles), **Teams**, **Roles**, **Rules**, **Terms**, **Shared workers** (only when linked), **Assistant** (Claude tool-use; WhatsApp schedule → jobs, `assistant-jobs.ts`).
  - AIMS app switcher (`web/src/components/AppSwitcher.tsx`, `POST /auth/aims-link` → 60 s Clerk sign-in ticket to AIMS).
- App admin shell: overview, timesheets, jobs (create/edit, multi-job), sites, workers, teams, rules, leave, reports (`app/lib/screens/admin/*`). CSV/XLSX timesheet export is web-only.
- **AIMS jobs are read-only in SiteClock**: office edit/delete, roster edits, assistant update/delete → 409 `EXTERNAL_JOB` "This job is managed by AIMS — change or cancel it there." (`jobs.router.ts:293,326`, `rosters.router.ts:449-485`, `assistant-jobs.ts:163,230`). Copy day/week and import "replace" skip them (`lib/jobs-plan.ts:190-194`). Web doesn't grey them out first (?).

---

## 4. AIMS integration (most important)

### AIMS → SiteClock: `/v1` API (`backend/src/modules/v1/v1.router.ts`, mounted `backend/src/app.ts:92`)
- Auth: `Authorization: Bearer sck_live_<32 base62>`; `requireApiKey(scope)` → 401 `UNAUTHORIZED` / 403 `FORBIDDEN`; sets company from key (`backend/src/lib/apiKeys.ts:45-67`). Cross-company access tested (`backend/test/v1.ts:176-184`).
- Scopes: `teams:read`, `workers:read`, `workers:phone` (opt-in), `sites:write`, `jobs:read`, `jobs:write` (`apiKeys.ts:12-15`).
- Key issue: CLI `backend/src/scripts/issue-api-key.ts --company <id>` (refuses remote DB without `--allow-remote-db`; full key to a mode-600 file, prefix printed; audit `API_CLIENT_CREATE`). **No UI/route to issue, rotate or revoke.**
- Errors `{error, code}`; 400 `VALIDATION` (zod details); 404 `NOT_FOUND`.
- Endpoints:
  - `GET /v1/teams?date=` — teams + members on that date (:63).
  - `GET /v1/workers?teamId&active&include=phone` — id, name, employeeNo, role, active, clerkUserId, teamIds, siteIds (+phone with scope) (:83).
  - `PUT /v1/sites/by-ref/:ref` — upsert site `{name, address?|lat+lng, radiusM 50–2000}`; geocodes (OneMap→OSM), 422 `ADDRESS_NOT_FOUND`; new = `kind JOB` (:140).
  - `POST /v1/jobs` — `{externalRef, workerId, siteId|siteRef, startAt+endAt (ISO with offset) | allDay+date, title, notes?, externalUrl? (https), externalUrlLabel?, deliveryEnabled?, notify=true}`; ≤24 h; one worker; 422 `SITE_NOT_FOUND`/`WORKER_NOT_FOUND`; idempotent on `externalRef`: same body → 200 `{duplicate:true}`, different → 409 `EXTERNAL_REF_CONFLICT`; race-safe (:274-318).
  - Crew (2026-11-25, optional on POST and PATCH): `crewWorkerIds: string[]` (≤50, everyone besides the lead `workerId`) and `teamIds: string[]` (labels; ids that are not the company's teams are dropped). With `crewWorkerIds`, lead and crew are checked with `lib/links.ts crewableIds` (own people, or workers a linked company shares) and must be active, else 422 `WORKER_NOT_FOUND` + `workerIds`. On PATCH the list replaces the one before; absent = crew left alone. Crew and teams can change while IN_PROGRESS, not once COMPLETED. Pushes: New job to who joins, Job removed to who leaves, Job changed / cancelled to all. The job answer adds `crew[]` and `teamIds`. `GET /v1/workers?include=shared` adds `shared[]` (`id, name, employeeNo, companyId, companyName`). A call without these fields behaves as before.
  - `PATCH /v1/jobs/by-ref/:ref` | `/v1/jobs/:id` — any create field + `status: IN_PROGRESS|COMPLETED`, `at?`; forward only (409 `INVALID_TRANSITION`); once started worker/site/time fixed (409 `JOB_STARTED`), completed/cancelled → 409 `JOB_CLOSED`; title/notes/link/`deliveryEnabled` still editable (:360-434).
  - `POST /v1/jobs/by-ref/:ref/cancel`, `DELETE /v1/jobs/by-ref/:ref`, `POST /v1/jobs/:id/cancel` — soft cancel `{reason?, notify}`; repeat = no-op; completed → 409 (:437-454).
  - `GET /v1/jobs/by-ref/:ref`, `GET /v1/jobs/:id` — **AIMS-created jobs only** (`loadJob` filters `externalSource != null`, :262).
  - `GET /v1/jobs?updatedSince&status&limit≤500` — **AIMS-created jobs only**, ordered `updatedAt,id`, `nextUpdatedSince` (inclusive → dedupe by id) (:542-565).
  - `GET /v1/jobs/calendar?from&to` (≤62 days, 400 `RANGE_TOO_LONG`) — **every** job of the company: `source` siteclock|external, externalRef/Status, window (startAt/endAt UTC or date+startTime+expectedMinutes (60 default) or allDay), site, team labels, crew with first arrive/last leave from job punches, `progress` NOT_STARTED|IN_PROGRESS|DONE, `cancelledAt`, `webUrl` (`<WEB_BASE_URL>/#/jobs`). **No `updatedAt`, no `deliveryEnabled`** (:462-538).
- Job response shape: `presentApiJob` (`backend/src/lib/externalJobs.ts:49-79`); API `notes` = `Job.description`, `worker` = first JobCrew.
- AIMS ids stored: `Job.externalRef` (format seen: `aims-delivery:<id>[:n]`, `docs/do-into-siteclock-discovery.md:116`), `Job.externalSource`, `Job.externalUrl` (DO link), `Site.externalRef`. **No separate order/DO/org id columns** — AIMS must encode in `externalRef`/`externalUrl`.
- Worker pushes on create / worker-site-time-wording change / cancel (when `notify`), plus 15 min before a still-SCHEDULED job (`backend/src/jobs/reminders.ts:97-122`); none for status/link/delivery changes (:419-429).
- AIMS job also makes its site the worker's clock-in place (no NOT_ASSIGNED flag).

### SiteClock → AIMS (what is sent today)
- **Webhooks: none.** Outbox + HMAC signing (`X-SiteClock-Signature: t=,v1=HMAC-SHA256(secret, t.body)`, `X-SiteClock-Event-Id`) + retry 1m/5m/30m/2h/12h + every-minute sender exist (`backend/src/lib/webhooks.ts`, `jobs/autoclose.ts:93-99`) but **`enqueueEvent` has no callers** in `backend/src`; events were removed in `b75fd31` (schema comment 1020, `test/v1.ts:306` asserts nothing is queued).
- **Job photos** → `{aimsBaseUrl}/integrations/siteclock/photos` with `Authorization: Bearer <AIMS inbound key>` (`backend/src/lib/jobPhotos.ts`):
  - `POST` multipart (externalRef, siteclockPhotoId, tag, note, takenAt, workerSiteclockUserId, workerName, file), `Idempotency-Key: <JobPhoto.id>` → `{photoId}`; `GET /:id/url?size=` → presigned URL; `DELETE /:id`.
  - Retries 1m…hourly up to 24 h on network/5xx/408/429; other 4xx → FAILED (409 = job cancelled in AIMS); admins pushed on FAILED (:160-238). SiteClock's own jobs → 404 `PHOTOS_OFF`.
- **Delivery relay** → `{aimsBaseUrl}/integrations/siteclock/delivery/jobs/<externalRef>/<step>` (`backend/src/lib/aimsDelivery.ts`, `backend/src/modules/jobs/jobDelivery.router.ts`):
  - Headers: `Authorization: Bearer <inbound key>`, `X-SiteClock-Worker-Id`, app's `Idempotency-Key`, `User-Agent: SiteClock-Delivery/1`; 30 s timeout (90 s PDFs); AIMS response passed through; 502 `AIMS_UNREACHABLE`, 504 on timeout; no server-side retry.
  - Allow-listed steps (`aimsDelivery.ts:23-51`): run GET; `claim-return`, `start`, `not-finished`, `open`, `end`; item `start|end|skip|unskip`; unit `start|deliver|collect-return`; `items/photos`, `ack-all`, `handoff` (+ `current|status`); `finalize`, `finalize-return`; DO `view|pdf`; service `reports` (create/get/pdf/draft/complete/sign); `pending-sign`; `uploads/image` (≤15 MB).
  - Gate: worker on crew, `externalSource=="aims"`, `deliveryEnabled`, not cancelled, AIMS link set → else 404 / 409 `DELIVERY_OFF` (`jobDelivery.router.ts:56-74`). AIMS re-checks org flag + member + field role.
- API keys in the dashboard (2026-11-26, `58a5d94`): platform admin > Companies shows each **Company ID** and an **API keys** button (list by prefix, create with the key shown once, switch off/on). Routes `GET/POST /companies/:id/api-keys`, `PATCH /companies/:id/api-keys/:keyId` (SUPERADMIN only; audit `API_CLIENT_CREATE|ENABLE|DISABLE`). Same `ApiClient` rows as `scripts/issue-api-key.ts`. The AIMS way back (photos) is still `set-aims-link.ts` only.
- AIMS link setup: `backend/src/scripts/set-aims-link.ts` sets `aimsBaseUrl` + encrypted inbound key (AIMS key prefix `aims_sck_`), audit `API_CLIENT_AIMS_LINK`; `--clear` turns photos + delivery off.
- Clerk: shared instance; `POST /auth/aims-link` gives office users a one-tap sign-in into AIMS (`auth.router.ts:343-355`); AIMS's own Clerk tokens are **not** accepted by SiteClock API (`authorizedParties` = SiteClock origins, `backend/src/lib/clerk.ts:5-18`).
- **Jobs created in SiteClock never reach AIMS by push.** AIMS can only read them via `GET /v1/jobs/calendar` (`source:"siteclock"`, `externalRef` null). They're excluded from `/v1/jobs`, by-id, `updatedSince`, photos and delivery.

### APIs AIMS can call today
- Jobs by company + date range: `GET /v1/jobs/calendar` (all jobs, incl. crew arrive/leave). Job by id/ref and change feed: AIMS jobs only. Workers/teams: yes. Sites: write only (no list).
- **Timesheets / time entries / punches / payroll: no `/v1` endpoint.** Only user-session routes (`GET /timesheets`, `/timesheets/export`, `/reports/attendance-export`, `/payroll/export`) that need a SiteClock JWT or SiteClock-origin Clerk token.
- Stable ids: all cuid, stable. `updatedAt`: Job only. SiteClock jobs are hard-deleted, so a poller can't see deletes except by absence in the calendar window. Punches probably don't bump `Job.updatedAt` (?).

### Delivery flow & AIMS manual order flow
- `enableSiteClockDeliveries` is an **AIMS org flag**; the name appears in SiteClock only in `docs/do-into-siteclock-discovery.md`. SiteClock's equivalent is per-job `Job.deliveryEnabled` set by AIMS on POST/PATCH.
- `/jobs/mine` only reports `deliveryEnabled` true when stored flag is on **and** the company's AIMS link is set (`jobs.router.ts:85-87`); `/v1` returns raw stored value.
- All run/item/DO/report/signature state lives in AIMS. SiteClock checks access and relays.
- WCT (S) runs AIMS's manual (dashboard-only) order flow (`enableManualOrderFlow`): "No SiteClock sync, field app hides WCT order jobs"; `enableSiteClockDeliveries` still ON for WCT but manual flow overrides (`WCT_STATE.md:25,35`). So today WCT order jobs are **not** sent to SiteClock, and the SiteClock Delivery flow is effectively unused for WCT (?confirm on AIMS side).

### Known bugs / TODOs / half-built
- No TODO/FIXME/HACK markers in integration code.
- Idle webhook sender (URL + secret issued, nothing sent).
- Discovery doc plans not built: `Job.externalApp` JSON, `POST /jobs/:id/aims-session`, WebView (delivery became a native relay) (`docs/do-into-siteclock-discovery.md:153-157,270`).
- `updatedSince` excludes SiteClock jobs; calendar has no `updatedAt` → no clean incremental sync of SiteClock jobs.
- Linked companies: `/v1` `resolveWorker` accepts only the key company's own workers (`v1.router.ts:222-225`); delivery check matches job company to worker company (`jobDelivery.router.ts:58-60`) → a shared worker on a linked company's AIMS job would get 404 (?).
- `source === "aims"` hard-coded in photos and delivery (`jobPhotos.ts:70`, `jobDelivery.router.ts:69,112`); company-wide delivery endpoints use the oldest active aims client (`:109-117`).
- No rate limit on `/v1`; no key management UI.
- 6 commits since v1.0.16 not yet in a store build; 1.0.16 store status unclear.

---

## 5. Integration options

### SiteClock-created jobs as AIMS "misc jobs" (no order)
- **A. AIMS polls (recommended to start)**
  - Use `GET /v1/jobs/calendar?from&to` (already live, already used by AIMS jobs calendar per `WCT_STATE.md:59`). Poll a rolling window (e.g. −7…+30 days) every few minutes; upsert by SiteClock `id` where `source=="siteclock"`; treat jobs missing from the window as deleted (they're hard-deleted).
  - SiteClock side (small): add `updatedAt` (and maybe `createdAt`) to calendar rows (`v1.router.ts:462-538`); optionally let `GET /v1/jobs?updatedSince` include SiteClock jobs behind a param (`v1.router.ts:542-565`, today filtered to `externalSource != null`), or a tombstone list for deletes.
  - AIMS side (small–medium): poller + misc-job model (no order), mapping crew → `OrganizationMemberProfile.siteclockUserId`, site → AIMS customer/location (none in SiteClock), WCT-group gate.
  - Size: **small** (SiteClock) + **small–medium** (AIMS). Pros: no new outbound infra, no retry/ordering issues, works with key as-is. Cons: latency = poll interval; delete detection by absence.
- **B. SiteClock webhook**
  - Re-use the idle outbox (`backend/src/lib/webhooks.ts`): `enqueueEvent` on job create/update/delete in `lib/jobs.ts` (createJob/updateJob/deleteJob), `jobs-plan.ts`, roster edits, import, assistant — many write paths to cover. Payload = calendar row shape. Only for companies whose ApiClient has `webhookUrl`.
  - AIMS side: signed endpoint (verify HMAC `t.body`, dedupe on event id), still needs a backfill/reconcile (poll) for missed events.
  - Size: **medium** (SiteClock) + **small–medium** (AIMS). Pros: near-real-time, clean deletes. Cons: more write paths to hook, cron sender on single instance, still needs reconcile.
- Recommendation: **A now** (calendar + `updatedAt`), add B later only if latency matters.
- Open: should misc jobs be editable in AIMS (would need SiteClock to accept AIMS edits on its own jobs — today the API refuses), and which AIMS org (WCT (S) only, or each WCT entity with its own SiteClock company + key).

### Longer term (options, not decided)
- **Single login**: shared Clerk already; web satellite login + app switcher exist (behind flags). Blockers: Flutter app has no Clerk; SiteClock API rejects AIMS-origin Clerk tokens; one phone = several SiteClock accounts vs one Clerk user; `clerk-prod-relink` branch not merged.
- **Shared customers/sites**: `Site.externalRef` + `PUT /v1/sites/by-ref` exist; SiteClock has no customer entity. Need AIMS→SiteClock site sync for all customer locations (not just per job), and a list endpoint.
- **Timesheets into AIMS payroll/costing**: needs new `/v1` read endpoints for TimeEntry/Punch (approved entries, `workedFor` split, minutes, job punches per job) + `updatedAt` on TimeEntry (only `createdAt`, approvals/edits mutate it). Decide where payroll lives (SiteClock has payroll; AIMS GL). Blocker: per-company scoping vs linked-company `workedFor`.
- **Job costing per AIMS job**: calendar already returns crew arrive/leave/onJobMinutes per job; could be added to `GET /v1/jobs/:id`.
- **SRs/photos from the app into AIMS**: photos already go to AIMS (AIMS jobs only); service reports already relayed in Delivery flow. Extending to SiteClock-own/misc jobs needs an AIMS-side record to attach to (misc job id) and lifting the `externalSource=="aims"` gates.
- **Status back to AIMS**: webhooks were built then removed by decision (`b75fd31`: AIMS jobs are schedule/assignment only). Re-enabling needs a decision on what counts as "started/finished".
- **PTW in the app**: not present; would be new on both sides.
- Blockers common to all: app store signing keys; single Railway instance assumptions; no `/v1` rate limit; WCT entity ↔ SiteClock company mapping unknown in repo.

---

## 6. Watch-outs

- **Multi-company isolation is per query** (`req.companyId` filter in every handler; `assertSameCompany()`, `backend/src/lib/auth.ts:196-200`); no Prisma middleware (`backend/src/lib/prisma.ts`). Any new `/v1` handler that forgets `companyId` leaks across tenants. API keys are per company: WCT (S), Racking, BC Air would each need their own SiteClock company + key.
- **Linked companies cross tenants on purpose** (`backend/src/lib/links.ts`, `punches.service`, `jobs.router` `checkCrewIds`, `/links/*`); `/jobs/mine` shows linked companies' jobs. New AIMS features must decide how shared workers behave.
- **Never change shared behaviour without a gate**: `/v1` is used only by AIMS-linked companies, but `lib/jobs.ts`, `/jobs/mine`, punches, crons are shared by every SiteClock company. Gate new behaviour on ApiClient presence/flag, not company id.
- **Rate limits**: only in-memory OTP/signup throttles (`backend/src/lib/throttle.ts`); **none on `/v1`** — AIMS pollers must self-limit (calendar ≤62 days per call; `/v1/jobs` ≤500 per page).
- **Single-instance assumptions**: in-memory throttle, in-process crons (reminder dedupe in memory, `jobs/autoclose.ts:77,93`), socket.io without Redis, local ephemeral uploads, migrations on boot. Scaling Railway to >1 replica breaks these.
- **Times**: `/v1` requires ISO with offset (bare local → 400); jobs store `date`/`startTime` in site zone plus UTC `startAt/endAt`; Asia/Singapore fallback hard-coded (`lib/externalJobs.ts`, `jobs/reminders.ts`); crons in UTC.
- **Two "status" meanings**: `/jobs/mine` `status` = SiteClock arrive/leave; AIMS status = `externalStatus`. Calendar: `progress` vs `externalStatus`.
- **Hard delete** of SiteClock jobs (`backend/src/lib/jobs.ts:394-398`); punches keep `jobId` set null.
- **`deliveryEnabled` can change any time** and isn't pushed to the worker; app sees it only on next `/jobs/mine`.
- **Fragile**: face-api WASM model loading via `process.cwd()` (`backend/src/lib/face.ts:20-26`); Android build silently debug-signs without `key.properties`; AIMS-side photo/delivery outages surface to workers as 502/FAILED.
- Test data: AIMS rule is TEST Client only on prod; SiteClock has no equivalent test company noted in repo (?). Elroy has a worker account in WCT's SiteClock company (`WCT_STATE.md:7`).

---

## Summary
1. Works today: AIMS → SiteClock jobs via `/v1` (create/patch/cancel/status, idempotent on `externalRef`), sites by ref, workers/teams read, all-jobs calendar (incl. SiteClock's own jobs + crew arrive/leave).
2. Works today: SiteClock → AIMS job photos and native Delivery/DO/service-report flow, both relayed with the AIMS inbound key, AIMS jobs only, WCT only.
3. Works today: shared Clerk; web "Sign in with AIMS" + AIMS app switcher (flag-gated); app is phone OTP only.
4. Not sent today: no webhooks/events (outbox idle); SiteClock-own jobs never pushed; no timesheet/punch/payroll API for AIMS.
5. Needs building (small): `updatedAt` on calendar rows / SiteClock jobs in `updatedSince`, plus an AIMS poller for misc jobs.
6. Needs building (medium+): timesheets API, webhooks for SiteClock jobs, site/customer sync, `/v1` rate limit + key management UI.
7. Blocker: app store signing keys (1.0.16/1.0.17 not shipped from this Mac); 6 commits since v1.0.16 unreleased in stores.
8. Open: which SiteClock company is "WCT" (WCT (S)?), and do WCT Racking / BC Air need their own SiteClock companies + keys?
9. Open: with WCT on AIMS manual flow (no SiteClock sync), is SiteClock Delivery for WCT parked — keep `deliveryEnabled`/AIMS link on or clear it?
10. Open: should misc jobs be read-only mirrors in AIMS or editable both ways; should AIMS ever get job status/attendance back (webhooks were removed on purpose in `b75fd31`)?
