# WCT (S) SiteClock workers / teams: read-only survey (round 39 B1, 20 Nov 2026)

Sources: docs/context/SITECLOCK.md, SITECLOCK_SPEC.md, AIMS code (api-server-production/src/siteclock/*), one read-only prod DB query (BEGIN TRANSACTION READ ONLY). No live SiteClock call was made; no key was read or printed.

## What SiteClock's /v1 API gives AIMS (key scopes: teams:read, workers:read, workers:phone opt-in, sites:write, jobs:read, jobs:write)
- `GET /v1/workers?teamId&active=true|false|all&include=phone` -> `{workers:[{id, name, employeeNo, role, active, clerkUserId, phone?, teamIds, siteIds}]}`.
  - role = SiteClock tier (WORKER / SUPERVISOR / COMPANY_ADMIN). Trades (UserTrade) are NOT exposed on /v1.
  - phone only when the key has the opt-in `workers:phone` scope (403 otherwise). Not knowable from AIMS: scopes live in SiteClock's ApiClient row.
  - No email on /v1. No ID / passport / work-permit fields on /v1 (SiteClock stores none of those as fields either; employeeNo is a free-text employee number and is NOT imported).
- `GET /v1/teams?date` -> `{date, teams:[{id, name, members:[{id, name, employeeNo}]}]}` = teams with the members active on that date (TeamMembership is dated). Team `active` is not in the response (only active teams are returned, inferred). TeamSupervisor not exposed.
- No /v1 for timesheets, punches, time entries, payroll, leave, trades (see SITECLOCK.md "AIMS -> SiteClock" and spec line 2425-2426).

## What AIMS already does with it
- `SiteClockClient.workers()` (no `active`/`include` params, so active workers only, no phone) and `teams()`: `src/siteclock/siteclock.client.ts`.
- `SiteClockLinkService.workers()` caches teams + active workers 5 min for the Schedule dialog's worker picker (only when enableSiteClockLink is on and the org is not manual-flow).
- `SiteClockLinkService.calendarJobs()` reads `/v1/jobs/calendar` for the jobs calendar (crew names come from there).
- Worker logins: `OrganizationMemberProfile.siteclockUserId` links an AIMS member to a SiteClock user (written by scripts/setup-wct-siteclock-fieldtechs.ts from Clerk publicMetadata.siteclock; field-tech role).

## The key
- Stored sealed in `SiteClockConnection.apiKeyEnc` (AES via `src/common/secret-box.ts`, env `AIMS_SECRETS_KEY`). The local .env has no AIMS_SECRETS_KEY, so the key can only be opened on Render: **every live SiteClock read (preview / sync) must go through the deployed API** (Settings > Workers & Teams > Sync from SiteClock, or the admin connection test).

## Prod facts (read-only, 20 Nov)
- One SiteClockConnection in AIMS: WCT (S), host api.siteclock.osiris.sg, enabled, last OK 12 Nov 14:03 UTC, no last error, inbound key set.
- WCT (S) flags: enableSiteClockLink true, enableWctMyJobs true, enableSiteClockDeliveries true (manual flow on, so no job sync to SiteClock).
- WCT (S) members: 41 active of 44. Roles: field-tech 25, Sales 6, Admin 5, Operations 4, Accounting 2, superadmin 2, Viewer 1.
- 25 member profiles carry a siteclockUserId (= the 25 field-tech logins), 10 profiles have a WhatsApp number.
- DeliverySiteClockJob rows for WCT (S): 0 (no AIMS job is on SiteClock).
- AIMS keeps no copy of SiteClock workers or teams today (no table). Worker / team counts in SiteClock itself are only visible through the live API (the dry run on the deployed API will report them).

## Matching plan for the sync (AIMS user link)
1. Profile link (siteclockUserId = SiteClock worker id): exact, covers the 25 field-tech logins.
2. SiteClock clerkUserId = the member's Clerk user id.
3. Phone (last 8 digits) vs the member's Clerk phone numbers / WhatsApp number (only if the key has workers:phone).
4. Exact name (case-insensitive) when exactly one active member has it.
Email: not available from SiteClock /v1, so not used.
