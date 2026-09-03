# CIEL INTERIOR PTE. LTD. — AIMS customisation status

Client: CIEL INTERIOR PTE. LTD. (UEN 202312049Z), interior-design firm.
Source of requirements: Pocket AI recordings of the 23 Aug 2026 meeting with the two owners
("Quoting and payment workflow", "Lead tracking and project automation", "Marketing analytics and CAC",
"Cash flow and rewards"), the SOW (`~/Downloads/AIMS SOW - CIEL INTERIOR (Draft v1).docx`),
and the sample files they sent (quotation template, costing summary, project schedule).

Legend — **✅ Done & tested** (guru has exercised it on dev) · **🟡 Built, not tested** (code on dev, uncommitted, no run-through yet) · **⬜ Not started** · **🚫 Parked / out of scope**

Everything is on the `elroy/dev` working tree, **uncommitted**, dev DB only. Staging/prod need: commit → push → `setup-ciel-org.ts --apply`, `promote-deliveries-module.ts --apply`, `import-ciel-work-library.ts --apply`.

---

## 0. Commercials & setup

| # | Item | Status | Notes |
|---|---|---|---|
| 0.1 | SOW drafted on Osiris template — scope, fees ($2,800 setup 50/50, $1,500 optional extra month, $100/mo subscription, first 2 months $50), 2-month term from 31 Aug 2026, advance-payment feature | ✅ Done | `AIMS SOW - CIEL INTERIOR (Draft v1).docx`, logo in header, no dashes |
| 0.2 | Pocket AI MCP connected + instructions doc for other agents | ✅ Done | `~/Downloads/POCKET_AI_MCP_INSTRUCTIONS.md` |
| 0.3 | CIEL org on dev (modules: Sales/Projects/Customers/Accounting; roles superadmin/Management/Designer; tax off; CoA; numbering) | ✅ Done & tested | `scripts/setup-ciel-org.ts`; guru viewed the org |
| 0.4 | Deliveries promoted to a real module so CIEL can hide it | ✅ Done & tested | catalog + `promote-deliveries-module.ts`; guru saw it disappear |
| 0.5 | Quotation numbering `CI{YY}-{###}` | 🟡 Built | serial starts at 001 — **guru to give the real next number** |
| 0.6 | CIEL company profile: logo, address, phone, bank details, PayNow QR | 🟡 Logo DONE (3 Sep) | Original_Black.png → S3, org.logo set dev+staging (`scripts/set-ciel-logo.ts`, prod via guru's !); appears on quotation/VO/invoice headers. Still needed: address, phone, bank, PayNow QR |
| 0.7 | CIEL users: Mike Leong + Levi Choo — Clerk accounts + Management **and** Designer roles + WhatsApp numbers on member profile | 🟡 dev+staging DONE (31 Aug, `scripts/setup-ciel-users.ts`); prod via guru's `!` | shared Clerk instance → same user ids everywhere |
| 0.8 | Deploy to staging → prod | 🟡 DB DONE on both (2026-08-31): staging org `25134abf-…`, prod org `09e55c23-e031-4254-8152-a373597b2cb3`, schema + 53-item library + deliveries rollout on each; **CODE still uncommitted — portal/API not deployed anywhere** | code push = release-captain flow |

## 1. Quotation (Phase 1)

| # | Item | Status | Notes |
|---|---|---|---|
| 1.1 | Work library: `WorkSection` (A–J trade sections) + `RevenueItem` work fields; 53 items imported from their Excel | ✅ Done | `import-ciel-work-library.ts`; costs missing for carpentry/painting/plumbing/tabletop/doors — **need their price lists** |
| 1.2 | Master Files → Work Library page (sections + items CRUD) | 🟡 Built | |
| 1.3 | ID quotation list (Sales → Quotation) | ✅ Done & tested | guru created quotes from it |
| 1.4 | ID quotation editor: header details, sections → areas → lines, includes, pricing modes, autosave, version conflict | ✅ Done & tested | guru built CI26-001/002 in it |
| 1.5 | ⌘K Work Library palette (fills template, includes, price, cost) | ✅ Done & tested | H01 added from library in screenshot |
| 1.6 | Section outline rail with drag-and-drop reorder | 🟡 Built | arrows replaced by dnd-kit after feedback; not re-checked |
| 1.7 | Aligned table grid with column headers; wide pricing selects | 🟡 Built | done after "all over the place" feedback |
| 1.8 | Internal view: cost, margin on price, 25% guideline auto-price, 15% floor → amber + reason + management bell alert | 🟡 Built | `POST /documents/:id/margin-alert` |
| 1.9 | Summary: Total, Professional Design Fee 5%, named discounts, Grand Total | 🟡 Built | |
| 1.10 | Payment terms A–E + 15 T&C clauses pre-loaded, editable | 🟡 Built | |
| 1.11 | Client-facing Preview = PDF (Letter of Intent layout, logo, contract grid, sections, includes, totals, sign block, T&Cs) | 🟡 Built | `document-html/id-quotation.ts`, `GET /documents/:id/html` |
| 1.12 | Confirm (paper-signed) → locks quote, creates/links project | 🟡 Built | |
| 1.13 | Room/section grouping printed like their sheet | 🟡 Built | |
| 1.14 | Guard: cannot send/sign a quotation with no priced lines | 🟡 Built | added after the empty CI26-002 test |

## 2. E-signature & project link

| # | Item | Status | Notes |
|---|---|---|---|
| 2.1 | Send for signature: token link (14-day validity), Copy, Share on WhatsApp, Revoke & re-issue | ✅ Done & tested | link now absolute (localhost / app.ai-ms.io) |
| 2.2 | Public sign page `/sign/<token>`: quote as PDF, name, signature pad, T&C tick, Sign & accept | ✅ Done & tested | guru signed CI26-002 ("a bit wonky" — UX polish pending) |
| 2.3 | On signing: quote confirmed, signature printed on PDF, project auto-created, milestones seeded, bell notification | ✅ Done & tested (project created) | milestone seeding added after the test — re-test |
| 2.4 | Editor shows "Signed by … · date" + project chip | 🟡 Built | |
| 2.5 | Signature-page UX polish (the "wonky" bits) | ⬜ Not started | need guru's specifics |

## 3. Projects (their Costing Summary, live)

| # | Item | Status | Notes |
|---|---|---|---|
| 3.1 | ID projects list (client/site, contract, designer, stage, contract sum, collected, outstanding, margin, next payment) | 🟡 Built | |
| 3.2 | Project page header: client/site/contact/NRIC, contract chip, signed date, Stage, Designer | ✅ Done & tested | screenshot |
| 3.3 | KPI tiles (Contract, Collected, Balance due, Total costing, Profit, Projected margin) | ✅ Done & tested | screenshot (zeros — empty quote) |
| 3.4 | Full-width frame, stable width across tabs (UI rule saved to memory) | 🟡 Built | after feedback |
| 3.5 | **Costing tab**: cost ledger (date, supplier, description, invoice no, section, status, amount), add/edit/delete | 🟡 Built | |
| 3.6 | Upload supplier invoice → S3 + AI extraction (supplier, invoice no, date, amount) → confirm | 🟡 Built | reuses bills extractor |
| 3.7 | Pending → Approve flow for designer-submitted costs | 🟡 Built | |
| 3.8 | Actual cost vs quotation provision per trade section (variance, usage bar) | 🟡 Built | |
| 3.9 | **Payments tab**: 10/40/45/5 schedule seeded from grand total; paid amount/date/method; VOs; refunds; Total collected / Balance due | 🟡 Built | guru saw the empty state; "Create schedule" prompt added |
| 3.10 | Deposit either/or: $1,500 engagement fee (editable) vs 10% | 🟡 Built | |
| 3.11 | Generate invoice per milestone (progress-claim invoice draft, linked, amount locks) | 🟡 Built | opens in the generic invoice editor |
| 3.12 | **Contract & P&L tab**: initial sum + VOs, collected − costing = profit, margin, commission % (50% default), advances, balance payable | 🟡 Built | |
| 3.13 | **Documents tab** | 🟡 Built | |
| 3.14 | **Schedule tab**: 35-step sequence picker with date ranges (sequential spread), weekly Mon–Sun calendar (Sun off, SG PH flagged), list editor, Shift, Print/PDF in their sheet layout | 🟡 Built | |
| 3.15 | Client share link for the schedule (live, always latest) | ✅ Tested (31 Aug) | `/schedule/<token>` responsive rewrite: mobile agenda rows / desktop 7-col grid, Print/PDF keeps the A4 sheet layout; verified both widths in Chrome |
| 3.15a | Schedule dates bug (default range + compressing spread) | 🟡 Fixed (31 Aug) | default 2-week window; ticking re-spreads live; extends past To date, min 1 day each |
| 3.15b | Payments tab button clarity | 🟡 Fixed (31 Aug) | explanatory tooltips on Recalculate / Add VO / Add refund |
| 3.16 | Monthly supplier payment run view (all approved costs across projects) | ⬜ Not started | from the "1st of the month I pay everyone" walkthrough |
| 3.17 | Project number auto-generation (`PRJ-{YY}-{###}`) | ⬜ Not started | column exists, never populated |
| 3.18 | Designer = dropdown of org users; saves designerUserId; adopts the user's default commission | 🟡 Built (31 Aug) | |

## 4. Payments — remaining Phase 2

| # | Item | Status | Notes |
|---|---|---|---|
| 4.1 | CIEL invoice PDF layout with **PayNow QR** | ⬜ Not started | needs 0.6 |
| 4.2 | Send invoice via WhatsApp | ⬜ Not started | needs CIEL WhatsApp connection |
| 4.3 | Receipt recorded on invoice → auto-fills milestone paid amount/date; official receipt (management signature only) | ⬜ Not started | today paid fields are keyed by hand |
| 4.4 | Invoice lock / CN-DN check for CIEL | ⬜ Not started | mostly exists; verify |

## 5. Variation Orders (Phase 3)

| # | Item | Status | Notes |
|---|---|---|---|
| 5.1 | `VARIATION_ORDER` doc, linked to parent quote, adds to contract sum + Payments tab | 🟡 Built (2 Sep, see 9.4) | additions/removals editor + their sheet print + Confirm→vo milestone; NOT e-signable yet (open question), no "paid before work" gate |

## 6. WhatsApp agent (designer-side)

| # | Item | Status | Notes |
|---|---|---|---|
| 6.1 | Designer sends supplier invoice photo → pending cost on the project | ⬜ Not started | endpoints ready (`/projects/:id/costs/extract`, `/costs`); needs CIEL WhatsApp connection + agent tool |
| 6.2 | Site photos / delivery confirmations captured against the project | ⬜ Not started | |
| 6.3 | User master: WhatsApp number + default commission % on Edit User (OrganizationMemberProfile, `PATCH /users/:id/profile`) | 🟡 Built (31 Aug) | agent lookup by number: `OrganizationMemberProfile.whatsappNumber` indexed |
| 6.4 | Agent asks "which project?" when the designer has several | ⬜ Not started | 30 Aug |
| 6.5 | Hand over `.md` docs for the ID agent + WhatsApp agent | ⬜ Not started | 30 Aug |

## 7. Leads (Phase 5)

| # | Item | Status | Notes |
|---|---|---|---|
| 7.1 | Leads: auto-capture from **EZiD** emails + **Network Singapore** lead-programme PDFs via docs+{org}@ ingestion into Sales → Leads | 🟡 Built (31 Aug) | `Lead` model, `src/leads`, hook in ingestion-email; needs EmailIngestConfig enabled per org |
| 7.1a | Dead/replacement handling: statuses incl. Dead + Replacement requested; Network 24h contact chip + 14-day replacement window shown | 🟡 Built (31 Aug) | |
| 7.1b | Create quotation from a lead | 🟡 Superseded (2 Sep) | convert now creates the PROJECT first (9.1); quotation raised from the project page, pre-filled + lead-tagged |
| 7.2 | WhatsApp notify management → assign designer by reply → designer notified | ⬜ Not started | |
| 7.3 | Status flow per owners' spec: Unqualified → Engaging (on assign) → Dead (mandatory no-reply proof upload, stored for replacement claim) \| Converted (auto-creates + links quotation) | 🟡 Built (31 Aug) | stat chips: unqualified/engaging/converted %/dead + per-designer ratios |
| 7.4 | Metrics: taken/returned/signed %, per-designer conversion ratio, cost per lead ($100), CAC | ⬜ Not started | data-building first, targets/alerts after 1–2 months |
| 7.5 | Signed lead → project (happens via the quotation e-sign flow) | 🟡 Covered | lead → quotation → sign → project |
| 7.6 | ID dashboard replacing rental widgets | 🟡 Built (3 Sep, see 9.13) | |
| 7.7 | 2nd lead platform (starts "next week" per meeting) | ⬜ Not started | |

## 8. Library (Phase 6)

| # | Item | Status | Notes |
|---|---|---|---|
| 8.1 | Permits/forms library (HDB hacking permit etc.) from Google Drive, surfaced per schedule step + chatbot lookup | ⬜ Not started | |

## 9. Commissions & advances (Phase 7)

| # | Item | Status | Notes |
|---|---|---|---|
| 9.1 | Designer as a user; commission ledger across projects (50% of profit, configurable) | ⬜ Not started | per-project commission % + payable already on the P&L tab |
| 9.1a | Commission % per designer (Edit User) + picked up when assigning them to a project | 🟡 Built (31 Aug) | |
| 9.2 | $1,000 signing incentive deducted from final commission | ⬜ Not started | |
| 9.3 | **Advance request + management approval**, offset at handover (SOW item) | ⬜ Not started | "Advanced" line already on P&L |
| 9.4 | Per-designer targets / bonus & rewards rules | 🟡 Targets built (3 Sep, see Phase-9 9.14) | bonus/rewards rules still undefined |

## 10. Marketing (Phase 8)

| # | Item | Status | Notes |
|---|---|---|---|
| 10.1 | Ad spend (FB/IG/TikTok) + agency payments dashboard | ⬜ Not started | |
| 10.2 | Cost per lead, CAC, audience→lead→customer conversion | ⬜ Not started | |
| 10.3 | Website inquiry form → lead tracker; funnel analytics | ⬜ Not started | |
| 10.4 | Research: Meta video watch-time / drop-off analytics | ⬜ Not started | Pocket action item |

## 11. Voice-to-quotation (SOW phase 2)

| # | Item | Status | Notes |
|---|---|---|---|
| 11.1 | Meeting recording → draft quotation from the work library for the designer to verify | 🚫 Parked | after the base is live |

## 12. Outside AIMS

| # | Item | Status | Notes |
|---|---|---|---|
| 12.1 | Domain transfer from Hostinger + Google Workspace email | ⬜ Not started | promised in the marketing recording |

## 12a. Other products noted in recordings (not CIEL)

| # | Item | Status | Notes |
|---|---|---|---|
| X.1 | DO guest-link Download badly formatted on iPhone (Biofuel) | ⬜ | 28 Aug |
| X.2 | "Request to pay" should auto-send but doesn't | ⬜ | 30 Aug |
| X.3 | GST close vs month close (two locks, reopen with reason), statement-upload dedupe / scale / multi-page / contacts-first / currency | ⬜ | 29 Aug — accounting client |

## 13. Parked / out of scope

- QuickBooks accounting migration — out of SOW scope
- Terminology/theme wiring ("Project → Job") — only if asked
- Xero — not applicable to CIEL

---

### Suggested test pass (dev), in order
1. Sales → Quotation → New → add a client + lines via ⌘K → Internal on, key a cost → Preview → Send for signature → sign in incognito
2. Notification bell → project → Payments: choose engagement fee vs 10% → Generate invoice → open it
3. Costing → Add cost with an invoice photo → approve → check the provision tally
4. Schedule → Add activities (tick 6–8, apply a range) → Calendar → Print
5. Master Files → Work Library → edit an item, add a section
6. Projects list

## Phase 9 — 09-01 meeting round (Lead→Project→Quotation rework + editor polish)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 9.1 | Flow rework: Lead → Project → Quotation | 🟡 Built (2 Sep) | lead convert → POST /id-projects (marks lead converted, adopts assigned designer + commission); project page "Create quotation" pre-fills client + links projectId + leadId; sign/confirm lock onto that project; auto-create-on-sign kept as fallback |
| 9.2 | Create-project button with source: lead / referral / self | 🟡 Built (2 Sep) | "New project" on the Projects list (top right); lead picker for open leads; Project.source + Project.leadId columns (dev+staging pushed) |
| 9.3 | Contract number allocation: Draft → Send for signature → signed → Confirm → allocate CI number (drafts stop burning serials) | 🟡 Built (2 Sep) | new ID drafts create with no number (skipNumbering); Confirm button + client-sign both allocate; typed custom numbers still win |
| 9.4 | One main quotation per project; post-signing changes = VOs | 🟡 Built (2 Sep) | VARIATION_ORDER docs (VO editor dialog: additions/removals, Complimentary, consolidation panel, Print in their sheet layout); Confirm VO → vo milestone with net amount; Payments "New VO" replaces bare milestone button |
| 9.5 | Editor: Enter in amount field creates a new line (bug) | 🟡 Built (2 Sep) | Enter now only commits the value |
| 9.6 | Editor: remove "Add line below" (redundant with "Add custom line"); "Add item" inserts in correct sequence | 🟡 Built (2 Sep) | row menu now Delete only; Custom line/library always append at end of area so numbering stays sequential |
| 9.7 | Editor: checkbox row selection for grouped ops (ranges), remove per-row hamburger | 🟡 Built (2 Sep) | checkbox column, shift-click ranges, floating Delete/Lump sum/Clear bar; row hamburger gone |
| 9.8 | Editor: Undo button | 🟡 Built (2 Sep) | 60-step history, header button + ⌘Z outside text fields |
| 9.9 | Lump sum: combine selected lines into one client-facing line, details kept internally | 🟡 Built (2 Sep) | same-area lines only; components stored on the item, chip expands them, Unbundle restores; never printed |
| 9.10 | Quotation template restyle to CIEL's current format + logo (high priority) | ⬜ Blocked | waiting: sample PDF + transparent/BW logo assets |
| 9.11 | AIMS branding for CIEL org per new logo colour scheme | ⬜ Blocked | waiting: logo assets |
| 9.12 | Designer counter-signature after client signs + saved signature on profile | 🟡 Built (3 Sep) | "Sign as designer" in editor header; draw or one-tap saved signature (OrganizationMemberProfile.signatureImage); stamps Prepared-by block on print/PDF |
| 9.13 | Designer dashboard | 🟡 Built (3 Sep) | /id-projects/dashboard + IdDashboard.tsx replaces rental cards for ID orgs; designers self-scoped, mgmt per-designer table; Create project button top right |
| 9.14 | Manager-set yearly sales target per designer | 🟡 Built (3 Sep) | OrganizationMemberProfile.yearlySalesTarget; Edit User field; dashboard target bars |
| 9.15 | Projects list scoped to designer-in-charge (Designer role); Management/admin see all | 🟡 Built (2 Sep) | /id-projects filters designerUserId when caller's only org role is Designer |
| 9.16 | WhatsApp share of sign link "copy issue" / not working | ➡ Moved | → CIEL_WHATSAPP_WORKLIST.md W1 (guru-owned) |
| 9.17 | Invoice send to a company number failed | ✅ Fixed by guru (2 Sep) | tracked in CIEL_WHATSAPP_WORKLIST.md W2 |
| 9.18 | WhatsApp automation: designer follow-up stages | ➡ Moved | → CIEL_WHATSAPP_WORKLIST.md W3 (guru-owned) |
| 9.19 | Voice-to-quotation / voice-to-invoice via WhatsApp | ➡ Moved | → CIEL_WHATSAPP_WORKLIST.md W4 (guru-owned) |
| 9.20 | "Quest" gamification system | ⬜ Parked | CIEL gathering info |
