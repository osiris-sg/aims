# WCT group facts
Read with aims-rules.md and WCT_STATE.md (current state + open items).
- SiteClock reference (API, data model, AIMS integration, watch-outs; from the SiteClock repo at 62b7d9d): docs/context/SITECLOCK.md. Read it before any SiteClock work.
- Org: WCT (S) Systems Pte Ltd, id 5c700000-0000-4000-8000-5c7000000001. Kitchen-exhaust / MV services. Group entities are separate orgs (ids …0002 WCT Racking, …0003 YMM Kitchen, …0004 BC Air); finance@wct.com.sg is admin in all 4.
- Scope: changes for the WCT group may go to all 4 sister orgs where it makes sense, but must never affect any other org (CIEL, Biofuel, ADH…). Gate everything per org and prove other orgs are unchanged.
- Read WCT_HANDOVER.md and WCT_SERVICE_REPORT_HANDOVER.md first; e2e scripts in api-server-production/scripts/e2e-wct-flow/.
- Flow (manual, WCT (S) only, enableManualOrderFlow): Quotation (e-sign link, CIEL-style) → Order + draft DO (no job) → Complete DO (sign here / upload signed DO / sign link) → draft Invoice (posts to GL only on confirm/send) → Service report (create or upload, linked to customer + DO) → Send service report. Orders page is the hub. Jobs and scheduling are optional. No SiteClock / DO app for WCT order jobs.
- "Like CIEL" means CIEL's exact UI and flow, reusing its components.
- Books: each org uses its own ABSS chart; imported old-ERP docs are GL-guarded. Source files in ~/Desktop/WCT_Books (owner-local).
- Testing on prod: only with customer "TEST Client" (was "TEST SiteClock"; email <redacted>, contact <redacted>); delete test runs directly afterwards (counters untouched, numbers stay as gaps).

## Racking
- Scope: WCT Racking Pte Ltd only (org id 5c700000-0000-4000-8000-5c7000000002), mainly Racking quotations. Gate everything per org; WCT (S), BC Air, YMM and all other orgs unchanged.
