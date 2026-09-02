# CIEL INTERIOR on AIMS — handbook

Client: **CIEL INTERIOR PTE. LTD.** (UEN 202312049Z), interior-design firm, Singapore, not GST-registered.
Engagement: SOW signed scope — setup S$2,800 (50% on acceptance, 50% on completion), optional extra month S$1,500, then S$100/mo subscription (first 2 months S$50). Term started 31 Aug 2026.
Fine-grained item tracker: `CIEL_CUSTOMISATION_STATUS.md` (same folder). Requirements source: Pocket AI recordings of the 23 & 30 Aug meetings + their sample files (quotation Excel, costing summary, project schedule, lead emails).

---

## 1. The org, per environment

One Clerk instance serves all three environments, so **user ids are identical everywhere**; the org ids differ:

| Env | DB | CIEL org id | Portal |
|---|---|---|---|
| dev | `.env` | `5a12a9f9-f139-44e8-ab68-dd63f1c23ae3` | localhost:3001 (API :4040) |
| staging | `.env.staging` | `25134abf-206f-4136-99e1-6d2e38af9bd9` | aims-mocha.vercel.app |
| prod | `.env.production` | `09e55c23-e031-4254-8152-a373597b2cb3` | app.ai-ms.io |

**Modules ON**: Dashboard · Sales (Leads, Quotation, Invoice, Credit Note, Debit Note) · Projects · Customers (under Master Files) · Accounting · User Management · Audit · Admin. Everything rental-shaped is OFF (Inventory, Orders, Documents-legacy, Invoices-legacy, Assets, CRM, Deliveries, Customer Information).

**Feature flags ON for CIEL**: `enableIdQuotation` (the master switch for the whole ID experience — quotation editor, projects page, leads, work library), `enableProjects`, `enableQuotationProjectLink`, `enableActionLog`, `enableDocumentAI`.

**Roles**
- `superadmin` — all permissions, all modules (Osiris)
- **Management** — all permissions; nav limited to Dashboard, Sales, Accounting, Projects, Customers (the owners; user/role admin stays with Osiris)
- **Designer** — documents/projects/customers/uploads/extraction + read-only suppliers/accounting/users; sidebar limited to Dashboard/Sales/Customers/Projects

**Users** (Clerk, shared across envs)
- Mike Leong — mikeleong@cielinterior.com, `user_3Ig3ow7wiP4z68jMxwxDnHvHe1Q`, WhatsApp 6582289608
- Levi Choo — levichoo@cielinterior.com, `user_3Ig3p4zVnct5wVHhGM4hIY8B9gY`, WhatsApp 6583686614
- Both hold Management **and** Designer on CIEL (so they appear in designer dropdowns).
- Org-scoped extras (WhatsApp number, default commission %) live in `OrganizationMemberProfile`, edited in User Management → Edit User.

**Numbering**: quotations `CI{YY}-{###}` (their contract series, e.g. CI26-003); invoices `CIEL-INV-{YYYY}-{####}`; CN/DN/RCP/PV similar. ⚠ Serial starts at 001 — set the real next number in Accounting Setup → Document Number Formats.

**Accounting**: SGD, tax off (no GST), default 26-account SG chart, revenue posts to SS001.

---

## 2. How everything works (the business flow)

```
EZiD email ─┐                                                   WhatsApp agent (planned)
Network PDF ─┼→ docs+{orgId}@inbound.osiris.sg → LEAD ──┐            │ supplier invoice photo
manual entry ┘                                          ▼            ▼
                       Unqualified → Engaging → Converted ──→ QUOTATION (ID editor)
                                        │ Dead (proof req'd)        │ e-sign link /sign/<token>
                                        ▼                           ▼ client signs (or manual Confirm)
                                  replacement claim         PROJECT auto-created
                                                     ┌──────────┼──────────┬─────────────┐
                                                 Costing    Payments   Schedule      Contract & P&L
                                              (supplier    (10/40/45/5, (35-step     (profit, margin,
                                               invoices,    generate     calendar,    50% commission)
                                               AI-extract)  invoices)    client link)
```

### 2.1 Leads (Sales → Leads)
- **EZiD**: plain-text email from `leads@ezid.sg` → fields parsed deterministically (name, verified phone, property, budget, remarks).
- **Network Singapore**: "Lead Programme" PDF (forwarded from Mike's mailbox) → AI-extracted (name, NSG ref, contacts, budget, areas, design style, concierge approach notes, floor-plan link); PDF stored. **24-hour first-contact deadline** and **14-day replacement window** computed from the distribution date; the received column shows an amber/red chip.
- Both arrive via the org's ingest address (`docs+{orgId}@inbound.osiris.sg`); a sender/subject heuristic diverts lead mail *before* the AR/AP classifier. Sender allow-list: `@ezid.sg`, `@cielinterior.com`.
- **Status flow (the owners' rule)**: `Unqualified` → `Engaging` (set automatically when a designer is assigned) → then either `Dead` (**mandatory proof upload** — a screenshot showing the client never replied, stored as replacement-claim evidence) or `Converted` (**auto-creates the quotation** pre-filled with the lead's details and links it).
- Stat chips: totals, unqualified, engaging, converted %, dead, per-designer converted/taken ratios. Per row: wa.me link, details drawer, delete. New leads ring the office bell.

### 2.2 Quotation (Sales → Quotation, the ID editor)
- Structure mirrors their contract: **lettered trade sections (A Hacking … J Miscellaneous) → rooms/areas → numbered lines with "* Includes" bullets**; pricing modes Priced / Inclusive / Complimentary; qty in their units (sqft/ft/nos/trip).
- **Work Library** (Master Files → Work Library): 53 templatised lines imported from their Excel with codes A01…J11, default includes, uom, unit price/cost. ⌘K in the editor opens the palette; picking fills the line (with `{dims}` placeholders to replace).
- **Internal view** (header switch, never printed): cost per line, **margin on price** = (amount − cost) ÷ amount; keying a cost pre-fills the price at the **25% guideline**; below the **15% floor** → amber + required reason + management bell alert on save.
- Summary: Total → Professional Design Fee 5% (editable) → named discounts → Grand Total. Payment terms A–E and their 15 T&C clauses pre-loaded.
- Preview = the printed **Letter of Intent** exactly (server renderer, same HTML as the PDF).
- **Send for signature** → no-login link `/sign/<token>` (14-day validity, revoke & re-issue, WhatsApp share). Client reads the quote, draws a signature, accepts T&Cs → quotation **confirmed** (locked), signature printed on the PDF, **project auto-created**, milestones seeded, bell rings. Manual **Confirm** (paper-signed) does the same minus the e-signature. Empty quotes can't be sent/signed.

### 2.3 Project (Projects → the live "Costing Summary")
- Header: client/site/NRIC/contact from the signed quote, contract chip, **Stage** (Signed → Design & 3D → Works → Carpentry → Handover → Completed), **Designer** (dropdown of Designer-role users; picking one records the user id for WhatsApp routing and adopts their default commission).
- KPI tiles: Contract · Collected · Balance due · Total costing · Profit on collected · Projected margin at handover.
- **Costing tab** — subcontractor/supplier ledger (their left-hand table). "Add cost / upload invoice": photo/PDF → S3 + AI-extracts supplier, invoice no., date, amount → confirm. Rows can be *Pending* (Approve button) for designer submissions. Below: **actual cost vs quotation provision** per trade section with variance bars.
- **Payments tab** — deposit chooser (**S$1,500 engagement fee OR 10%**, either/or, locked once invoiced), then the 10/40/45/5 schedule seeded from the signed grand total. **Generate invoice** per milestone → formal progress-claim invoice draft (one line, contract ref, due on receipt), linked; paid amount/date/method recorded on the row; Add VO / Add refund / Recalculate; Total Collected vs Balance due.
- **Contract & P&L tab** — initial sum + VOs = contract; collected − costing = profit; margin on collected; **sales commission %** (default 50, per-designer default from their profile) → commission payable; advances placeholder.
- **Schedule tab** — their weekly Mon–Sun client calendar. "Add activities" ticks items from the **35-step standard sequence** (3D Rendering Discussion → … → Furniture Move In) and spreads them across a date range (extends if the range is short); Sundays = workers' off day, SG public holidays flagged; List view for fine-tuning; **Shift** slides everything by N days; **Client link** = live no-login URL (always latest); Print/PDF in their sheet layout.
- **Documents tab** — the quotation + everything linked.

### 2.4 Email ingestion plumbing
Cloudflare Email Routing on `inbound.osiris.sg` → `email-ingest-worker` → `POST /ingestion-email/email` (X-webhook-secret). Org resolved from the `docs+{orgId}@` plus-suffix; per-org `EmailIngestConfig` gate (enabled + allow-list + rules); lead mail → Leads, everything else → AR/AP document drafts (Biofuel behaviour).

---

## 3. Done so far

- **Phase 0** — org bootstrap in all 3 DBs (modules, roles, flags, templates, CoA, numbering); Deliveries promoted to a toggleable module.
- **Phase 1** — Work Library (10 sections, 53 items, all 3 DBs) + the full ID quotation editor (sections/areas/includes grid, ⌘K palette, internal margin guardrails + management alert, Letter-of-Intent preview/PDF, T&Cs).
- **E-sign** — token link, public sign page, signature on PDF, auto-project, office notification.
- **Projects** — list + the costing-summary page: costing ledger with AI invoice extraction and provision tally, 10/40/45/5 payments with deposit either/or and per-milestone invoice generation, Contract & P&L with commission, 35-step schedule with calendar/print/client link, documents.
- **Leads** — Lead model, EZiD parser + Network PDF extractor, ingestion hook, Sales → Leads page with the Unqualified/Engaging/Dead(+proof)/Converted(+auto-quote) flow; email ingestion enabled (dev+staging) with the lead allow-list. **Verified end-to-end on dev** with both sample emails (Jiaxin, Anna).
- **Users** — Mike, Levi + Summer in Clerk with Management+Designer and WhatsApp numbers (dev+staging; prod pending). All three log in with password `password` (to be changed at onboarding).
- **30 Aug feedback round** — schedule date-spread fix, schedule client link, designer dropdowns (quotation + project, Designer-role holders only), WhatsApp number + default commission on Edit User, Payments-tab tooltips.
- **SOW** delivered; Pocket AI MCP wired for meeting-note extraction.

## 4. Still to do

**Before CIEL goes live (prod)**
1. Push the latest code (leads + fixes are uncommitted); after deploy run on prod via `!`:
   `npm run db:push:prod` → `setup-ciel-org.ts --apply` → `seed-ciel-email-config.ts` → `setup-ciel-users.ts`
2. Company profile: logo, address, phone, bank details + **PayNow QR**
3. Real next quotation serial (currently 001)
4. Supplier price lists → costs for carpentry/painting/plumbing/tabletop/doors library items
5. EZiD forwarding rule / Network PDF forwarding to the prod ingest address
6. A full test pass of everything marked 🟡 in the tracker (built, untested)

**Next build phases**
7. **Payments completion**: CIEL invoice PDF with PayNow QR; receipts auto-filling milestone paid amounts; official receipt (management signature only); WhatsApp invoice send
8. **Variation Orders**: quotation-format VO linked to the parent quote, e-signable, auto-adds to contract + Payments
9. **WhatsApp agent**: designer sends a supplier invoice photo → pending cost on their project (endpoints ready; needs CIEL's WhatsApp connection); "which project?" prompt; site photos
10. **Dashboard** for the ID firm (leads, projects, outstanding milestones, margins) replacing the rental widgets
11. **Commissions module**: cross-project commission ledger, $1k signing comp offset, **advance request + approval** (SOW item), per-designer targets/rewards (spec pending)
12. **Marketing/CAC** (guru handling the requirements); permits/forms library on schedule steps; monthly supplier payment-run view; sign-page UX polish; project number auto-generation
13. Outside AIMS: domain transfer from Hostinger + Google Workspace email

## 5. Useful paths & scripts

| What | Where |
|---|---|
| Org bootstrap (idempotent, per env) | `api-server-production/scripts/setup-ciel-org.ts --apply` |
| Work library seed | `scripts/import-ciel-work-library.ts --apply` (+ `ciel-work-library.json`) |
| Email ingest enable | `scripts/seed-ciel-email-config.ts` |
| Users | `scripts/setup-ciel-users.ts` |
| Deliveries role rollout | `scripts/promote-deliveries-module.ts --apply` |
| Bi-weekly finance backfill (bills+payments+GL) | parse step baked into `scripts/ciel-biweekly-payments.json`; `npx dotenv -e <env> -- npx ts-node scripts/import-ciel-biweekly-finance.ts` (dry) / `--apply` |
| ID quotation editor | `portal-production/app/portal/sales/quotations/id/` |
| ID project page | `portal-production/app/portal/projects/_id/` |
| Leads page | `portal-production/app/portal/sales/leads/page.tsx` |
| Backend: costing/schedule/milestones | `api-server-production/src/project-costing/` |
| Backend: e-sign | `src/public-sign/` · Leads: `src/leads/` |
| Print renderers | `src/common/services/document-html/id-quotation.ts`, `src/project-costing/schedule.ts` |
| Dev docs | `docs-site/guides/id-quotation.mdx` |
