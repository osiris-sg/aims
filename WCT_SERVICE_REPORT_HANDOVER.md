# WCT service report — handover to the laptop agent

Written 2026-10-27 from a cloud session (no network to dev/prod, no browser),
so everything below is **type-checked but not browser-tested**. Read
`WCT_HANDOVER.md` first for the WCT org, templates, services and scripts; this
file covers the service-report work on top of it and what is left.

## State of the repo

`main` = `8b3caf4` (also on `claude/focused-pasteur-rv6piz`, same commit).
Three commits, all on `main`, all deployed by Render + Vercel on push:

| Commit | What |
| --- | --- |
| `a00aa93` | `WCT_V1` service-report template (paper #012392), server renderer, asset-less SERVICE report API, field capture form, office page view |
| `6096e0c` | Report **scheduled with the run** and **mandatory right after the sign-off**; `POST /maintenance-reports/:id/complete`; list payloads and office/field badges |
| `8b3caf4` | DO step of a service job is just **"Select item"** (no photos, no per-line signature); photos live on the report |

Working tree was clean at hand-off. `npm run db:push` is NOT needed: no
schema change in any of the three (the report uses the existing
`MaintenanceServiceReport` row with `assetId` null and JSON `serviceData`).

## The flow as guru specified it (2026-10-27)

Quotation → DO → service done → invoice → **service report**. Only WCT (a
run with a `SERVICE`-class line) takes this path; every other org keeps the
normal flow untouched.

1. Office confirms the quotation (staff button or customer e-sign) → DO +
   draft delivery (already existed, rounds 1–4).
2. Office schedules the delivery (`ScheduleDeliveryDialog` → `PATCH
   /deliveries/scheduled/:id` promotion, or `POST /deliveries/scheduled`).
   `deliveries.service.ensureScheduledServiceReport` creates the report row:
   kind `SERVICE`, status `draft`, `serviceData.scheduled = true`,
   `templateId WCT_V1`, customer / site / planned date filled, **no number**.
   Service Reports lists it as **Scheduled**; the run page shows a
   "Service report" bar. Cancel / delete / save-back-to-draft drops it
   (`dropScheduledServiceReport`). Scheduled rows are excluded from the field
   app's Pending Sign query (`findAllService` with `status=draft`).
3. Technician (`sitejob_wct`, field-tech role) opens the run in SiteJobs.
   Each Service line has **Select item** (`run-select-service-item`) → `POST
   /deliveries/:id/items/:itemId/start` with `photos: []`
   (`MIN_PHOTOS_BY_ASSET_CLASS.SERVICE = 0`, in `src/common/asset-class.ts`
   and `portal-production/helpers/assetClass.ts`). Then "End Delivery"
   (`ack-all`, unsigned) and the run's one signature at finalize (unchanged;
   invoice auto-created at quoted prices).
4. `finalize/page.tsx` redirects a service job to
   `/scan/delivery/[id]/service-report` instead of "Delivery completed".
   The form (`app/(field)/scan/delivery/[deliveryId]/service-report/page.tsx`):
   step 1 Company / Location / Date (from the run) + "Type of Service/Job"
   ticks; step 2 one block per photo section the ticks call for (Before /
   After grids, the ✓ work lines to un-tick); step 3 remarks + optional
   customer email. Submit → `POST /maintenance-reports/:id/complete` on the
   scheduled row (fallback: `POST /maintenance-reports` with no `assetId`
   when a run has no scheduled row). `completeScheduled` assigns the running
   number, technician, `deliveryItemId`, `invoiceDocumentId` (the INVOICE
   whose `config.sourceDocumentId` is the run's DO), sets `completed` and
   emails the PDF (no customer signature on this paper — the customer signed
   the DO).
5. Until written: "Delivery completed" screen shows "Service report pending"
   + **Write Service Report** (`field-service-report`); the Completed list
   badges the run **REPORT DUE** (`serviceReport` on the run list payload).

## Files to know

- `portal-production/lib/msr-templates.ts` + mirror
  `api-server-production/src/maintenance-reports/msr-templates.ts` —
  `WCT_V1` catalogue: `WCT_JOB_TYPE_GROUPS`, `WCT_PHOTO_SECTIONS`,
  `wctSectionsFor`, fixed text (cover letter, contacts, values, signatory,
  SCDF/NEA advisory, frequency table, closing EN+ZH), stored shape
  `serviceData.wct = { jobTypes: string[], sections: { [id]: { before, after,
  photos, lines } } }`. **Keep the two files identical** — check:
  `diff <(tail -n +34 portal-production/lib/msr-templates.ts) <(tail -n +28 api-server-production/src/maintenance-reports/msr-templates.ts)`.
- `api-server-production/src/maintenance-reports/service-report-wct.ts` —
  the only renderer of the paper (`buildWctServiceReportHtml`,
  `wctServicePdfOptions`: margins + Puppeteer footer "TEL / WEBSITE / EMAIL /
  ADDRESS … Page n of N"). `service-report-pdf.ts` delegates to it by the
  stamped `templateId`; `servicePdfOptions` replaced `servicePdfMargin` at
  the call site.
- `maintenance-reports.service.ts`: `create()` (asset-less SERVICE on a run,
  `runFill`, `selfCompleting`), `completeScheduled()`, `renderReportHtml()`,
  `getReportHtml()` / `getReportPdf()` (`GET /maintenance-reports/:id/html`
  → `{ html, templateId }`, `GET …/:id/pdf`), `REPORT_ORG_SELECT`.
- `deliveries.service.ts`: `ensureScheduledServiceReport`,
  `dropScheduledServiceReport`, `list()` adds `serviceReport` per run and
  skips the `photos` flag for a service-only run.
- Portal: `app/portal/maintenance-reports/_components/WctReportView.tsx`
  (iframe of the served HTML, Print = iframe print, Download = authenticated
  fetch of the PDF with `X-Active-Org-Id`), `[id]/page.tsx` (`isWct` branch,
  "Scheduled — awaiting the technician" chip), list page `Scheduled` chip,
  `app/portal/deliveries/[id]/page.tsx` "Service report" bar.
- Field: `MsrPrintSurface.tsx` prints the served HTML for `WCT_V1`
  (same road as the WCT DO in `DoA4Print`); `finished/[deliveryId]/page.tsx`;
  `DeliveryRunCards.tsx` REPORT DUE chip; `lib/deliveryLists.ts`
  `RunSummary.serviceReport`.
- Guide: `app-knowledge.ts` "WCT SERVICE REPORT" line; anchors in
  `guide.service.ts` (`run-select-service-item`, `field-service-report`,
  `service-report-print`, `service-report-download-pdf`, `run-service-report`).

## What to verify in a browser (none of this has been run)

Dev first (`npm run start:dev` + portal `npm run dev`, or the Chrome pass):

1. Schedule a WCT run with a Service line (accept a quotation → promote the
   draft with a date). Service Reports shows a **Scheduled** row; the run page
   shows the Service report bar; `GET /deliveries?…` rows carry
   `serviceReport`.
2. SiteJobs as `sitejob_wct`: run page shows **Select item** on the Service
   line (not Start Delivery); tap → line is `delivering` with no photo page;
   End Delivery → finalize → signature → lands on the service report form.
3. Form: ticks drive the photo sections; photo upload (`uploadImage`,
   folder `maintenance-reports`); submit → `…/complete` returns the row with
   a `reportNumber`; Service Reports flips to Completed with the number; the
   office page shows the paper in the iframe; Print / Download PDF work; the
   customer email went out (Resend) with the PDF.
4. "Delivery completed" afterwards reads **View Service Report**; the
   Completed list has no REPORT DUE on that run.
5. Dark mode on the office report page (the iframe is white by design).
6. Edge: a run scheduled BEFORE `6096e0c` has no scheduled row → the form
   creates one via `POST /maintenance-reports` (numbered at creation).
7. A Biofuel run (no Service line) is unaffected: photo flow, finished
   screen, no bar, no chip.

Known gaps / decisions to confirm with guru:

- The de-dusting / additions work lines in `WCT_PHOTO_SECTIONS` had no paper
  sample and are drafted (`draftedLines: true`) — get WCT's wording.
- SCDF/NEA slides and the bizSAFE/BCA badges print as text, not images.
- The paper's "Vers: (LH)21.07.2023" footer note is not printed.
- Report number is 6-digit padded `#012392` style from `reportNumber`; it
  is issued at completion (job-done order), per guru.
- Multi-trip (partial sign-off) service jobs: the redirect only fires on a
  full finalize; a partial lands on the finished screen as before.
- Guest driver link (`/guest/delivery/[token]`, used by the e2e stage 04)
  still runs the old per-line photo flow and never reaches the report; the
  field app is the intended road.

## Original task still open: the flow videos for the client

The first ask of this session was to record the WCT end-to-end flow on
PRODUCTION (`api-server-production/scripts/e2e-wct-flow/`, see its README and
`WCT_HANDOVER.md` §8). The cloud session could not reach prod or read
`.env.production`; nothing was recorded and nothing was written to prod.
From the laptop:

1. Dry-run `setup-wct-org.ts`, `setup-wct-templates.ts`,
   `setup-wct-services.ts` with `--env prod`; apply only on guru's APPLY.
2. Confirm Render (`aims-ahwy`) and Vercel are on `8b3caf4` or newer.
3. Harness stages 00–04 exist; stage 04 drives the GUEST link. The flow
   guru wants on video is the FIELD APP road (Select item → End Delivery →
   sign → service report), so a `05-service-report.js` stage (Clerk-signed
   `sitejob_wct` context, or the admin context viewing as WCT) is still to
   be written: run page → Select item → End Delivery → finalize → report
   form → office Service Reports page + PDF.
4. Test customer "Yoshinoya (Suntec City)"; afterwards remind guru to void
   the test documents.
