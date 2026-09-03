# CIEL INTERIOR — status at a glance (2026-09-03)

Condensed from `CIEL_CUSTOMISATION_STATUS.md` (item-level detail lives there).
Legend: ✅ done & tested · 🟡 built, untested · ⬜ not started · 🚫 parked

---

## ✅ Done & tested (guru exercised on dev)

| Area | Items |
|---|---|
| Commercials & setup | SOW, Pocket MCP, CIEL org bootstrap, Deliveries module toggle |
| Quotation | List, editor core, ⌘K work-library palette |
| E-sign | Send-for-signature link, public sign page, sign → confirm → project |
| Projects | Page header, KPI tiles |
| Schedule | Client share link (responsive rewrite, mobile + desktop verified) |
| Finance | Bi-weekly backfill on dev: 177 bills, 132 payments, GL balanced DR=CR $905,747 |
| WhatsApp | W2 invoice-send fix (guru) |

## 🟡 Built — waiting on guru's test pass

| Area | Items |
|---|---|
| Editor | Outline drag-drop, grid headers, internal margin view + mgmt alerts, design fee/discounts, T&Cs, preview/PDF, confirm, no-priced-lines guard, Work Library CRUD page |
| Projects | List, Costing tab (AI invoice upload, approve flow, provisions tally), Payments (10/40/45/5, deposit either/or, milestone invoices), P&L, Documents, Schedule tab, designer dropdown |
| Leads | EZiD + Network auto-capture, status flow w/ dead-proof upload, stat chips |
| Phase 9 (09-01 meeting) | Lead→Project→Quotation rework · create-project w/ source (lead/referral/self) · contract number allocated on confirm (drafts burn no serials) · Variation Orders (editor, their sheet print, Confirm → contract) · Enter-key fix · checkbox selection + lump sum + undo · designer-scoped projects list · designer dashboard (KPIs, target bar, mgmt per-designer table) · yearly sales target (Edit User) · designer counter-signature + saved signature |
| Deploy | Users on dev+staging (prod pending guru's `!`); **ALL CODE UNCOMMITTED — nothing deployed** |

## ⬜ Not started — blocked on input

| Item | Waiting on |
|---|---|
| Company profile: logo, address, bank, PayNow QR (0.6) | CIEL |
| Quotation template restyle + AIMS branding (9.10/9.11) | CIEL sample PDF + transparent/BW logo |
| Work-library costs for carpentry/painting/plumbing/tabletop/doors (1.1) | CIEL price lists |
| Real quotation next-serial (0.5) | guru |
| Sign-page UX polish (2.5) | guru's "wonky" specifics |
| EZiD/Network forwarding → prod ingest address | CIEL Gmail setup |

## ⬜ Not started — buildable now

| Priority | Item |
|---|---|
| **1 (recommended)** | Payments completion: PayNow invoice PDF · receipts auto-filling milestone paid amounts · official receipt (mgmt signature) · invoice lock check (4.1–4.4) |
| 2 | Sales-side books backfill (client invoices/receipts → bank + P&L complete) — needs guru's income records |
| 3 | Commissions & advances: per-designer ledger, $1k signing incentive, advance request + approval (reconciles the EX100 $42.4k already in the GL) |
| 4 | Supplier payment-run view (3.16) · project number auto-gen (3.17) |
| 5 | Lead metrics/CAC (7.4) · marketing dashboards (10.x) · permits library (8.1) · VO e-sign + paid-before-work gate |
| — | Domain/Google Workspace (outside AIMS) |

## 🚫 Parked / guru-owned

- WhatsApp worklist W1–W7 (`CIEL_WHATSAPP_WORKLIST.md`) — guru handles
- Voice-to-quotation (after base is live)
- "Quest" gamification — CIEL still researching what they want
- QuickBooks migration — out of SOW scope

---

## Critical path (in order)

1. **guru**: commit + push all dev work (release-captain flow: build both apps first)
2. **guru** (`!` from `api-server-production/`): prod catch-up
   ```
   npm run db:push:prod
   npx dotenv -e .env.production -- npx ts-node scripts/setup-ciel-org.ts --apply
   npx dotenv -e .env.production -- npx ts-node scripts/seed-ciel-email-config.ts
   npx dotenv -e .env.production -- npx ts-node scripts/setup-ciel-users.ts
   ```
3. **guru**: finance backfill on staging + prod
   ```
   npx dotenv -e .env.staging -- npx ts-node scripts/import-ciel-biweekly-finance.ts --apply
   npx dotenv -e .env.production -- npx ts-node scripts/import-ciel-biweekly-finance.ts --apply
   ```
4. **guru**: test pass of the 🟡 items (suggested order in `CIEL_CUSTOMISATION_STATUS.md`)
5. **Claude**: payments completion (next build)
6. **CIEL**: send logo, sample quotation, price lists, bank/PayNow details, set up email forwarding
