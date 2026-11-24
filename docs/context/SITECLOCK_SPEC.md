# SiteClock — rebuild spec (for recreating every function as AIMS modules)

- Source: `~/Desktop/siteclock`, main @ **`62b7d9d`** (2026-11-14, "Linked companies share workers"). `git fetch` + `pull --ff-only` on 2026-11-18: already up to date; no commits since. Untracked `docs/design-reference/`, `docs/do-clone-compare/` only.
- Written 2026-11-18, read-only (no code changes, no commits, no prod/DB access → **no data counts available**; counts must come from a read-only prod query later).
- Companion: `SITECLOCK.md` (integration reference, AIMS ↔ SiteClock). This file does not repeat it; §7 lists only the gaps.
- Paths are relative to the repo root unless a section header says otherwise (§4 and §6 use paths relative to `backend/src/`; `prisma/…` = `backend/prisma/schema.prisma`). "(?)" = not verified.
- Sections 2–3 and 4/6 were read by two parallel readers (app+web, backend) and spot-checked; findings marked "(code reading, not tested)" were not run.

Legend for §1: **W** worker, **S** supervisor (role with some permissions), **O** office/admin (company admin or role with the permission), **P** platform admin (SUPERADMIN), **API** machine client (AIMS). Platform: **app** (Flutter Android/iOS), **web** (React office), **API**. Status: **live**, **half** (half-built / partly wired), **hidden** (flag- or server-gated, legacy, or not reachable from UI), **dead** (in code, unused).

---

## 1. Feature inventory (master list)

### 1.1 Auth & accounts
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 1 | Phone + 6-digit OTP login (WhatsApp; console in dev) → 30-day JWT | W S O P | app, web | live | `backend/src/modules/auth/auth.router.ts`, `backend/src/lib/otp.ts`, `app/lib/screens/login_screen.dart`, `web/src/pages/Login.tsx` |
| 2 | Web login code shown in the app (`POST /auth/app-code`) / code by push to app | S O | app→web | live | `auth.router.ts`, `app/lib/screens/profile_screen.dart` |
| 3 | Device binding, "move to this phone", rebind via OTP | W S O | app | live | `auth.router.ts:99-226`, `app/lib/services/device_service.dart` |
| 4 | One phone, account per company; switch company | W S O | app, web | live (app 1.0.17 unreleased) | `backend/src/lib/accounts.ts`, `POST /auth/switch`, `profile_screen.dart:186`, web sidebar switcher |
| 5 | Sign in with AIMS account (Clerk satellite), AIMS app switcher | O | web | hidden (flags `VITE_CLERK_*`, `CLERK_ENABLED`) | `web/src/lib/clerk.tsx`, `backend/src/lib/clerk*.ts`, `web/src/components/AppSwitcher.tsx` |
| 6 | Clerk webhook sync (user/phone), write-through metadata | P | API | hidden (`CLERK_WEBHOOK_APPLY`, `CLERK_WRITE_THROUGH`) | `backend/src/modules/webhooks/clerk.webhook.ts`, `backend/src/lib/clerkAdmin.ts` |
| 7 | Terms acceptance gate (company terms text + version, re-accept) | W S O | app (gate), web (edit) | live | `app/lib/screens/terms_screen.dart`, `web/src/pages/Terms.tsx`, `backend/src/modules/terms` |
| 8 | Delete my account (deactivates all accounts of the phone) | W | app | live | `DELETE /auth/account` |
| 9 | Store-review login (fixed OTP for a review phone) | — | app | hidden (`REVIEW_PHONE`/`REVIEW_OTP`) | `backend/src/lib/otp.ts` (?) |
| 10 | Forced/soft app update prompt | W S O | app | live | `backend/src/app.ts:47-71`, `app/lib/services/update_check.dart` |

### 1.2 Companies, linked companies, platform
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 11 | Company self-signup (public, OTP) | O | web, app | live (gated `SELF_SIGNUP_ENABLED`) | `backend/src/modules/signup`, `web/src/pages/Signup.tsx`, `app/lib/screens/company_signup_screen.dart` |
| 12 | Platform: companies CRUD, stats, add company admins, delete company | P | web | live | `backend/src/modules/companies/companies.router.ts`, `web/src/pages/Companies.tsx` |
| 13 | Platform: all users, edit, reset device; superadmins | P | web | live | `web/src/pages/PlatformUsers.tsx`, `PlatformOverview.tsx` |
| 14 | "View as" a company (8 h admin token) | P | web | live | `backend/src/lib/auth.ts:43-44`, `web/src/App.tsx:110` |
| 15 | Link two companies; share workers NONE/ALL/SELECTED; Shared workers page (hours each way) | P, O | web | live (new, 62b7d9d) | `backend/src/lib/links.ts`, `backend/src/modules/links`, `web/src/pages/SharedWorkers.tsx` |

### 1.3 Users, roles, permissions
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 16 | Company roles = permission sets with scope COMPANY/ASSIGNED; built-in Admin/Supervisor/Worker | O | web | live | `backend/src/lib/permissions.ts`, `backend/src/modules/roles`, `web/src/pages/Roles.tsx` |
| 17 | Legacy tier (`User.role`) + legacy supervisor switches mirrored into Supervisor role | — | app (old Rules screen) | hidden/legacy | `rules.router.ts:15-19,138-139`, `app/lib/screens/admin/rules_screen.dart` |

### 1.4 Workers
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 18 | Worker CRUD (name, phone, employee no, role, sites, supervisor sites, active, trades) | O | web, app | live | `backend/src/modules/workers/workers.router.ts`, `web/src/pages/Workers.tsx`, `app/lib/screens/admin/workers_screen.dart` |
| 19 | Per-worker rule overrides: job clocking, off-site, selfie, base clocking, pay follows crew + margins, attendance exempt, payslip visible, shared with linked | O | web | live | `Workers.tsx`, `workers.router.ts:140-160` |
| 20 | Invite links + join requests (worker self-registration with photo) → approve/reject | O / W | web, app | live | `backend/src/modules/invites`, `web/src/pages/Join.tsx`, `app/lib/screens/admin/invites_screen.dart` |
| 21 | Photo on record: request new photo, approve/reject, photo at first login | O / W | web, app | live | `backend/src/modules/photos/photos.router.ts`, `backend/src/lib/photos.ts`, `app/lib/widgets/record_photo.dart` |
| 22 | Reset device, change phone | O | web, app | live | `POST /workers/:id/reset-device` |

### 1.5 Teams
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 23 | Teams with dated memberships (history), team supervisors, archive | O | web, app | live | `backend/src/modules/teams`, `web/src/pages/Teams.tsx`, `app/lib/screens/admin/teams_screen.dart` |
| 24 | Trades + manning presets + needed headcount per trade on jobs | O | web | live | `backend/src/modules/rosters/rosters.router.ts`, `Job`/`JobNeed` |

### 1.6 Sites
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 25 | Sites CRUD with geocode (OneMap/OSM), map pin, geofence radius (default 150 m) + max GPS accuracy (default 50 m), timezone, auto-close hours (default 14) | O | web, app | live | `backend/src/modules/sites`, `backend/src/lib/geocode.ts`, `web/src/pages/Sites.tsx` |
| 26 | Site kinds: PERMANENT / JOB (auto, hidden) / BASE (office/yard/dorm, `allWorkers`) | O | web | live (BASE new, 2d5fffe; app can't set kind) | `prisma/schema.prisma:299-343,908` |
| 27 | Site assignments (+ site supervisor flag) | O | web, app | live | `SiteAssignment` |
| 28 | Live site presence (who is on site, map) | S O | app, web | live | `web/src/pages/LiveSite.tsx`, `app/lib/screens/supervisor/live_screen.dart`, socket `site:presence` |

### 1.7 Jobs & scheduling
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 29 | Job create/edit/delete (date, start time, duration, all-day, place → auto JOB site, crew = teams + individuals − exceptions, clocking OFF/ARRIVE/ARRIVE_LEAVE, instructions) | O (S with `jobs.manage`) | web, app | live | `backend/src/lib/jobs.ts`, `backend/src/modules/jobs/jobs.router.ts`, `web/src/pages/Roster.tsx`, `app/lib/screens/admin/job_edit_screen.dart` |
| 30 | Several jobs for one team at once | O | web, app | live | `Roster.tsx:906-926`, `app/lib/screens/admin/multi_job_screen.dart` |
| 31 | Copy previous day / week | O | web | live | `POST /rosters/copy`, `/rosters/copy-week` |
| 32 | Publish day (push crews) / per-job notify | O | web | live (Publish gated by `notifyRoster`) | `/rosters/publish`, `/jobs/notify` |
| 33 | Day notes | O / W reads | web, app | live | `DayNote`, `PUT /jobs/notes/:date` |
| 34 | Spreadsheet import (template, preview, add/replace) | O | web | live | `web/src/components/ImportSchedule.tsx`, `backend/src/modules/jobs/jobs-import.ts`, `backend/src/lib/jobs-plan.ts` |
| 35 | Job QR sign-in (show/share/replace code) | O / W | web, app | live | `POST /jobs/:id/qr`, `app/lib/widgets/job_qr_sheet.dart`, `app/lib/screens/worker/qr_scan_screen.dart` |
| 36 | Jobs views: Plan / Attendance / Week; worker 2-week strip | O / W | web, app | live | `Roster.tsx`, `app/lib/screens/worker/jobs_screen.dart` |
| 37 | Recurring jobs | — | — | **does not exist** (only copy day/week + import; shift templates recur but are working hours, not jobs) | grep recur/rrule: none |
| 38 | Working hours: shift templates (days of week, sites, start/end, grace, early mode) + assignments (date ranges) + exceptions | O | web, app | live | `backend/src/modules/schedules`, `web/src/pages/Schedules.tsx`, `app/lib/screens/admin/schedules_screen.dart` |
| 39 | Old Roster tables (Roster/RosterRequirement/RosterEntry) | — | — | dead (rosters became Jobs) | `prisma/schema.prisma:820+` |
| 40 | AIMS (external) jobs: read-only in SiteClock, status by AIMS, View DO link | API / W | API, app | live | `backend/src/lib/externalJobs.ts`, `backend/src/modules/v1` (see SITECLOCK.md) |

### 1.8 Clock in/out & punches
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 41 | Day clock in/out with GPS, geofence, accuracy, auto site pick | W S | app | live | `app/lib/screens/worker/home_screen.dart`, `backend/src/modules/punches/punches.service.ts` |
| 42 | Job clocking (arrive / leave per job; auto-leave on next job; end day) | W S | app | live | `app/lib/services/job_clock.dart`, `backend/src/lib/jobs.ts:271-290` |
| 43 | Selfie policy SMART/ALWAYS, per-worker override; on-device face detect + server face match | W | app | live (face mismatch flag never set — dead) | `app/lib/services/face_check.dart`, `backend/src/lib/face.ts` |
| 44 | Off-site handling REVIEW / MARK / BLOCK (company + worker) | W / S | app | live | `punches.service.ts` |
| 45 | Base sites clocking rule | W | app | live (new) | `punches.service.ts:164-174` |
| 46 | Linked-company site clocking (shared worker) | W | app | live (new) | `punches.service.ts`, `backend/src/lib/links.ts` |
| 47 | QR required at job | W | app | live | `punches.service.ts:130` |
| 48 | Group punches (crew clocked by one person) | W/S | app | live (gated `groupJobClocking`) | `app/lib/widgets/group_clock_sheet.dart`, `POST /punches/group` |
| 49 | Offline punch queue (back-dated ≤48 h, flagged if >60 min late) | W | app | live (Clock tab only; refused punches dropped silently) | `app/lib/services/punch_queue.dart`, `punches.service.ts:93,133-145,224` |
| 50 | Flags (13 reasons) → review: approve/reject punch | S O | app, web | live | `web/src/pages/Flagged.tsx`, `app/lib/screens/supervisor/flagged_screen.dart`, `punches.service.ts:586-729` |
| 51 | Fraud policy BLOCK for mocked/rooted | P | — | hidden (superadmin-only setting) | `Company.fraudPolicy` |
| 52 | Auto-close stale entries + missed clock-out rule FULL_SHIFT/SHIFT_END/NO_HOURS | — | cron | live | `backend/src/jobs/autoclose.ts`, `backend/src/lib/missedClockOut.ts` |
| 53 | Reminders: shift starting soon, still clocked in?, job in 15 min (AIMS), flagged punches daily | W / S | push | live | `backend/src/jobs/reminders.ts`, `autoclose.ts` |
| 54 | Missed-entry request by worker | W → S | app | live | `POST /timesheets/missed-request`, `app/lib/screens/worker/history_screen.dart` |

### 1.9 Job progress, photos, delivery
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 55 | Job progress from crew arrive/leave (NOT_STARTED / IN_PROGRESS / DONE); no separate start/finish for own jobs | W / O | app, web, API | live | `app/lib/widgets/today_jobs_card.dart`, `/v1/jobs/calendar` |
| 56 | Job photos → AIMS (UNSORTED, queue, retry, delete) | W / O | app, web strip | live for AIMS-linked jobs only | `backend/src/lib/jobPhotos.ts`, `app/lib/widgets/job_photos.dart`, `web/src/components/JobPhotos.tsx` |
| 57 | Delivery / DO / service-report flow (relay to AIMS): open, items, photos, sign-off (customer or link), DO PDF, not-finished, pending sign, clock-out guard | W | app | live for AIMS jobs with `deliveryEnabled`; WCT on AIMS manual flow (unused?) | `app/lib/delivery/*`, `backend/src/lib/aimsDelivery.ts`, `backend/src/modules/jobs/jobDelivery.router.ts` |
| 58 | PTW | — | — | **does not exist** | — |

### 1.10 Leave
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 59 | Leave types (paid, default days, requires document, archive) | O | web | live | `backend/src/modules/leave/leave.router.ts`, `web/src/pages/Leave.tsx` |
| 60 | Entitlements/balances per worker | O / W | web, app | live | `LeaveEntitlement`, `/leave/balances/mine` |
| 61 | Request leave with documents; cancel | W | app | live (no push/audit on new request) | `app/lib/screens/worker/leave_screen.dart` |
| 62 | Approve/reject, record leave for a worker, calendar | S O | web, app | live | `Leave.tsx`, `app/lib/screens/admin/leave_admin_screen.dart` |

### 1.11 Timesheets & paid hours
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 63 | Time entry computation (gross, breaks, OT, late/early, NLB) | — | API | live | `backend/src/modules/timesheets/timesheets.service.ts:30-146` |
| 64 | Timesheets list, approve/reject, bulk approve (skips needsReview silently), edit times, reopen, delete, entry detail | S O | web, app | live | `web/src/pages/Timesheets.tsx`, `app/lib/screens/admin/timesheets_screen.dart`, `entry_detail_screen.dart` |
| 65 | Paid hours follow the crew's jobs (margins, needsReview, crewNote) | O | web | live (new, 8b06a0d) | `timesheets.service.ts:199-246` |
| 66 | workedFor split for shared workers | O | web | live (new) | `timesheets.service.ts:167-197` |
| 67 | Worker history (my entries) | W | app | live | `GET /timesheets/mine` |

### 1.12 Payroll
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 68 | Pay profiles (MONTHLY/DAILY/HOURLY, allowances, premium mode, rest days, overrides), public holidays | O | web | live | `backend/src/modules/payroll/payroll.service.ts`, `web/src/pages/Payroll.tsx` |
| 69 | Monthly payroll table + export CSV/XLSX | O | web | live (no CPF, no proration — see §9) | `GET /payroll/export` |
| 70 | Worker payslip (month to date) | W | app | live (gated `payslipVisible`) | `app/lib/screens/worker/payslip_screen.dart`, `GET /payroll/me` |

### 1.13 Notifications
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 71 | FCM push (~25 titles: jobs, roster, reminders, approvals, leave, photos, login codes) | W S O | app | live | `backend/src/lib/push.ts`, list in §6.27 |
| 72 | WhatsApp: OTP + registration approved/rejected templates | W | WhatsApp | live | `backend/src/lib/whatsapp.ts` |
| 73 | In-app realtime (socket.io: punch flagged/reviewed, site presence) | S O | app, web | live | `backend/src/realtime/socket.ts` |
| 74 | Email | — | — | **none** | — |

### 1.14 Assistant, reports, admin tools
| # | Feature | Who | Platform | Status | Where |
|---|---|---|---|---|---|
| 75 | AI assistant chat (Claude tool-use; confirm before writes; plan jobs from pasted WhatsApp schedule) | S O | web, app | live (permission gaps, §9) | `backend/src/modules/assistant/*`, `web/src/components/AssistantChat.tsx`, `app/lib/screens/assistant_chat_screen.dart` |
| 76 | Reports: attendance XLSX (≤92 days), attendance summary, fraud summary | S O | web, app (export) | live | `backend/src/modules/reports`, `web/src/pages/Reports.tsx`, `app/lib/widgets/attendance_export.dart` |
| 77 | Timesheet export CSV/XLSX (≤10k rows) | O | web | live | `GET /timesheets/export` |
| 78 | Rules page (OT, breaks, punch rules, crew margins, share workers…) | O | web (most), app (subset) | live | `web/src/pages/Rules.tsx`, `backend/src/modules/rules/rules.router.ts` |
| 79 | Overview dashboard (flags, presence, schedule exceptions) | S O | web, app | live | `web/src/pages/Overview.tsx`, `app/lib/screens/admin/overview_screen.dart` |
| 80 | In-app guides | all | web, app | live | `web/src/components/Guide.tsx`, `app/lib/widgets/app_guide.dart` |
| 81 | Audit log (write only; no read API/UI) | — | API | half | `backend/src/lib/audit.ts` |
| 82 | Machine API `/v1` + API keys (CLI only) + AIMS link script | API / P | API, CLI | live | `backend/src/modules/v1`, `backend/src/scripts/*` |
| 83 | Outbound webhooks (outbox, signing, retry) | — | API | dead/idle | `backend/src/lib/webhooks.ts` |
| 84 | Clerk backfill / prod relink scripts | P | CLI | hidden (`clerk-prod-relink` branch unmerged) | `backend/src/scripts/clerk-backfill.ts` |

---
## 2. Screens

### 2a. Worker / supervisor / admin app (Flutter, `app/lib`)

#### 2a.0 Root, shells and role tiers — `app/lib/main.dart`, `app/lib/services/auth_state.dart`

- `main()` (`main.dart:33`): init push (`PushService.init`), lock portrait, `ChangeNotifierProvider(AuthState()..init())`. Theme light/dark follows system (`theme.dart`).
- `AuthState.init()` → loads stored token → `GET /auth/me` → `user` (incl. `permissions`, `scope`, `companyRole`, `company`, `accounts`, `siteAssignments`, `companySites`, `photo`, `payslipVisible`, `offSiteClocking`, …). On failure logs out silently (`auth_state.dart:113-123`). After `/auth/me` registers FCM token (`POST /auth/fcm-token`, `push_service.dart:52`).
- `RootScreen` (`main.dart:62-78`):
  - loading → spinner; `user == null` → `LoginScreen`.
  - Tier from permissions: `isAdmin` (role `COMPANY_ADMIN`) → `AdminShell`; `isStaff` (≥1 permission) → `SupervisorShell`; else `WorkerShell`. Each wrapped in `TermsGate`.
  - `AuthState.can(perm, [or])`: checks `user.permissions`; older server (no permissions) falls back to legacy supervisor set (`auth_state.dart:20-41`).
  - `scoped` = role scope `ASSIGNED` (only own sites/teams).
- Each shell on first frame: `UpdateCheck.run` then `AppGuide.showIfFirstTime` (per user+role, prefs key `guide_v<N>_<userId>_<role>` — `widgets/app_guide.dart:347`).
- **WorkerShell** (`main.dart:80-138`): AppBar logo + History icon (pushes `HistoryScreen`). Bottom nav: Jobs (`JobsScreen`), **Clock (default)** (`WorkerHomeScreen`), Profile (`ProfileScreen`).
- **SupervisorShell** (`main.dart:140-247`): tabs filtered by permission: Jobs (`jobs.view` → `SupervisorJobsTab`), Live (`live.view`), Flagged (`flagged.view`, live count badge), Clock (always), Profile (always). Default tab = Live if present else Clock. Rebuilds tab row live if role permissions change. AppBar title suffix = role name. History action. FAB "AI assistant" if `assistant.use` (pushes `AssistantChatScreen`; lifted 72px on Jobs tab).
- **AdminShell** (`main.dart:249-355`): tabs Overview, Timesheets, Clock, Jobs (`AdminJobsTab`), More. AppBar flag icon with live pending-count badge → pushes `FlaggedScreen`. FAB assistant always.
- **More** list (`_AdminMoreScreen`, `main.dart:357-428`): Profile · Sites · Workers · Teams · Join requests & invites · Rules · Leave · Reports; footer note "CSV/XLSX timesheet export is available on the web dashboard."
- `FlagCountIcon` (`main.dart:452-482`): `GET /punches/flagged` on mount and on socket events `punch:flagged` / `punch:reviewed`.

#### 2a.1 LoginScreen — `app/lib/screens/login_screen.dart`
- Who: anyone signed out.
- Purpose: phone + OTP login, device binding.
- Fields:

| Field | Type | Req | Validation/default |
|---|---|---|---|
| Phone | `PhoneField` (country dropdown + number; emits E.164) — `widgets/phone_field.dart:77,106` | yes | hint "9123 4567" |
| 6-digit code | text | yes (after send) | trimmed |

- Actions: Send code → `POST /auth/request-otp {phone}`; response may include `devCode` (shown grey "Dev code: …" — dev servers only). Verify → `POST /auth/verify-otp {phone, code, deviceId}` with header `x-bind-flow: photo` (`login_screen.dart:43-45`). "Change phone number" back. Secondary: "Running a company that isn't on SiteClock yet?" → `CompanySignupScreen`.
- Device bind (server `backend/src/modules/auth/auth.router.ts:116-138`): first login on a device binds silently; account bound to another phone → 409 with `bindTicket` → dialog **"Move to this phone?"** ("…Your first clock-in from this phone will ask for a quick selfie…") → Move here → `POST /auth/bind-device {ticket, deviceId}` → token. Without the header the server just says `DEVICE_MISMATCH`.
- Errors: server message or "Network error"; "Could not finish sign-in. Request a new code and try again."
- Multi-account: server lands on the account bound to this device else the oldest; `accounts` returned.

#### 2a.2 CompanySignupScreen — `app/lib/screens/company_signup_screen.dart`
- Who: signed out. Steps `gate → phone → code → details` (+ `employee` dead-end page).
- Gate: cards "I'm an owner or manager" / "I'm an employee" (employee page → "Back to log in"). Owner must tick "I understand this creates a new company account that I will administer — not an employee account." → Continue.
- Phone → `POST /signup/request-otp {phone}`; Code → `POST /signup/verify-code {phone, code}` → `ticket`.
- Details: Company name (max 80, req), Timezone (dropdown `kTimezones`, default `kDefaultTimezone` — `widgets/timezones.dart`), Your name (max 80, req) → "Create company" → `POST /signup/complete {ticket, companyName, timezone, adminName, deviceId}` → token → lands in AdminShell.
- Errors: codes `ALREADY_REGISTERED` / `PENDING_REGISTRATION` shown with "Back to log in".

#### 2a.3 TermsGate / TermsScreen — `app/lib/screens/terms_screen.dart`
- Who: every signed-in user (all tiers).
- `GET /terms` once per login; if `mustAccept` shows TermsScreen with `text`, `version`. **Fails open** when offline (`terms_screen.dart:165-176`).
- TermsScreen: scrollable text; Accept enabled only after scrolled to end (±40px; short text counts as read) and checkbox ticked; banner "Scroll down to read all of the terms."; AppBar "Log out".
- Accept → `POST /terms/accept {version}`. Error: "Could not save your acceptance. Check your connection."

#### 2a.4 Update prompt — `app/lib/services/update_check.dart`
- Once per app run after shell loads: `GET /app-version?platform=ios|android` → `latestBuild`, `minBuild`, `iosUrl`/`androidUrl`.
- If build < latest: dialog "Update available"; if build < min → forced (not dismissible, no "Later"; text "This version of SiteClock is no longer supported…"). Update opens store URL. Never blocks on failure.

#### 2a.5 WorkerHomeScreen ("Clock" tab) — `app/lib/screens/worker/home_screen.dart` (1696 lines)
- Who: all tiers (Worker default tab; Clock tab for supervisors/admins).
- Purpose: one big CLOCK IN / CLOCK OUT button that runs the worker's whole day, job by job.
- Loads (`:108-170`, `:366`): `GET /auth/me` (quiet refresh) · `GET /jobs/mine?from=today&to=today` (jobs sorted by `startTime`/`usualStart`; also `groupClocking`) · `GET /timesheets/mine` · `GET /punches/mine` (latest unreviewed FLAGGED punch → "pending" card) · `GET /schedules/mine?siteId=` (today's shift) · `GET /photos/mine` (photo-on-record status). Location permission requested on open; distance refresh every 20 s; 1-s ticker for elapsed time.
- Next-step logic (`app/lib/services/job_clock.dart`): `StepKind` dayIn / dayOut / jobIn / jobOut / jobOutEndDay. Per job `clocking` from `/jobs/mine`: `OFF` (not needed), `ARRIVE` (clock in only), `ARRIVE_LEAVE` (in+out). First clock-in opens the day; clock-out at the last job (or plain clock-out) ends it. Preferred job = job picked by hand, or job whose fence the worker stands in. Button caption CLOCK IN / CLOCK OUT + subtitle ("<job> · starts your day", "· you stay on the clock", "· ends your day", "· scan the QR code").
- UI elements:
  - Empty: "Your company has no active sites yet, so you cannot clock in. Ask your admin to create a site (admins: More → Sites)." / "No job or site for you today, so there is nowhere to clock in. Ask your scheduler…"
  - Job row (label "Job (chosen by you)" / "Job (you are here)" / next) → `_chooseJob` bottom sheet: **Auto** ("The job you are at, else the next one by time"), **End my day** (when on the clock: clock out now, skipped jobs stay on the list), list of today's clocking jobs with state/distance.
  - Site row (label "Site (chosen by you)" / "Site (auto-detected)" / "Nearest site (out of range)" / "Next: <job>") → site picker sheet: "Auto-detect" + sites (assigned sites; all company sites only when none assigned; bases appear when allowed).
  - Warnings: out-of-range text; "Not your assigned site — punches here are flagged for supervisor review."; "Today's shift: <name> <start>–<end>"; location note.
  - Timer of the open entry, today's entry summary.
  - Secondary buttons when in a job: "Clock out for the day instead", "Clock out of this job only, stay on the clock".
  - Pending card: "Clock-in at HH:mm … Pending approval" + "Waiting for supervisor approval…".
  - Offline queue card: "<n> punch(es) waiting to sync" + **Sync** button.
  - `TodayJobsCard` (`widgets/today_jobs_card.dart`) with "Full timeline" → Jobs tab.
- Punch sequence `_punch` (`:650-1005`) — see Flow 3.1.
- API: `POST /punches` (or `/punches/group`), multipart when selfie attached (`services/punch_queue.dart:24-35`).

#### 2a.6 Selfie dialogs (inside Clock tab and Jobs tab) — `home_screen.dart:1008-1142`, `jobs_screen.dart:675-760`
- Reason → title/message: `NEW_DEVICE` "Verify it's you" · `VERIFY_REQUESTED` "Verify it's you" · `NOT_ASSIGNED` "Not your assigned site" · `QR_MISSING` "Code not scanned" · `ACCURACY` "Weak GPS signal" · `AUTO_CLOSE_OVERRIDE` "Confirm you're still working" · default `OUTSIDE_FENCE` "Outside site zone" ("You are N m from <site>…"). `POLICY` (company/worker ALWAYS) → no dialog, camera opens directly.
- Field: "Reason (optional)" text, max 300, 2 lines, hint "e.g. delivery at customer site" → sent as `workerNote`.
- Camera: front, quality 70, max width 1080. On-device face detection (`services/face_check.dart`); no face → "We couldn't see your face" (Cancel / Use anyway / Retake). Soft gate, never hard-blocks.

#### 2a.7 QR scan screen — `app/lib/screens/worker/qr_scan_screen.dart`
- Shown when job `qrRequired`. Full-screen scanner "Scan to clock in/out", torch toggle. "Can't find the code?" dialog → "Keep looking" / "Continue with selfie" (punch goes without `qrToken` → `QR_MISSING` selfie + review). Returns `QrScan{token}` or null (cancel).

#### 2a.8 Group clock sheet — `app/lib/widgets/group_clock_sheet.dart`
- Shown when Rules → group job clocking on (`groupClocking` from `/jobs/mine`) and the step is at a job.
- Lists crew members eligible (for IN: not yet arrived; for OUT: arrived, not left) with checkboxes; "Just me" returns empty list; returns ticked userIds; cancel → null.
- Group punches go to `POST /punches/group` with `userIds`; response `others[]` with `ok/error` per person → snack "Not recorded: Ali (already pending)". Group punches are **never queued offline** ("No connection — try again.").

#### 2a.9 JobsScreen (worker "Jobs" tab; supervisor "My jobs") — `app/lib/screens/worker/jobs_screen.dart` (1670 lines)
- Who: everyone with jobs.
- Purpose: 14-day day strip + vertical timeline (100 px/hour) of my jobs, with my clock-in/out marks and a moving "Now" line.
- Loads: `GET /jobs/mine?from=today&to=today+13` (`jobs`, `notes` per date, `jobClocking`, `groupClocking`) · `GET /timesheets/mine` · `GET /punches/mine` (pending plain punches per day).
- Elements: `_DayStrip` (Today · EEE d MMM), `_NoteBanner` (day note from office), `_AllDayStrip` (jobs without time: "All day · ~2h"), `_JobBlock`s, `_MarkLine` (Clocked in HH:mm · <job>, "Left for next job", "awaiting approval"), empty "No jobs for you on this day.".
- Hints per job: "Clock in & out here" / "Clock in here" / "Clock out here".
- `_ActionButton` per job (today only): IN / OUT / OUT_END_DAY ("Clock out · ends your day", "You stay on the clock for the next job.").
- Tap job → bottom sheet `_JobDetails` (`:1308-1560`): title, "For <company>" when a linked company's job (`fromCompany`), expected "~2h", description ("Work"), external link button (AIMS "View DO" — `externalUrl`/`externalUrlLabel`, opens in-app browser), **DeliverySection** (if `deliveryEnabled`), **JobPhotosSection** (if `photosEnabled`), instructions, "Not clocked in yet · expected ~…", QR hint "Scan the QR code posted at the site to clock in / out", crew & teams ("Crew · Team A"), place button (address → `mapsUrl`), phone numbers in text are tappable `tel:`.
- Job punch errors: "This job is not today — you can only clock in on the day.", "That is not the code for <job>…", "This is already waiting for supervisor review.", "No connection — try again when you are back online." (job-tab punches are not queued (?) — `jobs_screen.dart:621`).

#### 2a.10 Job photos — `app/lib/widgets/job_photos.dart`
- Visible only when `job.photosEnabled` (= AIMS job whose API client has its AIMS return path configured — `backend/src/lib/jobPhotos.ts:69`).
- Section lists photos (`GET /jobs/:id/photos`) + queued local ones; "Add photos" → sheet "Take a photo" / "Choose from gallery (You can pick several)". Since 2026-11-11 no tag/note asked — sent as `UNSORTED`.
- After a clock-OUT at a photo job: dialog "Add photos?" (Not now / Add photos) (`offerJobPhotosAfterClockOut`).
- Failed item dialog: Remove / Try again / Close. Delete own sent photo: "Delete this photo?" → `DELETE /jobs/photos/:id`.
- Upload: `POST /jobs/:id/photos` multipart `{photo, tag, note?, takenAt, clientId}` via PhotoQueue.

#### 2a.11 Delivery flow (AIMS deliveries) — `app/lib/delivery/*`
- Gate: `job.deliveryEnabled == true` (`delivery_section.dart:16`). All calls go to SiteClock backend `/jobs/:id/delivery/<step>` which proxies AIMS (`delivery_api.dart:1-31`); POST/PATCH carry `Idempotency-Key`.
- **DeliverySection** (in job sheet): "Delivery" card, `#<deliveryNumber>`, order number, "View DO <name>" (`GET …/delivery/do/:id/pdf`), "Pending Sign" button, "Try again" on error. Load `GET /jobs/:id/delivery`.
- Auto-open: after any clock-in, the first unfinished delivery job of the day opens (`home_screen.dart:402-415`).
- **DeliveryRunScreen** (`delivery_run_screen.dart`): opening → `POST …/open` (claims run). One screen: every item with a checkbox, all ticked (untick = another day). "End job" → confirm "End the <noun>?" (Not yet / End) → `POST …/end {itemIds}`. "Continue to sign-off". Back never sends.
- **Delivery photos** (`delivery_photos.dart`): optional "Job photos" step; "Try to cover these angles"; Take photos / Choose from gallery; per-photo Uploading / Retry; uploads `POST /jobs/:id/delivery/uploads/image` (folder + file, Idempotency-Key = clientId) via PhotoQueue.
- **DeliveryFinishScreen** (`delivery_finish_screen.dart`): outbound asks "Installation needed?" once (not for WCT service runs); "How is the job signed off?": customer signs now on `SignaturePad` (+ signed-by name, Clear) or (flag `enableWctFinishModes`) Skip → `completionMode: sign_link` with optional note. `POST …/finalize` (or `finalize-return` for returns). Partial (`partial:true`) → done screen with count. AIMS refusals shown verbatim.
- **DeliveryDoneScreen** (`delivery_done_screen.dart`): "Job completed", "Driver signed for N items", sign-off panel (note, "Verified by …"), DO actions (View / Share / Save to Downloads / Print — `do_actions.dart`), **"Done, clock out"** (runs the app's normal clock-out incl. guard), Back.
- **PendingSignScreen** (`pending_sign_screen.dart`): `GET /jobs/delivery/pending-sign` — service reports awaiting customer signature, grouped by customer; tick several of one customer → "Sign N"; two-step pads "Service technician signature" → Next → client signature → "Sign and finish": uploads signatures (`POST /jobs/delivery/uploads/image`) then `POST …/reports/:id/sign` one by one.
- **Clock-out guard** (`clock_out_guard.dart`): clocking out of a delivery job not yet completed → "Finish the <noun> first" (Open <noun> / Can't finish today). "Can't finish today" → reason text → "Send and clock out" → `POST …/delivery/not-finished {reason}` (goes to AIMS activity log). Offline → "Can't check the job … Clock out anyway?".
- WCT service template (`wct_service_template.dart`): fixed ids for "Type of Service/Job" ticks and photo sections (stored contract; do not rename).
- Wording mirrors AIMS "SiteJobs" (`delivery_words.dart`): "Delivery #12" / "Job #12" (WCT) / "Return #12".

#### 2a.12 HistoryScreen — `app/lib/screens/worker/history_screen.dart`
- Who: everyone (AppBar History icon).
- `GET /timesheets/mine` → cards: "<workDate> — <site>" or "Off-site", status chip, in/out times, gross "8h 0m", "OT Nm", "late Nm", "early Nm", "left early Nm".
- FAB **"Missed entry"** → bottom sheet "Request missed entry" ("Forgot to clock in/out? Your supervisor will review this request."):

| Field | Type | Req | Validation |
|---|---|---|---|
| Site | dropdown of my sites | yes | "You are not assigned to any site." if none |
| Date + In time + Out time | pickers | yes | server: out > in, in the past, ≤ 14 days back, no overlap (409) — `backend/src/modules/timesheets/timesheets.router.ts:63-86` |
| Reason | text, e.g. "phone battery died" | yes | "Please give a short reason." |

  → `POST /timesheets/missed-request {siteId, clockInAt, clockOutAt, note}` → creates a PENDING entry (editNote "worker request: …") and pushes site staff. Snack "Request submitted — pending supervisor review."
- **"Still working? Override auto-close"** on an `AUTO_CLOSED` entry < 24 h old: dialog "Still working?" → GPS + mandatory selfie (`AUTO_CLOSE_OVERRIDE`) → `POST /punches` with `overrideAutoClose: true` → "Override submitted — pending supervisor review." Cancel → "Cancelled — a selfie is required to override."

#### 2a.13 LeaveScreen ("My leave") — `app/lib/screens/worker/leave_screen.dart`
- Who: everyone (Profile → My leave).
- Loads `GET /leave/types`, `GET /leave/requests/mine`, `GET /leave/balances/mine` (balances shown per tracked type).
- FAB "Request leave" → dialog:

| Field | Type | Req | Notes |
|---|---|---|---|
| Type | dropdown of types | yes | |
| Dates | date-range picker | yes | |
| Half day | switch | no | default off |
| Reason | text | no | |
| MC photos | camera/gallery, up to 5 (`_maxDocuments=5`) | yes when type `requiresDocument` (Submit disabled until ≥1) | "Attach photo of MC" |

  → `POST /leave/requests` JSON `{typeId, startDate, endDate, halfDay, reason?}` or multipart with repeated `document` fields.
- List: status, "Entered by the office" (recorded by admin), MC thumbnails (`widgets/leave_documents.dart`), "Cancel request" when cancellable → `POST /leave/requests/:id/cancel`.

#### 2a.14 PayslipScreen ("My payslip") — `app/lib/screens/worker/payslip_screen.dart`
- Who: only when `user.payslipVisible` (admin toggles per worker on web Payroll → "App payslip"); server returns 403 `PAYSLIP_HIDDEN` otherwise.
- Month switcher (‹ ›). `GET /payroll/me?month=YYYY-MM`.
- Shows: net pay big; "N day(s) · X h worked + Y h OT · approved entries only"; warning if no pay profile; rows Regular/Basic (by payType MONTHLY/DAILY/HOURLY), Fixed allowance, Overtime (or "not paid on ordinary days"), Premium (PH/off days), Leave rows (paid/unpaid), Gross, Deductions, Net; premium-days list.
- Empty: "No payslip available". Money shown as `$x.xx` (cents/100).

#### 2a.15 ProfileScreen — `app/lib/screens/profile_screen.dart`
- Who: everyone (Worker/Supervisor tab; Admin via More).
- Header: avatar (photo on record), name, phone, chips role (Admin/Supervisor/Worker), company name, employee no; assigned sites list.
- **Switch company** (only when `accounts.length > 1`): refuses if offline punches queued ("You have clock-ins waiting to sync…"); bottom sheet of accounts (companyName, role) → `AuthState.switchAccount` → `POST /auth/switch {userId, deviceId}` → new token → reload `/auth/me` → shell rebuilds.
- Staff section (non-admin staff only): My team (`workers.view` → `AdminWorkersScreen` titled "My team"), Timesheets (`timesheets.view`), Leave requests (`leave.view`), Teams, Working hours (`schedules.view`), Join requests & invites (`workers.invite`), Export attendance (`reports.attendance|reports.view` → XLSX, `widgets/attendance_export.dart`: `GET /reports/attendance-export?from&to` bytes).
- My leave → LeaveScreen; My payslip (gated); **Web login code** → `POST /auth/app-code` → dialog showing code (used on web login "manual" channel); How to use SiteClock (guide); Privacy policy (link).
- **Photo on record card**: status texts — REQUESTED+auto "Your company needs a photo of you on record. Take it before you clock in or out." (Rules → photo at first login), REQUESTED "Your admin asked for a new photo…", PENDING "New photo sent — waiting for your admin to approve it…", else "Your clock-in selfies are checked against this photo…". Buttons: Take photo / Update photo / Retake; Withdraw (PENDING) → `DELETE /photos/mine`. Take → `widgets/record_photo.dart`: dialog "New photo needed"/"Update your photo" → front camera + face check → `POST /photos/mine` multipart → "Photo sent — your admin will approve it."
- Log out; **Delete account** ("Deactivate your account and unbind this device") → confirm → `DELETE /auth/account` (deactivates all accounts of the phone).

#### 2a.16 SupervisorJobsTab — `app/lib/screens/supervisor/jobs_tab.dart`
- `jobs.view`. Segmented "My jobs" (JobsScreen) / "All jobs" (`AdminRosterScreen(embedded)`).

#### 2a.17 LiveScreen — `app/lib/screens/supervisor/live_screen.dart`
- `live.view`. Site dropdown (`GET /sites`); "N on site now"; list name/employeeNo/"in HH:mm"; `GET /sites/:id/present`; `GET /sites/:id/pulse` (occupancy + hourly headcount; staff also get who/GPS — `backend/src/modules/sites/sites.router.ts:80`). Socket `site:presence`, `site:punch` refresh. Empty "Nobody on site.".

#### 2a.18 FlaggedScreen — `app/lib/screens/supervisor/flagged_screen.dart`
- `flagged.view` (decide needs `flagged.review` server-side).
- `GET /punches/flagged`. Card: "<name> — IN/OUT at <site>", time · distance · inside/outside zone · ±accuracy, address or lat/lng, selfie thumb (`GET /punches/:id/photo`, tap full-size), mini map (`widgets/site_map.dart`) of fence vs punch, worker note "💬 …", reason chip (`QR_MISSING` shown as text, "QR scanned").
- Approve / Reject → dialog "<Verb> this punch?": on approve a time picker for the punch time ("The worker's own time — change it if they finished earlier.") → `punchAt` if changed; "Note (optional)" hint "e.g. confirmed with foreman". → `POST /punches/:id/approve|reject {note?, punchAt?}`.
- Special: `OUT_WITHOUT_IN` with `needsClockIn` → first pick the missing clock-in date/time ("Missing clock-in — pick the start time"); must be before the clock-out ("Clock-in must be before the clock-out time.") → body `clockInAt`.

#### 2a.19 AdminOverviewScreen — `app/lib/screens/admin/overview_screen.dart`
- Admin tab 1. `GET /sites`, `GET /punches/flagged`, per site `GET /sites/:id/present`, `GET /schedules/exceptions?siteId&date=today`, `GET /sites/:id/pulse`.
- Banner "N flagged punches pending review" → Flagged; per-site card with count "on site now", present list, exceptions (late/absent), pulse chart. Empty: "Add your first site" button.

#### 2a.20 AdminTimesheetsScreen — `app/lib/screens/admin/timesheets_screen.dart`
- Admin tab 2; also from Profile for `timesheets.view` staff.
- Filters sheet: Site (All sites), Status (All/OPEN/PENDING/APPROVED/REJECTED/AUTO_CLOSED), Worker (All workers), date range. `GET /timesheets?siteId&status&userId&from&to`, `GET /sites`, `GET /workers`.
- "Approve all listed (N)" (PENDING + AUTO_CLOSED) → `POST /timesheets/approve-bulk {entryIds}` → snack "N entries approved." (**does not read per-id results; needsReview entries are skipped server-side but still counted** — `timesheets_screen.dart:127-140`, server `timesheets.router.ts:286-296`).
- Row: Edit / Approve (Reject) → `POST /timesheets/entries/:id/approve|reject`. Tap → EntryDetailScreen.
- Edit entry sheet: Clock in (date+time), Clock out (date+time, may be unset), "Note (why edited)" → `PATCH /timesheets/entries/:id {clockInAt, clockOutAt?, note?}`.

#### 2a.21 EntryDetailScreen — `app/lib/screens/admin/entry_detail_screen.dart`
- `GET /timesheets/entries/:id/detail`: site, punches with selfies/map, gross/break/regular/OT, paid span.
- NLB: "Worker claims: no lunch break" → Approve NLB / Dismiss → `PATCH /timesheets/entries/:id {nlb:true|false}`; "✓ No lunch break — break credited" + Undo.
- `timesheets.reopen`: "Delete clock-out & reopen" → `POST /timesheets/entries/:id/reopen`; "Delete timesheet" → `DELETE /timesheets/entries/:id`.

#### 2a.22 AdminSitesScreen — `app/lib/screens/admin/sites_screen.dart`
- More → Sites. `GET /sites`; row menu Edit / Activate-Deactivate (`PATCH /sites/:id {active}`); empty "No sites yet. Tap + to add one."
- Add/Edit sheet:

| Field | Type | Req | Default |
|---|---|---|---|
| Name | text | yes | |
| Search address or place | text → `GET /sites/geocode?q=` results list | no | hint "e.g. 10 Tuas South Ave 3" |
| Use my current location | button (GPS) | — | error "Could not get a GPS fix — try again outdoors." |
| Address | text | no | |
| Latitude / Longitude | decimal | yes | |
| Geofence radius (m) | int | yes | 150 |
| Max GPS accuracy (m) | int | yes | 50 |

  Validation "Name, valid lat/lng and numbers are required." → `POST /sites` / `PATCH /sites/:id`. (App has **no** site kind/base, auto-close hours fields — web only.)

#### 2a.23 AdminWorkersScreen ("Workers" / "My team") — `app/lib/screens/admin/workers_screen.dart`
- `workers.view`; edit needs `workers.manage`. Loads `GET /workers`, `/sites`, `/photos`, `/teams`.
- Row menu: Edit · Reset device (`POST /workers/:id/reset-device` → "Device binding reset — <name> can log in on a new phone.") · Ask for new photo (dialog "Message to them (optional)" hint "e.g. Your old photo is blurry" → `POST /photos/request/:id {note}`) · Cancel photo request (`DELETE /photos/request/:id`) · Activate/Deactivate (`PATCH /workers/:id {active}`). Link to **PhotoApprovalsScreen** "New photos": approve / reject with "Reason (sent to them, optional)" → `POST /photos/:id/approve|reject {note?}`.
- Worker editor sheet:

| Field | Type | Req | Notes |
|---|---|---|---|
| Phone | PhoneField (new) / text (edit) | yes | ≥8 chars; E.164 ≥9 for new |
| Name | text | yes | "Phone and name are required." |
| Role | dropdown of company roles (`GET /roles`) → `companyRoleId`; fallback WORKER/SUPERVISOR/COMPANY_ADMIN | yes | |
| Emp no | text | no | |
| Photo | front camera (face check warns "No face detected…") | no | multipart `photo` |
| Assigned sites | checkboxes → `siteIds` | no | "can clock in" |
| Supervises | checkboxes → `supervisorSiteIds` | only for scoped roles | |

  → `POST /workers` / `PATCH /workers/:id` (JSON or multipart). App editor lacks per-worker overrides (job clocking, off-site, selfie, base, shared, pay-follows-crew, attendance exempt, leave entitlements) — web only.
- Empty: "No workers yet. Tap + to register one."

#### 2a.24 TeamsScreen — `app/lib/screens/admin/teams_screen.dart`
- View for all with access; edit `teams.manage`. `GET /teams`, `GET /workers/directory`.
- "New team" (name, hint "e.g. Team A") → `POST /teams {name}`. Per team menu: Add people (multi-select sheet with search → `POST /teams/:id/members {userIds}`), Supervisor (pick → `PUT /teams/:id/supervisors {userIds}`), Rename (`PATCH /teams/:id {name}`), Archive team (`PATCH /teams/:id {active:false}`). Remove member: "Take <name> out of <team>?" → `POST /teams/:id/members/:userId/remove`.

#### 2a.25 InvitesScreen — `app/lib/screens/admin/invites_screen.dart`
- `workers.invite`. Loads `GET /invites/registrations?status=PENDING`, `GET /invites`, `GET /schedules/templates`.
- Join requests: name, phone, employee no, "requested …" → Approve / Reject → `POST /invites/registrations/:id/approve|reject`. Empty "No join requests pending."
- "New invite link" dialog: Label (e.g. Aug intake), Joins as (Worker/Supervisor), Site (Any site; required for supervisor), Shift templates (checkboxes), Expiry (date, optional; set to 23:59:59), Max uses (int) → `POST /invites` → share `joinUrl`. List: Share link, Disable/Enable (`PATCH /invites/:id {active}`), Delete (`DELETE /invites/:id`). Empty: "No invite links yet — create one and share it in the site WhatsApp group."

#### 2a.26 AdminRulesScreen (app) — `app/lib/screens/admin/rules_screen.dart`
- More → Rules. `GET /rules`, `GET /sites`.
- Switches (`PUT /rules/punch`): "Supervisors can approve timesheets" (`supervisorsApproveTimesheets` — legacy; web moved this to Roles), Job clocking radio OFF/ARRIVE/ARRIVE_LEAVE (`jobClocking`), "One worker can clock in the crew with them" (`groupJobClocking`), "Ask for a photo at first login" (`photoAtFirstLogin`).
- Overtime rules list + "Set" sheet: Scope (Company default / site), Daily threshold (min), Multiplier, Weekly OT cap (min, optional), Early clock-in (Not paid / Paid — extra can become OT / Slides the day) → `PUT /rules/overtime`.
- Break rules + sheet: Scope, Deduct (min), Min shift (min) → `PUT /rules/breaks`.
- Empty: "No overtime rules." / "No break rules." (App lacks selfie, off-site, missed clock-out, base, share workers, crew margins, roster notify, job-clocking teams, NLB credit — web only.)

#### 2a.27 AdminJobsTab + AdminRosterScreen — `app/lib/screens/admin/jobs_tab.dart`, `roster_screen.dart`
- Admin Jobs tab: segmented "Jobs" (roster) / "Working hours" (AdminSchedulesScreen).
- Roster: previous/next day, Plan / Attendance segments (`GET /rosters?date` or `GET /rosters/attendance?date`), team filter chips ("All teams", `GET /teams?date`), job cards "@ <place>", clocking label, crew, QR code icon (→ `widgets/job_qr_sheet.dart`).
- "New job" FAB (when `jobs.manage`) → sheet "One job" (JobEditScreen) / "Several jobs for a team" ("Pick a team once, add a row per job" → MultiJobScreen). Tap job → JobEditScreen.

#### 2a.28 JobEditScreen — `app/lib/screens/admin/job_edit_screen.dart`
- Title "New job · <date>" / "Edit job"; Delete icon → "Delete this job?" → `DELETE /jobs/:id`.
- Loads `GET /sites`, `GET /teams?date`, `GET /rosters/pickers?date` (workers incl. linked companies' shared ones).

| Field | Type | Req | Notes |
|---|---|---|---|
| Job / client (`title`) | text | yes | hint "e.g. Ajiya Restaurant or Barge A" |
| Start time | time "Set" | no | `startTime` HH:mm |
| Expected duration | `widgets/duration_field.dart` | no | `expectedMinutes` |
| Clocking at this job | OFF/ARRIVE/ARRIVE_LEAVE (null = company rule) | no | |
| QR sign-in at this job | switch | no | `qrRequired`; "Show QR code — Share with the client, or print" |
| Place | segmented "Our site" / "Address" | yes | |
| Site | dropdown | if Our site | sends `{siteId, location: siteName}` |
| Address as workers see it | text | if Address | hint "e.g. Westgate #02-12" |
| Map search (postal code is best) | text → `GET /sites/geocode?q` → pick | no | sends `lat,lng,address` or `search` |
| Work (optional) | text → `description` | no | "e.g. Troubleshoot exhaust VSD" |
| Notes for the crew (optional) | text → `instructions` | no | "e.g. Call <redacted> upon arrival" |
| Teams | chips → `teamIds` | no | members listed with tick ("Untick to leave them off this job" → `exceptUserIds`) |
| Add workers | search sheet "Search name or employee no." → `userIds` | no | shows "from <company>" for shared workers (?) |

  → `POST /jobs {date, …}` / `PATCH /jobs/:id` (place fields only when changed).
- `JobQrSheet`: shows QR PNG, "New code" (confirm "New code?" — old prints stop working) → `POST /jobs/:id/qr`, "Share / print".

#### 2a.29 MultiJobScreen — `app/lib/screens/admin/multi_job_screen.dart`
- "Several jobs · <date>": pick Team once, clocking for all; rows (time, Job/client, Our site/Address, Site or Address + "Postal code (for the map)", Work) — "Add another job", "Remove this row". Saves each unsaved valid row → `POST /jobs {date, startTime, expectedMinutes, clocking, title, description, teamIds:[team], …}`; saved rows marked.

#### 2a.30 AdminSchedulesScreen ("Working hours") — `app/lib/screens/admin/schedules_screen.dart`
- `schedules.view`; create/rename/delete templates `schedules.manage`; assign `schedules.assign`.
- "Who works which hours" (site dropdown + date → `GET /schedules/exceptions?siteId&date`); "No one has working hours on this day."
- Shift templates list (`GET /schedules/templates`): New sheet — Name, Sites (checkboxes; none = company-wide), Start/End HH:mm, Days of week (≥1), Grace (min, default 10), Early clock-in (inherit / pay / slide / clamp). Validation "Name, HH:mm times and at least one day required." → `POST /schedules/templates`. Rename (`PATCH`), Delete (`DELETE /schedules/templates/:id`).
- Assignments (`GET /schedules/assignments`): "Assign shift" sheet — Template, Worker, Start date, End date (or ongoing) → `POST /schedules/assignments`; remove → `DELETE /schedules/assignments/:id`.

#### 2a.31 AdminLeaveScreen — `app/lib/screens/admin/leave_admin_screen.dart`
- More → Leave; also Profile → Leave requests (`leave.view`). `GET /leave/types`, `GET /leave/requests?status=PENDING`, `GET /leave/calendar?month=`.
- Pending: Approve / Reject → `POST /leave/requests/:id/approve|reject`. Calendar of approved leave per month ("No approved leave this month."). Types list + "New" dialog: Name, Paid (switch), "Photo of the MC required" → `POST /leave/types`.

#### 2a.32 AdminReportsScreen — `app/lib/screens/admin/reports_screen.dart`
- From/To date pickers; `GET /reports/attendance-summary`, `GET /reports/fraud-summary`; "Download attendance XLSX" (`GET /reports/attendance-export`). Attendance by site (entries, unique workers, regular/OT, lates); Fraud/flags (total, per worker flags). Empty texts "No entries in range." / "No flags.".

#### 2a.33 AssistantChatScreen — `app/lib/screens/assistant_chat_screen.dart`
- `assistant.use` (admin always). `GET /assistant/history`; send `POST /assistant/chat {message, attachments?}` (attach: Take a photo / Photo from gallery / PDF document, base64 (?)); response `reply` + optional `pending.summary` → Confirm / Cancel → `POST /assistant/confirm {accept}`; New conversation → `POST /assistant/reset`. Errors: `NOT_CONFIGURED` → "The assistant is not set up on the server yet (missing AI key)…". Empty: "Ask me anything about your sites".

#### 2a.34 App guide — `app/lib/widgets/app_guide.dart`
- Coach-mark walkthrough per role (`guideStepsFor(role)`), highlights keyed widgets (`GuideTargets.key('w-jobs')` etc.), switches tabs via `GuideNav`. Skip / Back / Next. Shown once per user+role; reopen from Profile → How to use SiteClock.

#### 2a.35 Push notifications — `app/lib/services/push_service.dart`
- FCM; foreground message → SnackBar "<title>\n<body>" via global messenger key. Token → `POST /auth/fcm-token`.

---

### 2b. Office web (React, `web/src`)

#### 2b.0 Shell & routing — `web/src/App.tsx`, `web/src/lib/permissions.ts`
- **Hash routes**: each tab at `#/<slug>` (`tabSlug`: lowercased, spaces → `-`, e.g. `#/live-site`, `#/working-hours`, `#/shared-workers`) — `App.tsx:69`. Old links `#/roster` → Jobs, `#/schedules` → Working hours / Rules (`App.tsx:71`).
- Signed-out entry points: `/` Landing; `#login`; `#signup`; `#join=<token>` (Join); `#/q/<token>` (QrLanding, works signed-out too).
- Session: `localStorage.token`; superadmin view-as keeps the super token in a second key (`api.ts:29-47`). Optional Clerk/AIMS SSO (see flags). `GET /auth/me` on load; roles allowed `WORKER|SUPERVISOR|COMPANY_ADMIN|SUPERADMIN` but a user with **no tabs** is rejected ("Workers use the SiteClock mobile app — the web dashboard is for supervisors and admins.").
- Tabs = `COMPANY_TABS` filtered by `TAB_PERMS` (`permissions.ts:30-55`):

| Tab | Permission(s) |
|---|---|
| Overview | overview.view |
| Live Site | live.view |
| Flagged | flagged.view (sidebar badge, polled every 60 s `GET /punches/flagged`) |
| Timesheets | timesheets.view |
| Sites | sites.manage |
| Workers | workers.view |
| Teams | teams.manage |
| Payroll | payroll.view |
| Jobs | jobs.view |
| Shared workers | jobs.view **and** company has ≥1 link (`GET /links`) |
| Working hours | schedules.view — hidden when user has rules.manage (then inside Rules) |
| Rules | rules.manage |
| Roles | roles.manage |
| Terms | terms.manage |
| Leave | leave.view |
| Reports | reports.attendance or reports.view |

- Superadmin (not viewing-as): tabs Platform, Companies, All Users. `can()` returns true for SUPERADMIN.
- Sidebar footer: name, role label (company role name), company; **company switcher** Select when `user.accounts.length > 1` → `POST /auth/switch {userId}` → token → reload at Overview; "How to use SiteClock" (Guide); Log out (also signs out of AIMS/Clerk if the session came from there).
- View-as bar: "Viewing as admin of <company>. Changes you make here are real." + company Select (`POST /companies/:id/view-as`) + "Exit to superadmin".
- Page head: tab title + long date. Floating **AssistantChat** when `assistant.use`. `GoToApp` mobile banner on every page (deep-link to app / store). `AppSwitcher` (AIMS ↔ SiteClock; `POST /auth/aims-link`).
- Modal component: `web/src/components/Modal.tsx`; `Field` label/hint wrapper; `Select` (`components/Select.tsx`).

#### 2b.1 Landing — `web/src/pages/Landing.tsx`
- Marketing page: "Know who is on site. Pay them right — automatically.", Log in / "Create your company account", 3-step onboarding, features, exports, three views (workers/supervisors/admins). No API.

#### 2b.2 Login — `web/src/pages/Login.tsx`
- Phone → `POST /auth/request-otp {phone, channel?}` (Send code disabled < 9 chars) → response `channel` (`whatsapp` default, `app` = push to SiteClock app, `manual` = "Enter the code shown in your SiteClock app (Profile → Web login code)"), `devCode` in dev. Code → `POST /auth/verify-otp {phone, code}` (no deviceId on web) → token. Optional Clerk "Sign in with AIMS" button (`VITE_CLERK_SIGN_IN_BUTTON`). Notice slot for AIMS session problems ("No SiteClock account is linked to your AIMS login…"). "← Back to home".

#### 2b.3 Signup — `web/src/pages/Signup.tsx`
- Same steps as app (gate owner/employee + ack → phone → 6-digit code → Company name (max 80) + Your name (max 80) (+ timezone?)) via `POST /signup/request-otp|verify-code|complete`. Errors carry `code` (already registered / pending) → "Go to log in".

#### 2b.4 Join (invite link) — `web/src/pages/Join.tsx`
- `#join=<token>`: `GET /join/:token` (invalid → "This invite link is not valid."); phone → `POST /join/:token/request-otp` ("Verify my number"); "6-digit code (sent on WhatsApp)" → `POST /join/:token/verify-code` → ticket; Full name (req), Employee no. (optional), photo (selfie file) → `POST /join/:token/register` multipart → done: wait for approval (shows up under Workers → Join requests).

#### 2b.5 QrLanding — `web/src/pages/QrLanding.tsx`
- `#/q/<token>`: "SiteClock clock-in code" — tells someone who scanned a job QR with a plain camera to open the SiteClock app.

#### 2b.6 Overview — `web/src/pages/Overview.tsx`
- `overview.view`. `GET /sites`, `GET /punches/flagged`, per site `GET /sites/:id/present` + `GET /schedules/exceptions?siteId&date`. Per-site tiles "N on site now", roster exceptions; flagged count; empty "No active sites yet — add your first site".

#### 2b.7 Live Site — `web/src/pages/LiveSite.tsx`
- `live.view`. Site select (`GET /sites`), present list (`GET /sites/:id/present`), "Today at this site" table (`GET /timesheets?siteId&from=today&to=today`). Socket.io with token: `site:presence` (replace list), `site:punch` (reload today) (`LiveSite.tsx:28-32`). Mini map (`components/MiniMap.tsx`) (?).

#### 2b.8 Flagged — `web/src/pages/Flagged.tsx`
- `flagged.view`; decide `flagged.review` (server).
- Views: **Needs approval · N** (`GET /punches/flagged`), **Marked · N** (`GET /punches/marked` — off-site punches recorded without approval under Rules → Off-site "just mark it", last 30 days), plus "Face verification log (last 7 days)" (`GET /punches/face-log`).
- Columns: worker, type (+ "ends day", "by <name>" for group punch, "QR scanned"), time, site, distance/accuracy, reason, selfie (`AuthImg` `/punches/:id/photo`), note, actions Approve / Reject.
- Decision modal "Approve punch" / "Reject punch": missing clock-in datetime for OUT_WITHOUT_IN (must be before the clock-out: "Clock-in must be a valid time before the clock-out."), punch time (approve; sends `punchAt` if changed), Note (placeholder "e.g. confirmed with foreman") → `POST /punches/:id/approve|reject {clockInAt?, punchAt?, note?}`.

#### 2b.9 Timesheets — `web/src/pages/Timesheets.tsx`
- `timesheets.view`; approve/reject/bulk/NLB/reopen/delete shown when `timesheets.approve` (prop `isAdmin`); edit visible to all viewers (server checks `timesheets.edit`).
- Filters: site, team (`GET /teams?all=1`), status, worker (?), from/to dates. `GET /timesheets?<q>`. Export **CSV / XLSX** → `GET /timesheets/export?format=csv|xlsx&<q>`.
- Stat tiles (entries, approved, pending, hours…). "Approve selected (N)" → `POST /timesheets/approve-bulk {entryIds}` (per-id results ignored; needsReview entries silently stay pending — `Timesheets.tsx:82-85`).
- Row: checkbox (PENDING/AUTO_CLOSED only), worker, date & site, clock in → out ("still in" badge), under it "paid: HH:mm → HH:mm · crew HH:mm → HH:mm" when pay follows crew, `WorkedFor` line ("for <company>: 1h 30m" — `components/WorkedFor.tsx`), gross/reg/OT, timing badges (late / early / left early), status badge (+ ✎ if edited), **review** badge (tooltip `crewNote`), NLB? / NLB badges, face issue badge. Buttons Edit, Approve, Reject (`POST /timesheets/entries/:id/approve|reject`).
- Edit modal: Clock in (datetime-local), Clock out, Note → `PATCH /timesheets/entries/:id {clockInAt, clockOutAt, note}`.
- **Entry detail panel** (`GET /timesheets/entries/:id/detail`): worker, each punch (Clock-in/out time, selfie, map, distance, flags), paid span "🚐 Paid … (follows the crew's jobs)", "👷 Crew's job clockings …", "Held for review: <crewNote>", break/NLB controls (Approve NLB / Dismiss / Undo NLB / Mark no lunch break → `PATCH … {nlb}`), "Delete clock-out & reopen" (`POST …/reopen`), "Delete timesheet" (`DELETE /timesheets/entries/:id`) — both with confirm modal.

#### 2b.10 Sites — `web/src/pages/Sites.tsx`
- `sites.manage`. Table + "+ Add site", Edit, Activate/Deactivate (`PATCH /sites/:id {active}`).
- Dialog (defaults `Sites.tsx:6`):

| Field | Type | Req | Default |
|---|---|---|---|
| Search address or place | text → `GET /sites/geocode?q=` → pick | — | |
| Map pin | `components/MapPicker.tsx` (click to set lat/lng) | yes | |
| Name | text | yes | |
| Address | text | no | |
| Radius (m) | int (geofence) | yes | 150 |
| Max GPS accuracy (m) | int | yes | 50 |
| Auto-close after (h) | int | yes | 14 |
| Kind | Work site (`PERMANENT`) / Base (office, yard, dorm) (`BASE`) | yes | PERMANENT |
| Every worker may clock in and out here | checkbox (`allWorkers`, BASE only) | no | false |

  → `POST /sites` / `PATCH /sites/:id`. Save disabled until lat/lng set.

#### 2b.11 Workers — `web/src/pages/Workers.tsx` (+ dialogs)
- `workers.view`; props: `canManage` (workers.manage), `canInvite` (workers.invite), `canVerify` (workers.verify), `canReviewPhotos` (photos.review).
- Sections: **Join requests pending approval** (`GET /invites/registrations?status=PENDING`, Approve/Reject `POST /invites/registrations/:id/approve|reject`); **New photos to approve** (`GET /photos`, approve `POST /photos/:id/approve`, reject modal "Reason (sent to them, optional)" max 300 → `POST /photos/:id/reject {note}`); **Invite links** (see below); worker table.
- Table columns: name, phone, badges (no clock-in, jobs: <mode>, off-site mode, selfie mode, base allowed/not, shared, pay follows crew), employee no, sites ("(sup)"), photo, active, actions: Edit, Reset device (`POST /workers/:id/reset-device`, only if bound), **Verify next punch** (`POST /workers/:id/request-verification`), Ask for photo (`POST /photos/request/:id {note}`) / Cancel ask (`DELETE /photos/request/:id`), Change number, Activate/Deactivate. Status badges "verification pending", "new photo asked", "new photo to approve".
- **Worker editor** (modal, `Workers.tsx:365-620`):

| Field | Type | Req | Notes / default |
|---|---|---|---|
| Phone | PhoneInput (read-only on edit; "use Change number") | yes | |
| Name | text | yes | |
| Role | Select of company roles (`GET /roles`) → `companyRoleId` | yes | default builtin WORKER; hint shows permission count + scope |
| Employee no | text | no | |
| Job clocking | "" Company rule / OFF Once a day / ARRIVE / ARRIVE_LEAVE → `jobClocking` | no | "" → null |
| Off-site clock-ins | "" / BLOCK / REVIEW / MARK → `offSiteClocking` | no | |
| Selfie | "" / ALWAYS / SMART → `selfiePolicy` | no | |
| Clock in and out at a base | "" / ALLOWED / NOT_ALLOWED → `baseClocking` | no | |
| Shared with linked companies | checkbox → `sharedWithLinked` | no | only meaningful with Rules → Share workers = SELECTED (shown when linked (?)) |
| Paid hours follow the crew's jobs | checkbox → `payFollowsCrew` | no | |
| Minutes before crew's first clock-in / after last clock-out | number 0–720, blank = company default | no | `crewMarginBeforeMin/AfterMin` |
| No clock-in required | checkbox → `attendanceExempt` | no | "office staff: never counted late or absent…" |
| Sites | checkboxes → `siteIds` | no | |
| Supervises | checkboxes → `supervisorSiteIds` | scoped roles | |
| Leave entitlements | number per leave type (step 0.5; placeholder = type default; shows taken/left on edit) | no | new: `leaveDays` map; edit: `PUT /leave/entitlements/:userId {entitlements}` |
| Photo for selfie verification | file | no | multipart (replaces current) |

  → `POST /workers` (response `otherCompanies` → notice "<name> added. This number also has an account with X — they pick the company in the app (Profile → Switch company) or on the web.") / `PATCH /workers/:id`. Leave balances `GET /leave/balances/:userId`.
- **Change number** modal: "New number" (≥8 digits) → `POST /workers/:id/change-phone`.
- **Invite links** (`InviteLinks`, `Workers.tsx:161-300`): `GET /invites`, `/schedules/templates`, `/leave/types`. Create: Label, Joins as (Worker/Supervisor), Site (Any/none), shift templates, Expires (date), Max uses, per-type leave days → `POST /invites`. Rows: Copy link (`joinUrl`), Disable/Enable, Delete (strong confirm).

#### 2b.12 Teams — `web/src/pages/Teams.tsx`
- `teams.manage`. Date selector (members on a date), show archived. `GET /teams?date[&all=1]`, `GET /workers/directory`.
- Table: Team, Members today/on date, Count, Supervisor; actions Change members, Supervisor, History, Rename, Archive/Restore.
- New team: Team name, Members (searchable checklist), "Members from" date (can be past) → `POST /teams {name, memberIds, startDate}`.
- Change members: "Change takes effect on" date; removals end the day before (`POST /teams/:id/members/:uid/remove {lastDay}`), adds `POST /teams/:id/members {userIds, startDate}`.
- Supervisor → `PUT /teams/:id/supervisors {userIds}`. Rename → `PATCH /teams/:id {name}`. History → `GET /teams/:id/history`; edit a period `PATCH /teams/memberships/:id {startDate, endDate}`; delete period (confirm "Only do this if it was entered by mistake") `DELETE /teams/memberships/:id`.

#### 2b.13 Jobs (Roster) — `web/src/pages/Roster.tsx` (1004 lines)
- `jobs.view`; `jobs.manage` (prop `canEditJobs`) to add/edit/delete jobs; `jobs.setup` (prop `isAdmin`) for Setup panel + Upload schedule.
- Loads: `GET /rosters?date`, `/sites`, `/trades`, `/manning-presets`, `/rules`, `/teams?date`.
- Toolbar: ‹ date › · **Copy previous day** (`POST /rosters/copy {fromDate, toDate}`; "Nothing to copy from the previous day (or those jobs already exist).") · **Publish day (N)** / "Day published" — when Rules → notify roster on: `POST /rosters/publish {date}` ("N worker(s) published (M have no app device yet)"), else `POST /jobs/notify {date}` ("N worker(s) notified") · views **Plan / Attendance / Week**.
- Week view: `GET /rosters/week?monday=`; 7 day cards (click → plan of that day); **Copy previous week** (`POST /rosters/copy-week {fromMonday, toMonday}`).
- Attendance view: `GET /rosters/attendance?date` — who arrived/left per job vs expected (`Visit` component).
- Plan view job cards: name/title, place, clocking ("once a day — no clocking here" for workers with own OFF), requirements by trade with qty inputs (`PATCH /rosters/:id {requirements}`), "+ Add" per trade / "+ Add worker (no trade)" → picker (`GET /rosters/pickers?date[&tradeId]`) → `POST /rosters/:id/entries {userId, tradeId}`; remove × → `DELETE /rosters/:id/entries/:userId`; QR button (JobQr), photos (JobPhotos when `photosEnabled`), Edit, Delete (`DELETE /jobs/:id` for JOB place kind else `DELETE /rosters/:id`); non-editable shows "view only".
- Buttons: "+ New job for <date>" (JobForm, or old site-roster form `POST /rosters {siteId, date, name, presetId}` when jobs not editable (?)), "+ Several jobs for a team" (MultiJobForm), "⬆ Upload schedule" (ImportSchedule), "Setup: trades, presets & worker trades" (SetupPanel).
- **JobForm (job editor)** (`Roster.tsx:712-900`):

| Field | Type | Req | Notes |
|---|---|---|---|
| Start time | time | no | null = all-day |
| Job / client | text | yes | e.g. "Ajiya Restaurant" or "Barge A" |
| Expected duration | select (`DURATIONS` 30…480 min) | no | |
| Clocking at this job | `ClockingSelect` "" (company rule shown) / OFF / ARRIVE / ARRIVE_LEAVE | no | |
| QR sign-in | checkbox → `qrRequired` | no | |
| Place mode | site / address | yes | |
| Site | select | if site | |
| Address as workers see it | text (lookup on blur `GET /jobs/place?q=&search=`) | if address | |
| Map search (postal code best) | text | no | |
| Work | text → description | no | |
| Notes for the crew | text → instructions | no | |
| Teams | checkboxes; members listed with tick to keep/leave out | no | `teamIds`, `exceptUserIds` |
| Individuals | search "a name or employee no. to add…" | no | `userIds`; shared workers badge "from <company>" |
| Manning preset | select (new jobs) | no | then `PATCH /rosters/:jobId {requirements}` |

  → `POST /jobs {date, …place}` / `PATCH /jobs/:id` (place only when changed).
- **MultiJobForm**: Team (req), Clocking for all, QR; rows Start time, Job/client, Site or Address + Postal code, Work → one `POST /jobs` per row (`teamIds:[team]`).
- **ImportSchedule** dialog (`components/ImportSchedule.tsx`): "Download template" (`GET /jobs/import/template` → `siteclock-schedule-template.xlsx`); file input `.xlsx,.csv` → `POST /jobs/import/preview` (multipart) → problems list ("N things to fix in <file>, then upload again") + per-day tables (Start, Job, Where, Who, Crew, ⚠ warnings, "already has N jobs"); when days clash: **Add to them / Replace them** ("Deletes the existing jobs on those days first; people dropped are told") → `POST /jobs/import {mode, rows}` → result → Done jumps to first day.
- **JobQr** (`components/JobQr.tsx`): QR image, Print, "New code" (rotate `POST /jobs/:id/qr`, canEdit only).
- **JobPhotos** (`components/JobPhotos.tsx`): `GET /jobs/:id/photos`, thumbnails, download full (`…&download=1`).
- **SetupPanel**: trades (`POST /trades`, `DELETE /trades/:id`), worker trades (`PUT /trades/user/:userId {tradeIds}`), manning presets (`POST /manning-presets {name, items[{tradeId, qty}]}`, `DELETE /manning-presets/:id`).

#### 2b.14 Shared workers — `web/src/pages/SharedWorkers.tsx`
- `jobs.view` + linked. From/To dates. `GET /links`, `GET /links/hours?from&to` ("Their workers on our jobs": Date, Worker, Their company, On our jobs, Their day), `GET /links/lent?from&to` ("Our workers on their jobs": Date, Worker, For, On their jobs, Whole day, Timesheet — needs timesheets.view). Empty "Nothing in this period.".

#### 2b.15 Working hours (Schedules) — `web/src/pages/Schedules.tsx`
- `schedules.view`; edit `schedules.manage` (prop isAdmin). Shown standalone or as Rules → "Working hours" segment.
- "Roster / exceptions": site + date → `GET /schedules/exceptions` table (Worker, Shift, Status, Late, Early, Left early, In, Out).
- Shift templates table + modal: Name, Start, End ("before start = overnight"), Grace for lateness (min), Early clock-in (inherit (?) / pay / slide / clamp), Days (Mon–Sun checkboxes), Sites (none = company-wide) → `POST /schedules/templates` / `PATCH /schedules/templates/:id`; delete with confirm (warns if assignments) `DELETE`.
- Assign worker to shift: Template, Worker (`GET /workers`), From, To (optional) → `POST /schedules/assignments`; Remove → `DELETE /schedules/assignments/:id`.
- **These templates (days of week, open-ended date range) are the only recurring schedule in the product** — see §3 note.

#### 2b.16 Rules — `web/src/pages/Rules.tsx`
- `rules.manage`. Segments "Overtime, breaks & clock-in" / "Working hours". Loads `GET /rules`, `/sites`, `/teams`, `/links`. Each control saves immediately via `PUT /rules/punch {key: value}` with toast; OT/breaks via modals.
- Cards (titles exact):
  - **Overtime** table + modal "Add/Edit overtime rule" (Applies to: company default or site; Daily threshold (min) default 528; OT multiplier 1.5; Weekly OT cap (min) optional; Early clock-in default `clamp`) → `PUT /rules/overtime`.
  - **Breaks** + modal (Applies to; Deduct (min) 60; Min shift (min) 360; NLB credit (min) 0) → `PUT /rules/breaks`.
  - **Clocking in**: Selfie (`selfiePolicy` SMART/ALWAYS); Off-site clock-ins (`offSiteReview` REVIEW/MARK/BLOCK); Missed clock-out (`missedClockOut` FULL_SHIFT/SHIFT_END/NO_HOURS); Selfie at a site they are not assigned to (`unassignedSelfie` switch, default on); Clock in and out at a base (`baseClocking` switch, default on); **Share workers** (only when linked: `shareWorkers` NONE/SELECTED/ALL); Ask for a photo at first login (`photoAtFirstLogin`).
  - **Supervisors**: "What supervisors may do" → link "Open Roles →".
  - **Roster**: "Tell workers their roster" (`notifyRoster`) — adds Publish day button.
  - **Job clocking**: How workers clock in at their jobs (`jobClocking` OFF/ARRIVE/ARRIVE_LEAVE); Paid hours follow the crew's jobs (`crewMarginBeforeMin` 15 / `crewMarginAfterMin` 30, 0–720, saved on blur); One worker clocks in the crew (`groupJobClocking`) + who (`groupClockBy` ANYONE/SUPERVISORS "Leaders only"); Who clocks in at jobs (Everyone / chosen teams → `jobClockingTeamIds`, at least one team).

#### 2b.17 Roles — `web/src/pages/Roles.tsx`
- `roles.manage`. `GET /roles` → roles + permission catalogue groups. Table: name, tier, scope, users (click → `GET /roles/:id/users`), Edit, Delete (`DELETE /roles/:id`, confirm).
- Editor: Name (max 40, "e.g. Foreman, HR, Accounts"), Scope radio **Whole company** / **Their sites and teams** (`COMPANY|ASSIGNED`), permission checkboxes per group with group "all" tick. Locked roles (Admin) read-only. → `POST /roles` / `PATCH /roles/:id {name, scope, permissions}`.
- Permission catalogue (`backend/src/lib/permissions.ts:14-91`): overview.view; live.view; flagged.view, flagged.review; timesheets.view/edit/approve/reopen/export; workers.view/manage/verify/invite, photos.review; sites.manage; teams.manage; jobs.view/manage/setup; schedules.view/assign/manage; leave.view/approve/manage; payroll.view/manage; reports.attendance/view; rules.manage, terms.manage, roles.manage; assistant.use.

#### 2b.18 Terms — `web/src/pages/Terms.tsx`
- `terms.manage`. `GET /terms`, `GET /terms/acceptances`. "Version N"; textarea; checkbox "ask everyone to accept again" (`reaccept`) → `PUT /terms {text, reaccept}` → "Saved as version N — workers will be asked to accept it." Acceptance table (who accepted which version, when).

#### 2b.19 Leave — `web/src/pages/Leave.tsx`
- `leave.view`; `leave.manage` (prop isAdmin) for types/record/remove; approve needs leave.approve (server).
- Pending requests (`GET /leave/requests?status=PENDING`) Approve/Reject (`POST /leave/requests/:id/approve|reject`), MC docs viewable.
- Approved leave calendar (`GET /leave/calendar?month=`) + month switch; Remove (confirm) (`DELETE` (?)).
- Leave types table (Name, Paid, Default days/year, MC required, Requests) + archived types with Restore (`POST /leave/types/:id/restore`); dialog Name, Default days/year (blank = not tracked, step 0.5), Paid leave, "Photo of the MC / supporting doc" → `POST /leave/types` / `PATCH /leave/types/:id`; Delete (`DELETE /leave/types/:id`).
- **Record leave** modal (admin enters for a worker): Worker, Leave type, From, To (≥ From), Half day, Reason, MC / documents (photos or PDF, up to 5) → `POST /leave/requests/record` multipart (`document` ×n).

#### 2b.20 Payroll — `web/src/pages/Payroll.tsx`
- `payroll.view`; edits `payroll.manage` (server). Month picker. `GET /payroll?month=`, `GET /payroll/holidays`.
- Export CSV / XLSX → `GET /payroll/export?month&format=csv|xlsx`.
- Public holidays table + add (Date, Name "e.g. National Day") → `POST /payroll/holidays`; Remove → `DELETE /payroll/holidays/:id`.
- Table: Employee, Basic, Days worked, Hours worked, OT, OT pay, PH/Rest days, Premium pay, Leave, Gross, Deductions, Net pay, **App payslip** checkbox (`PATCH /workers/:userId {payslipVisible}`), Edit profile.
- **Pay profile modal** "Pay profile — <name>":

| Field | Type | Notes |
|---|---|---|
| Paid by | seg MONTHLY "Monthly salary" / DAILY "Per day worked" / HOURLY "Per hour worked" | explanatory text per type |
| Basic monthly ($) | money, req if MONTHLY | |
| Daily rate ($) | req if DAILY (stored as dailyRate override) | |
| Hourly rate ($) | req if HOURLY | |
| Fixed allowance ($), Housing deduction ($), Other deduction ($) | money | |
| Work days/week | int (not HOURLY), default 6 | |
| OT rate override ($/h) | "auto" | auto = MOM formula basic×12/(52×44)×1.5; DAILY daily×days/44×1.5; HOURLY ×1.5 (`Payroll.tsx:56-69`) |
| Daily rate override ($) | MONTHLY only, "auto" = basic×12/(52×days) | |
| Off days | Mon–Sun chips → `restDays` (blank = working hours, else Sunday) | |
| PH / off days worked | seg DOUBLE_DAY / OT_RATE / FIXED_HOURLY → `premiumMode`; FIXED → Rate on PH/off days ($/h) | |
| Overtime on ordinary days | Paid / Not paid → `weekdayOt` | |

  → `PUT /payroll/profiles/:userId` (all money as cents).

#### 2b.21 Reports — `web/src/pages/Reports.tsx`
- `reports.attendance|reports.view` (`isAdmin` = reports.view shows fraud). From/To; `GET /reports/attendance-summary`, `GET /reports/fraud-summary`; download attendance export XLSX. Sections "Attendance by site", "Fraud / flags".

#### 2b.22 Platform (superadmin) — `PlatformOverview.tsx`, `Companies.tsx`, `PlatformUsers.tsx`
- **Platform**: `GET /companies/platform/overview` (users by role, recent activity across companies), "View a company as its admin" (→ view-as), Superadmins list + add (Phone, Name → `POST /companies/platform/superadmins`).
- **Companies**: `GET /companies`, `/companies/stats`, `/companies/platform/links`. Table Name, Source, Users, Sites, **Linked with**, Fraud policy, Active. "+ New company" (Company name, Fraud signals FLAG/BLOCK → `POST /companies`); "+ Add company admin" / per-row "Add admin" (Company, Admin name, Phone → `POST /companies/:id/admins`, makes a second account if phone exists elsewhere); **"Link companies"** modal (Company, Linked with; must differ → `POST /companies/:a/links {companyId:b}`); Unlink (confirm "Shared workers drop out of each other's job pickers; existing jobs and hours stay." → `DELETE /companies/:id/links/:otherId`); Activate/Deactivate (`PATCH /companies/:id {active}`); **Delete** (confirm + type company name → `DELETE /companies/:id`, erases everything).
- **All Users**: search name/phone/emp no, company filter → `GET /companies/platform/users?…`; edit Name/Phone/Employee no/Role → `PATCH /companies/platform/users/:id`; Deactivate (confirm), Delete (`DELETE`), Reset device (`POST …/reset-device`). (`viewerIsOwner` gates some actions (?).)

#### 2b.23 AssistantChat (web) — `web/src/components/AssistantChat.tsx`
- Floating FAB → panel. Same API as app (`/assistant/history|chat|confirm|reset`). Quick chips: "What's pending review?", "Who's on site now?", "Late or absent today?", "Leave requests waiting?", "Yesterday's timesheets", "OT this week so far"; admin extras "Bulk approve yesterday's pending timesheets", "Payroll summary this month", "Who has no pay profile set up?". Attach image/PDF ≤ 4 MB (jpeg/png/webp/gif/pdf). Pending action → ✓ Confirm / ✕ Cancel. Resets per company in view-as.

#### 2b.24 Guide (web) — `web/src/components/Guide.tsx`, `web/src/lib/guide.ts`
- Step-through per role, can jump to tabs (`onGo`); seen-flag per user+role in localStorage; reopen "How to use SiteClock".

---

## 3. Flows (UI side)

### 3.1 Worker

**First login**
1. Install app → LoginScreen → phone (country picker) → "Send code" (`POST /auth/request-otp`; WhatsApp OTP).
2. Enter 6-digit code → `POST /auth/verify-otp {phone, code, deviceId}` + `x-bind-flow: photo`.
   - Unbound account → bound silently (audit DEVICE_BIND).
   - Bound to another phone → "Move to this phone?" → `POST /auth/bind-device` → next punch from this phone needs a selfie (`NEW_DEVICE`) and is reviewed.
   - Not registered → 404 "Phone not registered".
3. `/auth/me` → shell by tier → **TermsGate**: must scroll to end, tick, Accept (`POST /terms/accept`) if company terms version not yet accepted (offline → skipped).
4. UpdateCheck dialog (optional/forced) → AppGuide coach marks (first time per role).
5. Photo at first login: if Rules → "Ask for a photo at first login" and no photo on record, `photo.status = REQUESTED, auto = true` → Profile card says so and **any clock-in first forces `takeRecordPhoto`** (front camera + face check → `POST /photos/mine`); photo waits for admin approval (Workers → New photos).
6. Self-registration alternative: invite link `#join=<token>` on web (phone OTP, name, emp no, selfie) → join request → admin approves → worker logs in on the app.

**Daily clock-in → job → photos → delivery → clock-out** (`home_screen.dart:_punch`)
1. Clock tab loads today's jobs/entries/shift; GPS shows distance to the target (job place or site).
2. Tap CLOCK IN. Order of checks: delivery guard (OUT only) → photo-on-record required → 5-s debounce → open entry at another site blocks plain clock-in ("You are still clocked in at another site…") → late first clock-in dialog ("Clocking in late … Your start time will be recorded as now") → end-of-day clock-out confirm with **"I had no lunch break today"** (→ `nlb:true`) → QR scan if job `qrRequired` → group sheet if group clocking → GPS fix (location permission; `maxAccuracyM` of the site, default 100 in app) → device checks (rooted, mocked location).
3. Selfie needed client-side if outside the fence (unless off-site BLOCK — then server decides), poor accuracy, or selfie policy ALWAYS; server can still answer `SELFIE_REQUIRED` with a reason → app opens the camera and resends.
4. `POST /punches {siteId, jobId?, endsDay?, userIds?, qrToken?, type, lat, lng, accuracyM, deviceTime, mocked, nlb?, rooted, deviceId, idempotencyKey, photo?, workerNote?}`.
5. Outcomes: success snack ("Clocked in at <job>."; "Clocked out of <job> — still on the clock."; "… Day ended."); `flagged:true` → "Recorded — pending supervisor approval (<reason>)"; `PHOTO_REQUIRED` → take record photo then retry; `QR_WRONG`; `ALREADY_PENDING`; `OUTSIDE_FENCE` (BLOCK mode) → server sentence; other → "Blocked: <msg>"; network error → queued (Flow: offline).
6. After IN: auto-open the first unfinished **Delivery** job (AIMS) → run screen → End job → photos → sign-off → Done screen → "Done, clock out" (runs the same `_punch`, guard included).
7. Between jobs: big button moves to the next job (jobIn) — worker can override with the job picker or "End my day". Jobs tab cards offer the same actions.
8. After OUT at a photo-enabled AIMS job (no delivery): "Add photos?" → camera/gallery → PhotoQueue.
9. Last job clock-out (`jobOutEndDay`) or plain clock-out ends the day (confirm + NLB checkbox).

**Group punches**: Rules → group clocking on (and `groupClockBy` permits) → at a job, sheet lists eligible crew → ticked people get the same punch "recorded by" me (`/punches/group`); per-person failures listed; not queued offline. Flagged page shows "by <name>".

**Offline queue**
- Punches (`services/punch_queue.dart`): network error (no HTTP response) → stored in SharedPreferences `punch_queue` with `queuedAt` + `idempotencyKey`; selfie path kept. Sync on Clock-tab open and "Sync" button; stops at first network failure; a 4xx/5xx response or missing selfie file **drops** the item. Server applies at `queuedAt` (clamped) and marks `offlineSynced`. Switch company is refused while items are queued.
- Photos (`services/photo_queue.dart`): every job/delivery photo copied to app documents with a `clientId` immediately; sent on app start/resume, after punches sync, and when the job's photos open; job photos wait until no punches are queued; 4xx kept as "Not sent: <reason>" (Retry / Remove); network/5xx keep waiting. Server dedupes by `clientId` / `Idempotency-Key`. Delivery photos stay until their step is released.

**Forgotten clock-out / missed entry**
- Auto-closed day (site `autoCloseAfterH`, default 14; result per Rules → Missed clock-out) shows AUTO_CLOSED in History → within 24 h "Still working? Override auto-close" (GPS + selfie, `overrideAutoClose:true`) → reviewed.
- Completely missed day: History → "Missed entry" → site, date, in/out, reason → `POST /timesheets/missed-request` (≤14 days back, no overlap) → PENDING entry + push to site staff → approved on Timesheets.
- OUT without IN → flagged `OUT_WITHOUT_IN`; reviewer supplies the clock-in time on approval.

**Leave request**: Profile → My leave → "Request leave" → type, range, half day, reason, MC photos (required for MC types, ≤5) → `POST /leave/requests` → shows PENDING → cancel possible while cancellable → office approves/rejects (Leave page / app Leave). Office can also "Record leave" directly (shows "Entered by the office").

**Payslip view**: only if admin ticked "App payslip" for the worker on Payroll → Profile → My payslip → month switcher → `GET /payroll/me?month` (approved entries only).

**Switch company** (one phone, account per company): Profile → Switch company (or web sidebar Select) → `POST /auth/switch {userId, deviceId}` → binds this device to that account (silently, or as a device move → selfie on next punch) → new token → app reloads as that user/role.

**Update prompt**: on each app start, `GET /app-version`; below `minBuild` the dialog cannot be dismissed.

### 3.2 Office

**Create / schedule / edit / delete a job**
1. Jobs tab → date → "+ New job for <date>" (web JobForm / app JobEditScreen).
2. Title, start time (optional = all-day), expected duration, clocking override, QR, place (site or free address with postal-code map search), work, crew notes.
3. Crew: tick teams (members on that date appear; untick to exclude → `exceptUserIds`), add individuals (search; linked companies' shared workers appear as "from <company>" with no phone/pay), optional manning preset → requirements per trade.
4. Save → `POST /jobs`; edit → `PATCH /jobs/:id`; delete → confirm → `DELETE /jobs/:id` (there is no separate "cancel" state in the UI; deletion is the cancel).
5. Multi-job: "+ Several jobs for a team" → one team, many rows → one POST per row.
6. Copy day: "Copy previous day" (`/rosters/copy`). Copy week: Week view → "Copy previous week" (`/rosters/copy-week`). Existing jobs are not duplicated.
7. Publish: "Publish day (N)" pushes newly rostered workers (`/rosters/publish` when Rules → Tell workers their roster, else `/jobs/notify`).
8. QR: job QR dialog → print/share; "New code" invalidates printed codes.
9. Spreadsheet import: "⬆ Upload schedule" (jobs.setup) → download template → upload .xlsx/.csv → preview with problems/warnings → Add to / Replace existing days → import.

**Recurring jobs**: **No recurring jobs exist.** Searches for `recurr|rrule|repeat every|weekly job` in `backend/src`, `backend/prisma/schema.prisma`, `web/src`, `app/lib` return nothing. Repetition is only via (a) "Copy previous day" / "Copy previous week" (manual), (b) spreadsheet import, (c) **shift templates** in Working hours (days-of-week + assignment date range, open-ended "ongoing") — these define expected working hours/lateness, not jobs.

**Approve timesheets**
1. Timesheets → filter → tick PENDING/AUTO_CLOSED rows → "Approve selected" (`/timesheets/approve-bulk`). Entries with `needsReview` (pay follows crew beyond margins / no crew data) are skipped (`NEEDS_REVIEW`) and must be approved one by one after opening the detail ("review" badge with `crewNote`). The UI does not report skipped ones.
2. Single: Approve / Reject buttons. NLB claims: detail → Approve NLB / Dismiss.
3. App: Timesheets tab → "Approve all listed (N)".

**Fix punches**
- Flagged page/app: Approve (optionally change punch time; supply missing clock-in) / Reject with note. Marked view for MARK-mode punches. Face verification log.
- Edit entry: Edit → clock in/out + note (`PATCH`; an admin edit is final — no crew logic afterwards).
- Reopen: detail → "Delete clock-out & reopen" (`timesheets.reopen`). Delete: "Delete timesheet".
- Worker identity: Workers → "Verify next punch" (next punch needs selfie, `VERIFY_REQUESTED`); Reset device; Ask for photo.

**Run payroll**
1. Payroll → month → set **pay profiles** per worker (Edit) → add public holidays.
2. Review computed table (approved timesheets only; leave; premiums).
3. Export CSV/XLSX. Optionally tick "App payslip" per worker.

**Manage sites / teams / workers**
- Sites: add with map pin/geocode, radius, accuracy, auto-close hours, kind Work site/Base (+ all workers).
- Teams: create with start date, change members with effective date, supervisors, history edits.
- Workers: add (phone, name, role, overrides, sites, supervises, leave entitlements, photo) — duplicate phone in another company creates a second account with notice; invites (links with label/role/site/templates/expiry/max uses/leave days) shared via WhatsApp; join requests approve/reject; device reset; photo requests/approvals; change number; deactivate.

**Roles**: Roles tab → New role → name, scope, permission ticks → assign via Workers → Role. App tabs/web tabs update from `/auth/me`.

**Rules**: Rules tab — every control autosaves (`PUT /rules/punch`) except OT/break modals.

**Linked companies (platform admin)**: Companies → "Link companies" (A, B) → each company's admin sets Rules → Share workers (NONE/SELECTED/ALL) and ticks workers → linked company sees them in job crew pickers → worker sees "For <company>" jobs in the app and clocks with same login → hours split shown on Timesheets ("for <company>: …") and Shared workers page; payroll never crosses. Unlink keeps history.

**Assistant chat**: FAB (web/app) → question or instruction (+ image/PDF) → read answers; write actions come back as a pending summary that must be Confirmed.

### 3.3 Cross-cutting notes

- **i18n**: none. All strings hard-coded English in Dart and TSX; `intl` (`app/pubspec.yaml:44`) is used only for `DateFormat`. Money formatted `$x.xx`; dates `toLocaleDateString` on web.
- **Flag-gated / server-turned-on UI**:
  - `VITE_API_URL`, `VITE_AIMS_URL` (`components/AppSwitcher.tsx:4`), `VITE_CLERK_LOGIN`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_DOMAIN`, `VITE_CLERK_SIGN_IN_URL`, `VITE_CLERK_SIGN_IN_BUTTON` (`lib/clerk.tsx:21-31`; Clerk/AIMS SSO only on the configured hostname).
  - App `--dart-define=API_URL`.
  - Per job from server: `photosEnabled` (AIMS job + API client with AIMS return path — `backend/src/lib/jobPhotos.ts:69`), `deliveryEnabled` (AIMS job flag), `qrRequired`, `clocking`, `fromCompany`, `externalUrl`.
  - AIMS org flags: `enableWctOrders` (wording Job vs Delivery), `enableWctFinishModes` (Skip-signature finish).
  - Company rules: `notifyRoster` (Publish day button), `groupJobClocking`, `photoAtFirstLogin`, selfie/off-site policies, base clocking, `shareWorkers` (card only when linked), Shared workers tab only when linked.
  - Per worker: `payslipVisible` (My payslip entry), `accounts.length > 1` (switchers).
  - `devCode` in OTP responses shown on login/signup (dev servers).
- **Not obvious things users rely on**:
  - App Clock tab picks the target automatically (job you are standing at, else next by time); the job picker and "End my day" are hidden behind the job row.
  - Selfie is a soft check (face detection never blocks).
  - Group punches and job-tab punches are not queued offline; plain Clock-tab punches are.
  - Queued punches with a server refusal are silently dropped.
  - Terms gate fails open offline; update check never blocks unless below `minBuild`.
  - "Web login code" in the app lets a supervisor log in on the web without SMS/WhatsApp (`channel: manual`).
  - Workers without permissions cannot use the web dashboard at all.
  - Admin app lacks many settings (site kind/auto-close, per-worker overrides, most Rules, payroll, roles, terms, exports) — those are web-only; app More says exports are on the web.
  - Approving in bulk silently skips needsReview entries (web and app).
  - App Rules still shows "Supervisors can approve timesheets" (`PUT /rules/punch supervisorsApproveTimesheets`), which the web replaced with Roles permissions.

### 3.4 Reference tables the UI depends on

**Punch flag reasons shown to reviewers** (`backend/prisma/schema.prisma:76-90`, enum `FlagReason`): FACE_MISMATCH, VERIFY_REQUESTED, OUTSIDE_FENCE, MOCKED, ROOTED, NEW_DEVICE, OFFLINE, TIME_DRIFT, OUT_WITHOUT_IN, AUTO_CLOSE_OVERRIDE, NOT_ASSIGNED, POOR_ACCURACY, QR_MISSING. The app shows the raw code in "Recorded — pending supervisor approval (<reason>)"; Flagged shows the code (QR_MISSING rewritten as text).

**Timesheet entry statuses** (badges on web/app): OPEN, PENDING, APPROVED, REJECTED, AUTO_CLOSED (+ `needsReview` "review", `nlbClaimed` "NLB?", `nlb` "NLB", `editedById` "✎").

**Punch API answers the app branches on** (`home_screen.dart:880-1000`, `jobs_screen.dart:555-625`):

| Answer | App behaviour |
|---|---|
| 2xx `flagged:false` | success snack; reload; offer photos (OUT) / open delivery (IN) |
| 2xx `flagged:true` | "Recorded — pending supervisor approval (<flagReason>)" or "Recorded with selfie — pending…" |
| `SELFIE_REQUIRED` + `reason` | open selfie dialog for that reason, resend multipart |
| `PHOTO_REQUIRED` | refresh photo status, force record photo, ask to clock again |
| `QR_WRONG` | "That is not the code for <job> — scan the one posted at the job." |
| `ALREADY_PENDING` | "This punch is already waiting for supervisor approval…" |
| code `OUTSIDE_FENCE` (BLOCK mode) | server sentence (where, how far, within what) |
| `BASE_NOT_ALLOWED` (422) | shown as "Blocked: <Yard> is a base. Clock in at the job or work site instead." |
| not today (job tab) | "This job is not today — you can only clock in on the day." |
| no HTTP response | plain punch → queued "No connection — punch queued, it will sync automatically."; group/job-tab → "No connection — try again." |
| any other error | "Blocked: <message>" |

**Socket.io events the UIs listen to**: `punch:flagged`, `punch:reviewed` (app flag badge), `site:presence`, `site:punch` (app Live, web Live Site). Server also emits `worker:deviceRebound`, `worker:accountDeleted` (no UI listener found (?)). App socket: `app/lib/services/socket_service.dart`; web: `socket.io-client` in `LiveSite.tsx:28`.

**Screen → permission quick map (app)**: Jobs tab `jobs.view`; Live `live.view`; Flagged `flagged.view`; Profile links: My team `workers.view`, Timesheets `timesheets.view`, Leave requests `leave.view`, Working hours `schedules.view`, Join requests & invites `workers.invite`, Export attendance `reports.attendance|reports.view`; Teams edit `teams.manage`; Workers edit `workers.manage`; New job `jobs.manage`; template actions `schedules.manage`; entry reopen/delete `timesheets.reopen`; assistant FAB `assistant.use`. Admin tier (role COMPANY_ADMIN) sees everything regardless.

---

> Sections 4 and 6: paths are relative to `backend/src/` unless they start with `prisma/` (= `backend/prisma/schema.prisma`).

## 4. Business rules (exact)

### 4.1 Time primitives and timezones (`lib/time.ts`)
- `localDate(utc, tz)` returns the `yyyy-MM-dd` of a UTC instant in `tz` (luxon) (`lib/time.ts:4`).
- `localTimeToUtc(date, "HH:mm", tz)` turns a local wall time into a UTC Date (`:9`). DST is handled by luxon. The default zone everywhere is `Asia/Singapore`.
- `minutesBetween(a,b) = Math.round((b-a)/60000)`. **This rounding to the nearest minute is the only rounding in the system.** There is no 15-minute or other rounding rule (`:17`).
- `weekdayOf(date)` uses luxon weekdays, 1=Mon … 7=Sun (`:22`). The same numbering is used for `ShiftTemplate.daysOfWeek` and `PayProfile.restDays`.
- `todayIn(tz)` (`:30`).
- **workDate** is the local date of the clock-IN at the *site's* timezone (`punches.service.ts:418`, `prisma/schema.prisma` TimeEntry.workDate). It is recomputed from `clockInAt` on an admin edit (`timesheets.router.ts:171`). For a manual entry or missed request it comes from `clockInAt` in the site's timezone.
- Several "today" values come from the **company** timezone: jobs (`jobs.router.ts:37`), `/auth/me` job sites (`auth.router.ts:322`), team "today" (`teams.router.ts:40`), and supervision (`lib/supervision.ts:30`). The site timezone is used for punch workDate, shift matching and the reminders.
- Overnight shifts: when a template has `endTime <= startTime`, the end is +24 h (`timesheets.service.ts:60`, `lib/missedClockOut.ts:55`, `jobs/reminders.ts:74`). The entry stays on its clock-in workDate.
- Jobs are matched over `aroundDates(d) = [d-1, d, d+1]` for job punches and job sites (`lib/jobs.ts:293`). crewSpan, workedFor and `findOpenEntryForOut` look at `[workDate, workDate+1]`.
- Oddities:
  - `GET /rosters/mine` uses the UTC date (`rosters.router.ts:213`).
  - Invite approval sets the shift `startDate` from the server-local date `toLocaleDateString("sv")` (`invites.router.ts:160`).
  - The cron jobs run in the server timezone. Comments assume UTC, so "09:00 SGT" means `0 1 * * *` (`jobs/autoclose.ts:105-111`).

### 4.2 Shift matching (`timesheets.service.ts:10 matchShift`)
- A ShiftAssignment for the user applies when `startDate <= workDate`, `endDate` is null or `>= workDate`, the template is active, `daysOfWeek` contains the workDate's weekday, and the template covers the site (`siteIds` is empty, meaning company-wide, or contains siteId) (`lib/templateSites.ts:5`).
- Site-specific templates are preferred over company-wide ones. The first match wins.
- The site used is the entry's **clock-in** site.

### 4.3 computeEntry: time math (`modules/timesheets/timesheets.service.ts:30-146`)
It runs whenever an entry closes (OUT, auto-close, stale close, edit, manual entry, missed request, punch-approval reclose). Results are snapshots: a later rule change does not recompute old entries (comment `:28`).

1. **Shift and lateness** (only when matchShift finds a shift):
   - `expectedStart = localTimeToUtc(workDate, template.startTime, site.tz)`.
   - `lateMinutes = max(0, minutes(expectedStart → clockIn) − template.graceLateMin)`. Grace defaults to **10** (`prisma` ShiftTemplate.graceLateMin) and accepts 0–120 (`schedules.router.ts:40`).
   - `earlyMinutes = max(0, minutes(clockIn → expectedStart))`. No grace applies; it is informational.
   - **Early mode** precedence: `template.earlyMode`, then legacy `template.payEarly` (true→pay, false→clamp), then `OvertimeRule.earlyMode`, then legacy `OvertimeRule.countEarlyAsWork` (true→pay), else **clamp** (`:53-57`).
     - `clamp`: paidStart = expectedStart when the worker is early.
     - `pay`: paidStart = clockIn, so early time can become OT.
     - `slide`: paidStart = clockIn **and** expectedEnd −= earlyMinutes (`:61`).
   - `expectedEnd = localTimeToUtc(workDate, endTime)`, +24 h if it is `<= expectedStart`.
   - `leftEarlyMinutes = max(0, minutes(clockOut → expectedEnd))`. No grace applies.
   - With no shift, late, early and leftEarly are all 0 and paidStart = clockIn.
2. **Pay follows crew** (`crewSpan`, see 4.4). When it applies, `paidStart = max(crew.paidStart, paidStart)` and `paidEnd = crew.paidEnd` (`:74-78`).
3. `gross = max(0, minutes(paidStart → paidEnd))` (`:80`).
4. `workedFor` split (4.5).
5. **Break** (`BreakRule`):
   - Rule choice: a site-specific rule beats the company rule (`siteId` null) (`:86-89`).
   - Defaults are `deductMinutes 60`, `minShiftMinutes 360`, `nlbCreditMinutes 0` (prisma BreakRule). Allowed ranges: deduct 0–240, minShift 0–1440, nlbCredit 0–240 (`rules.router.ts:63-68`).
   - `deduct = entry.nlb ? max(0, deductMinutes − nlbCreditMinutes) : deductMinutes`.
   - `breakMin = gross >= minShiftMinutes ? deduct : 0`. With no rule, it is 0.
   - `net = max(0, gross − breakMin)`.
   - **NLB (no lunch break)**: the worker sends `nlb:true` on the clock-OUT, which sets `TimeEntry.nlbClaimed` (`punches.service.ts:441`). An admin sets `nlb` true or false with `PATCH /timesheets/entries/:id {nlb}`, which also clears `nlbClaimed` (`timesheets.router.ts:180`). Because the default `nlbCreditMinutes` is 0, **an approved NLB credits nothing until a company sets a credit**.
6. **Overtime** (`OvertimeRule`, site rule beats company rule):
   - `threshold = dailyThresholdMin ?? 528`. 528 min = 8.8 h, i.e. 44 h over 5 days. Allowed 0–1440.
   - `ot = max(0, net − threshold)`.
   - **Weekly cap** (`weeklyCapOtMin`, null means none): the week is Mon–Sun of the workDate (computed in UTC on the date string). `alreadyOt` is the sum of `otMinutes` of the user's other entries that week that are not REJECTED. Then `ot = min(ot, max(0, cap − alreadyOt))`, and the excess becomes regular time (`:104-121`).
   - **No weekly threshold.** OT is daily only, with an optional weekly OT *cap*.
   - `regular = net − ot`.
   - `otMultiplier = rule.otMultiplier ?? 1.5` (allowed 1–3) is stamped on the entry.
   - Weekday OT on or off, rest days and PH are **not** handled here. They are handled in payroll (4.7).
7. The fields persisted (`:124-145`):
   - status (PENDING, or AUTO_CLOSED for system closes), gross, break, regular, ot, otMultiplier, late, early, leftEarly, shiftAssignmentId;
   - paidFromAt/paidToAt, crewFirstInAt/crewLastOutAt, needsReview and crewNote (crew rule only);
   - workedFor (Json or DbNull).

### 4.4 Paid hours follow the crew (`timesheets.service.ts:199-246 crewSpan`)
- It applies only when `User.payFollowsCrew` is true **and** `entry.editedById` is null.
  - An admin edit is final: no crew logic runs and the fields are cleared.
  - NB: worker missed-requests, manual entries and punch-approval reclose/missed-in all set editedById, so they also skip it.
- Margins: `before = user.crewMarginBeforeMin ?? company.crewMarginBeforeMin` (default **15**). `after = user.crewMarginAfterMin ?? company.crewMarginAfterMin` (default **30**). Allowed range 0–720 (`rules.router.ts:106`, `workers.router.ts`).
- Jobs considered: the company's own live jobs dated `workDate` or `workDate+1` that have this user as crew.
  - No jobs: paid as clocked, needsReview, note "Not on any job's crew this day — paid as clocked. Check the hours."
- Clockings considered: punches that are not REJECTED, with serverTime within **±6 h** of the entry (clockIn−6h to clockOut+6h), and either:
  - other crew members' punches tagged to those jobs;
  - other crew members' plain punches (`jobId` null) at those jobs' sites;
  - this worker's **own job** punches. Their own plain punches are never counted.
- No clockings: paid as clocked, needsReview. The note is "No clockings on this day's jobs, by the crew or by them…" or, when nobody else is on the crew, "No one else on the crew and no job clockings of their own…".
- Calculation:
  - `crewFirst` = earliest clocking, `crewLast` = latest.
  - `paidStart = max(crewFirst − before, clockIn)`.
  - `paidEnd = min(crewLast + after, clockOut)`.
  - If `paidEnd <= paidStart`: paid as clocked, needsReview, "The crew's clockings fall outside this worker's own…".
- Trimmed time:
  - Trimmed at the start: note "Clocked in X before the crew's first job clock-in; {before} paid." where X = cut + before.
  - Trimmed at the end: the same pattern for clock-out.
  - needsReview = any trim happened (`:240-245`).
- `needsReview` entries are **skipped by bulk approve** with the result `NEEDS_REVIEW` (`timesheets.router.ts:290`). They can still be approved one at a time.

### 4.5 workedFor split, for shared workers (`timesheets.service.ts:167-197`)
- Inputs are the worker's own job punches (any company, not REJECTED, within ±6 h), in time order.
- For each job **IN** whose job belongs to a *different* company than the entry's company:
  - The span ends at the first OUT on the same job, else the next IN on a different job, else the entry's clockOut.
  - It is clipped to [paidStart, paidEnd] and added in rounded minutes to `out[job.companyId]`.
- With no job punches at all: if the live jobs on workDate and workDate+1 with this user as crew all belong to **one** other company, that company gets the whole paid span. A mixed day stays with home.
- The result is `{companyId: minutes}`, or null. Payroll never reads it (`lib/links.ts` comment). It is only shown via `/links/hours`, `/links/lent` and timesheet rows.

### 4.6 Missed clock-out / auto-close (`lib/missedClockOut.ts`, `jobs/autoclose.ts`)
- The cron runs `*/15 * * * *`. It loads every OPEN entry and closes those with `ageH >= site.autoCloseAfterH` (default **14**, allowed 1–48 per `sites.router.ts:21`) (`jobs/autoclose.ts:18-54`).
- The close time follows `Company.missedClockOut` (default **FULL_SHIFT**), capped at `now` (or at `before` for a stale close):
  - `FULL_SHIFT`: clockIn + the matched shift's length (basis `shift_length`), else clockIn + autoCloseAfterH (basis `window`).
  - `SHIFT_END`: the shift's scheduled end, or clockIn if the shift already ended (basis `shift_end`). With no shift it falls through to the NO_HOURS logic.
  - `NO_HOURS`: the last OK job punch on this entry after clockIn (basis `last_job_clocking`), else clockIn itself, giving 0 h (basis `no_hours`).
- The entry gets `computeEntry(…,"AUTO_CLOSED")`, an audit row `ENTRY_AUTO_CLOSE` (actor null) carrying `{rule, basis, autoCloseAfterH}`, and a push "Shift auto-closed" to the worker. The push text depends on the basis and suggests "Still working? Override".
- **Stale close at next clock-in** (`punches.service.ts:394-404, 464-496`): a new IN closes every OPEN entry of the user with `workDate < today` (today = local date of the punch at the site's timezone).
  - If an unreviewed FLAGGED plain OUT punch exists after clockIn: close at that punch's time, status PENDING, link the punch, audit `ENTRY_CLOSE_AT_PENDING_OUT`.
  - Otherwise: apply the missedClockOut rule capped at the new IN time, status AUTO_CLOSED, audit `ENTRY_AUTO_CLOSE`.
- **Override**: the worker sends OUT with `overrideAutoClose=true` and no open entry.
  - It needs an AUTO_CLOSED entry at the same site with clockIn in the last **24 h** (`RECLOSE_WINDOW_H`), otherwise 422 `NO_AUTO_CLOSED_ENTRY`.
  - A selfie is mandatory (`SELFIE_REQUIRED reason AUTO_CLOSE_OVERRIDE`).
  - The punch is FLAGGED `AUTO_CLOSE_OVERRIDE` with audit `AUTOCLOSE_OVERRIDE_REQUEST`.
  - Approval re-closes the entry at the punch time (`punches.service.ts:240-246, 551-561`).
- AUTO_CLOSED entries can be approved or rejected like PENDING ones (`decideEntry`). Export does **not** exclude them, despite the comment in `jobs/autoclose.ts:16`.

### 4.7 Reminders (`jobs/reminders.ts`)
- Runs `*/5 * * * *`. Window dedupe: a reminder fires only if its moment is in `(lastTick, now]`. `lastTick` is held in memory, so a restart can skip or duplicate reminders.
- **Clock-in reminder**:
  - For each active ShiftAssignment of an active user who has an fcmToken, on a weekday in the template: fire at `start − 15 min` in the template site's timezone (company-wide templates use the SG default (?)).
  - It is skipped if there is any entry with that workDate, any punch since start−12 h, or approved leave that day.
  - Push "Shift starting soon" / "Your {name} shift starts at HH:mm. Remember to clock in when you arrive." with kind `clockin_reminder`.
- **Clock-out nags**:
  - For each OPEN entry with a matched shift: fire at `end + 15 + k×60 min` for k = 0..3, so **4 nags**.
  - Push "Still clocked in?". k=0 says "Your shift ended at … Don't forget to clock out." Later ones say "… about Nh ago. Clock out now, or this entry will be closed automatically." Kind `clockout_reminder`.
- **API job reminders**: runs every minute. For external jobs with status SCHEDULED and startAt in `(since+15m, now+15m]`, push "Job starting soon" to each active crew member who has a token (`:102-120`).
- **Flag reminder**: daily at `0 1 * * *` (09:00 SGT). For each site with FLAGGED punches, push to that site's staff: "Flagged punches awaiting review" / "{n} flagged punch(es) at {site} still need(s) review." (`jobs/autoclose.ts:57-75`).

### 4.8 Punch rules: `createPunch` in exact order (`modules/punches/punches.service.ts:92-343`)
Input (`punches.router.ts:39-61`), multipart or JSON:
- `siteId`, `type` IN|OUT, `lat` (−90..90), `lng`, `accuracyM >= 0`;
- `deviceTime?` and `queuedAt?` (ISO);
- `mocked?`, `rooted?`, `deviceId?`, `idempotencyKey? (≤100)`, `overrideAutoClose?`, `workerNote? (≤300)`, `nlb?`;
- `jobId? (≤60)`, `endsDay?`, `qrToken? (≤120)`;
- file `photo` (an image of at most 8 MB, stored as `uploads/punches/<ts>-<hex>.jpg|png`).

Router pre-checks:
- (a) zod validation fails → 400.
- (b) If the request has an `X-App-Version` header **and** it is not an offline sync (`queuedAt` absent) **and** the user has an open PhotoUpdate with status REQUESTED → **409 `PHOTO_REQUIRED`** `{photoRequired:true}` (`punches.router.ts:96`).

Service steps:
1. **Idempotency**: an existing punch with the same `idempotencyKey` (globally unique column) is returned with `duplicate:true` and HTTP 200. Nothing else runs.
2. Site must exist, be active, and the user must have a company. Otherwise 422 `SITE_NOT_FOUND`. A site of another company is allowed only if `isLinked(userCo, siteCo)` (CompanyLink either direction), else `SITE_NOT_FOUND` (`:98-104`).
3. **Job punch** (`jobId` given):
   - The job must be in the **site's company**, have the user on its crew, and be live (not a cancelled external job), with an active site. Otherwise `JOB_NOT_FOUND`.
   - `job.date` must be in aroundDates(today in the *company* timezone), otherwise `JOB_NOT_TODAY`.
   - The site becomes the job's site (`:111-120`).
   - `endsDay = job && type==OUT && endsDay===true`.
   - `onBehalf = !!recordedBy` (group punch).
4. **QR** (only when `job.qrRequired`):
   - A token that doesn't match `job.qrToken` → 422 `QR_WRONG`.
   - No token and no photo and not onBehalf → 400 `SELFIE_REQUIRED reason QR_MISSING`. With a photo, `qrMissing` is set (flagged later).
5. **Offline back-dating**: if `queuedAt` is valid and in the past, `effectiveTime = max(queuedAt, now − 48 h)` (`OFFLINE_CLAMP_H=48`) and `offlineSynced = true`. Otherwise effectiveTime = now (`:132-143`).
6. **Job-site redirect**:
   - jobSiteIds = the sites of live jobs on aroundDates(local date of effectiveTime) with the user as crew.
   - If this is not a job punch, the user has job sites, and the point is outside the sent site's fence, the punch moves to the nearest job site whose fence contains the point (for older apps that keep a stale site selected) (`:148-156`).
   - Then, if the site belongs to another company and there is no job and it is not a job site → `SITE_NOT_FOUND`.
7. `assignment` = the SiteAssignment for (user, site).
8. **Base**: a site of kind BASE without a job.
   - Allowed = `user.baseClocking ? user.baseClocking==="ALLOWED" : company.baseClocking` (company default **true**).
   - Not allowed → 422 `BASE_NOT_ALLOWED` with message "{site} is a base. Clock in|out at the job or work site instead." and `{siteName}`.
9. `assigned = assignment || job || jobSiteIds.has(site) || (BASE && site.allWorkers)`.
10. Geometry:
    - `distanceM = haversine` with R = 6371000 (`lib/geo.ts`). `insideFence = distanceM <= site.radiusM`.
    - Defaults: site radius **150 m** (20–5000), maxAccuracy **50 m** (10–500). JOB sites use 200 m / 100 m (`lib/jobs.ts:38-39`). Sites created by `/v1` use 200 m by default (50–2000).
11. `offSiteRule = user.offSiteClocking ?? company.offSiteReview` (default **REVIEW**).
12. **Selfie policy**: `selfieRule = user.selfiePolicy ?? company.selfiePolicy` (default **SMART**). With `ALWAYS`, no photo and not onBehalf → 400 `SELFIE_REQUIRED reason POLICY`. SMART has no check of its own: selfies are demanded only by the conditions below.
13. **Flag evaluation**, if/else chain, so only the first reason applies (`:191-223`):
    - a. `mocked`: if `company.fraudPolicy==BLOCK` (default FLAG; only a superadmin can set it via `PATCH /companies/:id`) → 422 `MOCKED_LOCATION`. Otherwise flag `MOCKED`.
    - b. else `rooted`: BLOCK → 422 `ROOTED_DEVICE`. Otherwise flag `ROOTED`.
    - c. else `accuracyM > site.maxAccuracyM || !insideFence`:
      - Outside the fence with offSiteRule `BLOCK` → 422 `OUTSIDE_FENCE`, message "You must be at {site} (within {r} m) to clock in|out. You are {d m | x.x km} away." with `{distanceM, radiusM, siteName}`. A poor fix measured *inside* the fence is not blocked.
      - No photo and not onBehalf → 400 `SELFIE_REQUIRED reason OUTSIDE_FENCE`.
      - Flag `POOR_ACCURACY` if inside the fence, else `OUTSIDE_FENCE`.
    - d. else onBehalf: device checks are skipped.
    - e. else `!user.deviceVerified || user.verifyRequested`: no photo → 400 `SELFIE_REQUIRED reason VERIFY_REQUESTED|NEW_DEVICE`. Flag `VERIFY_REQUESTED` or `NEW_DEVICE`.
    - f. else `deviceId` was sent, the user has a deviceId, and they differ → flag `NEW_DEVICE`. No selfie is required here.
    - g. else, when not an offline sync, `deviceTime` was sent, and `|deviceTime − now| > 5 min` (`DRIFT_LIMIT_MIN`) → flag `TIME_DRIFT`.
14. When there is no flag yet, `offlineSynced`, and `now − effectiveTime > 60 min` (`OFFLINE_FLAG_GAP_MIN`) → flag `OFFLINE`.
15. When there is no flag yet and `qrMissing` → flag `QR_MISSING`.
16. When there is no flag yet and not `assigned` → flag `NOT_ASSIGNED`. If `company.unassignedSelfie` (default **true**) and there is no photo and not onBehalf → 400 `SELFIE_REQUIRED reason NOT_ASSIGNED`.
17. **OUT sequencing** (a plain OUT, or a job OUT with endsDay):
    - `openEntry = findOpenEntryForOut(user, site)`. That is the OPEN entry at this site, else the user's latest OPEN entry if this site is a JOB-kind site of a live job with the user as crew on that entry's workDate or workDate+1 (`:506-518`).
    - With no open entry and `overrideAutoClose`, see 4.6.
    - Else with no open entry and no flag yet → flag `OUT_WITHOUT_IN`.
18. **ALREADY_PENDING**: if there is a FLAGGED punch of the same type for the same job (or the same site when there is no job) since `openEntry.clockInAt` (for an OUT with an open entry) or else in the last **6 h** (`PENDING_BLOCK_H`) → 422 `ALREADY_PENDING` (`:257-264`).
19. **MARK**: `marked = flagReason ∈ LOCATION_FLAGS{OUTSIDE_FENCE, POOR_ACCURACY, NOT_ASSIGNED, QR_MISSING} && offSiteRule==="MARK"`. A marked punch is saved with status **OK** and keeps its flagReason (`:85, 270`).
20. Create the Punch:
    - `status = flag && !marked ? FLAGGED : OK`;
    - `serverTime = effectiveTime`;
    - `distanceM` rounded;
    - plus mockedFlag, rootedFlag, offlineSynced, deviceId, photoPath, workerNote (trimmed), `nlbClaimed`, jobId, endsDay, recordedById, qrScanned.
21. Async side effects that never block the punch:
    - face scoring (4.9);
    - Nominatim reverse geocode into `address` (`:304-313`).
22. Audit `AUTOCLOSE_OVERRIDE_REQUEST` when that is the flag.
23. If FLAGGED:
    - Socket `punch:flagged` to rooms `site:{id}` and `company:{id}` with `{punchId,userId,name,siteId,type,flagReason}`.
    - Push to site staff: "Flagged punch needs review" / "{name} clocked in at|out of {site} (by a crew member)? ({reason lowercased})", kind `punch_flagged`.
    - Return `{punch, flagged:true}` with HTTP 201.
24. Otherwise `applyPunchEffect` runs and returns `{punch, entry, marked?}` with HTTP 201.

**applyPunchEffect** (`:381-449`):
- **Job punch** that is not an endsDay OUT:
  - If an OPEN entry exists (any site), attach the punch to it and return it.
  - A job OUT with no open entry just runs auto-leave and returns null.
  - A **job IN with no open entry falls through and opens the day**, so the first job arrival starts the day.
- **IN**:
  - First close stale OPEN entries from earlier workDates (4.6).
  - An OPEN entry at the same site already exists → idempotent: attach the punch and return it.
  - Otherwise create an OPEN entry. Its companyId is the **punch's (home) company**, its workDate the local date at the site's timezone, clockInAt = serverTime.
  - Socket `site:punch {action:"add", siteId,userId,name,employeeNo,entryId,clockInAt}` to `site:{id}`.
- **OUT**:
  - `findOpenEntryForOut`. None → null.
  - `closeAt = max(serverTime, clockInAt)`. Set `clockOutSiteId` if the site differs. Set `nlbClaimed` if the punch claimed it.
  - `computeEntry(PENDING)`.
  - Socket `site:punch {action:"remove"}`.
- **Auto-leave previous jobs** (`:353-378`), on a job IN:
  - Applies to every other live job (aroundDates) of the user whose effective clocking (4.10) is `ARRIVE_LEAVE`, which has a non-rejected IN before this punch and no OUT since.
  - For each one an OUT punch is created: status OK, `autoLeft:true`, time = this IN, using this punch's lat/lng/accuracy/deviceId, distance and inside-fence measured against that job's site, attached to the open entry.

**Group punches** (`POST /punches/group`, `punches.router.ts:123-185`):
- Requires `company.groupJobClocking` (default false), otherwise 403 `GROUP_CLOCKING_OFF`.
- If `groupClockBy==SUPERVISORS` (default ANYONE), the caller must pass `isLeader`: any role with ≥1 permission, a team supervisor, or a site supervisor. Otherwise 403 `GROUP_CLOCKING_LEADER_ONLY`.
- The job must be in the caller's company, have the caller as crew, and be live. Otherwise 422 `JOB_NOT_FOUND`.
- The same PHOTO_REQUIRED check applies.
- The caller's own punch runs first; an error there aborts the whole request.
- Then, for each crew member listed in `userIds` (at most 100, given as a JSON string or CSV): `createPunch(member, {...input, photoPath:undefined, deviceId:undefined, deviceTime:undefined, idempotencyKey: key+":"+userId, recordedBy: caller})`.
  - These punches skip selfie and device checks but are still location-checked.
  - Per-member errors are collected into `others[] {userId,name,ok,flagged,error?}`.
- Audit `PUNCH_GROUP`.

**Approve a flagged punch** (`approvePunch`, `punches.service.ts:575-720`). `POST /punches/:id/approve {clockInAt?, punchAt?, note? ≤300}`:
- The punch must be FLAGGED (409 "Punch not pending review" at the router).
- **Time correction**:
  - Only when `punchAt` differs by ≥ 60 s.
  - It may not be more than 2 min in the future → 400.
  - For an OUT, it must be after the entry's clockIn → 400.
  - `originalTime` keeps the first recorded time.
- For a plain or endsDay **OUT**:
  - If the punch already closed an entry (stale close) → re-close that entry. The note is "clock-out confirmed/corrected on punch approval".
  - Else, with no suitable open entry: look for an AUTO_CLOSED entry within 24 h and re-close it.
  - Else look for a FLAGGED IN at the same site within **24 h** (`PAIR_WINDOW_H`) to pair with. The pair is approved first, so one review covers both.
  - Else `clockInAt` is required: 400 `CLOCK_IN_REQUIRED`, or with it a new PENDING entry is created with note "missed clock-in — start time set on punch approval".
- A re-close sets `editedById` to the reviewer and clears approval, then `computeEntry(PENDING)`.
- Otherwise `applyPunchEffect` runs at the punch's (possibly corrected) time.
- Socket `punch:reviewed {punchId,status}` to `user:{id}`. Push "Punch approved" / "Your clock-in|out at {site} was approved." with kind `punch_reviewed`.
- **Device trust**: if the user was unverified or verifyRequested, and the punch's deviceId is null or equals the user's deviceId:
  - Set `deviceVerified=true, verifyRequested=false`.
  - If the punch has a photo, it becomes `lastBindPhotoPath` (photo on record) and `faceDescriptor=[]`.
  - Close any REQUESTED PhotoUpdate as APPROVED (`closeRequestFromPunch`).
- **Reject**: status REJECTED, socket `punch:reviewed`, push "Punch rejected" / "Your clock-in|out was rejected. Contact your supervisor." A rejected punch has no effect on the timesheet.
- The `GET /punches/flagged` enrichment, for OUT_WITHOUT_IN and AUTO_CLOSE_OVERRIDE punches, adds:
  - `needsClockIn` (when there is no open entry, no reclosable entry and no pair);
  - `suggestedClockInAt` (the shift start, if earlier than the punch) (`punches.router.ts:258-270`).

**FlagReason values** (`prisma` enum FlagReason):

| Reason | Set when |
|---|---|
| MOCKED | `mocked` was sent |
| ROOTED | `rooted` was sent |
| OUTSIDE_FENCE | outside the fence |
| POOR_ACCURACY | accuracy is above the max but the point is inside the fence |
| NEW_DEVICE | the device is unverified (selfie required), or the deviceId differs (no selfie) |
| VERIFY_REQUESTED | verifyRequested is set |
| TIME_DRIFT | the device clock is off by more than 5 min |
| OFFLINE | queued more than 60 min ago |
| QR_MISSING | the job needs a QR scan and no token was sent |
| NOT_ASSIGNED | the user is not assigned to the site and has no job there |
| OUT_WITHOUT_IN | OUT with no open entry |
| AUTO_CLOSE_OVERRIDE | the worker challenges an auto-close |
| FACE_MISMATCH | **never set** (dead enum value) |

### 4.9 Face match (`lib/face.ts`, `punches.service.ts:741-775`)
- Runs asynchronously and is advisory only. It never blocks or flags a punch.
- Models: face-api SSD Mobilenet v1 + 68-point landmarks + recognition + TinyFaceDetector, loaded from `node_modules/@vladmandic/face-api/model`. Images are EXIF-rotated, then three passes run:
  1. 1024 px, SSD minConfidence 0.4;
  2. 1600 px, SSD minConfidence 0.2;
  3. Tiny detector, inputSize 608, scoreThreshold 0.2.
- Results:
  - `NO_FACE` when no face is detected;
  - `NO_REFERENCE` when there is no photo on record, or the selfie *is* the photo on record, or no face is in the reference;
  - otherwise the Euclidean distance of the 128-d descriptors is compared with `FACE_MATCH_THRESHOLD` (default **0.62**): above it is `MISMATCH`, at or below it is `MATCH`. `faceScore` holds the distance.
- The reference descriptor is cached in `User.faceDescriptor`. `[]` means it must be recomputed.
- If the models fail to load, the punch is left unmarked.

### 4.10 Job clocking (`lib/jobs.ts:271-290`)
- `workerClocking`:
  - If `User.jobClocking` is set, it wins outright (`perWorker`). OFF means in at the first job and out at the last.
  - Otherwise `Company.jobClocking` (default **ARRIVE_LEAVE**) applies. If `jobClockingTeamIds` is non-empty, only members of those teams on that date get it; everyone else gets OFF.
- `jobClockingOf(job, w) = w.perWorker ? w.rule : (job.clocking ?? w.rule)`.
- OFF means plain punches only; ARRIVE means arrival punches; ARRIVE_LEAVE means arrival and leave. Enforcement is in the **app**. The server accepts job punches whatever the setting, except that auto-leave only runs for ARRIVE_LEAVE jobs.
- `/jobs/mine` returns each job's effective clocking using the *job's company's* rule.
- Job status for the office (`jobStatus`, `:245`): NOT_STARTED when nobody arrived; DONE when everyone who arrived has left; else IN_PROGRESS. `visitFor` uses the first IN and the last OUT at or after it. An `autoLeft` OUT counts as inside the fence.

### 4.11 Missed-entry request (worker) (`timesheets.router.ts:54-115`)
- `POST /timesheets/missed-request {siteId, clockInAt, clockOutAt, note 3..500}` for roles WORKER or SUPERVISOR.
- Rules:
  - out must be after in;
  - out must not be in the future;
  - in must be at most **14 days** ago;
  - no overlap with any non-REJECTED entry (else 409);
  - the site must be in the same company and active.
- Creates a PENDING entry with `editedById` = the worker and editNote "worker request: …", then computeEntry.
- Audit `ENTRY_MISSED_REQUEST`. Push to site staff: "Missed entry request" / "{name} requested a missed entry at {site} ({date}) — pending your review".

### 4.12 Timesheet admin actions
- **Edit** (`PATCH /timesheets/entries/:id`):
  - Sets new in/out; recomputes workDate in the site's timezone; sets editedBy/At/Note; clears approval.
  - On the first edit, stores `origClockInAt` / `origClockOutAt`.
  - Optional `nlb`.
  - If closed, `computeEntry(PENDING)`. **An edit of an APPROVED entry silently returns it to PENDING.**
- **Approve/Reject** (`decideEntry`): only from PENDING or AUTO_CLOSED (else 409). Sets approvedBy/At. Audit `ENTRY_APPROVED|ENTRY_REJECTED`.
- **Reopen**: deletes all OUT punches of the entry, sets status OPEN, nulls clockOut and the computed fields. Audit `ENTRY_REOPEN`.
- **Delete**: hard-deletes the entry and its punches. Audit `ENTRY_DELETE` with a full snapshot.
- **Manual entry**: `POST /timesheets/entries` creates a PENDING entry with editedById = the actor and note "manual entry". The worker and site must be in the same company and within the caller's review scope.

### 4.13 Payroll math (`modules/payroll/payroll.service.ts`)
- All money is integer **cents** (SGD in comments).
- Month = `YYYY-MM`; from = the first day, to = the last day.
- Included users: active users with role WORKER or SUPERVISOR in the company. **COMPANY_ADMIN-tier users are excluded from payroll** (`:153-162`).
- Hours: only entries with status **APPROVED** and workDate in the month count (`:166-168`).
- `EMPTY_PROFILE` applies when no PayProfile exists: MONTHLY, all values 0, workDaysPerWeek 6, DOUBLE_DAY, weekdayOt true.

**Rates** (`deriveRates`, `:68-86`), with `days = max(1, workDaysPerWeek)`:
- DAILY: `daily = dailyRateCentsOverride ?? 0`; `ot = otOverride ?? round(daily × days / 44 × 1.5)`.
- HOURLY: `ot = otOverride ?? round(hourly × 1.5)`; `daily = dailyOverride ?? hourly × 8`.
- MONTHLY: `ot = otOverride ?? round(basic × 12 / (52 × 44) × 1.5)`; `daily = dailyOverride ?? round(basic × 12 / (52 × days))`.

**Rest day** (`isRestDay`, `:131-142`):
- If `profile.restDays` is non-empty, those weekdays are rest days.
- Otherwise the weekdays not in the shift template active on that date are rest days (the first assignment found).
- With no template, working days are Mon–Sat, so Sunday is the rest day.

**Premium days**: the worked dates (the distinct workDates of approved entries) that are a PublicHoliday (company holiday table, **PH takes priority**) or a rest day.

**OT pay**, per entry:
- `otPaid = premiumDay ? premiumMode==DOUBLE_DAY : profile.weekdayOt`.
- `otPay += round(ot/60 × otRateCents × (entry.otMultiplier ?? 1.5)/1.5)`. The rate is scaled by the multiplier stamped on the entry (`:230-236`).

**premiumMode**:
- `DOUBLE_DAY` (default):
  - MONTHLY: basic = salary; premium = premiumDays × **2 × daily**.
  - DAILY: basic = daysWorked × daily; premium = premiumDays × daily.
  - HOURLY: basic = round(regular/60 × hourly); premium = for each premium day, round(that day's regular/60 × hourly), i.e. double time.
- `OT_RATE` / `FIXED_HOURLY`:
  - premium = round(premiumMinutes/60 × rate), where premiumMinutes = regular + OT on premium days and rate = otRate or premiumRateCents.
  - Basic excludes premium days: DAILY = (days − premiumDays) × daily; HOURLY = (regular − premium regular) × hourly; MONTHLY = salary.
  - OT on premium days is not paid separately.

**Leave**:
- Approved requests overlapping the month count only on non-rest, non-PH days. A half-day counts 0.5 *per day* (`:248`).
- They are grouped per type with a paid flag.
- `unpaidLeaveDeduct = MONTHLY ? round(unpaidDays × daily) : 0`.

**Totals**:
- `gross = basic + fixedAllowance + otPay + premiumPay`.
- `deductions = deductHousing + deductOther + unpaidLeaveDeduct`.
- `net = gross − deductions`.
- Not handled: proration for partial months, joiners or leavers; CPF or any statutory contribution; rounding beyond cents.

**Payslip** (`GET /payroll/me`):
- Allowed only if `User.payslipVisible` (default false), otherwise 403 `PAYSLIP_HIDDEN`.
- Returns the `WorkerPayroll` object (`:101-128`): userId, name, employeeNo, hasProfile, payslipVisible, profile, payType, otRateCents, dailyRateCents, basicPayCents, daysWorked, regularMinutes, otMinutes, otPaidMinutes, otPayCents, premiumDays[{date,kind PUBLIC_HOLIDAY|REST_DAY,name?}], premiumMinutes, premiumMode, premiumHourlyRateCents, weekdayOt, premiumPayCents, leaveDays[{type,paid,days}], unpaidLeaveDeductCents, grossCents, deductionCents, netCents.

**Profile validation** (`payroll.router.ts:53-67`):
- hourly 0–100,000 cents; basic, allowance and deductions 0–10,000,000 cents; workDaysPerWeek 1–7;
- overrides 0–1,000,000 cents or null; restDays an array of up to 7 values in 1..7.

**Export** columns (CSV/XLSX, `payroll.router.ts:134-155`): Employee No, Name, Pay Type, Days Worked, Regular Hours, OT Hours, OT Rate, OT Pay, PH/Rest Days Worked, PH/Rest Hours, PH/Rest Pay Basis, Daily Rate, Premium Pay, Weekday OT, Leave (paid), Leave (unpaid), Unpaid Leave Deduction, Basic, Allowance, Gross, Deductions, Net Pay.

**Seeded SG public holidays (2026)** (`lib/companyDefaults.ts:14-22`): 14 dates, inserted for every new company. Other years are manual.

### 4.14 Leave rules (`modules/leave/leave.router.ts`, `lib/leave.ts`)
- **Default types for a new company**: Annual Leave (paid), Sick Leave (paid, `requiresDocument`), Unpaid Leave (unpaid). None has defaultDays, so none is tracked (`lib/companyDefaults.ts:7-11`).
- **LeaveType** fields:
  - `paid`;
  - `defaultDays` (null means untracked; 0–366 in steps of 0.5);
  - `requiresDocument`;
  - `archived`. Deleting a type that has requests archives it instead (hidden from new requests and from balances unless taken > 0).
- **Entitlement**:
  - Each worker gets one per tracked type when created: `overrides[typeId] ?? type.defaultDays`. Sources are the worker form `leaveDays` or the invite `leaveDays` (`lib/leave.ts:10-16`).
  - Editable with `PUT /leave/entitlements/:userId`, where null removes the row so the type default applies.
  - Not handled: proration by join date, carry-forward, yearly reset jobs. The "year" is just the calendar year at read time.
- **Balance** (`leaveBalances`):
  - `entitled = own ?? type.defaultDays`;
  - `taken` = sum over APPROVED requests of `leaveDaysInYear`, which counts **calendar days** in that year including weekends and PH. A halfDay request counts 0.5 regardless of its range.
  - `pending` = the same sum over PENDING requests;
  - `remaining = entitled − taken` (pending is not subtracted).
  - **There is no check against the balance when requesting or approving**, so overdraw is possible.
  - This is inconsistent with payroll, which counts workdays only.
- **Request** (`POST /leave/requests`, multipart field `document` with up to **5** files, each an image or PDF of at most 8 MB):
  - The type must be the company's and not archived.
  - `endDate >= startDate`.
  - If `requiresDocument` and no files → 400 `DOCUMENT_REQUIRED`.
  - The status is PENDING.
  - **No push or notification is sent to approvers, and no audit row is written.**
- **Record**: `POST /leave/requests/record` creates the request APPROVED immediately with `recordedById`. Audit `LEAVE_RECORDED`, push "Leave recorded".
- **Approve/Reject**: only from PENDING (else 409).
  - A scoped approver must share a site assignment with the worker. Teams are not considered, despite the comment.
  - Audit `LEAVE_APPROVED|LEAVE_REJECTED`. Push "Leave approved|rejected" / "{type} leave {start}[ to {end}] was approved|rejected."
- **Cancel**:
  - By the worker (`/cancel`): own PENDING or APPROVED requests, **any date** (the "future" comment is not enforced). Not allowed for recorded leave (409 `RECORDED_BY_OFFICE`). No audit.
  - By an admin (`DELETE /leave/requests/:id`): any request that is not cancelled becomes CANCELLED. Audit `LEAVE_CANCELLED_BY_ADMIN`.
- **Effects**:
  - Payroll counts approved leave (4.13).
  - The roster or exceptions view shows ON_LEAVE.
  - Clock-in reminders are suppressed.
  - The attendance export shows "Leave".
- `halfDay` is a boolean with no AM/PM.

### 4.15 Per-company settings (Company) and per-worker overrides (User)

Company settings (`prisma/schema.prisma` model Company; written by `PUT /rules/punch` unless another place is noted):

| Field | Default | Meaning / where enforced | Set by |
|---|---|---|---|
| timezone | Asia/Singapore | today for jobs, teams and supervision; default site timezone | superadmin PATCH /companies/:id, signup |
| fraudPolicy | FLAG | BLOCK refuses mocked or rooted punches | superadmin only |
| unassignedSelfie | true | selfie for NOT_ASSIGNED | rules |
| selfiePolicy | SMART | ALWAYS = selfie on every punch | rules; user override `selfiePolicy` |
| offSiteReview | REVIEW | REVIEW / MARK / BLOCK (4.8 §13c, §19) | rules; user override `offSiteClocking` |
| missedClockOut | FULL_SHIFT | 4.6 | rules |
| jobClocking | ARRIVE_LEAVE | 4.10 | rules; user override `jobClocking`; job override `Job.clocking` |
| jobClockingTeamIds | [] | limits jobClocking to those teams | rules |
| groupJobClocking | false | group punches | rules |
| groupClockBy | ANYONE | ANYONE / SUPERVISORS | rules |
| photoAtFirstLogin | false | the first `/auth/me` of a clocking WORKER or SUPERVISOR with no photo (not attendanceExempt) creates a REQUESTED PhotoUpdate (`auto:true`) and sets verifyRequested (`lib/photos.ts:46-64`) | rules |
| crewMarginBeforeMin / AfterMin | 15 / 30 | 4.4 | rules (0–720); user overrides |
| baseClocking | true | BASE sites | rules; user override `baseClocking` ALLOWED/NOT_ALLOWED |
| shareWorkers | NONE | NONE / ALL / SELECTED (with User.sharedWithLinked) | rules |
| notifyRoster | false | gates `/rosters/publish` and the "Roster change" push | rules |
| supervisorsApproveTimesheets / supervisorsManageJobs | false | legacy. Writing these switches toggles `timesheets.approve` / `jobs.manage` on the built-in Supervisor role (`rules.router.ts:15-19,138-139`). GET reads them back from the role | rules |
| termsText / termsVersion / termsUpdatedAt | null / 1 | worker terms; version bumped when `reaccept` (default true) | PUT /terms |
| selfServe | false | created by public signup | signup |
| active | true | an inactive company's API keys get 401; join links get 410 | superadmin |

Other rule tables:
- OvertimeRule per company or site: dailyThresholdMin 528, otMultiplier 1.5, weeklyCapOtMin null, earlyMode null. Set with `PUT /rules/overtime`.
- BreakRule per company or site: 60 / 360 / 0. Set with `PUT /rules/breaks`.
- Each new company gets one company-wide row of each (`lib/companyDefaults.ts:47-48`).

Per-site settings (Site):

| Field | Default | Range / notes |
|---|---|---|
| radiusM | 150 | 20–5000 |
| maxAccuracyM | 50 | 10–500 |
| autoCloseAfterH | 14 | 1–48 |
| timezone | Asia/Singapore | |
| kind | PERMANENT | PERMANENT / JOB / BASE |
| allWorkers | false | BASE only |
| externalRef | | for `/v1` |

Per-shift-template settings: graceLateMin 10, earlyMode (null / clamp / pay / slide), legacy payEarly, daysOfWeek, siteIds (empty means company-wide).

Per-worker settings (User): jobClocking, offSiteClocking, selfiePolicy, baseClocking, payFollowsCrew (false), crewMarginBefore/AfterMin, sharedWithLinked (false), attendanceExempt (false: never late or absent, left off rosters and exceptions), payslipVisible (false), deviceVerified (true), verifyRequested (false), companyRoleId.

### 4.16 Identity, devices and accounts
- **OTP** (`lib/otp.ts`):
  - A 6-digit code from `crypto.randomInt`, stored as an HMAC-SHA256 of `otp:{purpose}:{phone}:{code}` keyed with JWT_SECRET.
  - TTL **5 min**; at most **5** attempts per code (claimed atomically); at most **3** unexpired unused codes per phone; at most **6** unused codes per phone per hour.
  - Purposes: LOGIN, DEVICE_REBIND, SIGNUP. The join flow uses LOGIN.
  - A review phone gets a fixed code and no message.
  - Delivery is through WhatsApp when `SMS_PROVIDER=whatsapp`, otherwise the console.
  - For web logins (`X-Client: web`) where the account has an fcmToken, the code goes by **push** "Web login code", unless `channel=whatsapp` is asked for. If the push fails it falls back to WhatsApp (`auth.router.ts:63-83`).
  - `devCode` is echoed when `OTP_DEV_MODE=true`, or when the web client uses a phone in `OTP_DEV_PHONES`.
- **Device binding**:
  - On the first login with a deviceId, the device is bound silently (audit `DEVICE_BIND`).
  - A different device gets 409 `DEVICE_MISMATCH`. With `X-Bind-Flow: photo` it also returns `bindTicket` (10 min) and `rebind:true`. `/auth/bind-device` (ticket + selfie) then binds the device, sets `deviceVerified=false` on a move, and stores the selfie as photo on record.
  - `/auth/rebind-device` (DEVICE_REBIND OTP) moves **every account of the phone** and sets `deviceVerified=false`.
  - An unverified device's next punch needs a selfie and is flagged NEW_DEVICE. Approving it trusts the device (4.8).
- **Accounts** (`lib/accounts.ts`):
  - One User row per company per phone (`@@unique[companyId, phone]`).
  - A login lands on the account bound to this device, else the oldest.
  - `/auth/switch` moves to another of the phone's accounts. It binds the device (a rebind sets deviceVerified=false), shares the fcmToken, and writes audit `ACCOUNT_SWITCH` (and DEVICE_BIND/REBIND).
  - A superadmin phone is exclusive.
  - `phoneTaken`: the same company → 409 "Phone already registered"; a superadmin phone → 409.
- **Terms**: `/terms` reports `mustAccept` when `acceptedVersion < company.termsVersion`. Accepting must quote the current version (else 409). Audit `TERMS_ACCEPT`. The server never enforces acceptance on punches (?). The app gates it.
- **App version gate** (`app.ts:48-71`): with `?platform=android|ios` it returns that platform's latest and min build. Without it, it returns the **minimum** of both platforms. A value of 0 disables the gate.

---


---

## 5. Data model (`backend/prisma/schema.prisma`, 1135 lines, Postgres, 72 migrations)

### 5a. Overview: table → feature, delete style
- IDs are `cuid()` strings except `WebhookDelivery.id` (`evt_<hex>`), `ProcessedWebhook.id` (Svix id), `UserTrade` (composite). `updatedAt` only on Job, JobPhoto, PayProfile, AssistantSession.
- Tenant isolation is in code (`companyId` filter per query); tables without `companyId` are reached via parent (see list in SITECLOCK.md §2).
- "Soft" = flag/state kept; "hard" = row deleted (cascades in field attributes in 5c).

| Model | Line | Needed for (§1 #) | Delete style |
|---|---|---|---|
| Company | 107 | everything | hard (platform delete; may be blocked by FKs (?) — §9) ; `active` flag |
| CompanyRole | 37 | 16 | hard (builtin rows kept) |
| CompanyLink | 166 | 15, 46, 66 | hard |
| User | 185 | all | soft `active`; "delete account" deactivates |
| PhotoUpdate | 263 | 21 | status (CANCELLED) |
| OtpCode | 286 | 1, 3, 11 | used/expired |
| Site | 299 | 25-28 | soft `active` |
| SiteAssignment | 332 | 27, 41 | hard |
| Punch | 345 | 41-54 | kept; status REJECTED; `jobId` set null on job delete |
| TimeEntry | 403 | 63-67, 69 | hard delete by admin (`timesheets.reopen`) |
| ShiftTemplate | 463 | 38, 52, 63 | soft `active` |
| ShiftAssignment | 485 | 38 | hard |
| OvertimeRule | 499 | 63, 78 | upsert per company/site |
| BreakRule | 514 | 63, 78 | upsert per company/site |
| LeaveType | 528 | 59 | soft `archived` |
| LeaveEntitlement | 543 | 60 | upsert |
| LeaveRequest | 555 | 61-62, 69 | status CANCELLED; admin delete hard |
| PayProfile | 597 | 68-70 | upsert |
| PublicHoliday | 621 | 68 | hard |
| AuditLog | 631 | 81 | append-only |
| InviteLink | 703 | 20 | revoke (?) |
| RegistrationRequest | 728 | 20 | status |
| ProcessedWebhook | 750 | 6 | dedupe log |
| AssistantSession | 760 | 75 | reset |
| Trade / UserTrade | 773 / 788 | 24 | hard |
| ManningPreset / Item | 798 / 808 | 24 | hard |
| Roster / RosterRequirement / RosterEntry | 820 / 835 / 847 | 39 (dead) | — |
| Team / TeamSupervisor / TeamMembership | 862 / 879 / 893 | 23, 29 | soft `active`; membership dated, never rewritten |
| Job | 917 | 29-40, 55-57 | own jobs **hard**; AIMS jobs soft-cancel |
| ApiClient | 993 | 82 | `active` |
| WebhookDelivery | 1021 | 83 (idle) | — |
| JobCrew | 1047 | 29, 42, 48, 55 | hard (with job) |
| JobPhoto | 1066 | 56 | soft `deletedAt` + `aimsDeletedAt` |
| JobNeed | 1113 | 24 | hard |
| DayNote | 1126 | 33 | hard |

Migration inventory for a rebuild (what holds data worth copying): Company (+rules tables), CompanyRole, User (+device, face descriptor, photo files), Team/TeamMembership/TeamSupervisor, Site/SiteAssignment, ShiftTemplate/ShiftAssignment, Job/JobCrew/JobNeed/DayNote, Punch (+selfie files), TimeEntry, LeaveType/Entitlement/Request (+document files), PayProfile/PublicHoliday, Trade/UserTrade, CompanyLink, AuditLog, JobPhoto (pointers only; images already in AIMS). Files live on the API's local disk (`UPLOAD_DIR`), not in a bucket.

### 5b. Enums

| Enum | line | values |
|---|---|---|
| `Role` | 10 | WORKER, SUPERVISOR, COMPANY_ADMIN, SUPERADMIN |
| `RoleScope` | 19 | COMPANY, ASSIGNED |
| `BuiltinRole` | 27 | ADMIN, SUPERVISOR, WORKER |
| `FencePolicy` | 53 | BLOCK, FLAG |
| `OtpPurpose` | 58 | LOGIN, DEVICE_REBIND, SIGNUP |
| `PunchType` | 64 | IN, OUT |
| `PunchStatus` | 69 | OK, FLAGGED, APPROVED, REJECTED |
| `FlagReason` | 76 | FACE_MISMATCH, VERIFY_REQUESTED, OUTSIDE_FENCE, MOCKED, ROOTED, NEW_DEVICE, OFFLINE, TIME_DRIFT, OUT_WITHOUT_IN, AUTO_CLOSE_OVERRIDE, NOT_ASSIGNED, POOR_ACCURACY, QR_MISSING |
| `EntryStatus` | 92 | OPEN, PENDING, APPROVED, REJECTED, AUTO_CLOSED |
| `LeaveStatus` | 100 | PENDING, APPROVED, REJECTED, CANCELLED |
| `ShareWorkers` | 179 | NONE, ALL, SELECTED |
| `PremiumMode` | 580 | DOUBLE_DAY, OT_RATE, FIXED_HOURLY |
| `PayType` | 586 | MONTHLY, DAILY, HOURLY |
| `SelfiePolicy` | 650 | SMART, ALWAYS |
| `BaseClocking` | 657 | ALLOWED, NOT_ALLOWED |
| `OffSiteReview` | 668 | REVIEW, MARK, BLOCK |
| `MissedClockOut` | 675 | FULL_SHIFT, SHIFT_END, NO_HOURS |
| `GroupClockBy` | 684 | ANYONE, SUPERVISORS |
| `JobClocking` | 691 | OFF, ARRIVE, ARRIVE_LEAVE |
| `RegStatus` | 697 | PENDING, APPROVED, REJECTED |
| `SiteKind` | 908 | PERMANENT, JOB, BASE |
| `JobStatus` | 983 | SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED |
| `WebhookStatus` | 1041 | PENDING, SENT, FAILED |
| `JobPhotoTag` | 1097 | UNSORTED, SIGNED_DO, STAMPED_DO, SERVICE_REPORT, SITE, OTHER |
| `JobPhotoStatus` | 1106 | QUEUED, STORED, FAILED |

### 5c. Models (field-level)

#### CompanyRole (`backend/prisma/schema.prisma:37`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| name | `String` |  |
| permissions | `String[]` | @default([]) |
| scope | `RoleScope` | @default(COMPANY) |
| builtin | `BuiltinRole?` |  |
| createdAt | `DateTime` | @default(now()) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| users | `User[]` |  |

- Indexes/constraints: `@@unique([companyId, builtin])`; `@@index([companyId])`

#### Company (`backend/prisma/schema.prisma:107`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| name | `String` |  |
| active | `Boolean` | @default(true) |
| timezone | `String` | @default("Asia/Singapore") |
| fraudPolicy | `FencePolicy` | @default(FLAG) |
| unassignedSelfie | `Boolean` | @default(true) |
| supervisorsApproveTimesheets | `Boolean` | @default(false) |
| notifyRoster | `Boolean` | @default(false) |
| supervisorsManageJobs | `Boolean` | @default(false) |
| termsText | `String?` |  |
| termsVersion | `Int` | @default(1) |
| termsUpdatedAt | `DateTime?` |  |
| selfiePolicy | `SelfiePolicy` | @default(SMART) |
| jobClocking | `JobClocking` | @default(ARRIVE_LEAVE) |
| groupJobClocking | `Boolean` | @default(false) |
| photoAtFirstLogin | `Boolean` | @default(false) |
| offSiteReview | `OffSiteReview` | @default(REVIEW) |
| missedClockOut | `MissedClockOut` | @default(FULL_SHIFT) |
| groupClockBy | `GroupClockBy` | @default(ANYONE) |
| jobClockingTeamIds | `String[]` | @default([]) |
| crewMarginBeforeMin | `Int` | @default(15) |
| crewMarginAfterMin | `Int` | @default(30) |
| baseClocking | `Boolean` | @default(true) |
| shareWorkers | `ShareWorkers` | @default(NONE) |
| selfServe | `Boolean` | @default(false) |
| createdAt | `DateTime` | @default(now()) |
| inviteLinks | `InviteLink[]` |  |
| regRequests | `RegistrationRequest[]` |  |
| roles | `CompanyRole[]` |  |
| users | `User[]` |  |
| sites | `Site[]` |  |
| punches | `Punch[]` |  |
| timeEntries | `TimeEntry[]` |  |
| shiftTemplates | `ShiftTemplate[]` |  |
| overtimeRules | `OvertimeRule[]` |  |
| breakRules | `BreakRule[]` |  |
| leaveTypes | `LeaveType[]` |  |
| auditLogs | `AuditLog[]` |  |
| teams | `Team[]` |  |
| jobs | `Job[]` |  |
| dayNotes | `DayNote[]` |  |
| apiClients | `ApiClient[]` |  |
| linksA | `CompanyLink[]` | @relation("LinksA") |
| linksB | `CompanyLink[]` | @relation("LinksB") |

#### CompanyLink (`backend/prisma/schema.prisma:166`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyAId | `String` |  |
| companyBId | `String` |  |
| createdAt | `DateTime` | @default(now()) |
| companyA | `Company` | @relation("LinksA", fields: [companyAId], references: [id], onDelete: Cascade) |
| companyB | `Company` | @relation("LinksB", fields: [companyBId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@unique([companyAId, companyBId])`; `@@index([companyBId])`

#### User (`backend/prisma/schema.prisma:185`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String?` |  |
| phone | `String` |  |
| name | `String` |  |
| role | `Role` | @default(WORKER) |
| employeeNo | `String?` |  |
| deviceId | `String?` |  |
| deviceBoundAt | `DateTime?` |  |
| lastBindPhotoPath | `String?` |  |
| deviceVerified | `Boolean` | @default(true) |
| faceDescriptor | `Json?` |  |
| verifyRequested | `Boolean` | @default(false) |
| fcmToken | `String?` |  |
| active | `Boolean` | @default(true) |
| termsAcceptedVersion | `Int?` |  |
| termsAcceptedAt | `DateTime?` |  |
| attendanceExempt | `Boolean` | @default(false) |
| payslipVisible | `Boolean` | @default(false) |
| jobClocking | `JobClocking?` |  |
| offSiteClocking | `OffSiteReview?` |  |
| selfiePolicy | `SelfiePolicy?` |  |
| baseClocking | `BaseClocking?` |  |
| payFollowsCrew | `Boolean` | @default(false) |
| crewMarginBeforeMin | `Int?` |  |
| sharedWithLinked | `Boolean` | @default(false) |
| crewMarginAfterMin | `Int?` |  |
| companyRoleId | `String?` |  |
| clerkUserId | `String?` | @unique |
| clerkSyncedAt | `DateTime?` |  |
| createdAt | `DateTime` | @default(now()) |
| company | `Company?` | @relation(fields: [companyId], references: [id]) |
| companyRole | `CompanyRole?` | @relation(fields: [companyRoleId], references: [id]) |
| siteAssignments | `SiteAssignment[]` |  |
| punches | `Punch[]` |  |
| recordedPunches | `Punch[]` | @relation("RecordedPunches") |
| supervisedTeams | `TeamSupervisor[]` |  |
| timeEntries | `TimeEntry[]` |  |
| shiftAssignments | `ShiftAssignment[]` |  |
| leaveRequests | `LeaveRequest[]` |  |
| payProfile | `PayProfile?` |  |
| trades | `UserTrade[]` |  |
| rosterEntries | `RosterEntry[]` |  |
| leaveEntitlements | `LeaveEntitlement[]` |  |
| teamMemberships | `TeamMembership[]` |  |
| jobCrews | `JobCrew[]` |  |
| photoUpdates | `PhotoUpdate[]` |  |
| jobPhotos | `JobPhoto[]` |  |

- Indexes/constraints: `@@unique([companyId, phone])`; `@@index([companyId])`; `@@index([phone])`

#### PhotoUpdate (`backend/prisma/schema.prisma:263`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| userId | `String` |  |
| status | `String` |  |
| photoPath | `String?` |  |
| requestedById | `String?` |  |
| auto | `Boolean` | @default(false) |
| setVerify | `Boolean` | @default(false) |
| reviewedById | `String?` |  |
| reviewedAt | `DateTime?` |  |
| note | `String?` |  |
| submittedAt | `DateTime?` |  |
| createdAt | `DateTime` | @default(now()) |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@index([companyId, status])`; `@@index([userId])`

#### OtpCode (`backend/prisma/schema.prisma:286`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| phone | `String` |  |
| code | `String` |  |
| purpose | `OtpPurpose` | @default(LOGIN) |
| expiresAt | `DateTime` |  |
| used | `Boolean` | @default(false) |
| attempts | `Int` | @default(0) |
| createdAt | `DateTime` | @default(now()) |

- Indexes/constraints: `@@index([phone])`

#### Site (`backend/prisma/schema.prisma:299`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| name | `String` |  |
| address | `String?` |  |
| lat | `Float` |  |
| lng | `Float` |  |
| radiusM | `Int` | @default(150) |
| timezone | `String` | @default("Asia/Singapore") |
| maxAccuracyM | `Int` | @default(50) |
| autoCloseAfterH | `Int` | @default(14) |
| active | `Boolean` | @default(true) |
| kind | `SiteKind` | @default(PERMANENT) |
| allWorkers | `Boolean` | @default(false) |
| externalRef | `String?` |  |
| createdAt | `DateTime` | @default(now()) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| inviteLinks | `InviteLink[]` |  |
| assignments | `SiteAssignment[]` |  |
| punches | `Punch[]` |  |
| timeEntries | `TimeEntry[]` |  |
| shiftTemplates | `ShiftTemplate[]` |  |
| rosters | `Roster[]` |  |
| jobs | `Job[]` |  |

- Indexes/constraints: `@@unique([companyId, externalRef])`; `@@index([companyId])`

#### SiteAssignment (`backend/prisma/schema.prisma:332`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| userId | `String` |  |
| siteId | `String` |  |
| isSupervisor | `Boolean` | @default(false) |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |
| site | `Site` | @relation(fields: [siteId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@unique([userId, siteId])`; `@@index([siteId])`

#### Punch (`backend/prisma/schema.prisma:345`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| userId | `String` |  |
| siteId | `String` |  |
| type | `PunchType` |  |
| serverTime | `DateTime` | @default(now()) |
| originalTime | `DateTime?` |  |
| deviceTime | `DateTime?` |  |
| lat | `Float` |  |
| lng | `Float` |  |
| accuracyM | `Float` |  |
| distanceM | `Float` |  |
| insideFence | `Boolean` |  |
| address | `String?` |  |
| faceScore | `Float?` |  |
| faceResult | `String?` |  |
| mockedFlag | `Boolean` | @default(false) |
| rootedFlag | `Boolean` | @default(false) |
| offlineSynced | `Boolean` | @default(false) |
| deviceId | `String?` |  |
| idempotencyKey | `String?` | @unique |
| photoPath | `String?` |  |
| workerNote | `String?` |  |
| nlbClaimed | `Boolean` | @default(false) |
| reviewNote | `String?` |  |
| status | `PunchStatus` | @default(OK) |
| flagReason | `FlagReason?` |  |
| reviewedById | `String?` |  |
| reviewedAt | `DateTime?` |  |
| timeEntryId | `String?` |  |
| jobId | `String?` |  |
| endsDay | `Boolean` | @default(false) |
| recordedById | `String?` |  |
| qrScanned | `Boolean` | @default(false) |
| autoLeft | `Boolean` | @default(false) |
| createdAt | `DateTime` | @default(now()) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| user | `User` | @relation(fields: [userId], references: [id]) |
| site | `Site` | @relation(fields: [siteId], references: [id]) |
| timeEntry | `TimeEntry?` | @relation(fields: [timeEntryId], references: [id]) |
| job | `Job?` | @relation(fields: [jobId], references: [id], onDelete: SetNull) |
| recordedBy | `User?` | @relation("RecordedPunches", fields: [recordedById], references: [id], onDelete: SetNull) |

- Indexes/constraints: `@@index([companyId, status])`; `@@index([userId, serverTime])`; `@@index([siteId, serverTime])`; `@@index([jobId])`

#### TimeEntry (`backend/prisma/schema.prisma:403`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| userId | `String` |  |
| siteId | `String` |  |
| workDate | `String` |  |
| clockInAt | `DateTime` |  |
| clockOutAt | `DateTime?` |  |
| status | `EntryStatus` | @default(OPEN) |
| grossMinutes | `Int?` |  |
| breakMinutes | `Int?` |  |
| nlbClaimed | `Boolean` | @default(false) |
| nlb | `Boolean` | @default(false) |
| regularMinutes | `Int?` |  |
| otMinutes | `Int?` |  |
| otMultiplier | `Float?` |  |
| lateMinutes | `Int?` |  |
| earlyMinutes | `Int?` |  |
| leftEarlyMinutes | `Int?` |  |
| shiftAssignmentId | `String?` |  |
| clockOutSiteId | `String?` |  |
| editedById | `String?` |  |
| editedAt | `DateTime?` |  |
| editNote | `String?` |  |
| origClockInAt | `DateTime?` |  |
| origClockOutAt | `DateTime?` |  |
| approvedById | `String?` |  |
| approvedAt | `DateTime?` |  |
| paidFromAt | `DateTime?` |  |
| paidToAt | `DateTime?` |  |
| crewFirstInAt | `DateTime?` |  |
| crewLastOutAt | `DateTime?` |  |
| needsReview | `Boolean` | @default(false) |
| crewNote | `String?` |  |
| workedFor | `Json?` |  |
| createdAt | `DateTime` | @default(now()) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| user | `User` | @relation(fields: [userId], references: [id]) |
| site | `Site` | @relation(fields: [siteId], references: [id]) |
| shiftAssignment | `ShiftAssignment?` | @relation(fields: [shiftAssignmentId], references: [id]) |
| punches | `Punch[]` |  |

- Indexes/constraints: `@@index([companyId, workDate])`; `@@index([userId, workDate])`; `@@index([siteId, workDate])`; `@@index([status])`

#### ShiftTemplate (`backend/prisma/schema.prisma:463`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| siteId | `String?` |  |
| siteIds | `String[]` | @default([]) |
| name | `String` |  |
| startTime | `String` |  |
| endTime | `String` |  |
| daysOfWeek | `Int[]` |  |
| graceLateMin | `Int` | @default(10) |
| payEarly | `Boolean?` |  |
| earlyMode | `String?` |  |
| active | `Boolean` | @default(true) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| site | `Site?` | @relation(fields: [siteId], references: [id]) |
| inviteLinks | `InviteLink[]` |  |
| assignments | `ShiftAssignment[]` |  |

- Indexes/constraints: `@@index([companyId])`

#### ShiftAssignment (`backend/prisma/schema.prisma:485`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| templateId | `String` |  |
| userId | `String` |  |
| startDate | `String` |  |
| endDate | `String?` |  |
| template | `ShiftTemplate` | @relation(fields: [templateId], references: [id], onDelete: Cascade) |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |
| timeEntries | `TimeEntry[]` |  |

- Indexes/constraints: `@@index([userId])`

#### OvertimeRule (`backend/prisma/schema.prisma:499`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| siteId | `String?` |  |
| dailyThresholdMin | `Int` | @default(528) |
| otMultiplier | `Float` | @default(1.5) |
| weeklyCapOtMin | `Int?` |  |
| countEarlyAsWork | `Boolean` | @default(false) |
| earlyMode | `String?` |  |
| company | `Company` | @relation(fields: [companyId], references: [id]) |

- Indexes/constraints: `@@unique([companyId, siteId])`

#### BreakRule (`backend/prisma/schema.prisma:514`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| siteId | `String?` |  |
| deductMinutes | `Int` | @default(60) |
| minShiftMinutes | `Int` | @default(360) |
| nlbCreditMinutes | `Int` | @default(0) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |

- Indexes/constraints: `@@unique([companyId, siteId])`

#### LeaveType (`backend/prisma/schema.prisma:528`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| name | `String` |  |
| paid | `Boolean` | @default(true) |
| defaultDays | `Float?` |  |
| requiresDocument | `Boolean` | @default(false) |
| archived | `Boolean` | @default(false) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| requests | `LeaveRequest[]` |  |
| entitlements | `LeaveEntitlement[]` |  |

#### LeaveEntitlement (`backend/prisma/schema.prisma:543`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| userId | `String` |  |
| typeId | `String` |  |
| days | `Float` |  |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |
| type | `LeaveType` | @relation(fields: [typeId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@unique([userId, typeId])`

#### LeaveRequest (`backend/prisma/schema.prisma:555`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| userId | `String` |  |
| typeId | `String` |  |
| startDate | `String` |  |
| endDate | `String` |  |
| halfDay | `Boolean` | @default(false) |
| reason | `String?` |  |
| documentPaths | `String[]` | @default([]) |
| recordedById | `String?` |  |
| status | `LeaveStatus` | @default(PENDING) |
| decidedById | `String?` |  |
| decidedAt | `DateTime?` |  |
| createdAt | `DateTime` | @default(now()) |
| user | `User` | @relation(fields: [userId], references: [id]) |
| type | `LeaveType` | @relation(fields: [typeId], references: [id]) |

- Indexes/constraints: `@@index([companyId, status])`; `@@index([userId])`

#### PayProfile (`backend/prisma/schema.prisma:597`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| userId | `String` | @unique |
| companyId | `String` |  |
| payType | `PayType` | @default(MONTHLY) |
| hourlyRateCents | `Int` | @default(0) |
| restDays | `Int[]` | @default([]) |
| premiumMode | `PremiumMode` | @default(DOUBLE_DAY) |
| premiumRateCents | `Int` | @default(0) |
| weekdayOt | `Boolean` | @default(true) |
| basicMonthlyCents | `Int` | @default(0) |
| fixedAllowanceCents | `Int` | @default(0) |
| deductHousingCents | `Int` | @default(0) |
| deductOtherCents | `Int` | @default(0) |
| workDaysPerWeek | `Int` | @default(6) |
| otRateCentsOverride | `Int?` |  |
| dailyRateCentsOverride | `Int?` |  |
| updatedAt | `DateTime` | @updatedAt |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@index([companyId])`

#### PublicHoliday (`backend/prisma/schema.prisma:621`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| date | `String` |  |
| name | `String` |  |

- Indexes/constraints: `@@unique([companyId, date])`; `@@index([companyId])`

#### AuditLog (`backend/prisma/schema.prisma:631`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String?` |  |
| actorId | `String?` |  |
| action | `String` |  |
| entity | `String` |  |
| entityId | `String?` |  |
| before | `Json?` |  |
| after | `Json?` |  |
| createdAt | `DateTime` | @default(now()) |
| company | `Company?` | @relation(fields: [companyId], references: [id]) |

- Indexes/constraints: `@@index([companyId, createdAt])`

#### InviteLink (`backend/prisma/schema.prisma:703`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| token | `String` | @unique |
| label | `String?` |  |
| siteId | `String?` |  |
| templateId | `String?` |  |
| role | `String?` |  |
| templateIds | `String[]` | @default([]) |
| leaveDays | `Json?` |  |
| active | `Boolean` | @default(true) |
| expiresAt | `DateTime?` |  |
| maxUses | `Int?` |  |
| uses | `Int` | @default(0) |
| createdById | `String` |  |
| createdAt | `DateTime` | @default(now()) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| site | `Site?` | @relation(fields: [siteId], references: [id]) |
| template | `ShiftTemplate?` | @relation(fields: [templateId], references: [id]) |
| requests | `RegistrationRequest[]` |  |

- Indexes/constraints: `@@index([companyId])`

#### RegistrationRequest (`backend/prisma/schema.prisma:728`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| inviteId | `String` |  |
| phone | `String` |  |
| name | `String` |  |
| employeeNo | `String?` |  |
| photoPath | `String?` |  |
| status | `RegStatus` | @default(PENDING) |
| reviewedById | `String?` |  |
| reviewedAt | `DateTime?` |  |
| clerkUserId | `String?` |  |
| createdAt | `DateTime` | @default(now()) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| invite | `InviteLink` | @relation(fields: [inviteId], references: [id]) |

- Indexes/constraints: `@@index([companyId, status])`

#### ProcessedWebhook (`backend/prisma/schema.prisma:750`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id |
| type | `String` |  |
| processedAt | `DateTime` | @default(now()) |

- Indexes/constraints: `@@index([processedAt])`

#### AssistantSession (`backend/prisma/schema.prisma:760`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| userId | `String` |  |
| companyId | `String` |  |
| state | `Json` |  |
| createdAt | `DateTime` | @default(now()) |
| updatedAt | `DateTime` | @updatedAt |

- Indexes/constraints: `@@unique([userId, companyId])`

#### Trade (`backend/prisma/schema.prisma:773`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| name | `String` |  |
| users | `UserTrade[]` |  |
| presetItems | `ManningPresetItem[]` |  |
| requirements | `RosterRequirement[]` |  |
| entries | `RosterEntry[]` |  |
| jobNeeds | `JobNeed[]` |  |
| jobCrews | `JobCrew[]` |  |

- Indexes/constraints: `@@unique([companyId, name])`

#### UserTrade (`backend/prisma/schema.prisma:788`)

| field | type | attributes |
|---|---|---|
| userId | `String` |  |
| tradeId | `String` |  |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |
| trade | `Trade` | @relation(fields: [tradeId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@id([userId, tradeId])`

#### ManningPreset (`backend/prisma/schema.prisma:798`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| name | `String` |  |
| items | `ManningPresetItem[]` |  |

- Indexes/constraints: `@@unique([companyId, name])`

#### ManningPresetItem (`backend/prisma/schema.prisma:808`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| presetId | `String` |  |
| tradeId | `String` |  |
| qty | `Int` |  |
| preset | `ManningPreset` | @relation(fields: [presetId], references: [id], onDelete: Cascade) |
| trade | `Trade` | @relation(fields: [tradeId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@unique([presetId, tradeId])`

#### Roster (`backend/prisma/schema.prisma:820`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| siteId | `String` |  |
| date | `String` |  |
| name | `String` |  |
| site | `Site` | @relation(fields: [siteId], references: [id], onDelete: Cascade) |
| requirements | `RosterRequirement[]` |  |
| entries | `RosterEntry[]` |  |

- Indexes/constraints: `@@unique([siteId, date, name])`; `@@index([companyId, date])`

#### RosterRequirement (`backend/prisma/schema.prisma:835`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| rosterId | `String` |  |
| tradeId | `String` |  |
| qty | `Int` |  |
| roster | `Roster` | @relation(fields: [rosterId], references: [id], onDelete: Cascade) |
| trade | `Trade` | @relation(fields: [tradeId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@unique([rosterId, tradeId])`

#### RosterEntry (`backend/prisma/schema.prisma:847`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| rosterId | `String` |  |
| userId | `String` |  |
| tradeId | `String?` |  |
| notifiedAt | `DateTime?` |  |
| roster | `Roster` | @relation(fields: [rosterId], references: [id], onDelete: Cascade) |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |
| trade | `Trade?` | @relation(fields: [tradeId], references: [id], onDelete: SetNull) |

- Indexes/constraints: `@@unique([rosterId, userId])`

#### Team (`backend/prisma/schema.prisma:862`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| name | `String` |  |
| active | `Boolean` | @default(true) |
| createdAt | `DateTime` | @default(now()) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| memberships | `TeamMembership[]` |  |
| supervisors | `TeamSupervisor[]` |  |

- Indexes/constraints: `@@index([companyId])`

#### TeamSupervisor (`backend/prisma/schema.prisma:879`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| teamId | `String` |  |
| userId | `String` |  |
| team | `Team` | @relation(fields: [teamId], references: [id], onDelete: Cascade) |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@unique([teamId, userId])`; `@@index([userId])`

#### TeamMembership (`backend/prisma/schema.prisma:893`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| teamId | `String` |  |
| userId | `String` |  |
| startDate | `String` |  |
| endDate | `String?` |  |
| createdAt | `DateTime` | @default(now()) |
| team | `Team` | @relation(fields: [teamId], references: [id], onDelete: Cascade) |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@index([teamId])`; `@@index([userId])`

#### Job (`backend/prisma/schema.prisma:917`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| date | `String` |  |
| startTime | `String?` |  |
| allDay | `Boolean` | @default(false) |
| title | `String` |  |
| location | `String` |  |
| siteId | `String` |  |
| description | `String?` |  |
| instructions | `String?` |  |
| teamIds | `String[]` | @default([]) |
| exceptUserIds | `String[]` | @default([]) |
| expectedMinutes | `Int?` |  |
| clocking | `JobClocking?` |  |
| qrRequired | `Boolean` | @default(false) |
| qrToken | `String?` | @unique |
| createdById | `String?` |  |
| externalSource | `String?` |  |
| externalRef | `String?` |  |
| apiClientId | `String?` |  |
| startAt | `DateTime?` |  |
| endAt | `DateTime?` |  |
| timezone | `String?` |  |
| status | `JobStatus?` |  |
| startedAt | `DateTime?` |  |
| completedAt | `DateTime?` |  |
| cancelledAt | `DateTime?` |  |
| cancelReason | `String?` |  |
| externalUrl | `String?` |  |
| externalUrlLabel | `String?` |  |
| deliveryEnabled | `Boolean` | @default(false) |
| createdAt | `DateTime` | @default(now()) |
| updatedAt | `DateTime` | @updatedAt |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| site | `Site` | @relation(fields: [siteId], references: [id]) |
| apiClient | `ApiClient?` | @relation(fields: [apiClientId], references: [id], onDelete: SetNull) |
| crew | `JobCrew[]` |  |
| needs | `JobNeed[]` |  |
| punches | `Punch[]` |  |
| photos | `JobPhoto[]` |  |

- Indexes/constraints: `@@unique([companyId, externalRef])`; `@@index([companyId, date])`; `@@index([companyId, updatedAt])`; `@@index([status, startAt])`

#### ApiClient (`backend/prisma/schema.prisma:993`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| name | `String` |  |
| source | `String` | @default("aims") |
| keyPrefix | `String` |  |
| keyHash | `String` | @unique |
| scopes | `String[]` |  |
| webhookUrl | `String?` |  |
| webhookSecret | `String?` |  |
| aimsBaseUrl | `String?` |  |
| aimsInboundKeyEnc | `String?` |  |
| active | `Boolean` | @default(true) |
| lastUsedAt | `DateTime?` |  |
| createdAt | `DateTime` | @default(now()) |
| company | `Company` | @relation(fields: [companyId], references: [id]) |
| jobs | `Job[]` |  |
| deliveries | `WebhookDelivery[]` |  |

- Indexes/constraints: `@@index([companyId])`

#### WebhookDelivery (`backend/prisma/schema.prisma:1021`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id |
| companyId | `String` |  |
| apiClientId | `String` |  |
| type | `String` |  |
| payload | `Json` |  |
| status | `WebhookStatus` | @default(PENDING) |
| attempts | `Int` | @default(0) |
| nextAttemptAt | `DateTime` | @default(now()) |
| lastError | `String?` |  |
| lastStatus | `Int?` |  |
| sentAt | `DateTime?` |  |
| createdAt | `DateTime` | @default(now()) |
| apiClient | `ApiClient` | @relation(fields: [apiClientId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@index([status, nextAttemptAt])`; `@@index([apiClientId, createdAt])`

#### JobCrew (`backend/prisma/schema.prisma:1047`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| jobId | `String` |  |
| userId | `String` |  |
| teamId | `String?` |  |
| tradeId | `String?` |  |
| notifiedAt | `DateTime?` |  |
| job | `Job` | @relation(fields: [jobId], references: [id], onDelete: Cascade) |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |
| trade | `Trade?` | @relation(fields: [tradeId], references: [id], onDelete: SetNull) |

- Indexes/constraints: `@@unique([jobId, userId])`; `@@index([userId])`

#### JobPhoto (`backend/prisma/schema.prisma:1066`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| jobId | `String` |  |
| userId | `String` |  |
| tag | `JobPhotoTag` |  |
| note | `String?` |  |
| takenAt | `DateTime` |  |
| clientId | `String` |  |
| status | `JobPhotoStatus` | @default(QUEUED) |
| mimeType | `String` |  |
| sizeBytes | `Int` |  |
| aimsPhotoId | `String?` |  |
| lastError | `String?` |  |
| attempts | `Int` | @default(0) |
| nextAttemptAt | `DateTime` | @default(now()) |
| storedAt | `DateTime?` |  |
| deletedAt | `DateTime?` |  |
| deletedById | `String?` |  |
| aimsDeletedAt | `DateTime?` |  |
| createdAt | `DateTime` | @default(now()) |
| updatedAt | `DateTime` | @updatedAt |
| job | `Job` | @relation(fields: [jobId], references: [id], onDelete: Cascade) |
| user | `User` | @relation(fields: [userId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@unique([userId, clientId])`; `@@index([jobId])`; `@@index([status, nextAttemptAt])`

#### JobNeed (`backend/prisma/schema.prisma:1113`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| jobId | `String` |  |
| tradeId | `String` |  |
| qty | `Int` |  |
| job | `Job` | @relation(fields: [jobId], references: [id], onDelete: Cascade) |
| trade | `Trade` | @relation(fields: [tradeId], references: [id], onDelete: Cascade) |

- Indexes/constraints: `@@unique([jobId, tradeId])`

#### DayNote (`backend/prisma/schema.prisma:1126`)

| field | type | attributes |
|---|---|---|
| id | `String` | @id @default(cuid()) |
| companyId | `String` |  |
| date | `String` |  |
| text | `String` |  |
| company | `Company` | @relation(fields: [companyId], references: [id]) |

- Indexes/constraints: `@@unique([companyId, date])`


---

> Paths relative to `backend/src/` unless prefixed `prisma/`.

## 6. Backend

### 6.0 Conventions
- Error body: `{error: string|zod-flatten, code?: string}`. An uncaught error gives 500 `{"error":"Internal error"}` (`app.ts:99`). The jobs, job-photo, delivery and v1 routers have their own `h()` wrapper that returns `{error:"Something went wrong"}`, or 502/504 for AIMS.
- Auth kinds used in the tables:
  - **public**;
  - **JWT** (`requireAuth()`), any signed-in active user;
  - **JWT[roles]** (`requireAuth("WORKER",…)`), checked against the *tier* role;
  - **perm:x** (`requirePerm`): signed in, has a company (403 `NO_COMPANY` otherwise), and holds one of the listed permissions (403 `NO_PERMISSION` with `needs`);
  - **staff** (`requireStaff`): has a company and ≥1 permission;
  - **SA**: the SUPERADMIN tier;
  - **key:scope**: a `/v1` API key.
- A superadmin holds every permission. Without view-as they have no companyId, so every perm or staff route returns `NO_COMPANY`.
- "scoped" means the role has scope ASSIGNED. Such a caller sees only their supervised sites (`SiteAssignment.isSupervisor`) and the members of teams they supervise (`lib/supervision.ts`).
- Global middleware: `trust proxy 1`; CORS `origin: CORS_ORIGINS`; `/webhooks/clerk` uses a raw body of at most 1 MB; `express.json` limit **12 MB** (`app.ts:35-39`).

### 6.1 App-level routes (`app.ts`)
| Method | Path | Auth | In | Out |
|---|---|---|---|---|
| GET | /health | public | – | `{ok:true}` |
| GET | /app-version | public | `?platform=android\|ios` | `{latestBuild,minBuild,androidUrl,iosUrl,latestBuildAndroid,latestBuildIos}` |
| POST | /webhooks/clerk | Svix signature | raw Clerk event | `{ok,outcome}`. 503 if no secret, 400 on a bad signature, 500 so Svix retries |

Static files: **there is no `express.static`**. Every upload is served through authenticated routes using `res.sendFile(UPLOAD_DIR/…)`. UPLOAD_DIR defaults to `./uploads` with subfolders `punches/`, `binds/`, `leave/`, `registrations/`, `job-photos-tmp/`.

### 6.2 /auth (`modules/auth/auth.router.ts`), 11 routes
| M | Path | Auth | Input | Output / errors |
|---|---|---|---|---|
| POST | /auth/request-otp | public + otpSendThrottle | `{phone ^\+?[0-9]{8,15}$, channel? whatsapp\|app}`, header X-Client | `{ok,channel:"app"\|"whatsapp",devCode?}`. 400 invalid phone, 404 "Phone not registered…", 429 limits or send failure |
| POST | /auth/app-code | JWT | – | `{code,expiresInSec:300}`, a LOGIN code shown in the app for web sign-in. 429 |
| POST | /auth/verify-otp | public + otpVerifyThrottle | `{phone, code(6), deviceId?}`, header X-Bind-Flow | `{token(30d), user(full row), accounts?}`. 400 bad code, 404, 409 `DEVICE_MISMATCH` (+`bindTicket`,`rebind` when the flow is photo) |
| POST | /auth/switch | JWT (not view-as) | `{userId, deviceId?}` | `{token,user,accounts}`. 403 in view-as or inactive company, 404 `NOT_YOUR_ACCOUNT`, 401 |
| POST | /auth/bind-device | bind ticket | multipart `ticket, deviceId, photo?` | `{token,user}`. 401 ticket expired, 400 device mismatch, 404 |
| POST | /auth/rebind-device/request | public + throttle | `{phone}` | `{ok,devCode?}`. 404, 429 |
| POST | /auth/rebind-device | public + throttle | `{phone,code,deviceId}` | `{token,user,accounts?}`. Rebinds all accounts. 400 / 404 |
| POST | /auth/fcm-token | JWT | `{token 10..512}` | `{ok}`. Removes this token from other phones and sets it on all of this phone's active accounts |
| DELETE | /auth/account | JWT (not view-as) | – | `{ok}`. Deactivates **all** the phone's accounts, clears device and fcm, runs clerkReconcile, emits `worker:accountDeleted` |
| GET | /auth/me | JWT | – | `{user:{…full row, company, siteAssignments, companySites, photo:{hasPhoto,status,requested,auto,note,rejected}, permissions[], scope, companyRole{id,name}, accounts?}}`. View-as returns a synthetic admin. Side effect: requestPhotoAtFirstLogin |
| POST | /auth/aims-link | JWT[COMPANY_ADMIN, SUPERVISOR, SUPERADMIN] | – | `{linked,url}`. A Clerk sign-in token valid 60 s when linked, otherwise the plain AIMS URL |

`companySites` holds the active sites of the user's company: PERMANENT, plus BASE when base clocking is allowed, plus the job sites around today. That can include a linked company's job site.

### 6.3 /companies: platform admin (`modules/companies/companies.router.ts`), all **SA**, 16 routes
| M | Path | Input | Output / notes |
|---|---|---|---|
| GET | /companies | – | companies with `_count{users,sites}` |
| POST | /companies | `{name, timezone="Asia/Singapore", fraudPolicy=FLAG, active?}` | `createCompanyWithDefaults` (OT + break rule, 3 leave types, SG PH, 3 roles). Audit COMPANY_CREATE |
| PATCH | /companies/:id | partial of the above | audit COMPANY_UPDATE |
| POST | /companies/:id/admins | `{phone,name}` | creates a COMPANY_ADMIN with the built-in Admin role; `{user, otherCompanies}`. 409 if the phone is taken |
| GET | /companies/platform/links | – | `{links[]}` with company names |
| POST | /companies/:id/links | `{companyId}` | an idempotent symmetric link (stored with sorted ids). Audit COMPANY_LINK. 400 when both ids are the same |
| DELETE | /companies/:id/links/:otherId | – | audit COMPANY_UNLINK. 404 |
| POST | /companies/platform/superadmins | `{phone,name≤100}` | SUPERADMIN_CREATE. 409 |
| GET | /companies/platform/overview | – | counts (companies, active, sites, usersByRole, punches24h/7d, flaggedOpen, boundDevices) and the 15 most recent audit rows |
| GET | /companies/platform/users | `?q,role,companyId` | up to 500 users with `isOwner`, plus `viewerIsOwner` |
| POST | /companies/:id/view-as | – | `{token (COMPANY_ADMIN, viewAs, 8h), company}`. Audit SUPERADMIN_VIEW_AS |
| PATCH | /companies/platform/users/:id | `{active?,name?,phone?,employeeNo?,role?}` | A superadmin target can only have `active` changed, only by the owner (`PLATFORM_OWNER_PHONE`), and the owner can never be changed. Deactivating clears device and fcm. Audit PLATFORM_USER_ACTIVATE/DEACTIVATE. **Changing `role` here does not change companyRoleId (?), so perms still follow the old role** |
| POST | /companies/platform/users/:id/reset-device | – | PLATFORM_DEVICE_RESET |
| GET | /companies/stats | – | `{companies,users,punchesToday}` |
| DELETE | /companies/platform/users/:id | – | hard-deletes the user's sessions, leave, shift and site assignments, pay profile, punches, entries and OTPs, then the user. clerkForget. Audit PLATFORM_USER_DELETE. Not allowed on yourself or the owner |
| DELETE | /companies/:id | – | hard-deletes the whole tenant (list at `:284-309`). Audit PLATFORM_COMPANY_DELETE. Not allowed on your own company. Trades, ManningPresets, PhotoUpdates via cascade, and other companies' punches at its sites are not listed explicitly (FK risk (?)) |

### 6.4 /sites (`modules/sites/sites.router.ts`), 6 routes
| M | Path | Auth | Input | Output |
|---|---|---|---|---|
| GET | /sites | staff | `?kind=all\|job` (default PERMANENT+BASE) | `{sites}`. Scoped callers get only the sites they supervise |
| GET | /sites/geocode | staff | `?q` (≥3 chars) | `{results[{label,lat,lng}]}` from Nominatim |
| POST | /sites | perm:sites.manage | `{name, address?, lat, lng, radiusM 20–5000=150, timezone, maxAccuracyM 10–500=50, autoCloseAfterH 1–48=14, active?, kind? PERMANENT\|BASE, allWorkers?}` | `{site}`. Audit SITE_CREATE |
| PATCH | /sites/:id | perm:sites.manage | partial | SITE_UPDATE. Not scope-restricted |
| GET | /sites/:id/present | perm:live.view (scoped callers must be assigned) | – | `{present[{entryId,userId,name,employeeNo,clockInAt}]}` |
| GET | /sites/:id/pulse | JWT (same company) | – | `{onSiteNow, hours[24], site, people?}`. `people` (with clock-in GPS and insideFence) is included only for live.view holders, and only when a scoped caller is assigned to the site |

### 6.5 /workers (`modules/workers/workers.router.ts`), 8 routes
| M | Path | Auth | Input | Output / notes |
|---|---|---|---|---|
| POST | /workers/:id/request-verification | perm:workers.verify (scoped: a worker on my site or in my team) | – | sets verifyRequested. Audit VERIFY_REQUEST |
| GET | /workers/:id/bind-photo | perm:workers.view | – | the photo-on-record file |
| GET | /workers | perm:workers.view | – | `{workers[]}`: **full User rows** (including deviceId, fcmToken, faceDescriptor, clerkUserId), siteAssignments, companyRole, open photoUpdate. Scoped callers get workers at sites they are assigned to (any assignment, not only supervised) plus their team members |
| GET | /workers/directory | staff | – | names only (id, name, employeeNo, role, active, companyRole). Scoped callers without teams.manage get the same reach as the list |
| POST | /workers | perm:workers.manage | multipart or JSON: `phone, name, role? (WORKER\|SUPERVISOR\|COMPANY_ADMIN) or companyRoleId, employeeNo, siteIds[], supervisorSiteIds[], active, attendanceExempt, payslipVisible, jobClocking, offSiteClocking, selfiePolicy, baseClocking, payFollowsCrew, sharedWithLinked, crewMarginBefore/AfterMin (0–720\|null), leaveDays{typeId:days}`, photo | `{user, otherCompanies}`. 409 if the phone is taken in this company. A SUPERVISOR-tier role supervises all of the user's assigned sites. Grants leave. Audit WORKER_CREATE. clerkReconcile |
| PATCH | /workers/:id | perm:workers.manage | partial of the above. `""` resets the override fields to null | 409 `LAST_ADMIN` when the only admin would lose the role or be deactivated. A phone change checks for a clash **globally** (any company) and updates Clerk first. A new photo resets faceDescriptor. Audit WORKER_UPDATE |
| POST | /workers/:id/change-phone | perm:workers.manage | `{phone, resetDevice=false}` | deletes unused OTPs for both numbers. Audit WORKER_PHONE_CHANGE. 409 on a clash |
| POST | /workers/:id/reset-device | perm:workers.manage | – | deviceId and boundAt set to null. Audit DEVICE_RESET |

### 6.6 /punches (`modules/punches/punches.router.ts`), 9 routes
| M | Path | Auth | Input | Output / errors |
|---|---|---|---|---|
| POST | /punches | JWT[WORKER, SUPERVISOR, COMPANY_ADMIN] | see 4.8 | 201 `{punch, entry?, flagged?, marked?}`. 200 `{punch, duplicate}`. 400 `SELFIE_REQUIRED {selfieRequired, reason}`. 422 `{error (message), code, blocked:true, …details}`. 409 `PHOTO_REQUIRED` |
| POST | /punches/group | same | the punch fields + `jobId` (required) + `userIds` | `{punch, entry?/flagged?, others[]}`. 403 `GROUP_CLOCKING_OFF` / `GROUP_CLOCKING_LEADER_ONLY`. 422 `JOB_NOT_FOUND` |
| GET | /punches/:id/photo | JWT[W, S, A] | – | the selfie. Allowed for your own punch; for flagged.view holders in the same company; scoped callers additionally need to be **site supervisor** of the punch's site (team scope is not honoured here) |
| GET | /punches/mine | JWT[W, S, A] | – | the last 100 of my punches with site |
| GET | /punches/face-log | perm:flagged.view | – | punches with a faceResult in the last 7 days (≤200, within review scope), plus the threshold |
| GET | /punches/flagged | perm:flagged.view | – | FLAGGED punches (review scope) with user, site, job, recordedBy, and needsClockIn / suggestedClockInAt |
| GET | /punches/marked | perm:flagged.view | – | OK punches with a LOCATION flag in the last 30 days (≤300) |
| POST | /punches/:id/approve | perm:flagged.review + mayReview | `{clockInAt?, punchAt?, note?}` | `{punch, entry}`. 409 not pending; 400 `CLOCK_IN_REQUIRED` or a time-validation message. Audit PUNCH_APPROVE |
| POST | /punches/:id/reject | perm:flagged.review + mayReview | `{note?}` | `{punch}`. Audit PUNCH_REJECT |

### 6.7 /timesheets (`modules/timesheets/timesheets.router.ts`), 12 routes
| M | Path | Auth | Input | Output / errors |
|---|---|---|---|---|
| GET | /timesheets/mine | JWT[W, S, A] | – | my last 60 entries with site and punches (incl. photoPath, face, address, distance) |
| POST | /timesheets/missed-request | JWT[WORKER, SUPERVISOR] | 4.11 | 201 `{entry}`. 400 / 404 / 409 |
| GET | /timesheets | perm:timesheets.view | `?siteId,userId,teamId,from,to,status` | ≤500 entries (review scope; teamId uses team history per workDate) |
| PATCH | /timesheets/entries/:id | perm:timesheets.edit + mayReview | `{clockInAt?,clockOutAt?,note≤500?,nlb?}` | `{entry}`. Audit ENTRY_EDIT |
| POST | /timesheets/entries/:id/approve | perm:timesheets.approve | – | 409 "Entry not pending". Audit ENTRY_APPROVED |
| POST | /timesheets/entries/:id/reject | perm:timesheets.approve | – | ENTRY_REJECTED |
| POST | /timesheets/entries/:id/reopen | perm:timesheets.reopen | – | deletes the OUT punches; OPEN. Audit ENTRY_REOPEN. 409 when there is no clock-out |
| DELETE | /timesheets/entries/:id | perm:timesheets.reopen | – | hard delete. Audit ENTRY_DELETE |
| POST | /timesheets/approve-bulk | perm:timesheets.approve | `{entryIds[1..200]}` | `{results{id: APPROVED\|NEEDS_REVIEW\|NOT_FOUND\|NOT_PENDING\|FORBIDDEN}}` |
| POST | /timesheets/entries | perm:timesheets.edit + mayReview | `{userId,siteId,clockInAt,clockOutAt,note?}` | 201. Audit ENTRY_MANUAL_CREATE |
| GET | /timesheets/export | perm:timesheets.export | the list filters + `format=csv\|xlsx` | ≤10000 rows. Columns: employeeNo, name, site, workDate, clockIn, clockOut (site-local), grossMin, breakMin, regularMin, otMin, otMultiplier, lateMin, earlyMin, leftEarlyMin, status, editedBy, approvedBy, team |
| GET | /timesheets/entries/:id/detail | perm:timesheets.view + mayReview | – | the entry (orig times, paid/crew fields, notes), worker, site, punches (the entry's own plus FLAGGED punches within ±6 h) with reviewer names |

### 6.8 /schedules (`modules/schedules/schedules.router.ts`), 9 routes
| M | Path | Auth | Input | Output |
|---|---|---|---|---|
| GET | /schedules/mine | JWT[W, S, A] | `?siteId` | today's shift `{name,startTime,endTime,graceLateMin,startAt}` or null |
| GET | /schedules/templates | perm:schedules.view | – | templates with `sites[]` and assignment counts |
| POST | /schedules/templates | perm:schedules.manage | `{name, startTime HH:mm, endTime, daysOfWeek[1..7]≥1, graceLateMin 0–120=10, payEarly?, earlyMode?, siteIds?\|siteId?, active?}` | TEMPLATE_CREATE |
| PATCH | /schedules/templates/:id | perm:schedules.manage | partial | TEMPLATE_UPDATE |
| DELETE | /schedules/templates/:id | perm:schedules.manage | – | unlinks entries, deletes assignments, nulls invite templateId. TEMPLATE_DELETE |
| POST | /schedules/assignments | perm:schedules.assign | `{templateId,userId,startDate,endDate?}` | scoped: the template must be company-wide or on my site, and the worker on my site. SHIFT_ASSIGN. **No overlap check** |
| DELETE | /schedules/assignments/:id | perm:schedules.assign | – | SHIFT_UNASSIGN |
| GET | /schedules/assignments | perm:schedules.view | – | every assignment (not scoped) |
| GET | /schedules/exceptions | perm:schedules.view | `?siteId,date` | `{roster[{userId,name,shift,status ON_LEAVE\|ABSENT\|PRESENT\|LATE\|LEFT_EARLY\|ON_TIME, late/early/leftEarly, in/out}]}`. Expected = assigned to the site, the template covers the site, not attendanceExempt |

### 6.9 Rosters, trades and presets (`modules/rosters/rosters.router.ts`, mounted at `/`), 20 routes
A "roster" is a Job at a site (merged in migration `20261019120000_roster_into_jobs`). Entries are JobCrew rows and requirements are JobNeed rows.
| M | Path | Auth | Notes |
|---|---|---|---|
| GET | /trades | JWT | `{trades[{id,name,workers}]}` |
| POST | /trades | perm:jobs.setup | `{name≤60}`. TRADE_CREATE |
| DELETE | /trades/:id | perm:jobs.setup | TRADE_DELETE |
| PUT | /trades/user/:userId | perm:jobs.setup | `{tradeIds≤10}` |
| GET | /manning-presets | perm:jobs.view | presets with items |
| POST | /manning-presets | perm:jobs.setup | `{name, items[{tradeId,qty 1–200}] 1..20}`, upserted by name. MANNING_PRESET_SET |
| DELETE | /manning-presets/:id | perm:jobs.setup | no audit |
| GET | /rosters/mine | JWT | my next 14 days of crew rows (UTC dates) |
| GET | /rosters | perm:jobs.view | `?date,siteId`. Scoped callers see their sites plus every JOB-kind job |
| POST | /rosters/publish | perm:jobs.manage | `{date,siteId?}`. 400 if notifyRoster is off. Pushes "You're rostered" to every un-notified crew row. ROSTER_PUBLISH. **No liveJob filter** |
| GET | /rosters/attendance | perm:jobs.view | `?date,siteId`. Per crew member: CLOCKED_IN / DONE / ON_LEAVE / NOT_ARRIVED, actual site, counts |
| POST | /rosters | perm:jobs.manage | `{siteId,date,name≤60,presetId?}`. 409 on a duplicate name. ROSTER_CREATE |
| PATCH | /rosters/:id | perm:jobs.manage | name, requirements. 409 `EXTERNAL_JOB` |
| DELETE | /rosters/:id | perm:jobs.manage | ROSTER_DELETE |
| POST | /rosters/:id/entries | perm:jobs.manage | `{userId,tradeId?}` (own company only) |
| DELETE | /rosters/:id/entries/:userId | perm:jobs.manage | "Roster change" push if notified and notifyRoster is on |
| POST | /rosters/copy | perm:jobs.manage | `{fromDate,toDate,siteId?}`. Never copies external jobs or over an existing name. No audit |
| POST | /rosters/copy-week | perm:jobs.manage | `{fromMonday,toMonday,siteId?}`. ROSTER_COPY_WEEK |
| GET | /rosters/week | perm:jobs.view | `?monday,siteId`. Per-day counts |
| GET | /rosters/pickers | perm:jobs.view | `?date,tradeId`. Own workers plus shared workers (with `fromCompany`), onLeave, rosteredIn |

### 6.10 /jobs (`jobs.router.ts`, `jobPhotos.router.ts`, `jobDelivery.router.ts`)
jobs.router, 12 routes. Every route after `/jobs` (GET) is behind `perm:jobs.manage` (`jobs.router.ts:123`).
| M | Path | Auth | Input | Output / notes |
|---|---|---|---|---|
| GET | /jobs/mine | JWT | `?from,to` (default today..+13, max 62 days) | `{from,to,today,jobClocking,groupClocking,jobs[],notes{date:text}}`. Includes linked companies' jobs (`fromCompany`). Each job has: effective clocking, `usualStart` (from the shift when there is no time and it is not allDay), external fields, photo fields, `deliveryEnabled` (AIMS and photosEnabled), and crew `{…, me}`. QR token/url, trade and notifiedAt are stripped |
| GET | /jobs | perm:jobs.view | `?date` | `{date,note,jobClocking,jobs[]}`. The full presentJobs output: qrToken, qrUrl, teams, crew with visits and fromCompany, status |
| GET | /jobs/place | perm:jobs.manage | `?q,search` | `{place}` from findPlace (site by name, else geocode snapped to a site fence or to a JOB site within 60 m) |
| GET | /jobs/import/template | jobs.manage + jobs.setup | – | xlsx template |
| POST | /jobs/import/preview | jobs.manage + jobs.setup | multipart `file` (xlsx/csv ≤5 MB, ≤500 rows) | `{rows,problems,days[{date,existing,workers,jobs}]}` |
| POST | /jobs/import | jobs.manage + jobs.setup | `{mode add\|replace, rows[1..500]}` | 422 `{problems}` if anything is unresolved. Otherwise `saveDayJobs` per day (replace deletes the day's own jobs, never external ones), notifies crews. 201 `{days,created}` |
| POST | /jobs | perm:jobs.manage | `{date, startTime?, title≤200, description?, instructions?, teamIds?, userIds?, exceptUserIds?, expectedMinutes 5–1440?, clocking?, qrRequired?, location, search?, siteId?, lat?, lng?, address?}` | 400 unknown team or worker (own or shared via `crewableIds`). 422 place not found. 403 when a scoped caller is not at their site. JOB_CREATE |
| PATCH | /jobs/:id | perm:jobs.manage | partial | 409 `EXTERNAL_JOB`. Rebuilds the crew if teams, users or date change. Re-notifies when time, place or date move. Dropped crew get "Job removed from your day". JOB_UPDATE |
| POST | /jobs/:id/qr | perm:jobs.manage | – | rotates qrToken (18 random bytes, base64url) and sets qrRequired. JOB_QR_ROTATE. (No external check) |
| DELETE | /jobs/:id | perm:jobs.manage | – | 409 external. Notified crew get "Job cancelled". JOB_DELETE |
| PUT | /jobs/notes/:date | perm:jobs.manage | `{text≤2000}` (empty clears) | DAY_NOTE_SET |
| POST | /jobs/notify | perm:jobs.manage | `{date}` | one push per worker "Your jobs for {ccc d LLL} ({n})" listing up to 3 jobs; marks notifiedAt. `{workers,told}`. JOBS_NOTIFY |

QR URL = `{WEB_BASE_URL}/#/q/{token}` (`lib/jobs.ts:137`).

jobPhotos.router, 4 routes, AIMS jobs only (`photosEnabled` = externalSource "aims" and an active client with aimsBaseUrl and an inbound key):
| M | Path | Auth | Input | Output / errors |
|---|---|---|---|---|
| POST | /jobs/:id/photos | JWT, crew of the job | multipart `photo` (≤10 MB, bytes sniffed as JPEG/PNG/WebP/HEIC), `tag?` (default UNSORTED), `note≤300`, `takenAt` (ISO with offset), `clientId [A-Za-z0-9_-]{8,100}` | 201 `{photo}`, or 200 `{photo, duplicate}` for the same clientId. Errors: 404 `PHOTOS_OFF`, 403 `NOT_CREW`, 409 `CLIENT_ID_REUSED` / `JOB_CANCELLED` / `NOT_CLOCKED_IN` / `OUTSIDE_WINDOW` (from the first IN that day minus 5 min to 23:59 job-local) / `PHOTO_LIMIT` (30 per worker per job), 413 `TOO_LARGE`, 415 `NOT_AN_IMAGE`, 400 `BAD_TAKEN_AT` (>5 min in the future). JOB_PHOTO_ADD, then one immediate send |
| GET | /jobs/:id/photos | crew, site or team supervisor, or admin (jobs.manage, unscoped) | – | `{photos[], canAdd, addFrom, addUntil, limit}` |
| GET | /jobs/photos/:id/file | the same visibility | `?size=thumb\|full&download=1` | streamed from a presigned AIMS URL (STORED), or the local temp file. 502 `AIMS_UNAVAILABLE` |
| DELETE | /jobs/photos/:id | own photo on the job's day or the upload day, or an admin | – | soft delete, removes the temp file, deletes on AIMS (retried). `{ok, aimsDeleted}`. JOB_PHOTO_DELETE |

jobDelivery.router, 4 route handlers that proxy to AIMS (`lib/aimsDelivery.ts`):
| M | Path | Auth | Notes |
|---|---|---|---|
| POST | /jobs/:id/delivery/uploads/image | JWT, crew of an AIMS job with deliveryEnabled, not cancelled, link set | multipart `file` (≤15 MB, sniffed) + `folder`. Forwarded |
| ANY | /jobs/:id/delivery[/step] | same | an allow-listed step only, else 404. Steps: GET "" · POST claim-return, start, not-finished, open, end, items/{uuid}/(start\|end\|skip\|unskip), units/{uuid}/(start\|deliver\|collect-return), items/photos, ack-all, handoff, finalize(-return), reports · GET handoff/(current\|status), do/{uuid}/(view\|pdf), reports/{uuid}[/pdf] · PATCH reports/{uuid}/draft · POST reports/{uuid}/complete. Errors: 404 `NOT_FOUND`, 409 `DELIVERY_OFF`, 502/504 `AIMS_UNREACHABLE` |
| POST | /jobs/delivery/uploads/image | JWT | uses the company's first active AIMS client |
| ANY | /jobs/delivery/(pending-sign \| reports/{uuid} \| reports/{uuid}/sign) | JWT | worker steps |

Forwarding goes to `{aimsBaseUrl}/integrations/siteclock/delivery/{jobs/<externalRef>/<step> | <step>}` with headers `Authorization: Bearer <inbound key>`, `X-SiteClock-Worker-Id`, `Idempotency-Key` (passed through, ≤200 chars). The timeout is 30 s, or 90 s for PDFs. The AIMS status and body are returned unchanged, plus `Idempotent-Replayed`.

### 6.11 /v1: server-to-server (`modules/v1/v1.router.ts`), 13 routes plus a 404 catch-all
- Auth: `Authorization: Bearer sck_live_<32 base62>`. Only the SHA-256 of the key is stored, plus a prefix (`lib/apiKeys.ts`).
  - 401 `UNAUTHORIZED` for a missing, unknown or inactive key, or an inactive company. 403 `FORBIDDEN` when the scope is missing.
  - `lastUsedAt` is updated at most once a minute. The audit actor is `api:<clientId>`.
- Scopes: `teams:read, workers:read, workers:phone, sites:write, jobs:read, jobs:write`. New clients get all of them except workers:phone.
- Times are ISO-8601 **with an offset** (a bare local time is refused). A job lasts at most 24 h.

| M | Path | Scope | Input | Output / errors |
|---|---|---|---|---|
| GET | /v1/teams | teams:read | `?date` | teams with the active members on that date |
| GET | /v1/workers | workers:read (+workers:phone for `include=phone`) | `?teamId, active=true\|false\|all, include` | `{workers[{id,name,employeeNo,role,active,clerkUserId,phone?,teamIds,siteIds}]}` |
| PUT | /v1/sites/by-ref/:ref | sites:write | `{name≤120, address?≤300, lat?, lng?, radiusM 50–2000?}` (an address or lat/lng is required) | upsert. Without lat/lng it geocodes (OneMap, then OSM). 422 `ADDRESS_NOT_FOUND`. 201 or 200 `{site}`. API_SITE_CREATE/UPDATE. A new site is JOB kind with the company timezone |
| POST | /v1/jobs | jobs:write | `{externalRef≤200, workerId, siteId\|siteRef, (startAt+endAt) \| (allDay:true + date), title≤200, notes≤2000?, externalUrl (https)?, externalUrlLabel≤40?, deliveryEnabled?, notify=true}` | 201 `{job}`. Idempotent: the same body gives 200 `duplicate`, a different one 409 `EXTERNAL_REF_CONFLICT`. 422 `SITE_NOT_FOUND` / `WORKER_NOT_FOUND`. 400 `VALIDATION`. Push "New job". API_JOB_CREATE |
| PATCH | /v1/jobs/by-ref/:ref, /v1/jobs/:id | jobs:write | any of the create fields + `status IN_PROGRESS\|COMPLETED`, `at` | Status only moves forward (409 `INVALID_TRANSITION`). Once IN_PROGRESS or COMPLETED, the worker, site and time cannot change (409 `JOB_STARTED` / `JOB_CLOSED`); title, notes, link and delivery still can. A cancelled job cannot change (409). Pushes "Job changed", or "Job removed" plus "New job" on reassignment. `{job, changes[] \| unchanged}`. API_JOB_UPDATE, API_JOB_STATUS |
| POST | /v1/jobs/by-ref/:ref/cancel, /v1/jobs/:id/cancel; DELETE /v1/jobs/by-ref/:ref | jobs:write | `{reason≤500?, notify=true}` | soft cancel (status CANCELLED, cancelledAt). A completed job gives 409 `JOB_CLOSED`. Push "Job cancelled". API_JOB_CANCEL |
| GET | /v1/jobs/by-ref/:ref, /v1/jobs/:id | jobs:read | – | `{job}` (presentApiJob: UTC and local times, worker, site, status, link, deliveryEnabled) |
| GET | /v1/jobs/calendar | jobs:read | `?from,to` (≤62 days) | every company job (own and external), with window, crew progress, `webUrl` |
| GET | /v1/jobs | jobs:read | `?updatedSince, status=CSV, limit 1–500=100` | external jobs only, ordered by updatedAt, with `nextUpdatedSince` |

### 6.12 /rules (`modules/rules/rules.router.ts`), all **perm:rules.manage**, 4 routes
| M | Path | Input | Output |
|---|---|---|---|
| GET | /rules | – | `{overtime[], breaks[], punch:{unassignedSelfie, selfiePolicy, supervisorsApproveTimesheets, notifyRoster, supervisorsManageJobs, jobClocking, jobClockingTeamIds, groupJobClocking, offSiteReview, crewMarginBeforeMin, crewMarginAfterMin, missedClockOut, groupClockBy, photoAtFirstLogin, baseClocking, shareWorkers}}` |
| PUT | /rules/overtime | `{siteId?, dailyThresholdMin 0–1440, otMultiplier 1–3, weeklyCapOtMin?, countEarlyAsWork?, earlyMode?}` | upsert per (company, site). OT_RULE_SET |
| PUT | /rules/breaks | `{siteId?, deductMinutes 0–240, minShiftMinutes 0–1440, nlbCreditMinutes 0–240}` | BREAK_RULE_SET |
| PUT | /rules/punch | any of the punch fields (at least one; teams validated) | PUNCH_RULE_SET |

### 6.13 /links (`modules/links/links.router.ts`), 4 routes
| M | Path | Auth | Output |
|---|---|---|---|
| GET | /links | staff | `{shareWorkers, links[{id,name,shareWorkers}]}` |
| GET | /links/workers | perm:jobs.view | workers shared with me `{id,name,employeeNo,companyId,companyName,trades}` (people who also have an account with me are excluded) |
| GET | /links/hours | perm:jobs.view | `?from,to` (≤92 days). Linked companies' entries whose `workedFor` has my id (raw SQL `"workedFor" ? $id`) → rows with minutes |
| GET | /links/lent | perm:timesheets.view | my entries with workedFor → a row per (entry, company) |

### 6.14 /roles (`modules/roles/roles.router.ts`), 5 routes
| M | Path | Auth | Notes |
|---|---|---|---|
| GET | /roles | staff | `{roles[{id,name,permissions,scope,builtin,locked,tier,users}], permissions: PERMISSION_GROUPS}`. Calls ensureCompanyRoles |
| POST | /roles | perm:roles.manage | `{name≤40, permissions[] (known keys), scope COMPANY\|ASSIGNED}`. 409 `ROLE_NAME_TAKEN` |
| PATCH | /roles/:id | perm:roles.manage | Admin is locked (403 `ROLE_LOCKED`). syncTiers on a permissions change |
| DELETE | /roles/:id | perm:roles.manage | built-in roles: 403 `ROLE_BUILTIN`. In use: 409 `ROLE_IN_USE` |
| GET | /roles/:id/users | perm:roles.manage | holders, plus the admin count for Admin |

### 6.15 /leave, 19 routes (rules in 4.14)
| M | Path | Auth | Notes |
|---|---|---|---|
| GET | /leave/types | JWT | `?all=1` (leave.manage) includes archived types. Each has `requestCount` |
| DELETE | /leave/types/:id | perm:leave.manage | deletes the type, or archives it when it has requests |
| POST | /leave/types/:id/restore | perm:leave.manage | LEAVE_TYPE_RESTORE |
| POST | /leave/types | perm:leave.manage | `{name, paid=true, defaultDays?, requiresDocument=false}` |
| PATCH | /leave/types/:id | perm:leave.manage | |
| GET | /leave/balances/mine | JWT | `?year` (2000–2100) |
| GET | /leave/balances/:userId | perm:leave.manage \| workers.manage | |
| PUT | /leave/entitlements/:userId | perm:leave.manage \| workers.manage | `{entitlements{typeId: days\|null}}` |
| POST | /leave/requests | JWT[W, S, A] | multipart `document[]≤5`, `typeId, startDate, endDate, halfDay, reason≤500` |
| POST | /leave/requests/record | perm:leave.manage | + `userId` |
| DELETE | /leave/requests/:id | perm:leave.manage | sets CANCELLED |
| GET | /leave/requests/mine | JWT[W, S, A] | |
| GET | /leave/requests/:id/document, /documents/:n | JWT[W, S, A] | own request, or leave.view (scoped: shares a site) |
| GET | /leave/requests | perm:leave.view | `?status`. Scoped: workers sharing my site assignments |
| POST | /leave/requests/:id/approve, /reject | perm:leave.approve | |
| POST | /leave/requests/:id/cancel | JWT[W, S, A] | own request only |
| GET | /leave/calendar | perm:leave.view | `?month,siteId`. Passing a siteId bypasses the scope filter (any site of the company) |

Presented request shape: `{…, hasDocument, documentCount, documentUrl, documents[{index,url}], recorded}`. Stored paths are hidden.

### 6.16 /payroll, 8 routes
| M | Path | Auth | Notes |
|---|---|---|---|
| GET | /payroll/me | JWT | `?month`. 403 `PAYSLIP_HIDDEN` |
| GET | /payroll | perm:payroll.view | `?month`. The whole company (**not scoped**) |
| GET | /payroll/profiles/:userId | perm:payroll.view | `{profile, rates, hasProfile}` |
| PUT | /payroll/profiles/:userId | perm:payroll.manage | 4.13 validation. PAY_PROFILE_SET |
| GET | /payroll/holidays | perm:payroll.view | `?year` |
| POST | /payroll/holidays | perm:payroll.manage | `{date,name≤100}`, upsert. **No audit** |
| DELETE | /payroll/holidays/:id | perm:payroll.manage | **no audit** |
| GET | /payroll/export | perm:payroll.view | `?month, format` |

### 6.17 /reports, 3 routes
| M | Path | Auth | Notes |
|---|---|---|---|
| GET | /reports/attendance-export | perm:reports.attendance | `?from,to (1–92 days),siteId`. XLSX with one row per active WORKER/SUPERVISOR: Days worked, Rest, Leave, Absent, Worked min, OT min, Late count/min, Left early count/min, Off-site days, Missed out, then one column per day with a verdict: Normal / Late Nm / Left early Nm / Missed out (AUTO_CLOSED) / Off-site (any punch outside the fence) / On clock / Leave / Absent (scheduled) / Rest. Scoped callers see supervised sites plus team members |
| GET | /reports/attendance-summary | perm:reports.view | `?from,to`. Per site: entries, uniqueWorkers, regular/OT/late totals, lateCount (not scoped) |
| GET | /reports/fraud-summary | perm:reports.view | `?from,to`. Punches with any flagReason: by reason, top 20 workers (UTC day bounds, not scoped) |

### 6.18 /teams, 9 routes
| M | Path | Auth | Notes |
|---|---|---|---|
| GET | /teams | staff | `?date,all=1`. Members on the date, supervisors, everCount |
| GET | /teams/:id/history | staff | every stint |
| POST | /teams | perm:teams.manage | `{name≤80, memberIds≤500, startDate?, supervisorIds≤20}` (supervisors must be SUPERVISOR or COMPANY_ADMIN tier). 409 duplicate active name. TEAM_CREATE |
| PUT | /teams/:id/supervisors | perm:teams.manage | `{userIds≤20}`. TEAM_SUPERVISORS |
| PATCH | /teams/:id | perm:teams.manage | `{name?, active?}` (archive). TEAM_UPDATE |
| POST | /teams/:id/members | perm:teams.manage | `{userIds, startDate?}`. 409 on an overlapping stint. TEAM_MEMBERS_ADD |
| POST | /teams/:id/members/:userId/remove | perm:teams.manage | `{lastDay?}` (default yesterday). If lastDay is before the start, the stint is deleted. TEAM_MEMBER_REMOVE |
| PATCH | /teams/memberships/:id | perm:teams.manage | `{startDate?, endDate?}`. Overlap check. TEAM_MEMBERSHIP_EDIT |
| DELETE | /teams/memberships/:id | perm:teams.manage | TEAM_MEMBERSHIP_DELETE |

### 6.19 /photos (new photo on record), 11 routes
| M | Path | Auth | Notes |
|---|---|---|---|
| GET | /photos/mine | JWT | photoStatus |
| GET | /photos/mine/current | JWT | my photo on record (file) |
| GET | /photos/mine/pending | JWT | my pending photo (file) |
| POST | /photos/mine | JWT | multipart `photo`. Fulfils the open request or creates a PENDING update. If the request had setVerify, verifyRequested is cleared. Push "New photo to approve" to company admins. PHOTO_SUBMIT |
| DELETE | /photos/mine | JWT | withdraws a PENDING update (it reverts to REQUESTED if an admin or auto asked for it) |
| GET | /photos | perm:photos.review | open updates (REQUESTED, PENDING) |
| GET | /photos/:id/photo | perm:photos.review | the file |
| POST | /photos/request/:userId | perm:photos.review | `{note≤300}`. Cancels a pending update, creates REQUESTED, sets verifyRequested. Push "New photo needed". PHOTO_REQUEST. Asking yourself gives 400 |
| DELETE | /photos/request/:userId | perm:photos.review | PHOTO_REQUEST_CANCEL |
| POST | /photos/:id/approve | perm:photos.review | becomes lastBindPhotoPath and resets faceDescriptor. Push "Photo approved". PHOTO_APPROVE |
| POST | /photos/:id/reject | perm:photos.review | `{note}`. If it was requested, a new REQUESTED update is created. Push "Photo not accepted". PHOTO_REJECT |

### 6.20 Invites, join and signup
`/invites` all **perm:workers.invite** (`modules/invites/invites.router.ts`), 8 routes:
| M | Path | Notes |
|---|---|---|
| POST | /invites | `{label≤60, role WORKER\|SUPERVISOR, siteId, templateId, templateIds≤10, expiresAt, maxUses 1–10000, leaveDays}`. A scoped caller must pick a site they supervise and cannot create SUPERVISOR invites (403). Token = 12 random bytes, base64url. `joinUrl = {WEB_BASE_URL}/#join={token}`. INVITE_CREATE |
| GET | /invites | scoped callers see their sites' invites. Includes the pending count |
| PATCH | /invites/:id | label, active, expiresAt, maxUses. INVITE_UPDATE |
| GET | /invites/registrations | `?status` (default PENDING), ≤200 |
| GET | /invites/registrations/:id/photo | file |
| POST | /invites/registrations/:id/approve | 409 if the phone was taken meanwhile (and the request is auto-rejected). Creates the user with the built-in role, site assignment (isSupervisor for SUPERVISOR), shift assignments from today, and leave. REGISTRATION_APPROVE. WhatsApp template `WHATSAPP_TPL_REG_APPROVED` with params [name, company] |
| POST | /invites/registrations/:id/reject | REGISTRATION_REJECT. Template `WHATSAPP_TPL_REG_REJECTED` |
| DELETE | /invites/:id | **perm:workers.manage** as well. Deletes the registrations too. INVITE_DELETE |

`/join` all public (`modules/invites/join.router.ts`), 4 routes. An invalid invite gives **410** with the reason: does not exist, disabled, expired, or max uses reached.
| M | Path | Notes |
|---|---|---|
| GET | /join/:token | `{company, site, shift, shifts[]}` |
| POST | /join/:token/request-otp | otpSendThrottle. `{phone}`. 409 if already in this company or a request is pending. Issues a LOGIN OTP |
| POST | /join/:token/verify-code | otpVerifyThrottle. Returns a `ticket` (JWT purpose `join`, 30 min) |
| POST | /join/:token/register | multipart `ticket, name≤80, employeeNo≤30, photo` (required). Creates a PENDING RegistrationRequest and increments `uses` |

`/signup` public (`modules/signup/signup.router.ts`), 3 routes. Kill switch `SELF_SIGNUP_ENABLED=false` gives 403.
| M | Path | Notes |
|---|---|---|
| POST | /signup/request-otp | an extra IP limit of 10 per hour. Refuses any known phone (409 `ALREADY_REGISTERED`) or a pending join (409 `PENDING_REGISTRATION`). SIGNUP OTP |
| POST | /signup/verify-code | otpVerifyThrottle. Ticket with purpose `signup` (30 min) |
| POST | /signup/complete | `{ticket, companyName≤80, timezone (validated IANA), adminName≤80, deviceId?}`. Company with defaults (`selfServe:true`) plus a COMPANY_ADMIN with an optional silent device bind. COMPANY_SELF_SIGNUP (+DEVICE_BIND). Returns `{token,user,company}` |

### 6.21 /terms (mounted at `/`), 4 routes
| M | Path | Auth | Notes |
|---|---|---|---|
| GET | /terms | JWT | `{text (company text or DEFAULT_TERMS), version, updatedAt, acceptedVersion, acceptedAt, mustAccept}` |
| POST | /terms/accept | JWT | `{version}` must match (409). TERMS_ACCEPT |
| PUT | /terms | perm:terms.manage | `{text 20..20000, reaccept=true}`. TERMS_UPDATE |
| GET | /terms/acceptances | perm:terms.manage | active WORKER/SUPERVISOR users with `current` |

DEFAULT_TERMS covers 9 plain-language clauses (`terms.router.ts:14-43`).

### 6.22 /assistant (`modules/assistant/*`), all **perm:assistant.use**, 4 routes
| M | Path | Input | Output |
|---|---|---|---|
| POST | /assistant/chat | `{message 1..2000, attachments[≤4]{mediaType jpeg/png/webp/gif/pdf, dataBase64 ≤6M chars, name?}}` | `{reply, pending:{summary}\|null}`. 503 `NOT_CONFIGURED` without ANTHROPIC_API_KEY. 500 `ASSISTANT_ERROR` |
| POST | /assistant/confirm | `{accept}` | `{message}`. 409 `NO_PENDING` |
| GET | /assistant/history | – | `{messages[{role,text}], pending, configured}` |
| POST | /assistant/reset | – | `{ok}` |

Engine (`assistant.service.ts`):
- Model `claude-sonnet-5`, max_tokens 8000, at most **8** tool rounds, history trimmed to **24** messages (never starting on a tool_result).
- A pending action expires after **30 min**.
- The session is stored per (user, company) in `AssistantSession.state`. It is reset when the permission/scope key changes. Binary attachments are replaced with placeholders before saving. An exception clears the history.
- Writes go through "confirm before commit": a tool returns `pending`. The user confirms via `/confirm` or by typing yes/y/confirm/ok/go ahead/do it. no/cancel/stop drops it. Any other message drops it too.
- The system prompt lists the abilities for each permission (`ABILITIES` at `:209-224`).

Tools (`assistant-tools.ts:150-435`, `assistant-jobs.ts:35-100`, `assistant-teams.ts:20-60`):
- **Read tools, always available**: list_sites, whos_on_site, site_pulse, find_worker, list_flagged_punches, get_timesheets, worker_hours, list_leave_requests, late_and_absent, overtime_summary, list_shift_templates, list_shift_assignments, list_jobs, list_teams.
- **Write tools, always offered** (they create a pending action): approve_punch, reject_punch, approve_timesheet, reject_timesheet, approve_leave, reject_leave, edit_timesheet_times, request_verification, approve_timesheets_bulk, assign_shift, unassign_shift.
- **Only for unscoped (COMPANY-scope) roles**: get_pay_profile, set_pay_profile, list_public_holidays, add_public_holiday, remove_public_holiday, create_worker, update_worker, reset_device, create_shift_template, set_overtime_rule, set_break_rule, edit_site, payroll_summary. Each is also checked against its permission (payroll.view/manage, workers.manage, schedules.manage, rules.manage, sites.manage).
- **jobs.manage**: plan_jobs (whole day, mode add\|replace, dayNote), update_job, delete_job.
- **teams.manage**: organize_teams (add, remove, move, create; `move` flag).
- **Permission gaps**:
  - approve/reject_punch, edit_timesheet_times, request_verification and assign/unassign_shift check **no permission** beyond assistant.use, only company and (site-only) scope.
  - Timesheet approve/reject and bulk check `timesheets.approve`. Leave checks `leave.approve` inside decideLeave.
  - The assistant's update_worker has no LAST_ADMIN guard.

### 6.23 Route counts
- auth 11
- companies 16
- sites 6
- workers 8
- punches 9
- timesheets 12
- schedules 9
- rosters/trades/presets 20
- terms 4
- rules 4
- links 4
- roles 5
- leave 19
- reports 3
- payroll 8
- teams 9
- jobs 12
- job photos 4
- job delivery 4 (two of them `all` proxies)
- v1 13
- photos 11
- invites 8
- join 4
- signup 3
- assistant 4
- app-level 3 (health, app-version, webhooks/clerk)

Total ≈ **218** route handlers.

### 6.24 Statuses and transitions
**Punch.status** (`OK | FLAGGED | APPROVED | REJECTED`):
- Created OK (no flag, or a MARK-ed location flag) or FLAGGED (`punches.service.ts:293`).
- FLAGGED → APPROVED (`approvePunch`, also the paired IN) or REJECTED (`rejectPunch`).
- An auto-left OUT is created OK.
- Deletion is a hard delete via entry reopen (OUT punches) or entry delete. There is no un-approve.

**TimeEntry.status** (`OPEN | PENDING | APPROVED | REJECTED | AUTO_CLOSED`):
- OPEN is created by the first IN (or the first job IN).
- OPEN → PENDING on a plain OUT, an endsDay job OUT, or a stale close at a pending OUT.
- OPEN → AUTO_CLOSED by the cron or a stale close.
- A PENDING entry can also be created directly: missed-request, manual entry, or missed clock-in on approval.
- PENDING or AUTO_CLOSED → APPROVED or REJECTED (`decideEntry`).
- Any closed entry → PENDING through an edit (approval cleared) or a punch-approval reclose. AUTO_CLOSED → PENDING on an override approval.
- Any entry with a clockOut → OPEN through reopen.
- Hard delete through DELETE.
- REJECTED is terminal except via edit or reopen.

**Job**:
- Own jobs have `status = null`. The office progress is derived (`jobStatus`): NOT_STARTED → IN_PROGRESS → DONE from crew punches. Own jobs are hard-deleted (`deleteJob`). Edits via PATCH / roster routes / assistant.
- External jobs (`externalSource` set, from `/v1`): `SCHEDULED → IN_PROGRESS → COMPLETED` (forward only, via PATCH status), or `→ CANCELLED` from SCHEDULED or IN_PROGRESS (soft).
  - The office, roster routes and assistant refuse to edit or delete them (409 `EXTERNAL_JOB`). Day replace and copy skip them.
  - `liveJob` hides CANCELLED jobs everywhere in SiteClock (`lib/externalJobs.ts:21`).
  - Punches never change the status.

**LeaveRequest** (`PENDING | APPROVED | REJECTED | CANCELLED`):
- Created PENDING (worker) or APPROVED (recorded).
- PENDING → APPROVED or REJECTED (`decideLeave`).
- PENDING or APPROVED → CANCELLED (worker cancel, except recorded leave).
- Any status except CANCELLED → CANCELLED (admin DELETE).

**PhotoUpdate.status** (a string: `REQUESTED | PENDING | APPROVED | REJECTED | CANCELLED`):
- REQUESTED is created by an admin request, auto at first login, or re-requested after a reject of a requested update.
- REQUESTED → PENDING when the person submits.
- A person's own submit creates PENDING.
- PENDING → APPROVED (admin) or REJECTED (admin; a new REQUESTED follows if it had been requested).
- PENDING → REQUESTED or CANCELLED when the person withdraws.
- REQUESTED → CANCELLED (admin cancel) or APPROVED (`closeRequestFromPunch` when a punch selfie is approved).
- A pending update is CANCELLED when an admin makes a new request.

**RegistrationRequest** (`PENDING | APPROVED | REJECTED`):
- Created PENDING by `/join/:token/register`.
- → APPROVED (approve, which creates the User) or REJECTED (reject, or the phone was taken at approve time).
- Hard-deleted when its invite is deleted.

**JobPhoto.status** (`QUEUED | STORED | FAILED`) plus `deletedAt` and `aimsDeletedAt`:
- Created QUEUED. `nextAttemptAt` is set to now+60 s until the file is written, then to now.
- `sendPhoto` leases the row for 5 min. A 2xx with a photoId → STORED and the temp file is removed.
- A 4xx (except 408 and 429), a missing file or no id → FAILED, and admins get the push "Job photo not sent to AIMS".
- Network, 5xx, 408 or 429 → retry after 1, 2, 5, 10, 30, 60 min, then hourly until 24 h → FAILED.
- Delete is a soft delete. The AIMS delete is retried with delay `clamp((now−deletedAt)/4, 1 min, 1 h)` for up to 24 h.

**WebhookDelivery.status** (`PENDING | SENT | FAILED`):
- PENDING → SENT on a 2xx.
- Otherwise retried after 1 m, 5 m, 30 m, 2 h, 12 h. After 5 retries (6 attempts) → FAILED (`lib/webhooks.ts:18,85-98`).
- **The outbox is idle: `enqueueEvent` is never called anywhere** (schema comment "Infrastructure only for now").

**InviteLink** has no status. It is unusable when `active=false`, past `expiresAt`, at `uses>=maxUses`, or when the company is inactive.

**OtpCode**: `used`, plus `attempts` up to 5.

### 6.25 Background jobs (`jobs/autoclose.ts:79-118`, started from `index.ts`)
| Schedule (server timezone) | What | File |
|---|---|---|
| `*/15 * * * *` | auto-close stale OPEN entries (4.6) | jobs/autoclose.ts:18 |
| `*/5 * * * *` | shift clock-in and clock-out reminders (4.7) | jobs/reminders.ts:19 |
| `* * * * *` | API-job 15-min reminders, then the webhook outbox (batch 50, 10 s timeout, a `running` guard), then job-photo delivery and AIMS deletes (batch 20 each) | jobs/reminders.ts:102, lib/webhooks.ts:47, lib/jobPhotos.ts:284 |
| `30 19 * * *` (03:30 SGT) | purge temp files of photos FAILED 7–14 days ago, or deleted in the last 7 days (status not STORED) | lib/jobPhotos.ts:319 |
| `0 1 * * *` (09:00 SGT) | push reminders for flagged punches per site | jobs/autoclose.ts:57 |
| `*/10 * * * *` | backfill missing punch addresses (≤20 per run, last 60 days) | jobs/backfill-address.ts |

All of these are single-process and in-memory guarded. Nothing protects against running more than one instance (duplicate pushes and sends are possible).

**Webhook signing**: headers `X-SiteClock-Event-Id: evt_<24hex>`, `X-SiteClock-Event: <type>`, and `X-SiteClock-Signature: t=<unix>,v1=hex(HMAC-SHA256(secret, t+"."+body))`. User-Agent `SiteClock-Webhooks/1`. Payload `{id,type,occurredAt,companyId,…data}`.

### 6.26 Realtime (`realtime/socket.ts`)
- Socket.io on the same server. CORS and the Origin check use CORS_ORIGINS; a missing Origin (the app) is allowed.
- Handshake: `auth.token` (our JWT or a Clerk token) goes through `resolveSession`.
- Rooms:
  - `user:{userId}` (always);
  - `company:{companyId}` (when the user has ≥1 permission);
  - `site:{siteId}`, joined via the client event `site:subscribe` when the user holds `live.view`, the site is in their company, and scoped users are assigned to it. `site:unsubscribe` leaves it.
- Server events:

| Event | Room | Payload | Source |
|---|---|---|---|
| `site:presence` | the socket | `{siteId, present[{entryId,userId,name,employeeNo,clockInAt}]}` on subscribe | socket.ts:75 |
| `site:punch` | site | `{action:"add", siteId,userId,name,employeeNo,entryId,clockInAt}` or `{action:"remove", siteId,userId,entryId}` | punches.service.ts:424,447,494 |
| `punch:flagged` | site + company | `{punchId,userId,name,siteId,type,flagReason}` | punches.service.ts:328-329 |
| `punch:reviewed` | user | `{punchId,status}` | punches.service.ts:648,701,729 |
| `worker:deviceRebound` | company | `{userId,name}` | auth.router.ts:172,208,252 |
| `worker:accountDeleted` | company | `{userId,name}` | auth.router.ts:293 |

### 6.27 External services and env var names (no values)
| Service | Use | Env |
|---|---|---|
| Postgres (Prisma) | data | DATABASE_URL |
| Local disk | selfies, binds, leave documents, registrations, job-photo temp files | UPLOAD_DIR (default ./uploads; Railway FS is ephemeral, so a volume is needed) |
| Firebase Cloud Messaging | push (`lib/push.ts`). Android priority high, APNs sound default. Unregistered tokens are cleared | FIREBASE_SERVICE_ACCOUNT (path) or FIREBASE_SERVICE_ACCOUNT_B64 |
| WhatsApp Cloud API (graph v20.0) | OTP (AUTHENTICATION template: body `{{1}}`=code plus a copy-code URL button) and registration outcome (UTILITY templates, params [name, company]) | SMS_PROVIDER (=whatsapp, else console), WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME (default siteclock_otp), WHATSAPP_LANG (default en), WHATSAPP_TPL_REG_APPROVED, WHATSAPP_TPL_REG_REJECTED |
| Clerk (instance shared with AIMS) | RS256 session tokens (authorizedParties = CORS origins), write-through linking via publicMetadata.siteclock, webhooks (user.created, user.updated, user.deleted, sms.created), sign-in tokens for the AIMS link | CLERK_ENABLED, CLERK_SECRET_KEY, CLERK_JWT_KEY, CLERK_PUBLISHABLE_KEY, CLERK_WRITE_THROUGH, CLERK_WEBHOOK_SIGNING_SECRET, CLERK_WEBHOOK_APPLY, CLERK_SMS_SEND |
| OneMap (SLA) | SG geocoding for jobs and `/v1` sites (6-digit postal code first, abbreviations expanded, 1 retry, 6 s) | ONEMAP_TOKEN (optional) |
| OSM Nominatim | reverse geocode of punches (requests ≥1.1 s apart, cache on a ~11 m grid, 5 s), address search, job geocode fallback | – (fixed User-Agent) |
| Anthropic | in-app assistant | ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID |
| face-api / tfjs / sharp | face match (local CPU) | FACE_MATCH_THRESHOLD |
| AIMS (outbound) | job photos `POST/GET url/DELETE {base}/integrations/siteclock/photos`, delivery proxy. The inbound key is stored AES-256-GCM encrypted (`lib/secretBox.ts`) | SECRETS_KEY (required in production), AIMS_WEB_URL |
| Misc | – | JWT_SECRET (required in production), PORT, NODE_ENV, CORS_ORIGINS, WEB_BASE_URL, OTP_DEV_MODE, OTP_DEV_PHONES, OTP_IP_LIMIT, REVIEW_PHONE, REVIEW_OTP, SELF_SIGNUP_ENABLED, PLATFORM_OWNER_PHONE (has a hard-coded default, value omitted), APP_LATEST_BUILD[_ANDROID\|_IOS], APP_MIN_BUILD[_ANDROID\|_IOS], APP_ANDROID_URL, APP_IOS_URL |

**Push notifications** (title → trigger, data.kind):
- Punches:
  - "Flagged punch needs review" → a flagged punch is created, sent to site supervisors, the worker's team supervisors and company admins (excluding the worker) (`punch_flagged`).
  - "Flagged punches awaiting review" → daily 09:00, to site staff (`flag_reminder`).
  - "Punch approved" / "Punch rejected" → the worker (`punch_reviewed`).
- Shifts and entries:
  - "Shift auto-closed" → the worker (`entry_auto_closed`).
  - "Shift starting soon" (`clockin_reminder`) and "Still clocked in?" (`clockout_reminder`).
  - "Missed entry request" → site staff (`entry_request`).
- Login codes:
  - "Web login code" → the account holder's phone (`web_login_code`).
  - "SiteClock login code" → the Clerk SMS fallback (`clerk_login_code`).
- Leave:
  - "Leave recorded" (`leave_decided`).
  - "Leave approved" / "Leave rejected" (`leave_decided`).
- Photos:
  - "New photo to approve" → admins (`photo_update`).
  - "New photo needed" (`photo_request`).
  - "Photo approved" / "Photo not accepted" (`photo_reviewed`).
  - "Job photo not sent to AIMS" → admins (`job_photo_failed`).
- Rosters:
  - "You're rostered" and "Roster change" (`roster`).
- Own jobs:
  - "Your jobs for {day} ({n})" (`jobs`).
  - "Job removed from your day", "Job cancelled", "Your schedule changed" (`jobs`).
- API jobs:
  - "New job", "Job changed", "Job removed", "Job cancelled", "Job starting soon" (`job`, with jobId and date).

### 6.28 Audit log (`lib/audit.ts`, table AuditLog `{companyId, actorId, action, entity, entityId, before, after}`)
Every action string written:

| Area | Actions |
|---|---|
| Account and device | ACCOUNT_DELETE, ACCOUNT_SWITCH, DEVICE_BIND, DEVICE_REBIND, DEVICE_RESET, PLATFORM_DEVICE_RESET |
| Platform | ADMIN_CREATE, SUPERADMIN_CREATE, SUPERADMIN_VIEW_AS, COMPANY_CREATE, COMPANY_UPDATE, COMPANY_SELF_SIGNUP, COMPANY_LINK, COMPANY_UNLINK, PLATFORM_USER_ACTIVATE, PLATFORM_USER_DEACTIVATE, PLATFORM_USER_DELETE, PLATFORM_COMPANY_DELETE |
| API (`/v1` and scripts) | API_CLIENT_CREATE, API_CLIENT_AIMS_LINK (scripts), API_SITE_CREATE, API_SITE_UPDATE, API_JOB_CREATE, API_JOB_UPDATE, API_JOB_STATUS, API_JOB_CANCEL |
| Punches | AUTOCLOSE_OVERRIDE_REQUEST, PUNCH_APPROVE, PUNCH_REJECT, PUNCH_GROUP |
| Time entries | ENTRY_AUTO_CLOSE, ENTRY_CLOSE_AT_PENDING_OUT, ENTRY_EDIT, ENTRY_MANUAL_CREATE, ENTRY_MISSED_REQUEST, ENTRY_REOPEN, ENTRY_DELETE, ENTRY_APPROVED, ENTRY_REJECTED |
| Rules | OT_RULE_SET, BREAK_RULE_SET, PUNCH_RULE_SET |
| Clerk | CLERK_LINK, CLERK_SYNC, CLERK_SYNC_FAILED, CLERK_USER_DELETED |
| Jobs | DAY_NOTE_SET, JOBS_NOTIFY, JOBS_PLAN, JOB_CREATE, JOB_UPDATE, JOB_DELETE, JOB_QR_ROTATE, JOB_PHOTO_ADD, JOB_PHOTO_DELETE |
| Invites | INVITE_CREATE, INVITE_UPDATE, INVITE_DELETE, REGISTRATION_APPROVE, REGISTRATION_REJECT |
| Leave | LEAVE_TYPE_CREATE, LEAVE_TYPE_UPDATE, LEAVE_TYPE_DELETE, LEAVE_TYPE_ARCHIVE, LEAVE_TYPE_RESTORE, LEAVE_ENTITLEMENT_SET, LEAVE_RECORDED, LEAVE_APPROVED, LEAVE_REJECTED, LEAVE_CANCELLED_BY_ADMIN |
| Rosters | MANNING_PRESET_SET, ROSTER_CREATE, ROSTER_DELETE, ROSTER_PUBLISH, ROSTER_COPY_WEEK, TRADE_CREATE, TRADE_DELETE |
| Pay | PAY_PROFILE_SET |
| Photos | PHOTO_SUBMIT, PHOTO_REQUEST, PHOTO_REQUEST_AUTO, PHOTO_REQUEST_CANCEL, PHOTO_APPROVE, PHOTO_REJECT |
| Roles | ROLE_CREATE, ROLE_UPDATE, ROLE_DELETE |
| Schedules | SHIFT_ASSIGN, SHIFT_UNASSIGN, TEMPLATE_CREATE, TEMPLATE_UPDATE, TEMPLATE_DELETE |
| Sites | SITE_CREATE, SITE_UPDATE |
| Teams | TEAM_CREATE, TEAM_UPDATE, TEAM_SUPERVISORS, TEAM_MEMBERS_ADD, TEAM_MEMBER_REMOVE, TEAM_MEMBERSHIP_EDIT, TEAM_MEMBERSHIP_DELETE, TEAMS_ORGANIZE |
| Terms | TERMS_ACCEPT, TERMS_UPDATE |
| Workers | VERIFY_REQUEST (route), VERIFY_REQUESTED (assistant; an inconsistent name), WORKER_CREATE, WORKER_UPDATE, WORKER_PHONE_CHANGE |

Not audited:
- leave request create and worker cancel;
- holiday add and delete;
- manning preset delete;
- roster patch, entries add/remove and day copy;
- trade assignment to a user;
- fcm-token;
- job photo sends.

There is **no API to read the audit log** except the 15 rows in platform/overview.

### 6.29 Security model
- **Session JWT**:
  - HS256 `{sub, role, companyId}`, expires in **30 d**, no refresh and no revocation list.
  - Every request re-reads the user, so deactivation and role changes apply immediately (`lib/auth.ts:103-117`).
  - Tokens that carry a `purpose` (bind, join, signup) are refused as sessions.
  - View-as: `{viewAs:true, companyId}` for 8 h. It is only valid while the holder is still an active SUPERADMIN, and it grants FULL_ACCESS in that company.
  - Clerk RS256 tokens are accepted when CLERK_ENABLED. An unlinked Clerk user gets 403 `NO_SITECLOCK_ACCOUNT`.
- **Permissions** (`lib/permissions.ts:13-92`). Each key and what it unlocks:

| Key | Unlocks |
|---|---|
| overview.view | (web only; no server route checks it (?)) |
| live.view | /sites/:id/present, pulse people, the socket site room |
| flagged.view | /punches/flagged, /punches/marked, /punches/face-log, others' punch photos |
| flagged.review | punch approve/reject |
| timesheets.view | list, detail, /links/lent |
| timesheets.edit | edit, manual entry |
| timesheets.approve | approve, reject, bulk |
| timesheets.reopen | reopen, delete |
| timesheets.export | export |
| workers.view | the workers list, bind photo |
| workers.manage | create/edit/phone/reset device, invite delete, leave balances/entitlements |
| workers.verify | request-verification |
| workers.invite | /invites/* |
| photos.review | /photos admin routes |
| sites.manage | site create/edit |
| teams.manage | team writes, full directory |
| jobs.view | /jobs list, /rosters reads, /links/workers, /links/hours, manning presets |
| jobs.manage | job and roster writes, notify, publish, copy, place lookup |
| jobs.setup | trades, presets, import |
| schedules.view | templates, assignments, exceptions |
| schedules.assign | assignments |
| schedules.manage | templates |
| leave.view | leave requests, calendar, documents |
| leave.approve | leave approve/reject |
| leave.manage | types, record, admin cancel, balances, entitlements |
| payroll.view | payroll, profiles read, holidays read, export |
| payroll.manage | profile write, holidays write |
| reports.attendance | attendance export |
| reports.view | summary, fraud |
| rules.manage | /rules |
| terms.manage | terms edit, acceptances |
| roles.manage | role writes |
| assistant.use | /assistant |

- Built-in roles:
  - ADMIN: all keys, COMPANY scope, locked.
  - SUPERVISOR: `SUPERVISOR_DEFAULTS` (live.view, flagged.view/review, timesheets.view/edit/export, workers.view/verify/invite, jobs.view, schedules.view/assign, leave.view/approve, reports.attendance, assistant.use) plus the two legacy switches. ASSIGNED scope.
  - WORKER: none.
  - The tier stored in `User.role`: every permission → COMPANY_ADMIN; any permission → SUPERVISOR; none → WORKER (`tierOf`).
- **ASSIGNED scope**:
  - `reviewScope` = rows at the sites I supervise OR by members of teams I supervise. Used by punches/flagged/marked/face-log, timesheets and mayReview.
  - Workers list and directory: my assigned sites (any assignment) plus my team members.
  - Leave: my site assignments only.
  - Invites and rosters: sites I supervise.
  - Jobs writes: sites I supervise plus any JOB-kind (address) site.
  - **Not scoped**: payroll, reports summary and fraud, schedules/assignments list, sites PATCH, workers PATCH/manage, leave calendar with siteId, teams GET.
- **Superadmin**: `assertSameCompany` always passes for a superadmin. Without view-as, `requirePerm` and `requireStaff` refuse (`NO_COMPANY`). `/companies/*` is superadmin only. The platform owner, matched on phone digits, is protected.
- **Rate limits** (`lib/throttle.ts`):
  - An in-memory sliding window per IP, **100 requests per 15 min** (OTP_IP_LIMIT) on request-otp, verify-otp, rebind, join OTP and signup verify. The response is 429 "Too many attempts. Try again later."
  - Signup request-otp: 10 per hour per IP.
  - Per-phone OTP caps (4.16).
  - Single process only; the map is pruned beyond 5000 keys. There is no global API rate limit.
- **CORS**: CORS_ORIGINS. In production it falls back to the WEB_BASE_URL origin; in dev to localhost:5173, 127.0.0.1:5173 and localhost:4173. Requests with no Origin are allowed.
- **Uploads**:

| Upload | Limit | Check | Stored as |
|---|---|---|---|
| Punch selfie | 8 MB | `mimetype.startsWith("image/")` (client-declared) | ext .png or .jpg |
| Binds / photos / worker photo / registration | 8 MB | image/* (declared) | **extension taken from `originalname`** |
| Leave documents | 8 MB, ≤5 files | image/* or PDF | |
| Job import | 5 MB | in memory | |
| Job photo | 10 MB | **sniffed magic bytes** (JPEG/PNG/WebP/HEIC/HEIF) | |
| Delivery image | 15 MB | sniffed | |
| Assistant attachments | ~4.5 MB each, ≤4 | base64 in JSON | |
| JSON body | 12 MB | | |

  Upload filenames are `Date.now()-randomhex`.
- **Who can see files**:

| File | Visible to |
|---|---|
| Punch selfie | the owner; flagged.view in the same company (scoped: site supervisor of that site) |
| Photo on record | workers.view (`/workers/:id/bind-photo`); the owner (`/photos/mine/current`) |
| Pending photo | photos.review; the owner |
| Registration selfie | workers.invite |
| Leave document | the owner; leave.view (scoped: shares a site) |
| Job photo | crew, site or team supervisor, admin |

- **Secrets at rest**: OTPs are HMACs; API keys are SHA-256; the AIMS inbound key uses AES-256-GCM (`SECRETS_KEY`; in dev the key is derived from JWT_SECRET). The webhook secret is stored in plain text on ApiClient.
- **Clerk webhook**: Svix-verified. Idempotent per svix-id (ProcessedWebhook). Log-only unless the APPLY or SMS_SEND flags are set.

### 6.30 Known TODOs, oddities, dead or half-built parts
1. **Webhook outbox is idle**. `WebhookDelivery` and `deliverDueWebhooks` run every minute, but `enqueueEvent` has no callers (`lib/webhooks.ts:31`; schema comment).
2. **Dead models and fields**:
   - `Roster`, `RosterRequirement`, `RosterEntry` tables are unused (rosters are now Jobs).
   - `FlagReason.FACE_MISMATCH` is never set.
   - `FencePolicy` is used only for fraudPolicy.
   - Legacy fields are still read as fallbacks: `ShiftTemplate.siteId` and `payEarly`, `OvertimeRule.countEarlyAsWork`, `Company.supervisorsApproveTimesheets` / `supervisorsManageJobs` (now mirrored into the Supervisor role), `User.role` (a derived tier).
3. **Assistant permission gaps**: approve/reject punch, edit times, request verification and assign/unassign shift need only `assistant.use`. The assistant's scope checks use supervised sites only, not teams (`assistant-tools.ts:646,846`).
4. **Privilege escalation**: anyone with `workers.manage` can assign the Admin role (`role: COMPANY_ADMIN` or the Admin `companyRoleId`) (`workers.router.ts:148,218`). `PATCH /companies/platform/users/:id {role}` changes the tier without the role row (?).
5. **Over-broad user payloads**: `GET /workers`, `/auth/me`, `/auth/verify-otp` and the `/auth/switch|bind-device|rebind-device` responses return whole User rows, including `fcmToken`, `deviceId`, `faceDescriptor` (128 floats) and `clerkUserId`.
6. **Phone uniqueness is inconsistent**. Create and approve allow the same phone in another company (`phoneTaken`). Phone *change* (worker PATCH, change-phone, platform users PATCH) refuses any existing holder in any company (`userByPhone`). The Clerk webhook phone sync changes one row only.
7. **Rule gaps**:
   - Default `nlbCreditMinutes = 0`, so an approved NLB does nothing.
   - There is no weekly OT threshold, only a cap.
   - Monthly salary is not prorated.
   - Admins are excluded from payroll.
   - Leave balance counts calendar days but payroll counts workdays.
   - No leave overdraw check.
   - Worker leave cancel ignores dates.
   - A leave request sends no notification and writes no audit.
8. **`editedById` is overloaded**. A worker's own missed request, manual entries and every punch-approval reclose count as an "admin edit", so `payFollowsCrew` silently stops applying to those days.
9. **Timezone slips**:
   - `/rosters/mine` uses UTC dates.
   - Invite-approved shift start uses the server date.
   - Cron times assume a UTC server.
   - `fraud-summary` uses UTC day bounds.
   - Reminders for company-wide templates fall back to Asia/Singapore.
10. **Scope leaks** (not filtered by ASSIGNED): payroll; reports summary and fraud; schedules/assignments list; leave calendar with `siteId`; `PATCH /sites/:id`; worker edits; the punch photo route honours only site supervision, not teams. Leave approval scope ignores teams despite the comment.
11. **Single-instance assumptions**: in-memory rate limits, reminder tick windows, the `running` guards and the face-model queue all break or double up with more than one API process.
12. **CSV exports don't escape formulas** (`lib/csv.ts`, a leading `=`, `+`, `-` or `@` is not neutralised).
13. **Missing audits**: holidays, leave create, roster entry edits, day copy, trade assignment, preset delete. **No audit-log read API.**
14. **Risky upload extension**: bind and registration uploads keep the client's `originalname` extension. Files are served via authenticated `sendFile`, whose content type comes from that extension (low risk, since a Bearer token is needed).
15. **Misleading comment**: `jobs/autoclose.ts:16` says AUTO_CLOSED entries are "excluded from export until reviewed", but the timesheet export includes every status.
16. **External-job guard missing**: `POST /jobs/:id/qr` does not refuse external jobs. `/rosters/publish` has no `liveJob` filter.
17. **Shared workers**: delivery and photos for an AIMS job of a *linked* company are unreachable, because `loadJob` and `deliveryJob` filter by the caller's company. Day notes in `/jobs/mine` come only from the home company.
18. **Possible delete failure**: company hard-delete does not remove Trades, ManningPresets or other companies' punches and entries at its sites. A foreign key may block it (?).
19. `GET /terms` and `GET /trades` assume a company. A superadmin without view-as gets a 500 (`findUniqueOrThrow` / `companyId!`).

---

## 7. Integrations

Full reference: `SITECLOCK.md` §4 (AIMS `/v1`, delivery relay, photos, Clerk). Only the gaps that matter for a rebuild are listed here.

### 7.1 AIMS (gaps for a rebuild inside AIMS)
- If SiteClock functions move into AIMS, the whole `/v1` layer, the delivery relay and the photo relay disappear: AIMS jobs, DO and photos are already AIMS data, and the relay exists only because the worker app lives in SiteClock (`backend/src/lib/aimsDelivery.ts`, `backend/src/lib/jobPhotos.ts`).
- What has to be kept or recreated from the relay:
  - The worker-facing native Delivery screens (`app/lib/delivery/*`) are a native copy of AIMS field delivery pages. The AIMS field app already has those pages (SiteJobs app per `Biofuel.md`). Pick one.
  - Clock-out guard: no clock-out from an unfinished delivery job without "Can't finish today" + reason (`app/lib/delivery/clock_out_guard.dart:124`).
  - Photos window: from clock-in until 23:59 on the job day (`backend/src/lib/jobPhotos.ts`, `GET /jobs/:id/photos` returns `addFrom`/`addUntil`).
- Gaps today (also in SITECLOCK.md): no timesheet/punch/payroll API; `updatedAt` only on Job; SiteClock jobs hard-deleted; webhook outbox idle; shared workers can't open delivery/photos for a linked company's AIMS job (§6.30 #17); no `/v1` rate limit or key-management UI.
- Identity bridge: `User.clerkUserId` + AIMS `OrganizationMemberProfile.siteclockUserId` (AIMS side, per `docs/do-into-siteclock-discovery.md:126`). Needed to map SiteClock workers to AIMS members during migration.

### 7.2 Other integrations
| Service | Use | Where | Env names |
|---|---|---|---|
| Firebase Cloud Messaging | push to app | `backend/src/lib/push.ts`, `app/lib/services/push_service.dart` | `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_SERVICE_ACCOUNT_B64` |
| Meta WhatsApp Cloud API | OTP + registration approved/rejected templates | `backend/src/lib/whatsapp.ts`, `backend/src/lib/otp.ts` | `SMS_PROVIDER`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_LANG`, `WHATSAPP_TPL_REG_APPROVED`, `WHATSAPP_TPL_REG_REJECTED` |
| Clerk (shared with AIMS) | web SSO, metadata, webhooks | `backend/src/lib/clerk*.ts`, `web/src/lib/clerk.tsx` | `CLERK_*`, `VITE_CLERK_*`, `AIMS_WEB_URL`, `VITE_AIMS_URL` |
| OneMap SG / OSM Nominatim | geocode + reverse | `backend/src/lib/geocode.ts`, `backend/src/jobs/backfill-address.ts` | `ONEMAP_TOKEN` |
| Anthropic Claude | assistant | `backend/src/modules/assistant/assistant.service.ts:15` | `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` |
| face-api (local, tfjs WASM) | face match vs photo on record | `backend/src/lib/face.ts` | `FACE_MATCH_THRESHOLD` |
| On-device ML (iOS Vision / Google ML Kit) | face present check before selfie upload | `app/lib/services/face_check.dart` | — |
| Google Maps (link out) | open job place | `app/lib/screens/worker/jobs_screen.dart` | — |
| Leaflet / OSM tiles | maps in web + app (?) | `web/package.json`, `app/lib/widgets/site_map.dart` | — |
| Local disk | selfies, worker photos, registration photos, leave documents, job-photo temp | `UPLOAD_DIR` (`backend/src/modules/punches/punches.router.ts:20-21`) | `UPLOAD_DIR` |
- No email, SMS (other than WhatsApp), payment, accounting or calendar integrations.

---

## 8. Non-functional

### 8.1 Offline
- Plain Clock-tab punches queue offline with idempotency key + `queuedAt`; server back-dates up to 48 h and flags OFFLINE if > 60 min late (`app/lib/services/punch_queue.dart`; §4.8).
- Job-tab punches and group punches are **not** queued ("No connection — try again").
- A queued punch the server refuses (4xx/5xx) is **dropped silently**.
- Job photos + delivery photos queue with `clientId` (`app/lib/services/photo_queue.dart`).
- Not offline: login, job list (not cached (?)), delivery steps (retry ×2 only), leave, payslip, history. Terms gate fails open offline; update check fails open.

### 8.2 Performance / limits
- JSON body 12 MB; Clerk webhook raw body 1 MB (`backend/src/app.ts:35-39`).
- Delivery uploads ≤ 15 MB; AIMS relay timeouts 30 s / 90 s PDFs.
- Timesheet export ≤ 10 000 rows; attendance export 1–92 days; `/v1/jobs/calendar` ≤ 62 days; `/v1/jobs` ≤ 500 per page.
- Face match runs in-process (WASM) with an in-memory queue (§6.30 #11).
- Single Railway process: HTTP + socket + crons; migrations on boot (`backend/railway.json`).

### 8.3 Rate limits
- In-memory sliding window, single process (`backend/src/lib/throttle.ts`): OTP send/verify/rebind/join/signup per IP (100 per 15 min, `OTP_IP_LIMIT`), signup 10/h per IP; OTP per phone: 5 wrong tries per code, 3 live codes, 6 unused per hour (`backend/src/lib/otp.ts`).
- No global limit, none on `/v1`.

### 8.4 Multi-company isolation & security
- Isolation per query (`req.companyId`), `assertSameCompany()` for ids from outside (`backend/src/lib/auth.ts:196-200`); no DB row-level security, no Prisma middleware.
- Session = HS256 JWT 30 days; DB re-read of role/company/active on every request (`backend/src/lib/auth.ts:103-157`); view-as token 8 h.
- Permissions: keys in `backend/src/lib/permissions.ts:13-104`; scope ASSIGNED limits to supervised sites + teams — with known leaks (§6.30 #10).
- Files served only through authenticated routes (`sendFile`), no public bucket (§6.29).
- Known weaknesses (code reading, not tested): `workers.manage` can grant Admin (`backend/src/modules/workers/workers.router.ts:140,210-222`); assistant tools bypass specific permissions; full User rows (push token, device id, face descriptor) in several responses; CSV formula injection (§6.30).
- Device binding is friction + audit, not a security boundary (`app/README.md`).

### 8.5 Audit
- `AuditLog` append-only via `backend/src/lib/audit.ts`; ~action list in §6.28; API writes as `api:<clientId>`. Missing for some actions (holidays, leave create, roster entry edits, day copy, trades, presets). **No read API or UI.**

### 8.6 i18n / locale
- None: all English, hard-coded in Dart and TSX; `intl` only for `DateFormat` (`app/pubspec.yaml:44`). Money as `$x.xx` SGD cents; default timezone Asia/Singapore; phone regex `^\+?[0-9]{8,15}$`.

### 8.7 App versions / store status
- App `1.0.17+27` in `app/pubspec.yaml`; tag `v1.0.16` (build 26) only; last confirmed store release 1.0.14 (build 24) (`docs/release-1.0.16.md`). 1.0.15 internal/TestFlight only; 1.0.16 and 1.0.17 store status unknown (?), signing keys not on this Mac (memory note `app-release-signing.md`).
- Gate: `APP_MIN_BUILD_*` = 20 (`docs/release-1.0.17.md`); every older build since 20 must keep working against the API — a rebuild that keeps the SiteClock app talking to a new backend must keep this contract.
- Android/iOS bundle `com.osiris.siteclock`.

---

## 9. Known bugs, TODOs, half-built and hidden

Details with file:line are in §6.30 (backend) and §3.3 (UI). Summary:

**Bugs / risky behaviour (code reading, not tested)**
1. `workers.manage` can make anyone (incl. self) Admin (`backend/src/modules/workers/workers.router.ts:140,216`).
2. Assistant write tools (approve/reject punch, edit times, request verification, assign shift) need only `assistant.use`; scope check ignores teams (`backend/src/modules/assistant/assistant-tools.ts:646,846`).
3. Scope ASSIGNED not applied to payroll, summary/fraud reports, schedule assignments list, leave calendar with siteId, site and worker edits.
4. Full User rows (fcmToken, deviceId, faceDescriptor, clerkUserId) returned by `/workers`, `/auth/me`, login/switch/bind.
5. Bulk approve silently skips `needsReview` entries (web `web/src/pages/Timesheets.tsx:82-85`, app `app/lib/screens/admin/timesheets_screen.dart:127-140` says "N approved").
6. Refused offline punches are dropped without telling the worker (`app/lib/services/punch_queue.dart`).
7. "Pay follows crew" silently stops on any entry with `editedById` — including the worker's own missed request and punch-approval recloses (§6.30 #8).
8. Phone uniqueness differs between create (per company) and change (global) (§6.30 #6).
9. Timezone slips: `/rosters/mine` UTC dates, fraud-summary UTC bounds, cron times assume UTC server (§6.30 #9).
10. CSV export formula injection; misleading AUTO_CLOSED export comment; `POST /jobs/:id/qr` and `/rosters/publish` don't exclude AIMS/cancelled jobs; company hard-delete may fail on FKs (?); `GET /terms` / `/trades` 500 for superadmin without view-as.

**Payroll/leave rule gaps**
- NLB credit default 0 (approved NLB changes nothing); no weekly OT threshold (cap only); monthly salary not prorated; admins excluded from payroll; no CPF/deductions; leave balance in calendar days vs payroll in workdays; no leave overdraw check; worker cancel ignores dates; new leave request: no push, no audit (§6.30 #7).

**Half-built / dead / legacy**
- Webhook outbox idle (`backend/src/lib/webhooks.ts`).
- Roster/RosterRequirement/RosterEntry tables dead; `FlagReason.FACE_MISMATCH` never set; legacy fields read as fallbacks (`ShiftTemplate.siteId`, `payEarly`, `OvertimeRule.countEarlyAsWork`, `Company.supervisorsApproveTimesheets/ManageJobs`, `User.role`).
- App Rules screen still shows the legacy "Supervisors can approve timesheets" switch.
- Audit log has no reader.
- Socket events `worker:deviceRebound`, `worker:accountDeleted` emitted with no UI listener (?).
- `clerk-prod-relink` branch unmerged; Clerk login hidden behind flags.

**Hidden / not obvious but relied on**
- Clock tab auto-picks the target (job you're at, else next by time); job picker and "End my day" sit behind the job row.
- Selfie face detection never blocks (fails open on device and server).
- Web login code from the app (no WhatsApp needed) — supervisors rely on it for web access; workers without permissions can't use the web.
- Many settings exist only on the web (site kind/auto-close, per-worker overrides, most rules, payroll, roles, terms, exports).
- Server-turned-on UI: `photosEnabled`, `deliveryEnabled`, `qrRequired`, `fromCompany`, `payslipVisible`, `notifyRoster`, `groupJobClocking`, Shared workers tab only when linked.
- AIMS org flags change app wording: `enableWctOrders`, `enableWctFinishModes` (`app/lib/delivery/delivery_ui.dart:38`).
- Fixed WCT service report template ids must not be renamed (`app/lib/delivery/wct_service_template.dart`).
- `devCode` returned by OTP endpoints on dev servers.

---

## 10. Rebuild notes for AIMS (options, not decisions)

AIMS context known from `SITECLOCK.md` and `docs/context/*`: NestJS API + Next.js portal, multi-org shared DB, Clerk login, orders/DO/jobs/service reports/PTW, jobs calendar (already shows SiteClock jobs via `/v1/jobs/calendar`), field app "SiteJobs" (loads the live portal), vehicles, WhatsApp group posts via a Render worker, S3 storage. Overlap claims about AIMS internals are from those notes only (?) — verify in the AIMS repo.

### 10.1 Feature → AIMS module options
| Area (§1 #) | Suggested AIMS module(s) | AIMS overlap (known) | Migration data from SiteClock | Notes / options |
|---|---|---|---|---|
| Auth & accounts (1-10) | Auth (Clerk) | Clerk org members, AIMS login | User phone, clerkUserId, device binding | Option A: Clerk phone login for workers; B: keep OTP-via-WhatsApp service. One-phone-many-companies ↔ Clerk multi-org membership. Device binding has no AIMS equivalent (?) |
| Companies, links (11-15) | Org admin | AIMS orgs (WCT group = 4 orgs) | Company rows + rules, CompanyLink | Linked companies ≈ AIMS sister orgs sharing staff; decide if cross-org crew is needed |
| Roles/permissions (16-17) | RBAC | AIMS roles (field role, admin) (?) | CompanyRole + permission keys | Map ~40 permission keys to AIMS roles; scope ASSIGNED is the hard part |
| Workers, teams, trades (18-24) | People / HR | Org members, member profiles | User, Team, TeamMembership (dated), Trade/UserTrade, photos on record, face descriptors | Face descriptors only useful if face match is kept |
| Sites (25-28) | Locations / Customers' sites | Customers + addresses (?) | Site (lat/lng/radius/accuracy/tz/kind), SiteAssignment | AIMS needs geofence fields on its locations |
| Jobs & scheduling (29-40) | Jobs / Scheduling / Calendar | Jobs, orders, DO, jobs calendar, PTW | Job, JobCrew, JobNeed, DayNote, ShiftTemplate/Assignment | Biggest overlap. Options: AIMS job gains crew + clocking fields; or "misc jobs" for non-order work. Import + copy day/week + assistant planning |
| Clock in/out (41-54) | Attendance (new) | none known | Punch (+selfies), open TimeEntries | Core new module; needs mobile GPS + camera + offline queue — SiteJobs is a web-wrapper (?) → native needs? |
| Progress/photos/delivery (55-58) | Field execution | AIMS field delivery pages, S3 photos, service reports | JobPhoto pointers (images already in AIMS) | Delivery already AIMS-native; drop the relay |
| Leave (59-62) | HR / Leave (new) | none known | LeaveType, Entitlement, Request (+documents) | |
| Timesheets (63-67) | Attendance / Timesheets (new) | none known | TimeEntry (all statuses), rules (OT/break/shift) | Must reproduce computeEntry exactly (§4.3-4.5) to avoid pay differences |
| Payroll (68-70) | Payroll (new) or export to ABSS | AIMS GL/ABSS books per org (no payroll known) | PayProfile, PublicHoliday | Option: keep SiteClock-style gross calc + export; or post to GL. No CPF today |
| Notifications (71-74) | Notifications | WhatsApp "AIMS update" line, group posts | FCM tokens (not portable without the app) | Push needs a native app; WhatsApp shared line affects all orgs |
| Assistant (75) | AIMEE (?) | AIMS assistant "AIMEE" mentioned in `_common.md` | AssistantSession (no need) | Re-implement tools against AIMS APIs with proper permission checks |
| Reports/exports (76-79) | Reports | AIMS reports (?) | none | Attendance XLSX format users know |
| Audit (81) | Activity Log | AIMS Activity Log | AuditLog (optional) | |
| API/webhooks (82-84) | — | — | ApiClient | Not needed once inside AIMS |

### 10.2 Migration needs (data)
- Per SiteClock company → AIMS org mapping (no field exists; manual table).
- Workers: User (+ per-company duplicates for multi-company phones), roles, teams/memberships, trades, site assignments, pay profiles, leave balances; photo-on-record + selfie files from `UPLOAD_DIR` (local disk on Railway — check volume first).
- Sites (with geofence), shift templates/assignments, OT/break rules, public holidays, company rule settings + per-worker overrides.
- Jobs (own + AIMS-sourced: dedupe AIMS jobs by `externalRef` — they already exist in AIMS), crew, needs, day notes.
- Punches + TimeEntries (history for payroll/audit; decide cut-off: e.g. all approved history read-only, open entries migrated live), leave requests + documents, audit log (optional).
- Cut-over: app clients ≥ build 20 call `api.siteclock.osiris.sg`; a rebuild must either keep the API contract or ship a new app and raise `APP_MIN_BUILD_*`.

### 10.3 Possible rebuild order (options)
1. Org/people foundation: org mapping, workers, roles/permissions, teams, sites with geofence (needed by everything).
2. Jobs + crew + scheduling on AIMS jobs (incl. misc jobs), working hours/shift templates.
3. Attendance: punches (GPS, selfie, policies, offline), auto-close, flags/review — needs the mobile client decision.
4. Timesheets computation + approval + exports (parallel-run against SiteClock numbers before switch).
5. Leave; then payroll/payslip.
6. Notifications, assistant tools, reports, linked-company sharing.
- Alternative: keep SiteClock as the attendance engine and rebuild only the office screens inside AIMS (via a widened `/v1`), migrating later.

---

## Summary

### Feature count by area (§1)
| Area | # features |
|---|---|
| Auth & accounts | 10 |
| Companies / linked / platform | 5 |
| Roles & permissions | 2 |
| Workers | 5 |
| Teams & trades | 2 |
| Sites | 4 |
| Jobs & scheduling | 12 (1 doesn't exist: recurring; 1 dead: old rosters) |
| Clock in/out & punches | 14 |
| Progress / photos / delivery | 4 (PTW doesn't exist) |
| Leave | 4 |
| Timesheets & paid hours | 5 |
| Payroll | 3 |
| Notifications | 4 (no email) |
| Assistant / reports / admin tools | 10 |
| **Total** | **84** (≈218 API routes, 41 tables, 25 enums) |

### 10 riskiest things to get right
1. `computeEntry` time math (breaks, OT threshold/multiplier, late/early grace, early modes, NLB) — pay changes if off by a minute (§4.3).
2. "Paid hours follow the crew" + `workedFor` split + admin-edit-is-final (§4.4-4.5).
3. The exact punch decision order (≈20 checks → error vs FLAGGED vs OK) incl. selfie/off-site/base/linked/QR/NOT_ASSIGNED (§4.8).
4. Offline back-dating (48 h clamp, >60 min flag, idempotency) and not losing queued punches (§4.8, §8.1).
5. Auto-close + missed clock-out modes + per-site `autoCloseAfterH` in site timezone (§4.6).
6. Timezones: workDate from site zone, overnight shifts, UTC crons (§4.1, §9 #9).
7. Permissions with scope ASSIGNED (sites + teams) — and not copying today's leaks/escalation (§6.29, §9 #1-3).
8. Multi-company identity: one phone → several accounts, device binding, linked-company sharing (§4.16, §1.2).
9. Payroll rules (MONTHLY/DAILY/HOURLY, premium modes, rest days, PH) matching what WCT has been paid by (§4.13).
10. Mobile client: GPS accuracy, camera, on-device face check, offline queue, push — and the store/app-version contract (min build 20) during cut-over (§8.7).

### Open questions for Elroy
1. Is the goal to retire SiteClock entirely, or keep it as the attendance engine behind AIMS screens?
2. Mobile client for workers: new native app inside AIMS, extend SiteJobs (web wrapper), or keep the SiteClock app pointed at AIMS?
3. Which SiteClock companies move first (WCT only? WCT group as 4 orgs?), and how many workers/punches/entries — needs a read-only prod count.
4. Payroll: rebuild in AIMS, keep SiteClock-style gross only, or export to ABSS? CPF needed?
5. Keep face match + device binding + selfie rules, or simplify?
6. Linked-company worker sharing: needed in AIMS (sister orgs) or drop?
7. History cut-off for punches/timesheets/leave: migrate all, or read-only archive?
8. Fix or deliberately replicate today's quirks (bulk approve skip, NLB credit 0, no proration, scope leaks)?
9. Is the assistant (Claude tool-use) part of the rebuild or folded into AIMEE?
10. Where do selfie/photo/leave files live now (Railway volume?) — needed before migration planning.
