> **SUPERSEDED 2026-11-21.** The Field module is now a native port into AIMS (see `FIELD_PLAN.md`). AIMS will not call SiteClock through an API, so nothing in this contract is to be implemented. Kept for reference only.

# SiteClock `/v1` office API: contract for the AIMS Field module

For the SiteClock repo agent. Written 2026-11-21 against SiteClock main `62b7d9d` (see `SITECLOCK_SPEC.md` for every existing route, rule and field). Companion: `FIELD_PLAN.md`.

**Goal:** AIMS (server to server, one API key per SiteClock company, WCT (S) first) can do everything the SiteClock office web does today, so the office moves into AIMS while SiteClock stays the engine and the worker app keeps working unchanged.

**Rules for the implementer**
- Reuse the existing services behind the session routes (`punches.service`, `timesheets.service`, `leave`, `payroll.service`, `lib/jobs.ts` …). A `/v1` handler = auth by key + scope, company from the key, input validation (zod), call the same service function the session route calls, present with a `/v1` presenter. **No second implementation of any business rule.**
- Every handler filters by the key's `companyId` (there is no Prisma middleware). Every route gets a cross-company test (key of company A, id of company B → 404), like `backend/test/v1.ts:176-184`.
- Nothing here changes behaviour for SiteClock companies without an API client. New behaviour that touches shared code (feature locks, crew on external jobs) is gated on the API client / company setting.
- Existing `/v1` routes keep working exactly as now (AIMS calls them in production); only additive changes to them.
- Slice order = the order of sections. AIMS phase 1 needs §1–§5, phase 2 §6, phase 3 §7, §9, §11.1, §3.5, phase 4 §8, phase 5 §10, phase 6 §12, §13.2, phase 7 the rest.

---

## 1. Conventions (all new routes)

### 1.1 Auth and scopes
- `Authorization: Bearer sck_live_…` (existing `requireApiKey(scope)`). The key belongs to one company (WCT (S)'s key today). 401 `UNAUTHORIZED`, 403 `FORBIDDEN` with `{needs: "<scope>"}`.
- New scopes (existing: `teams:read, workers:read, workers:phone, sites:write, jobs:read, jobs:write`):

| Scope | Grants |
|---|---|
| `company:read` | §2 |
| `company:locks` | §1.4 |
| `workers:write` | §3.1–3.3 writes, trades on workers |
| `workers:invite` | §3.4 |
| `photos:review` | §3.5 |
| `teams:write` | §4 writes |
| `sites:read` | §5 reads, presence §7.5 |
| `jobs:setup` | trades, presets §6.6 |
| `punches:read` | §7.1, 7.2, 7.4, 7.5 |
| `punches:review` | §7.3 |
| `timesheets:read` | §8 reads, export |
| `timesheets:write` | §8 edit, manual entry, reopen, delete |
| `timesheets:approve` | §8 approve, reject, bulk |
| `schedules:read` / `schedules:write` | §9 |
| `leave:read` / `leave:write` | §10 (write = types, entitlements, record, decide, cancel) |
| `payroll:read` / `payroll:write` | §12 |
| `reports:read` | §13.2 |
| `rules:read` / `rules:write` | §11.1 |
| `roles:read` | §11.2 |
| `terms:write` | §11.3 (read is `company:read`) |
| `notify:write` | §6.4, §13.1 |
| `audit:read` | §13.3 |

- Key issue script `issue-api-key.ts` gains `--scopes a,b,c` and `--add-scopes` (re-scope an existing client without changing the key); audit `API_CLIENT_SCOPES`. AIMS never sees or prints the key.
- AIMS enforces its own users' permissions and supervisor scope before calling. SiteClock checks scopes only. Do **not** apply `ASSIGNED` scope on `/v1`.

### 1.2 Acting user (audit)
- Every write accepts `X-Acting-User: <AIMS user id>` and `X-Acting-User-Name: <display name, ≤100, URL-encoded>`. Optional on reads.
- Audit rows written by `/v1` keep `actorId = api:<clientId>` and add `actingAs: {aimsUserId, name}` inside `after` (no schema change). Fields that store a reviewer / editor / approver / decider (`reviewedById`, `editedById`, `approvedById`, `decidedById`, `recordedById`) get **null** from `/v1` writes plus a new nullable text column `…ByName` (e.g. `approvedByName`) set from the header, so presenters can show who did it. Reads return `{id: null, name}` for those.
- Note the existing overload (`editedById` set ⇒ "pay follows crew" stops for that day, spec §6.30 #8): a `/v1` edit must have the same effect as a session edit. Implement with a boolean `editedViaApi` or by treating `editedByName != null` as edited; keep one rule.

### 1.3 Idempotency (writes)
- Every POST / PUT / PATCH / DELETE takes `Idempotency-Key` (8–200 chars). **Required** on POST; optional on PUT / PATCH / DELETE (they should be idempotent by nature).
- Store `(clientId, key) → {requestHash, status, body}` for 24 h (new table `ApiIdempotency`). Same key + same body → replay the stored status and body with header `Idempotent-Replayed: true`. Same key + different body → 409 `IDEMPOTENCY_KEY_REUSED`. Concurrent duplicate → second waits for the first (row lock) or gets 409 `IN_PROGRESS`.
- Existing `POST /v1/jobs` keeps its `externalRef` idempotency in addition.

### 1.4 Feature locks (cutover support)
- `GET /v1/company/locks` (`company:read`) → `{locks: {workers, teams, sites, jobs, schedules, rules, leave, payroll, timesheets, punches_review, invites, terms}}` each `false | {since, by}`.
- `PUT /v1/company/locks` (`company:locks`), body `{<feature>: true|false, …}` → the same shape. Audit `COMPANY_LOCKS_SET`.
- Effect when a feature is locked: the SiteClock **session** routes for that feature return 423 `MANAGED_IN_AIMS` `{error: "This is managed in AIMS.", feature}` for writes (reads still work); the web and app hide or disable the edit controls when `/auth/me` carries `company.locks`. `/v1` writes are never blocked by a lock. The assistant's write tools respect the same locks.
- Not lockable: punches by workers, leave requests by workers, missed-entry requests (they come from the app).

### 1.5 Pagination and change feeds
- Lists: `?limit` (1–500, default 100) and `?cursor` (opaque). Response `{items: […], nextCursor: string|null}`. Stable order: `(updatedAt, id)` for change-feed lists, otherwise the stated sort.
- Change feeds: `?updatedSince=<ISO with offset>` returns rows with `updatedAt >= updatedSince` (inclusive; AIMS dedupes by id) plus `deleted: [{id, deletedAt}]` tombstones for hard-deleted rows, and `nextUpdatedSince`.
- Needs: `updatedAt @updatedAt` on User, Team, TeamMembership, Site, SiteAssignment, TimeEntry, Punch, LeaveRequest, LeaveType, LeaveEntitlement, ShiftTemplate, ShiftAssignment, PayProfile (exists), PublicHoliday, DayNote; a `Tombstone {companyId, entity, entityId, deletedAt}` table written wherever those rows are hard-deleted (jobs, entries, memberships, assignments, holidays, templates). Backfill `updatedAt = createdAt` (or now() where no createdAt).

### 1.6 Errors
- Body `{error: string, code: string, details?: object}`. Codes used below plus the generic ones: 400 `VALIDATION` (zod flatten in `details`), 404 `NOT_FOUND`, 409 `CONFLICT` / specific, 412 `STALE` (§1.9), 413 `TOO_LARGE`, 415 `UNSUPPORTED_MEDIA`, 422 specific, 423 `MANAGED_IN_AIMS` (session routes only), 429 `RATE_LIMITED` with `Retry-After`, 500 `INTERNAL`.
- Re-use every existing domain code unchanged (`LAST_ADMIN`, `PHONE_TAKEN`, `CLOCK_IN_REQUIRED`, `EXTERNAL_JOB`, `JOB_STARTED`, `ROLE_LOCKED` …) so AIMS can show SiteClock's own messages.

### 1.7 Rate limit
- Per API client: 600 requests / min, burst 50 (in-memory is acceptable while single-instance; note it). 429 `RATE_LIMITED` + `Retry-After` seconds.

### 1.8 Files
- File routes return `200 {url, expiresAt, contentType, bytes}` where `url` is a signed, single-file link valid 5 min on a new public route `GET /files/signed/:token` (HMAC of `{path, companyId, exp}` with `SECRETS_KEY`); no Bearer needed on that link so the AIMS browser can load it. `?download=1` sets `Content-Disposition: attachment`.
- Uploads (leave documents, worker photo, recorded leave): multipart, same limits and **magic-byte sniffing** as job photos (fixes the `originalname` extension issue for these paths).

### 1.9 Concurrency
- Every single-row GET returns `updatedAt`; PATCH accepts `If-Match: <updatedAt ISO>`. Mismatch → 412 `STALE` with the current row in `details.current`. Without `If-Match` the PATCH applies (last write wins).

### 1.10 Payload hygiene
- `/v1` presenters never return `deviceId`, `fcmToken`, `faceDescriptor`, `clerkUserId` (except the existing `GET /v1/workers` field, kept for compatibility), photo paths, or OTP data. Phone only with `workers:phone`. Device state as `{bound: boolean, boundAt}`.

### 1.11 Times
- Instants: ISO-8601 **with offset** in and out (existing rule; bare local → 400 `VALIDATION`). Out: UTC `Z` plus `…Local` (company / site zone, `YYYY-MM-DDTHH:mm`) where a person reads it.
- Dates: `YYYY-MM-DD` in the site's zone (`workDate`) or company zone (jobs, leave, rosters). Fix the UTC-date slips on the routes this contract wraps (`/rosters/mine` is out of scope; fraud summary §13.2 uses company-zone day bounds).
- Money: integer cents, currency SGD.

---

## 2. Company

| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/company | company:read | – | `{id, name, timezone, active, settings: {selfiePolicy, offSiteReview, missedClockOut, jobClocking, jobClockingTeamIds, groupJobClocking, groupClockBy, photoAtFirstLogin, crewMarginBeforeMin, crewMarginAfterMin, baseClocking, shareWorkers, notifyRoster, unassignedSelfie}, terms: {version, updatedAt}, links: [{companyId, name, shareWorkers}], scopes: [..], locks: {…§1.4}, serverTime}`. Also the AIMS health probe. |
| GET | /v1/changes | company:read | `?since=<ISO>` | Cheap "anything changed" summary for pollers: `{counts: {workers, teams, memberships, sites, assignments, jobs, entries, punches, leave, schedules, payProfiles, holidays}, until}` = rows with `updatedAt > since` or tombstones per entity. |

---

## 3. Workers

### 3.1 List, get, create, update
| M | Path | Scope | Request | Response / errors |
|---|---|---|---|---|
| GET | /v1/workers | workers:read (exists) | existing `teamId, active, include=phone` **plus** `include=overrides,sites,trades,photo,device,leaveDays`, `q` (name / employeeNo), `updatedSince`, `limit`, `cursor` | existing fields **plus** (when included) `overrides{jobClocking, offSiteClocking, selfiePolicy, baseClocking, payFollowsCrew, crewMarginBeforeMin, crewMarginAfterMin, attendanceExempt, payslipVisible, sharedWithLinked}`, `sites[{siteId, isSupervisor}]`, `trades[{id,name}]`, `photo{hasPhoto, status, requested}`, `device{bound, boundAt}`, `companyRole{id,name,scope}`, `supervisesTeamIds[]`, `otherCompanies[{companyId, name}]`, `updatedAt`; `nextCursor`; `deleted[]` when `updatedSince`. Without `cursor`/`limit` the response stays the old unpaged `{workers}` (compatibility). |
| GET | /v1/workers/:id | workers:read | `include` as above | `{worker}` |
| POST | /v1/workers | workers:write | `{phone, name≤80, employeeNo?≤30, companyRoleId? \| role WORKER\|SUPERVISOR (COMPANY_ADMIN refused on /v1: 403 ROLE_NOT_ALLOWED), siteIds[], supervisorSiteIds[], active=true, overrides{…}, tradeIds[≤10], leaveDays{typeId: days}}` | 201 `{worker, otherCompanies}`. 409 `PHONE_TAKEN`. Audit WORKER_CREATE (actingAs). |
| PATCH | /v1/workers/:id | workers:write | partial of the above (`null` resets an override); `If-Match` | `{worker}`. 409 `LAST_ADMIN`, `PHONE_TAKEN`; 403 `ROLE_NOT_ALLOWED` for giving the Admin role via `/v1` (closes spec §6.30 #4 for the API). Deactivate = `{active:false}` (clears device + FCM like today). Audit WORKER_UPDATE. |
| PUT | /v1/workers/:id/trades | jobs:setup | `{tradeIds≤10}` | `{trades}` |

### 3.2 Hours and leave on the worker page
Covered by §8 (`workerId` filter) and §10.2.

### 3.3 Phone, device, verification
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| POST | /v1/workers/:id/change-phone | workers:write | `{phone, resetDevice=false}` | `{worker}`. 409 `PHONE_TAKEN`. Audit WORKER_PHONE_CHANGE |
| POST | /v1/workers/:id/reset-device | workers:write | – | `{worker}`. Audit DEVICE_RESET |
| POST | /v1/workers/:id/request-verification | workers:write | – | `{worker}`. Audit VERIFY_REQUEST |
| GET | /v1/workers/:id/photo | workers:read | – | file link (§1.8) of the photo on record; 404 `NO_PHOTO` |

### 3.4 Invites and join requests
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/invites | workers:invite | – | `{invites[{id,label,role,siteId,templateIds,expiresAt,maxUses,uses,active,joinUrl,pendingCount}]}` |
| POST | /v1/invites | workers:invite | `{label≤60, role WORKER\|SUPERVISOR, siteId, templateIds≤10, expiresAt?, maxUses 1–10000, leaveDays?}` | 201 `{invite}` |
| PATCH | /v1/invites/:id | workers:invite | `{label?, active?, expiresAt?, maxUses?}` | `{invite}` |
| DELETE | /v1/invites/:id | workers:invite + workers:write | – | `{ok}` (deletes its registrations, as today) |
| GET | /v1/registrations | workers:invite | `?status=PENDING\|APPROVED\|REJECTED` (default PENDING), `limit`, `cursor` | `{items[{id, inviteId, name, phone (needs workers:phone, else masked), employeeNo, createdAt, status}], nextCursor}` |
| GET | /v1/registrations/:id/photo | workers:invite | – | file link |
| POST | /v1/registrations/:id/approve | workers:invite | – | `{worker}`. 409 `PHONE_TAKEN` (request auto-rejected, as today). Sends the WhatsApp template as today |
| POST | /v1/registrations/:id/reject | workers:invite | `{note?≤300}` | `{registration}` |

### 3.5 Photos on record (review)
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/photo-updates | photos:review | `?status=REQUESTED,PENDING` (default both) | `{items[{id, workerId, workerName, status, requestedBy:{name}, note, auto, createdAt}]}` |
| GET | /v1/photo-updates/:id/file | photos:review | – | file link (pending photo) |
| POST | /v1/photo-updates/request/:workerId | photos:review | `{note?≤300}` | `{photoUpdate}`. Push "New photo needed" as today |
| DELETE | /v1/photo-updates/request/:workerId | photos:review | – | `{ok}` |
| POST | /v1/photo-updates/:id/approve | photos:review | – | `{photoUpdate}`. Resets faceDescriptor, push as today |
| POST | /v1/photo-updates/:id/reject | photos:review | `{note≤300}` | `{photoUpdate}` |

### 3.6 Shared workers (linked companies)
| M | Path | Scope | Response |
|---|---|---|---|
| GET | /v1/shared-workers | workers:read | workers shared **with** this company: `{items[{id, name, employeeNo, companyId, companyName, trades}]}` (= `/links/workers`) |

---

## 4. Teams

| M | Path | Scope | Request | Response / errors |
|---|---|---|---|---|
| GET | /v1/teams | teams:read (exists) | existing `date` **plus** `all=1` (archived too), `include=supervisors,history`, `updatedSince` | existing shape **plus** `active, supervisors[{id,name}], everCount, updatedAt`, `deleted[]` |
| GET | /v1/teams/:id/history | teams:read | – | `{stints[{id, workerId, name, startDate, endDate|null}]}` |
| GET | /v1/team-memberships | teams:read | `?updatedSince, limit, cursor` | `{items[{id, teamId, workerId, startDate, endDate, updatedAt}], deleted[], nextUpdatedSince}` (feed for AIMS's dated memberships) |
| POST | /v1/teams | teams:write | `{name≤80, memberIds≤500, startDate?, supervisorIds≤20}` | 201 `{team}`. 409 `TEAM_NAME_TAKEN` |
| PATCH | /v1/teams/:id | teams:write | `{name?, active?}` | `{team}` |
| PUT | /v1/teams/:id/supervisors | teams:write | `{workerIds≤20}` | `{team}`. 422 `NOT_SUPERVISOR_TIER` |
| POST | /v1/teams/:id/members | teams:write | `{workerIds≤500, startDate?}` | `{team, added}`. 409 `MEMBERSHIP_OVERLAP` |
| POST | /v1/teams/:id/members/:workerId/remove | teams:write | `{lastDay?}` (default yesterday, company zone) | `{team}` |
| PATCH | /v1/team-memberships/:id | teams:write | `{startDate?, endDate?}` | `{membership}`. 409 `MEMBERSHIP_OVERLAP` |
| DELETE | /v1/team-memberships/:id | teams:write | – | `{ok}` (tombstone) |

---

## 5. Sites

### 5.1 Read
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/sites | sites:read | `?kind=PERMANENT,BASE,JOB` (default PERMANENT,BASE), `active=true\|false\|all`, `q`, `updatedSince`, `limit`, `cursor` | `{items[{id, name, address, lat, lng, radiusM, maxAccuracyM, timezone, autoCloseAfterH, active, kind, allWorkers, externalRef, assignments[{workerId, isSupervisor}], createdAt, updatedAt}], nextCursor, deleted[]}` |
| GET | /v1/sites/:id | sites:read | – | `{site}` |

### 5.2 Write
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| POST | /v1/sites | sites:write | `{name≤120, address?≤300, lat?, lng?, radiusM 20–5000=150, maxAccuracyM 10–500=50, timezone (IANA)=company, autoCloseAfterH 1–48=14, kind PERMANENT\|BASE=PERMANENT, allWorkers=false, active=true, externalRef?}`; address or lat+lng required (geocode like `PUT by-ref`) | 201 `{site}`. 422 `ADDRESS_NOT_FOUND`; 409 `EXTERNAL_REF_TAKEN` |
| PATCH | /v1/sites/:id | sites:write | partial; `If-Match` | `{site}` |
| PUT | /v1/sites/by-ref/:ref | sites:write (exists) | unchanged | unchanged |

### 5.3 Geocode
| GET | /v1/sites/geocode | sites:read | `?q` (≥3 chars) | `{results[{label, lat, lng, postal?}]}` (OneMap first, then OSM, same as job place lookup) |
|---|---|---|---|---|

### 5.4 Assignments
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| PUT | /v1/sites/:id/assignments | sites:write | `{assignments[{workerId, isSupervisor}]}` = the full list for this site | `{site}` with assignments. Audit SITE_ASSIGNMENTS_SET |

---

## 6. Jobs and scheduling

### 6.1 Crew jobs on `/v1/jobs` (additive)
`POST /v1/jobs` and `PATCH /v1/jobs/(by-ref/:ref|:id)` (scope `jobs:write`) accept, in addition to today's fields:
- `crew: {teamIds[], workerIds[], exceptWorkerIds[]}`: when present, replaces `workerId` (either `workerId` or `crew`, not both: 400). Crew is built exactly like an office job (`lib/jobs.ts` team + individuals − exceptions, team membership on the job date, shared workers via `crewableIds`). 422 `WORKER_NOT_FOUND` / `TEAM_NOT_FOUND` with `details.ids`.
- `clocking: OFF|ARRIVE|ARRIVE_LEAVE` (default = company rule), `qrRequired`, `instructions≤4000`, `expectedMinutes 5–1440`, `startTime HH:mm` + `date` (local) as an alternative to `startAt/endAt` for timed jobs without an end, `needs[{tradeId, qty 1–200}]`.
- Response `job` adds `crew[{workerId, name, viaTeamId|null, notifiedAt}]`, `teams[{id,name}]`, `clocking`, `qrRequired`, `needs`, `updatedAt`.
- Rules unchanged: forward-only status, started / closed locks, notify on worker / site / time change; for crew, "Job removed" to dropped workers and "New job" to added ones (as the office PATCH does).
- New: `POST /v1/jobs/batch` (`jobs:write`) `{jobs[1..100] (each a create body with its own externalRef)}` → `{results[{externalRef, status: created|duplicate|error, job?, error?}]}` (AIMS "several jobs for a team", copy day / week, import).

### 6.2 Calendar and feed (additive)
- `GET /v1/jobs/calendar`: add `createdAt`, `updatedAt`, `deliveryEnabled`, `clocking`, `qrRequired`, `instructions`, `expectedMinutes`, `needs` to each row; `?include=deleted` adds `deleted[{id, deletedAt}]` for SiteClock-own jobs hard-deleted in the window.
- `GET /v1/jobs?source=external|siteclock|all` (default `external`, today's behaviour): `all` includes SiteClock-own jobs in the `updatedSince` feed with tombstones.
- Make sure crew punches bump `Job.updatedAt` (spec: probably not today) or expose `progressUpdatedAt`, so the feed sees progress changes.
- SiteClock-own jobs stay read-only on `/v1` (409 `NOT_EXTERNAL` on PATCH). When the `jobs` lock (§1.4) is on, the office cannot create own jobs, so all new jobs come through `/v1`.

### 6.3 Day notes
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/day-notes | jobs:read | `?from,to` (≤62 days) | `{notes{date: text}}` |
| PUT | /v1/day-notes/:date | jobs:write | `{text≤2000}` (empty clears) | `{date, text}`. Audit DAY_NOTE_SET |

### 6.4 Notify crews
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| POST | /v1/jobs/notify | notify:write | `{date, siteId?}` | `{workers, told}` (= `/jobs/notify`, includes external jobs with crew). Audit JOBS_NOTIFY |

### 6.5 QR
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| POST | /v1/jobs/:id/qr | jobs:write | – | `{qrUrl, qrToken}` (rotates; works for external jobs; refuses cancelled 409 `JOB_CLOSED`) |
| GET | /v1/jobs/:id/qr | jobs:read | – | `{qrUrl, qrRequired}` |

### 6.6 Trades and manning presets
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/trades | jobs:read | – | `{trades[{id, name, workers}]}` |
| POST | /v1/trades | jobs:setup | `{name≤60}` | 201 `{trade}`. 409 `TRADE_NAME_TAKEN` |
| DELETE | /v1/trades/:id | jobs:setup | – | `{ok}` |
| GET | /v1/manning-presets | jobs:read | – | `{presets[{id, name, items[{tradeId, qty}]}]}` |
| PUT | /v1/manning-presets | jobs:setup | `{name, items[{tradeId, qty 1–200}] 1..20}` (upsert by name) | `{preset}` |
| DELETE | /v1/manning-presets/:id | jobs:setup | – | `{ok}` (add the missing audit) |

### 6.7 Attendance per day
| GET | /v1/jobs/attendance | jobs:read | `?date, siteId?` | `{date, jobs[{jobId, title, siteId, crew[{workerId, name, state CLOCKED_IN\|DONE\|ON_LEAVE\|NOT_ARRIVED, firstInAt, lastOutAt, actualSiteId}]}], counts}` (= `/rosters/attendance` incl. external jobs) |
|---|---|---|---|---|

---

## 7. Punches, flags, presence

### 7.1 Punch list
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/punches | punches:read | `?from,to` (instants, ≤92 days), `workerId, siteId, jobId, status=OK,FLAGGED,APPROVED,REJECTED, flagReason, updatedSince, limit, cursor` | `{items[{id, workerId, workerName, siteId, siteName, jobId, type IN\|OUT, at (effective), serverTime, originalTime, deviceTime, lat, lng, accuracyM, distanceM, insideFence, address, faceScore, faceResult, mocked, rooted, offlineSynced, qrScanned, autoLeft, endsDay, recordedBy{id,name}|null, workerNote, nlbClaimed, status, flagReason, review{by{name}, at, note}|null, timeEntryId, hasPhoto, updatedAt}], nextCursor}` |

### 7.2 Review queues
| M | Path | Scope | Response |
|---|---|---|---|
| GET | /v1/punches/flagged | punches:read | `{items[…punch, needsClockIn, suggestedClockInAt, job{id,title}|null]}` (= `/punches/flagged`, whole company) |
| GET | /v1/punches/marked | punches:read | `?days≤30` → OK punches with a location flag |
| GET | /v1/punches/face-log | punches:read | `?days≤7` → `{items, threshold}` |

### 7.3 Decide
| M | Path | Scope | Request | Response / errors |
|---|---|---|---|---|
| POST | /v1/punches/:id/approve | punches:review | `{clockInAt?, punchAt?, note?≤500}` | `{punch, entry}`. 409 `NOT_PENDING`; 400 `CLOCK_IN_REQUIRED` / time validation (same messages). Push to the worker as today. Audit PUNCH_APPROVE (actingAs) |
| POST | /v1/punches/:id/reject | punches:review | `{note?≤500}` | `{punch}`. 409 `NOT_PENDING` |

### 7.4 Selfie
| GET | /v1/punches/:id/photo | punches:read | – | file link (§1.8). 404 `NO_PHOTO` |
|---|---|---|---|---|

### 7.5 Presence
| M | Path | Scope | Response |
|---|---|---|---|
| GET | /v1/sites/:id/present | sites:read + punches:read | `{present[{entryId, workerId, name, employeeNo, clockInAt, lat, lng, insideFence}]}` |
| GET | /v1/sites/:id/pulse | sites:read | `{onSiteNow, hours[24], people[…]}` (= `/sites/:id/pulse` with people) |
| GET | /v1/presence | sites:read + punches:read | every site with someone on it now: `{sites[{siteId, name, count}], updatedAt}` (one call for the Live overview) |

---

## 8. Timesheets

### 8.1 Entries
| M | Path | Scope | Request | Response / errors |
|---|---|---|---|---|
| GET | /v1/time-entries | timesheets:read | `?from,to` (workDate, ≤92 days) **or** `updatedSince`; `workerId, siteId, teamId (team history per workDate), status=OPEN,PENDING,APPROVED,REJECTED,AUTO_CLOSED, needsReview=true, createdByWorker=true (missed requests), limit, cursor` | `{items[{id, workerId, workerName, employeeNo, siteId, siteName, clockOutSiteId, workDate, clockInAt, clockOutAt, origClockInAt, origClockOutAt, status, grossMinutes, breakMinutes, regularMinutes, otMinutes, otMultiplier, lateMinutes, earlyMinutes, leftEarlyMinutes, nlbClaimed, nlb, paidFromAt, paidToAt, crewFirstInAt, crewLastOutAt, needsReview, crewNote, workedFor, shift{name,startTime,endTime}|null, edited{by{name}, at, note}|null, approved{by{name}, at}|null, teamNames[], createdAt, updatedAt}], nextCursor, deleted[]}` |
| GET | /v1/time-entries/:id | timesheets:read | – | `{entry, worker, site, punches[…§7.1 shape], nearbyFlagged[…]}` (= entry detail) |
| PATCH | /v1/time-entries/:id | timesheets:write | `{clockInAt?, clockOutAt?, note?≤500, nlb?}`; `If-Match` | `{entry}` (recomputed, approval cleared as today). Audit ENTRY_EDIT |
| POST | /v1/time-entries | timesheets:write | `{workerId, siteId, clockInAt, clockOutAt, note?}` | 201 `{entry}` (PENDING). Audit ENTRY_MANUAL_CREATE |
| POST | /v1/time-entries/:id/approve | timesheets:approve | `{force?: boolean}` | `{entry}`. 409 `NOT_PENDING`; 409 `NEEDS_REVIEW` when `needsReview` and not `force` |
| POST | /v1/time-entries/:id/reject | timesheets:approve | `{note?}` | `{entry}` |
| POST | /v1/time-entries/approve-bulk | timesheets:approve | `{entryIds[1..200], includeNeedsReview=false}` | `{results{id: APPROVED\|NEEDS_REVIEW\|NOT_FOUND\|NOT_PENDING}, counts{approved, needsReview, skipped}}` (explicit counts; AIMS shows the needs-review ones) |
| POST | /v1/time-entries/:id/reopen | timesheets:write | – | `{entry}` (OPEN). 409 `NO_CLOCK_OUT`. Audit ENTRY_REOPEN |
| DELETE | /v1/time-entries/:id | timesheets:write | – | `{ok}` (tombstone). Audit ENTRY_DELETE |

### 8.2 Export
| GET | /v1/time-entries/export | timesheets:read | the list filters + `format=csv\|xlsx` | file link (§1.8) to the same file as `/timesheets/export` (≤10 000 rows; escape `= + - @` at cell start, fixes spec §6.30 #12) |
|---|---|---|---|---|

### 8.6 Linked-company hours
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/linked-hours | timesheets:read | `?from,to` (≤92 days), `direction=borrowed\|lent` | `{items[{companyId, companyName, workerId, name, workDate, minutes, entryId}]}` (= `/links/hours` and `/links/lent`) |

---

## 9. Working hours (schedules)

### 9.1 Templates
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/shift-templates | schedules:read | `?active` | `{items[{id, name, startTime, endTime, daysOfWeek[1..7], graceLateMin, earlyMode null\|clamp\|pay\|slide, siteIds[], active, assignmentCount, updatedAt}]}` |
| POST | /v1/shift-templates | schedules:write | `{name, startTime HH:mm, endTime, daysOfWeek≥1, graceLateMin 0–120=10, earlyMode?, siteIds[], active=true}` | 201 `{template}` |
| PATCH | /v1/shift-templates/:id | schedules:write | partial | `{template}` |
| DELETE | /v1/shift-templates/:id | schedules:write | – | `{ok}` (same side effects as today) |

### 9.2 Assignments
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/shift-assignments | schedules:read | `?workerId, templateId, activeOn=<date>, updatedSince` | `{items[{id, templateId, workerId, startDate, endDate|null}]}` |
| POST | /v1/shift-assignments | schedules:write | `{templateId, workerId, startDate, endDate?}` | 201 `{assignment}`. **New:** 409 `ASSIGNMENT_OVERLAP` when the worker already has an assignment covering any of those dates (today there is no check; add it for `/v1` only, or behind the company lock, so the app flow is unchanged) |
| PATCH | /v1/shift-assignments/:id | schedules:write | `{endDate}` | `{assignment}` (end an assignment without deleting history) |
| DELETE | /v1/shift-assignments/:id | schedules:write | – | `{ok}` |

### 9.3 Exceptions (who is late / absent)
| GET | /v1/schedule-exceptions | schedules:read | `?date, siteId?` | `{roster[{workerId, name, shift{name,startTime,endTime}, status ON_LEAVE\|ABSENT\|PRESENT\|LATE\|LEFT_EARLY\|ON_TIME, lateMinutes, earlyMinutes, leftEarlyMinutes, in, out}]}` |
|---|---|---|---|---|

---

## 10. Leave

### 10.1 Types
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/leave/types | leave:read | `?all=1` | `{items[{id, name, paid, defaultDays, requiresDocument, archived, requestCount}]}` |
| POST | /v1/leave/types | leave:write | `{name, paid=true, defaultDays?, requiresDocument=false}` | 201 `{type}` |
| PATCH | /v1/leave/types/:id | leave:write | partial | `{type}` |
| DELETE | /v1/leave/types/:id | leave:write | – | `{deleted: true}` or `{archived: true}` (as today) |
| POST | /v1/leave/types/:id/restore | leave:write | – | `{type}` |

### 10.2 Balances and entitlements
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/leave/balances | leave:read | `?year, workerId?` | `{items[{workerId, name, types[{typeId, name, entitled, taken, pending, remaining}]}]}` (all workers when no workerId) |
| PUT | /v1/leave/entitlements/:workerId | leave:write | `{entitlements{typeId: days\|null}}` | `{balances}` |

### 10.3 Requests
| M | Path | Scope | Request | Response / errors |
|---|---|---|---|---|
| GET | /v1/leave/requests | leave:read | `?status, workerId, from, to, updatedSince, limit, cursor` | `{items[{id, workerId, name, typeId, typeName, startDate, endDate, halfDay, days, reason, status, recorded, documentCount, decided{by{name}, at}|null, createdAt, updatedAt}], nextCursor}` |
| GET | /v1/leave/requests/:id/documents/:n | leave:read | – | file link |
| POST | /v1/leave/requests/record | leave:write | multipart `workerId, typeId, startDate, endDate, halfDay, reason≤500, document[]≤5` | 201 `{request}` (APPROVED, recorded). Push "Leave recorded" |
| POST | /v1/leave/requests/:id/approve | leave:write | `{note?}` | `{request}`. 409 `NOT_PENDING`. **New, optional field:** response `warnings[]` with `OVERDRAW` when remaining < 0 (no block) |
| POST | /v1/leave/requests/:id/reject | leave:write | `{note?}` | `{request}` |
| POST | /v1/leave/requests/:id/cancel | leave:write | `{note?}` | `{request}` (admin cancel, any status but CANCELLED) |

### 10.4 Calendar
| GET | /v1/leave/calendar | leave:read | `?month=YYYY-MM, siteId?` | `{days{date: [{workerId, name, typeName, halfDay, status}]}}` |
|---|---|---|---|---|

---

## 11. Settings

### 11.1 Rules
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/rules | rules:read | – | = `GET /rules`: `{overtime[{siteId|null, dailyThresholdMin, otMultiplier, weeklyCapOtMin, earlyMode}], breaks[{siteId|null, deductMinutes, minShiftMinutes, nlbCreditMinutes}], punch{…company settings §2}}` |
| PUT | /v1/rules/overtime | rules:write | `{siteId?, dailyThresholdMin 0–1440, otMultiplier 1–3, weeklyCapOtMin?, earlyMode?}` | `{overtime}`. Audit OT_RULE_SET |
| PUT | /v1/rules/breaks | rules:write | `{siteId?, deductMinutes 0–240, minShiftMinutes 0–1440, nlbCreditMinutes 0–240}` | `{breaks}` |
| PUT | /v1/rules/punch | rules:write | any of the punch fields (≥1) | `{punch}`. The two legacy switches are **not** accepted on `/v1` |

### 11.2 Roles (read)
| GET | /v1/roles | roles:read | – | `{roles[{id, name, permissions[], scope, builtin, users}]}` (AIMS maps them to its presets; no role writes on `/v1`) |
|---|---|---|---|---|

### 11.3 Terms
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/terms | company:read | – | `{text, version, updatedAt}` |
| PUT | /v1/terms | terms:write | `{text 20..20000, reaccept=true}` | `{version}` |
| GET | /v1/terms/acceptances | company:read | – | `{items[{workerId, name, acceptedVersion, acceptedAt, current}]}` |

---

## 12. Payroll

### 12.1 Month
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/payroll | payroll:read | `?month=YYYY-MM` | the same rows as `GET /payroll` (per worker: payType, days worked, rest / PH / leave days, regular and OT minutes, premium, basic, allowances, deductions, gross, all in cents) + `totals` |
| GET | /v1/payroll/export | payroll:read | `?month, format=csv\|xlsx` | file link (same file as today; formula-escaped) |

### 12.2 Profiles
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/payroll/profiles | payroll:read | `?workerId?, updatedSince` | `{items[{workerId, hasProfile, payType, hourlyRateCents, basicMonthlyCents, fixedAllowanceCents, deductHousingCents, deductOtherCents, restDays[], workDaysPerWeek, premiumMode, premiumRateCents, weekdayOt, otRateCentsOverride, dailyRateCentsOverride, rates{daily, hourly, ot}, updatedAt}]}` |
| PUT | /v1/payroll/profiles/:workerId | payroll:write | the profile fields (same validation as 4.13) | `{profile, rates}`. Audit PAY_PROFILE_SET |

### 12.3 Public holidays
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/payroll/holidays | payroll:read | `?year` | `{items[{id, date, name}]}` |
| POST | /v1/payroll/holidays | payroll:write | `{date, name≤100}` (upsert by date) | `{holiday}` (add the missing audit HOLIDAY_SET) |
| DELETE | /v1/payroll/holidays/:id | payroll:write | – | `{ok}` (audit HOLIDAY_DELETE) |

### 12.4 Payslip
| GET | /v1/payroll/payslip | payroll:read | `?workerId, month` | the same object `GET /payroll/me` returns for that worker (ignores `payslipVisible`; that flag only governs the app) |
|---|---|---|---|---|

---

## 13. Notifications, reports, audit

### 13.1 Push to workers
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| POST | /v1/notify | notify:write | `{workerIds[1..500] \| teamId \| siteId, title≤60, body≤240, kind="office", data?{jobId?, date?}}` | `{sent, noDevice[]}`. Uses `lib/push.ts`. Audit OFFICE_NOTIFY. Limit 20 calls / min per client |

### 13.2 Reports
| M | Path | Scope | Request | Response |
|---|---|---|---|---|
| GET | /v1/reports/attendance-export | reports:read | `?from,to (1–92 days), siteId?` | file link (same XLSX) |
| GET | /v1/reports/attendance-summary | reports:read | `?from,to` | same JSON as today |
| GET | /v1/reports/fraud-summary | reports:read | `?from,to` | same JSON, **company-zone day bounds** |

### 13.3 Audit (read)
| GET | /v1/audit | audit:read | `?from,to, entity, action, actorId, limit, cursor` | `{items[{id, at, actor{id, name, api: boolean, actingAs?}, action, entity, entityId, before, after}], nextCursor}` (redact phone / device / face fields in before/after) |
|---|---|---|---|---|

---

## 14. Webhooks (optional, phase 7)

Turn the idle outbox on for clients with `webhookUrl`, events only (payload = the `/v1` presenter of the row):
`punch.flagged`, `punch.reviewed`, `entry.closed` (OPEN → PENDING / AUTO_CLOSED), `entry.missed_request`, `leave.requested`, `leave.decided`, `photo.submitted`, `registration.created`, `job.progress` (crew first arrive / last leave on a job).
Signing and retry as already built (`lib/webhooks.ts`). AIMS keeps polling as the safety net.

---

## 15. Size and order (SiteClock side, rough)

| Slice | Sections | Routes (new / changed) | Size | Blocks AIMS phase |
|---|---|---|---|---|
| A | §1 (idempotency table, acting user, locks, file links, rate limit, updatedAt + tombstones), §2 | 4 + infra | L | 1 |
| B | §3.1–3.3, §3.6, §4, §5 | 27 | M | 1 |
| C | §6 | 17 | M | 2 |
| D | §7, §9, §11.1, §3.5 | 25 | M | 3 |
| E | §8 | 11 | M | 4 |
| F | §10 | 14 | M | 5 |
| G | §12, §13.2 | 11 | S–M | 6 |
| H | §3.4, §11.2, §11.3, §13.1, §13.3, §14 | 16 | M | 7 |

Total ≈ 125 routes. Each slice ships with: zod schemas, `/v1` presenters, cross-company tests, scope tests, idempotency replay test, and an entry in `docs/v1.md` (request / response examples) that AIMS's adapter tests use as fixtures.
