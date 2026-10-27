# WCT (S) Systems Pte Ltd — Onboarding Handover

Written 2026-10-26. Covers everything built for the WCT org on `elroy/dev`
between 2026-10-22 and 2026-10-26, what is verified, and what is still open.

## 1. What WCT asked for

WCT is a kitchen-exhaust / mechanical-ventilation services company (chemical
degreasing, MV fans, ductwork). They wanted:

- The same tabs as Biofuel, minus **Customer Information**:
  Dashboard · Sales · Inventory · Projects · Service Reports · Accounting ·
  Deliveries · Org Settings.
- Their own paper documents reproduced exactly: **Quotation**, **Tax Invoice**,
  **Delivery Order** (photographed originals: Quotation -014162-R0, Tax Invoice
  I-015128, Delivery Order DO011982 — the Yoshinoya job). Guru's instruction:
  "look at how we did the CIEL quotation template, something like that", i.e.
  a page layout of its own, not the stock AIMS frame.

### Client call, 2026-10-26 (guru's notes, relayed to the PC session)

1. Document chain: **Quotation → DO → Invoice → Service Report**, sent by
   email and/or WhatsApp (both if possible).
2. **Every quotation must be accepted before a DO** — accepted by a staff
   button OR by the customer via a link (both exist: rounds 1–2 below).
   Acceptance auto-creates the delivery as a DRAFT under the Delivery schedule,
   waiting for office confirmation; once confirmed and the date arrives the
   field app runs the job and the invoice auto-generates on completion (same
   logic as Biofuel).
3. **FOC jobs**: a DO + schedule WITHOUT a quotation must stay possible.
   Whether an FOC job gets no invoice or a $0 invoice is still unanswered.
4. **"Auto invoice to maintenance flow"** — a hand-off from the finished
   job / invoice into the Service Report (MAINTENANCE) module. Does not exist
   yet; exact meaning (auto-create a Service Report?) still to confirm.
5. Group of four entities, each its own AIMS org with its own bank account and
   letterhead: **WCT System** (~30 pax, the ONLY GST-registered one, 9 %),
   **BC Air** (products, non-GST, 0 pax — item tracking modelled on it, WCT may
   follow), **WCT Racking** (4–5 pax), **YMM** (2–3 pax). Open: own layouts
   per entity or just own letterhead data; whether BC Air has any logins.
6. Open design gap: how a WCT field tech STARTS a run with free-typed lines
   only (nothing to scan — service jobs have no catalog unit); the guest
   driver link may be the answer.

## 2. What exists on DEV today

### Org

| Item | Value |
| --- | --- |
| Org name | `WCT` (legal name on paper: **WCT (S) Systems Pte Ltd** — see open items) |
| Org id | `5c700000-0000-4000-8000-5c7000000001` |
| Currency / GST | SGD, 9 %, FYE 31 Dec |
| Address | 19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099 |
| Tel | 6741 1697 |
| Reg no | 201724603K (printed as Company Reg and GST Reg No) |
| Email / website | info@wct.com.sg / www.wct.com.sg (new `Organization.email` / `.website` columns) |
| PayNow UEN | 201724603K001 (`bankDetails.paynowUen`) |
| Dev schema | `org_wct` (`prisma/tenancy/orgs/wct.prisma`, 91 tables, guard triggers installed, registered in `platform.OrgTenant`) |

### Modules, flags, roles

- **Modules ON**: DASHBOARD, SALES, INVENTORY, PROJECTS, MAINTENANCE (= Service
  Reports), ACCOUNTING, DELIVERIES, CUSTOMERS, SUPPLIERS.
- **Stored OFF** (catalog-default modules show as virtual tabs unless stored
  off): CUSTOMER_INFORMATION, USER_MANAGEMENT, ORDERS, DOCUMENTS, INVOICES, CRM,
  AUDIT, ADMIN.
- **Feature flags**: Biofuel's set; `enableIdQuotation` **OFF** (see §4);
  water-sg and Xero flags OFF; `enableActionLog` ON.
- **Roles**: copied from Biofuel (superadmin, Admin, Manager, User, field-tech),
  with CRM / CUSTOMER_INFORMATION / AUDIT / ADMIN / USER_MANAGEMENT dropped from
  `allowedModules`. All Osiris superadmins are superadmin on WCT.

### Accounting

- Default 26-account SG chart (controls CA001 / CL001 / CL900), 13 GST codes
  copied from Biofuel, one "Default" number format per document type
  (`{DOC}{YYYY}{MM}-{####}`).
- Work Library seeded with CIEL's 10 trade sections (A–J), no items. Harmless
  now that the ID quotation flag is off; delete if unwanted.

### Services master file (round 3, 2026-10-26)

Guru's decision after the client call: keep the **normal editor** (not the
CIEL sectioned editor), the template keeps WCT's look, and staff **select the
services from a master list, each tied to a GL account**. That is the existing
Revenue Master File (`RevenueItem`, Master Files → Services, "Add Service" in
the editor) — so round 3 is data plus one editor improvement:

- `scripts/setup-wct-services.ts` seeds WCT's 14 standard services verbatim
  from the papers, all tied to **SS001 Credit Sales**: G01–G03 (general scope
  lines), S01–S09 (service scope lines) at $0, and the two priced packages
  **MA1X** (1×/year, hood + duct + fan, $800) and **MA3X** (3×/year, hood only,
  $350). Idempotent (upsert by code), dry run by default, `--apply` to write.
  WCT can add or reprice services later on Master Files → Services.
- The "Add Service" picker (`RevenueItemPickerDialog`) gained a **multi-select
  mode**: checkboxes per row, a header checkbox for everything visible, search
  to narrow, and one "Add N services" button that appends the ticked lines in
  master-file order (code order = paper order). One trip to the picker per
  quotation instead of twelve. Re-coding an existing row via the pencil stays
  single-pick. Every line carries its `accountCode`, so when the accepted
  quotation becomes the invoice, `postFromInvoice` credits SS001 per line
  (`revenueLines`) — no accountant re-coding.
- Guide assistant: knowledge line updated, anchors `editor-add-service` and
  `service-picker-add-selected`, and a prebuilt walkthrough
  "Quote from your standard services".

Not changed: no new feature flag (`enableServiceItems` is already ON in
Biofuel's set, which WCT inherits), no schema change.

### Document templates (the main piece of work)

Three WCT-owned templates, all with the design knob **`layout: 'wct'`**:

| Type | Variant | Name | Columns |
| --- | --- | --- | --- |
| QUOTATION | QO1 | WCT Quotation | S/No · Description · Qty · Unit Price · Amount |
| INVOICE | TI2 | WCT Tax Invoice | same |
| DELIVERY_ORDER | DO | WCT Delivery Order | S/No · DESCRIPTION · QTY · REMARK |

Each template carries its own editor fields (`config.formFields`): document
number, date, customer, Bill To, **Attention / Email / Phone**, **Job Location /
Subject** (quotation + invoice), **Sales Person / Sales Contact**, Invoice Rev
(invoice), Quotation Number + Ship To (DO), money fields, remarks.

Doc Defaults (`Organization.docTypeDefaults`, keyed by both type and variant):
the 18 Terms & Conditions bullets transcribed from the paper quotation; the
invoice version adds the cheque instruction and the thank-you line. Footer
messages: "This is computer generated, no signature is required" (quotation)
and "Computer generated document, no signature is required." (invoice).

## 3. How the WCT layout works (architecture)

Same pattern as CIEL's ID quotation (`document-html/id-quotation.ts`): one
server renderer is the single source for the on-screen preview and the PDF.

- **Design knob** `styleConfig.layout: 'standard' | 'wct'`
  (`api-server-production/src/common/services/document-html/design.ts` and the
  portal mirror `portal-production/app/portal/documents/design.ts`). Set per
  template in Admin → Organizations → org → Document Types → Manage Templates →
  **Design → Layout**. Any org may pick it.
- **Renderer** `src/common/services/document-html/wct.ts` —
  `renderWctBody(kind, data, org, design)` for `quotation | invoice | do`.
  Letterhead (logo beside company block, Company Reg / GST Reg No, Tel, PayNow
  UEN, Email, Website, document number over a rule) sits in an outer table
  `<thead>`, so Chromium repeats it on every printed page. Then title, Bill To
  block with Date (and Invoice Rev), boxed Job Location / Subject rows, the
  line table with boxed header cells, totals (Total / GST n% / Total Amount, or
  Total / GST n% / Amount Paid / Amount Due on the invoice, read via
  `document-money.ts`), Terms and Conditions, Sales Person / Contact / Yours
  Sincerely beside Confirmation of Order, closing lines. DO: centred title over
  an asterisk rule, DO No / Quotation Number / Date, Sold To + Ship To boxes.
- **Routing** `document-html/index.ts`: `renderDocumentHtml` sends quotation,
  invoice and delivery-order types to the WCT renderer when
  `design.layout === 'wct'` (the ID quotation keeps its own renderer).
  `pdfOptionsFor(type, data)` returns the Puppeteer options: WCT margins plus
  a per-page footer (footer line left, **"Page n/N"** right —
  `pdf-generator.service.ts` footer gained `format / fontPx / paddingX`).
- **Editor preview** `portal-production/containers/DocumentTemplates/components/ServerDocumentPreview.tsx`:
  when the template's design has a non-standard layout, `TabbedDocumentCreator`
  shows an iframe of `POST /documents/preview-html` (debounced on every edit,
  same HTML as the PDF) instead of `CleanDocumentPreview`; Print prints the
  iframe; Generate PDF goes through the normal `generate-pdf` path. Both
  endpoints accept `templateId`, so an unsaved document already previews in
  its layout. `preview-html` is in the Activity Log skip list.
- **Letterhead data**: `Organization.email`, `Organization.website` (new
  columns, in both `platform.prisma` and `schema.prisma`, the ClerkAuthGuard
  selects, the org DTO, and Company Profile → General);
  `bankDetails.paynowUen` (Company Profile → Bank).
- **Adding another client layout** = a new renderer file + one entry in
  `DOCUMENT_LAYOUTS` (+ label in the portal `design.ts`) + a case in
  `renderDocumentHtml` / `pdfOptionsFor`.

## 4. Decision taken: the CIEL quotation editor is OFF for WCT

The original brief said "the quotation, follow the CIEL one". CIEL's quotation
is the sectioned interior-design editor (`enableIdQuotation`), which also
replaces the Dashboard and the Projects pages with the ID versions. WCT's paper
quotation is a flat S/No line-item table, so "follow the CIEL one" was read as
"a layout of its own, like CIEL's" and the flag was turned off: WCT uses the
standard editor with the WCT layout. If guru wants the ID editor instead, flip
`enableIdQuotation` in `scripts/setup-wct-org.ts` (`FEATURE_OVERRIDES`) and
re-run with `--apply`; re-runs reconcile the overrides.

## 5. Files

| Commit / file | What |
| --- | --- |
| `3fe65e1d` feat(wct) | `wct.prisma`, `wct.ts` renderer, layout knob, PDF footer, preview-html, ServerDocumentPreview, Design dialog Layout select, editor wiring, Guide knowledge |
| `a9fec1ad` feat(org) | `Organization.email` / `.website`, guard selects, DTO, Company Profile fields, PayNow UEN |
| `api-server-production/scripts/setup-wct-org.ts` | Builds the org: org row, OrgTenant + permission catalogue (tenancy), UI config / flags, modules, roles, accounting, number formats, default templates, work sections, superadmins. `--env dev\|staging\|prod`, dry run by default, `--apply` to write. Idempotent. |
| `api-server-production/scripts/setup-wct-templates.ts` | Letterhead profile, Doc Defaults (T&Cs), the three templates (columns, formFields, layout knob). Same flags. Idempotent, touches only WCT-owned rows. |
| `api-server-production/scripts/_wct-preview.ts`, `_wct-pdf.ts` | One-off: render the Yoshinoya sample through the real renderer / Puppeteer for eyeballing. Not needed in prod. |
| `api-server-production/scripts/tenancy-push.ts` | Restored (was only on the dev PC): pushes `platform` + every `org_<name>` tenancy schema on DEV via the direct Neon host; `tenancy-push.ts wct osiris` for a subset, `--dry` to plan. Used to push `Delivery.sourceQuotationId` to `org_wct` / `org_osiris` / `org_biofuel`; the dev PUBLIC schema push failed (P4002) and may still be pending. |
| `api-server-production/scripts/setup-wct-services.ts` | Round 3: the 14 standard services (RevenueItem) tied to SS001. Same flags. Idempotent, touches only WCT's rows. |
| `portal-production/containers/DocumentTemplates/components/RevenueItemPickerDialog.tsx` + `TabbedDocumentCreator.tsx` | Round 3: multi-select "Add Service" picker (`onSelectMany`), `data-tour="editor-add-service"`. |

## 6. Verified / not verified

Verified on dev:

- Org builds and re-runs cleanly; tenancy smoke test passes for WCT.
- Nav shows exactly the eight requested tabs (checked in Chrome as
  admin@osiris.sg viewing as WCT, before the layout work).
- All three documents rendered through the real server renderer and through
  the real Puppeteer path: quotation and invoice produce **3 pages matching the
  paper** (repeated letterhead, totals, T&Cs, signature block, footer line,
  Page n/N). Line items no longer split across pages.
- API compiles and starts with the changes (watch-mode restart confirmed).

**Not yet verified in Chrome** (the browser session was signed out when the
pass was due; nobody has repeated it since). Round 3 (services master +
multi-select picker) was type-checked only — no browser pass, no end-to-end
flow video yet (see §7):

1. Editor: Sales → Quotation → New (WCT template) → Preview shows the iframe;
   edits re-render; **Print** prints the iframe; **Generate PDF** opens the
   WCT PDF.
2. Admin → WCT → Document Types → Manage Templates → Design: the **Layout**
   select shows "WCT (S) Systems", the sample on the right renders, Save works.
3. Company Profile → General shows Email / Website, Bank shows PayNow UEN, and
   Save round-trips them.
4. Dark mode on the Design dialog select and the preview backdrop.
5. Delivery Order created from a Delivery (field-app flow) with the WCT
   template: the proof-of-delivery photo section of the stock DO sheet is NOT
   part of the WCT layout.

### Service report (round 5, 2026-10-27) — the LAST step of the flow

Guru's flow: **Quotation → DO → service done → invoice → service report.** The
report is the client's paper (report #012392, Da Paolo Gastronomia, 12 pages),
reproduced as the `WCT_V1` service-report template:

- **Template** (`portal-production/lib/msr-templates.ts`, mirrored in
  `api-server-production/src/maintenance-reports/msr-templates.ts` — keep the
  two in sync): the "Type of Service/Job" tick table (Chemical Degreasing ·
  De-Dusting Work · Additions and Alterations Work), the photo sections
  (Unit Location, one Before/After page per equipment with its ✓ work lines,
  Area Cleaning), the cover letter, contacts, Mission/Vision/Drive, signatory
  (Isadora Eng), the SCDF/NEA advisory, the frequency table and the EN+ZH
  closing lines. Paper wording is verbatim; the de-dusting / additions lines
  (no paper sample) are marked `draftedLines` for WCT to correct.
- **Renderer** `src/maintenance-reports/service-report-wct.ts` — the only
  drawing of the paper: letterhead (logo, red company block, UEN) repeated on
  every page via an outer-table `<thead>`, "#012392"-style number, dashed
  Company/Location box, red tick stamps, Before/After grids, Puppeteer footer
  with TEL / WEBSITE / EMAIL / ADDRESS and "Page n of N". The office page
  (`WctReportView`, iframe of `GET /maintenance-reports/:id/html`), the field
  app's Print / Download PDF, the customer's PDF (`GET …/:id/pdf`, the email,
  the sign-link PDF) all show this HTML.
- **Capture** — field app, `/scan/delivery/[id]/service-report`, reached from
  the "Delivery completed" screen's **Write Service Report** button (runs with a
  Service-class line): step 1 Company / Location / Date (from the run) + job
  types; step 2 Before/After photos per section the ticks call for (Unit
  Location seeded from the line's DO_START photo; un-tick a line not done);
  step 3 remarks + optional customer email → one `POST /maintenance-reports`
  with no `assetId` (now optional for a SERVICE report on a run), `deliveryId`
  + `deliveryItemId`, `serviceData.templateId = WCT_V1`. The server fills
  customer / site / customer email from the run, links `invoiceDocumentId` to
  the invoice created off the run's DO, numbers it and — since the paper has
  no customer signature — creates it **completed** and emails it at once.
- Not done: the e2e harness has no stage for it yet (04-complete drives the
  guest link, not the field app); the paper's SCDF/NEA slide images are
  reproduced as text boxes, not pictures; the bizSAFE/BCA badges print as a
  text line.

## 7. Open items for guru

- **Logo**: not supplied. Upload on Company Profile; the layout prints it at
  the left of the company block (`design.logoPosition` is already `left`).
- **Org legal name**: the letterhead prints `Organization.name`, currently
  `WCT`. Paper says `WCT (S) SYSTEMS PTE LTD`. Rename the org or accept `WCT`.
- **WCT admin user**: none created. Needs a Clerk user + `UserOrganization` +
  `UserRole` (Admin) rows. Osiris superadmins can already log in and view as WCT.
- **Sales Person** on documents is free text (`documentInfo.salesPersonName`),
  not a salesman master record.
- **Invoice Rev** (`documentInfo.revision`) is typed by hand; there is no
  revision counter.
- **Flow video** (guru's ask): record the whole WCT flow once on dev —
  Quotation (customer → Add Service → tick the scope lines + a package → Add →
  Save) → accept (Confirm Quotation, or the customer e-sign link) → the draft
  schedule appears on Deliveries → set date + save → DO → field completion →
  auto invoice → Accounting shows the SS001 credit per line. Needs a signed-in
  browser against a running dev stack (the PC Remote Control session had a
  Playwright harness for this in its scratchpad; it ran out of memory before
  recording). `scripts/setup-wct-services.ts --env dev --apply` must run first.

## 8. Prod / staging rollout (guru runs these with `!`)

Staging and prod are still on the single `public` schema, so there is no
schema-per-org step; the scripts detect the layout themselves.

```bash
cd api-server-production
npm run db:push:prod                                   # email / website columns (and anything else pending on schema.prisma)
npx ts-node --transpile-only scripts/setup-wct-org.ts --env prod             # dry run, read it
npx ts-node --transpile-only scripts/setup-wct-org.ts --env prod --apply
npx ts-node --transpile-only scripts/setup-wct-templates.ts --env prod --apply
npx ts-node --transpile-only scripts/setup-wct-services.ts --env prod             # dry run — expect 14 creates, account SS001
npx ts-node --transpile-only scripts/setup-wct-services.ts --env prod --apply
```

Same with `--env staging` and `npm run db:push:staging` for staging. The org
script copies Biofuel's roles / tax codes from the target env, so Biofuel must
exist there (it does on both).

## 9. Gotchas learned on the way

- A new org schema on dev must be pushed via the **direct** Neon host (not
  `-pooler`), and the three `gin_trgm_ops` indexes (Customer / Document /
  Project name) fail because `pg_trgm` lives in `public`: create them by hand
  with `SET search_path TO org_wct, public`, then re-push with
  `--accept-data-loss` on the empty schema.
- The watch-mode API restarts only on a real content change under `src/`
  (`touch` is not enough) and the tenancy router loads org clients at
  startup, so a new org needs that restart. Cold start takes about 70 s; the
  portal shows "Network error" until then.
- Admin "Viewing as org" is per-tab `sessionStorage`; a fresh Chrome tab shows
  osiris-platform, not WCT.
- Catalog-default modules (ORDERS, DOCUMENTS, INVOICES, USER_MANAGEMENT…)
  must be stored OFF per org or they appear as virtual tabs.
- Importing `setup-wct-org.ts` from another script runs its `main()`; the
  templates script therefore hard-codes the org id.
