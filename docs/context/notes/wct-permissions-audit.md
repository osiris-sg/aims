# WCT group permissions audit (round 25, 19 Nov 2026)

Read-only. Sources: the prod role rows of the 4 WCT group orgs (permissions, allowedModules, active holders, org modules and flags, read 19 Nov), and the code that gates each tab: the nav (`components/TopNav/useNavModules.ts`, used by the role-home top bar `RoleTopBar.tsx`; all 4 orgs run enableRoleHome), the pages, and `@Permissions` on the API controllers (`ClerkAuthGuard`).

## How each tab is gated (today)

| Tab | Shown in the nav when | API (what the screens call) |
|---|---|---|
| Dashboard | DASHBOARD module on + in the role's allowedModules ([] = all) | `/dashboard/*` needs dashboard:read |
| Sales | SALES module | `/documents/*`: read = documents:read, create = documents:create-basic, save = documents:update, delete = documents:delete |
| Orders | ORDERS module | `/orders/*`: orders:read / orders:update / orders:create (+ documents:update for invoice from order) |
| Jobs | DELIVERIES module (reads "Jobs" for WCT) | `/deliveries/*`: list = maintenance-reports:read; create / schedule / style / PTW / link = documents:create-basic; complete / verify / reject / DO complete = documents:update; cancel / delete / assign = maintenance-reports:create |
| Service Reports | MAINTENANCE module | `/maintenance-reports/*`: maintenance-reports:read / :create / :sign |
| Assets | enableWctVehicles (WCT (S) only) + vehicles:read | `/vehicles/*`: vehicles:read / :update / :approve (repair approve, unlock) |
| Inventory | INVENTORY module | `/inventories/*`: inventories:read-* / :create / :update |
| Accounting | ACCOUNTING module | accounting:*, journal:*, bills:*, bankrec:*, payments:*, statements:read, transactions:*, xerosync:* |
| Org Settings | every role that is not a "scoped" ID role (so every WCT role) | company profile organizations:update; Master Files customers:* / suppliers:* / categories:*; Job fields + Quotation categories + calendar colours organizations:update; Users users:* (Master Files > User Management tab, enableUserMgmtMasterfile); Audit Log needs the AUDIT module |
| Reports | REPORTS module (off in all 4 orgs: no nav entry) | `/portal/reports` by URL: Price History documents:read, Statement of Account statements:read |
| Sales report | Sales > Sales report (enableSalesReport: WCT (S), Racking, BC Air) | `/sales-report` documents:read, then scope BY ROLE NAME: Admin / superadmin / Accounting = all, Sales = own, others = 403 |
| Calendar | the Sales main page (`/portal/sales`, enableJobsCalendar: WCT (S), Racking, BC Air), so SALES module needed | `/dashboard/jobs-calendar` dashboard:read (notes add / edit / delete also only dashboard:read); new job / drag / style documents:create-basic |

Legend: **edit** = opens and saves; **edit\*** = opens, some saves refused (see gaps); **view** = opens, saves refused; **API only** = the role holds the read permission but has no nav entry; **tab, no data** = the tab shows but its list is refused; **tab, 403** = tab shows, the report refuses the role; **URL only** = no nav entry, the page works by URL; **view+notes** = reads the calendar and can add / change / delete calendar notes; **field app** = Technician (field-tech) only uses the field app, the portal sends them to /scan; **n/a** = the feature is off in that org.

### Today (prod, 19 Nov)


**WCT (S) Systems Pte Ltd**

| Role (users) | Dashboard | Sales | Orders | Jobs | Service Reports | Assets | Inventory | Accounting | Org Settings | Reports | Sales report | Calendar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accounting (2) | view | view | none | none | none | view | none | edit | view | URL only | all | view+notes |
| Admin (5) | view | edit | edit | edit | edit | edit | edit | edit | edit | URL only | all | edit |
| Operations (4) | view | API only | none | edit* | edit | edit | view | none | view | none | none | none |
| Sales (6) | view | edit | none | edit* | view | view | view | none | view | none | own | edit |
| Viewer (1) | view | view | API only | view | view | view | view | view | view | URL only | tab, 403 | view+notes |
| Technician (25) | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app |
| superadmin (2) | view | edit | tab, no data | edit | edit | edit | edit | edit | edit | URL only | all | edit |

**WCT Racking Pte Ltd**

| Role (users) | Dashboard | Sales | Orders | Jobs | Service Reports | Assets | Inventory | Accounting | Org Settings | Reports | Sales report | Calendar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accounting (0) | view | view | none | none | none | n/a | none | edit | view | URL only | all | view+notes |
| Admin (1) | view | edit | edit | edit | edit | n/a | edit | edit | edit | URL only | all | edit |
| Operations (0) | view | API only | none | edit* | edit | n/a | view | none | view | none | none | none |
| Sales (2) | view | edit | none | edit* | view | n/a | view | none | view | none | own | edit |
| Viewer (0) | view | view | API only | view | view | n/a | view | view | view | URL only | tab, 403 | view+notes |
| Technician (0) | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app |
| superadmin (2) | tab, no data | edit | tab, no data | edit | edit | n/a | edit | edit | edit | URL only | all | none |

**YMM KITCHEN PTE. LTD.**

| Role (users) | Dashboard | Sales | Orders | Jobs | Service Reports | Assets | Inventory | Accounting | Org Settings | Reports | Sales report | Calendar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accounting (1) | API only | API only | none | none | none | n/a | none | edit | view | URL only | n/a | n/a |
| Admin (1) | API only | API only | API only | API only | API only | n/a | API only | edit | edit | URL only | n/a | n/a |
| Viewer (0) | API only | API only | API only | API only | API only | n/a | API only | view | view | URL only | n/a | n/a |
| superadmin (2) | API only | API only | API only | API only | API only | n/a | API only | edit | edit | URL only | n/a | n/a |

**BC AIR PTE. LTD.**

| Role (users) | Dashboard | Sales | Orders | Jobs | Service Reports | Assets | Inventory | Accounting | Org Settings | Reports | Sales report | Calendar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accounting (1) | API only | view | none | none | none | n/a | none | edit | view | URL only | all | view+notes |
| Admin (2) | view | edit | edit | edit | edit | n/a | edit | edit | edit | URL only | all | edit |
| Operations (0) | view | API only | none | edit* | edit | n/a | view | none | view | none | none | none |
| Sales (9) | view | edit | none | edit* | view | n/a | view | none | view | none | own | edit |
| Viewer (0) | API only | view | API only | API only | view | n/a | API only | view | view | URL only | tab, 403 | view+notes |
| superadmin (2) | view | edit | edit | edit | edit | n/a | edit | edit | edit | URL only | all | edit |


## Gaps found

1. **Orders**: no preset role except Admin has the ORDERS module in any org, so Sales, Accounting, Operations and Viewer cannot open Orders (Viewer even holds orders:read). Sales cannot edit orders (no orders:update).
2. **Jobs edit is partial** (edit\*): Sales and Operations cannot cancel / delete / assign a job (the API asks maintenance-reports:create, Sales lacks it); Operations cannot complete / verify / reject a job or complete a DO (documents:update missing).
3. **Calendar for Operations**: the calendar lives only on the Sales main page; Operations has no SALES module, so no calendar at all.
4. **Viewer**: the Sales report tab shows but the API refuses Viewer (scope by role name). Viewer (and Accounting) can add, change and delete calendar notes, because notes need only dashboard:read.
5. **Shared permissions**: the API cannot separate some tabs by permission alone: maintenance-reports:create = job cancel / delete / assign AND service report writes; documents:update = editing sales documents AND job / DO completion; dashboard:read = dashboard AND calendar AND calendar notes. Custom access enforces tabs by API path for that reason; presets can get the same with `enforcePresetTabs` (off, needs Elroy's go).
6. **Org Settings for everyone**: every WCT role sees Org Settings (Company Profile, Master Files incl. the User Management tab, Job fields, Quotation categories, Hotkeys, Accounting Setup). Saves are refused without organizations:update / configuration:write, but Sales edits customers and Accounting edits suppliers in Master Files; the User Management list is empty (403) for Sales / Accounting / Operations; Viewer reads it.
7. **Audit Log / Activity Log not reachable**: the AUDIT module is off in all 4 orgs, so nobody in the WCT group sees Org Settings > Audit Log (Admin holds audit:read). Role / access changes are logged but WCT's Admins cannot open the log from the menu.
8. **Reports**: REPORTS module is off in all 4 orgs, so /portal/reports (Price History, Statement of Account) has no nav entry; the Sales report is under Sales.
9. **superadmin rows** (platform support role, 2 holders per org, not touched by any preset script): WCT (S) superadmin has no orders:* (Orders tab opens with no data); Racking superadmin has no dashboard:read (no dashboard data, no calendar). Needs Elroy's decision.
10. **Hand-narrowed presets**: BC Air Accounting = [ACCOUNTING, SALES, CUSTOMERS] (no Dashboard), BC Air Viewer = [ACCOUNTING, SALES, CUSTOMERS, MAINTENANCE], YMM roles = [ACCOUNTING] (YMM is accounting only; its other modules are off, so their "API only" cells do not matter). The fix keeps these narrowings except Viewer ("view all").
11. **No custom roles possible**: the Admin preset excludes roles:create / update / delete (by design), the old role editor is hidden for preset orgs, and the role pickers load only the first 10 roles (GET /roles default page).
12. **Role-name rules on the server**: the Sales report scope, the field app lock (field-tech) and some WCT screens decide by role NAME, not permission.

## Final preset table (after the fix)

What Elroy asked for (19 Nov), the rest of each preset unchanged. Same table in code: `PRESET_TAB_ACCESS` in `api-server-production/src/access/tab-access.ts` (enforced by API path only with `enforcePresetTabs`).

| Role | Dashboard | Sales | Orders | Jobs | Service Reports | Assets | Inventory | Accounting | Org Settings | Reports | Sales report | Calendar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Admin | view | edit | edit | edit | edit | edit | edit | edit | edit | view | all | edit |
| Sales | view | edit | **edit** | **edit** | view (1) | view | view | none | view (customers edit) | none | own | edit |
| Accounting | view (2) | update + send | **view** | none | none | view | none | edit | view (suppliers edit) | view (URL) | all | view + notes |
| Operations | view | none | **view** | **edit** | edit | edit | view | none | view | none | none | **edit (Jobs > Calendar) (3)** |
| Viewer | view | view | **view** | view | view | view | view | view | view | view (URL) | **all** | view (4) |
| Technician | field app | | | | | | | | | | | |
| superadmin | as stored, not touched (see gap 9) | | | | | | | | | | | |

(1) Sales gets maintenance-reports:create for Jobs edit (cancel / delete / assign); the same permission lets the API save service reports, so Service Reports is view in the menu and on paper only, unless `enforcePresetTabs` is on. (2) BC Air Accounting has no Dashboard module (kept). (3) Jobs > Calendar shows when `enableCustomAccess` is on (jobs calendar orgs). (4) Calendar notes still open to anyone with dashboard:read (gap 4) unless `enforcePresetTabs` is on.

Per org after the fix (computed from the prod rows + the DRY-RUN):


**WCT (S) Systems Pte Ltd**

| Role (users) | Dashboard | Sales | Orders | Jobs | Service Reports | Assets | Inventory | Accounting | Org Settings | Reports | Sales report | Calendar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accounting (2) | view | view | view | API only | API only | view | none | edit | view | URL only | all | view+notes |
| Admin (5) | view | edit | edit | edit | edit | edit | edit | edit | edit | URL only | all | edit |
| Operations (4) | view | API only | view | edit | edit | edit | view | none | view | none | none | edit (Jobs > Calendar) |
| Sales (6) | view | edit | edit | edit | edit | view | view | none | view | none | own | edit |
| Viewer (1) | view | view | view | view | view | view | view | view | view | URL only | all | view+notes |
| Technician (25) | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app |
| superadmin (2) | view | edit | tab, no data | edit | edit | edit | edit | edit | edit | URL only | all | edit |

**WCT Racking Pte Ltd**

| Role (users) | Dashboard | Sales | Orders | Jobs | Service Reports | Assets | Inventory | Accounting | Org Settings | Reports | Sales report | Calendar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accounting (0) | view | view | view | API only | API only | n/a | none | edit | view | URL only | all | view+notes |
| Admin (1) | view | edit | edit | edit | edit | n/a | edit | edit | edit | URL only | all | edit |
| Operations (0) | view | API only | view | edit | edit | n/a | view | none | view | none | none | edit (Jobs > Calendar) |
| Sales (2) | view | edit | edit | edit | edit | n/a | view | none | view | none | own | edit |
| Viewer (0) | view | view | view | view | view | n/a | view | view | view | URL only | all | view+notes |
| Technician (0) | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app | field app |
| superadmin (2) | tab, no data | edit | tab, no data | edit | edit | n/a | edit | edit | edit | URL only | all | none |

**YMM KITCHEN PTE. LTD.**

| Role (users) | Dashboard | Sales | Orders | Jobs | Service Reports | Assets | Inventory | Accounting | Org Settings | Reports | Sales report | Calendar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accounting (1) | API only | API only | API only | API only | API only | n/a | none | edit | view | URL only | n/a | n/a |
| Admin (1) | API only | API only | API only | API only | API only | n/a | API only | edit | edit | URL only | n/a | n/a |
| Viewer (0) | API only | API only | API only | API only | API only | n/a | API only | view | view | URL only | n/a | n/a |
| superadmin (2) | API only | API only | API only | API only | API only | n/a | API only | edit | edit | URL only | n/a | n/a |

**BC AIR PTE. LTD.**

| Role (users) | Dashboard | Sales | Orders | Jobs | Service Reports | Assets | Inventory | Accounting | Org Settings | Reports | Sales report | Calendar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accounting (1) | API only | view | view | API only | API only | n/a | none | edit | view | URL only | all | view+notes |
| Admin (2) | view | edit | edit | edit | edit | n/a | edit | edit | edit | URL only | all | edit |
| Operations (0) | view | API only | view | edit | edit | n/a | view | none | view | none | none | edit (Jobs > Calendar) |
| Sales (9) | view | edit | edit | edit | edit | n/a | view | none | view | none | own | edit |
| Viewer (0) | view | view | view | view | view | n/a | view | view | view | URL only | all | view+notes |
| superadmin (2) | view | edit | edit | edit | edit | n/a | edit | edit | edit | URL only | all | edit |

## DRY-RUN (prod, read-only, 19 Nov)

```
prod: WCT group preset fix  (dry run)

== WCT (S) Systems Pte Ltd (modules on: DASHBOARD, INVENTORY, CUSTOMERS, SUPPLIERS, MAINTENANCE, ACCOUNTING, SALES, DELIVERIES, USER_MANAGEMENT, ORDERS)
  Accounting  2 user(s), 50 permissions, modules [DASHBOARD,ACCOUNTING,SALES,CUSTOMERS,SUPPLIERS,MASTERFILES]
      + permissions: maintenance-reports:read, orders:read
      + modules:     ORDERS
  Admin       not changed
  Operations  4 user(s), 41 permissions, modules [DASHBOARD,DELIVERIES,MAINTENANCE,INVENTORY,CUSTOMERS,MASTERFILES]
      + permissions: documents:update, orders:read
      + modules:     ORDERS
  Sales       6 user(s), 49 permissions, modules [DASHBOARD,SALES,CUSTOMERS,MASTERFILES,INVENTORY,DELIVERIES,MAINTENANCE]
      + permissions: maintenance-reports:create, orders:create, orders:read, orders:update
      + modules:     ORDERS
  Viewer      1 user(s), 50 permissions, modules [DASHBOARD,SALES,INVENTORY,DELIVERIES,MAINTENANCE,ACCOUNTING,CUSTOMERS,SUPPLIERS,MASTERFILES]
      + modules:     ORDERS
      (module off in this org, not added: ASSETS, REPORTS)
  field-tech  not changed
  superadmin  not changed

== WCT Racking Pte Ltd (modules on: DASHBOARD, INVENTORY, DELIVERIES, SALES, CUSTOMERS, SUPPLIERS, USER_MANAGEMENT, ACCOUNTING, ORDERS, MAINTENANCE)
  Accounting  0 user(s), 49 permissions, modules [DASHBOARD,ACCOUNTING,SALES,CUSTOMERS,SUPPLIERS,MASTERFILES]
      + permissions: maintenance-reports:read, orders:read
      + modules:     ORDERS
  Admin       not changed
  Operations  0 user(s), 39 permissions, modules [DASHBOARD,DELIVERIES,INVENTORY,CUSTOMERS,MASTERFILES,MAINTENANCE]
      + permissions: documents:update, orders:read
      + modules:     ORDERS
  Sales       2 user(s), 48 permissions, modules [DASHBOARD,SALES,CUSTOMERS,MASTERFILES,INVENTORY,DELIVERIES,MAINTENANCE]
      + permissions: maintenance-reports:create, orders:create, orders:read, orders:update
      + modules:     ORDERS
  Viewer      0 user(s), 49 permissions, modules [DASHBOARD,SALES,INVENTORY,DELIVERIES,ACCOUNTING,CUSTOMERS,SUPPLIERS,MASTERFILES,MAINTENANCE]
      + permissions: vehicles:read
      + modules:     ORDERS
      (module off in this org, not added: ASSETS, REPORTS)
  field-tech  not changed
  superadmin  not changed

== YMM KITCHEN PTE. LTD. (modules on: USER_MANAGEMENT, ACCOUNTING)
  Accounting  1 user(s), 49 permissions, modules [ACCOUNTING]
      + permissions: maintenance-reports:read, orders:read
      (module off in this org, not added: ORDERS)
  Admin       not changed
  Viewer      0 user(s), 49 permissions, modules [ACCOUNTING]
      + permissions: vehicles:read
      (module off in this org, not added: DASHBOARD, SALES, ORDERS, INVENTORY, DELIVERIES, MAINTENANCE, CUSTOMERS, SUPPLIERS, MASTERFILES, ASSETS, REPORTS)
  superadmin  not changed

== BC AIR PTE. LTD. (modules on: DASHBOARD, INVENTORY, USER_MANAGEMENT, ACCOUNTING, SALES, CUSTOMERS, MAINTENANCE, ORDERS, DELIVERIES, SUPPLIERS)
  Accounting  1 user(s), 49 permissions, modules [ACCOUNTING,SALES,CUSTOMERS]
      + permissions: maintenance-reports:read, orders:read
      + modules:     ORDERS
  Admin       not changed
  Operations  0 user(s), 39 permissions, modules [DASHBOARD,DELIVERIES,MAINTENANCE,INVENTORY,CUSTOMERS,MASTERFILES]
      + permissions: documents:update, orders:read
      + modules:     ORDERS
  Sales       9 user(s), 48 permissions, modules [DASHBOARD,SALES,CUSTOMERS,MASTERFILES,INVENTORY,DELIVERIES,MAINTENANCE]
      + permissions: maintenance-reports:create, orders:create, orders:read, orders:update
      + modules:     ORDERS
  Viewer      0 user(s), 49 permissions, modules [ACCOUNTING,SALES,CUSTOMERS,MAINTENANCE]
      + permissions: vehicles:read
      + modules:     DASHBOARD, ORDERS, INVENTORY, DELIVERIES, SUPPLIERS
      (module off in this org, not added: MASTERFILES, ASSETS, REPORTS)
  superadmin  not changed

DRY RUN: 45 change(s), nothing written. Re-run with --apply after Elroy's go.
```

APPLY (after Elroy's go; writes permission links + allowedModules in one transaction per org, an ActionLog row per role, and `scripts/wct-r25-preset-fix.prod.log.json`):

```
cd api-server-production && npx ts-node --transpile-only scripts/wct-r25-preset-fix.ts --env prod --apply
```

## Custom access (built, behind enableCustomAccess, default OFF)

- Org Settings > Roles (Admin / superadmin): custom roles = name + per tab No access / View / Edit (Sales report: No access / Own / All). Org Settings at most View in a role. Built-in roles listed read-only with their table. Custom roles show in Add / Edit User next to the presets; several roles = union.
- Add / Edit User: "Custom access" switch with the same grid; it supersedes the person's roles; Users list shows "Custom". Org Settings Edit only for someone holding Admin; never for superadmin or yourself.
- Server: ClerkAuthGuard checks every request of a custom-access person against the tab map, by API path (incl. routes with no @Permissions, e.g. /import, /admin) and by permission; refused = 403 "Your access does not include this page". Admin / superadmin / Technician / hand-made roles are never narrowed. Orgs without the flag: no extra reads, unchanged (tests).
- Activity Log: resource `access`: role CREATE / UPDATE (tabs that changed, rename) / DELETE; person SET_ACCESS (on / off + tabs that changed).
- Schema: new table `CustomAccess` only (no change to existing tables). Prod gets it from Render's build; dev created with `scripts/_r25-custom-access-dev-table.ts --apply` (done 19 Nov).

## Round 30 follow-ups (20 Nov, branch wct-r30-perm-followups, not applied)

- Operations "Jobs edit" no longer uses documents:update. New permission `deliveries:update` (created in the catalogue by the preset fix script) admits ONLY these 15 routes, and only when the caller fails the route's own documents:update check (everyone who passes today passes the same way): job complete / verify / reject / cancel hand-off, DO complete (`/deliveries/order-dos/:doId/complete`), job photo hide / tag, and on the generic document routes only for a DELIVERY_ORDER / DO of the caller's org: DO save (`POST /documents/update`), the editor lock (3 routes), DO sign link (`/documents/:id/share-link` + revoke), guest delivery link (+ revoke). Quotations, invoices, notes, delete, confirm-invoice etc. stay documents:update only. Custom access Jobs edit uses the same.
- Operations also gets the CALENDAR role module: Jobs > Calendar shows only to a person on ordinary roles whose role grants CALENDAR and who has no Sales (or a custom-access person with Calendar), so enableCustomAccess alone changes nothing for existing users (proof: imports/wct-r30-custom-access-noop-check.txt (owner-local)).
- Preset fix dry run (prod): imports/wct-r30-preset-fix-dryrun.txt (owner-local) (48 changes: Operations gets deliveries:update + CALENDAR instead of documents:update; the other roles as before).
- Activity Log menu + superadmin Orders dry run (prod): imports/wct-r30-audit-gaps-dryrun.txt (owner-local) (AUDIT module row on in all 4 orgs: menu for Admin + superadmin only; superadmin + orders:* in WCT (S) and Racking).
