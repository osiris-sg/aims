# Accountant Demo — Osiris Technology

Walk-through script for showcasing the AIMS accounting module. The dev DB
has been seeded with a coherent month-and-a-half of Osiris activity.
**Trial Balance ties out: 173,829.50 / 173,829.50 ✓**

> All URLs assume the dev portal at `http://localhost:3000`.
> Sign in as the Osiris admin.

---

## What's been seeded

| Item | Count | Detail |
|---|---|---|
| Chart of Accounts | 32 | Singapore-style SS/CS/EX/IC/CA/CL/FA/PD/SC/RTPL codes |
| Customers | 6 | ABC Trading, XYZ Engineering, Tech Solutions, Marina Bay Cafe, Sunshine Logistics, Premier Retail |
| Suppliers | 6 | Stationery Wholesale, Office Equipment Pro, Power & Tools, Cloud Services, Premium Logistics, Marketing Agency |
| Fixed Assets | 3 | Furniture (straight-line), Van (declining), CNC machine (units-of-production) |
| Sales Invoices | 8 | mix of paid / awaiting / overdue across April–June 2026 |
| Customer Payments | 3 | against the paid invoices |
| Supplier Bills | 5 | DRAFT / PENDING_APPROVAL ($9.2K, over threshold) / POSTED / PAID |
| Cost Centers | 4 | ADMIN / OPS / RND / SALES |
| Budgets | 10 P&L accounts × 12 months | full 2026 |
| Recurring Templates | 2 | Monthly Office Rent ($2.5K), Monthly Insurance Accrual ($400) |
| Bank Statement Import | 1 (8 lines) | CSV-style import, ready to reconcile |
| Opening Balances | 1 JE | $90K assets = $30K liab + $60K equity |
| Manual Adjustment | 1 JE | May depreciation $1,200 |
| Total Posted JEs | ~22 | TB balanced |

---

## Demo flow (suggested 30 min walkthrough)

### 1. Finance Hub (the "AI-native" moment) — 3 min
**URL:** `/portal/accounting`

**Talking points:**
- "Instead of navigating to 8 separate report pages, the Hub aggregates the
  six numbers an accountant looks at first."
- Point out the KPIs: **Revenue MTD 7.7K**, **Net Profit MTD 7.7K**,
  **Cash 66.7K**, **GST Payable 3.9K**, **AR 55.5K**, **AP 35K**.
- **Action Queue** — system spotted a draft JE awaiting review + GST ready
  to file. *"These are flagged automatically, not month-end surprises."*
- **Smart Insights** — *"Revenue MTD 68% lower than last month"* —
  computed by comparing posted activity period over period.
- **Ask bar** — type *"What's my net profit this month?"* → click Ask →
  shows Claude pulling the P&L number with a deep-link to the report.

### 2. Trial Balance — sanity check — 2 min
**URL:** `/portal/accounting/reports?tab=tb`

- Point at the **Balanced ✓** chip top-right.
- Totals: **173,829.50 = 173,829.50** to the cent.
- *"Every single posted journal entry contributes to this. Real-time, not
  end-of-month batched."*

### 3. P&L / Balance Sheet — A4 print-ready — 5 min
**URL:** `/portal/accounting/reports?tab=pl`

**P&L tab:**
- 3-column comparison: **Jun 2026 / May 2026 / Year-to-Date**.
- Sales 48,700 YTD, Expenses 6,700, **Net Profit 42,000 YTD**.
- Click **Print** → A4 PDF ready (browser print dialog).
- *"This isn't a screen mockup — that's the literal A4 sheet the accountant
  signs off on."*

**Balance Sheet tab:**
- **Balanced ✓** chip top-right.
- Assets 147,156.50 = Liab + Equity 147,156.50.
- *"P&L flows into Equity via Net Profit row — single source of truth."*

**Bonus:** Click **Month-End Close** — show the preflight checklist
(draft entries, depreciation will post, etc.). Don't actually run it.

### 4. Cash Flow Statement — 2 min
**URL:** `/portal/accounting/reports?tab=cf`

- Indirect method, auto-derived from posted entries.
- Net income → working capital adjustments → operating cash.
- *"No manual cash flow worksheet — comes from the same source data."*
- ⚠️ Known gap: depreciation non-cash addback shows as $1,200 diff on this
  seed. Real production data wouldn't have this issue at month-end close.

### 5. AR / AP workflows — 5 min
**URL:** `/portal/accounting/reports?tab=ar` (AR workspace)

- **Tabs**: All / Awaiting Payment / Overdue / Paid — with live counts.
- Per-row: **Outstanding** column, **days overdue** chip, **Record Payment** button.
- Click the Payment icon on any unpaid invoice → quick payment dialog.

**URL:** `/portal/accounting/reports?tab=ar-aging` (AR Aging)
- Customer-level aging buckets (Current / 31-60 / 61-90 / 91-120 / 120+).
- XYZ Engineering is in the **31-60 bucket** — flagged red.
- Total Outstanding: $39,458.

**URL:** `/portal/accounting/reports?tab=ap` (Bills workspace)
- **5 bills**, mix of statuses.
- One **PENDING APPROVAL** for $9,265 (over the $5K threshold) — Admin
  clicks ✓ to post.
- *"Bills can come in 4 ways: manual entry, PDF drop (Claude extracts),
  email forwarding, or from a confirmed PO with 3-way match. Pick whichever
  fits the vendor."*

**URL:** `/portal/accounting/reports?tab=ap-aging`
- Supplier aging mirror of AR. Total Owed: $5,068.50.

### 6. GST F5-style report — 2 min
**URL:** `/portal/accounting/reports?tab=gst`

- 4 KPI cards: **Output Tax 693**, Input 0, **Net GST Payable 693**, Total Supplies 7,700.
- Transaction-level breakdown below.
- Collapse the **GST Return Summary** accordion — that's the F5 form layout
  the accountant files.

### 7. Bank Reconciliation — the LLM moment — 4 min
**URL:** `/portal/accounting/bank-reconciliation`

- Select **CA100 — Bank — Main Account** from the dropdown.
- Show the seeded import: **CSV · May 2026 · 8 lines**.
- Click **Re-run match** — 3 lines auto-match (the customer payments).
- 5 lines still PENDING — these are bank charges, interest, etc.
- Click on a row like **"OCBC service charge -25.00"** → **Post as new** →
  click the **Suggest** ✨ button → Claude returns *"Bank Charges (EX210)
  with 95% confidence"* → click **Post + match**.
- *"That's the LLM categorizing in seconds. Could be done across hundreds
  of lines in a single review."*

### 8. Audit Trail — 1 min
**URL:** `/portal/accounting/reports?tab=audit`

- Full chronological log of every journal entry.
- Show the **"Recurring: Monthly Office Rent"** entry at the top — created
  *today* because the recurring template fired on Hub load.
- Filter by **Type=BILL** to show only AP entries.

### 9. Budget vs Actual — 2 min
**URL:** `/portal/accounting/reports?tab=ba`

- **Total Budget 618K / Total Actual 55K / Variance -562K** (we're 5 months in).
- **Top Variances** — system explains in plain English which accounts are
  furthest off plan.
- Click **Edit budgets** → spreadsheet grid → live edit any cell.

### 10. The smart-system extras — 4 min
**Fixed Assets register:** `/portal/accounting/fixed-assets`
- 3 assets, total cost basis $93K.
- 3 depreciation methods — Furniture (SL 60mo), Van (DB 20%/yr), CNC (UoP).
- *"Depreciation auto-posts on Month-End Close, per asset, per method.
  No worksheet."*

**Recurring Journals:** `/portal/accounting/recurring`
- 2 templates. Office Rent **last fired today** — that's the lazy
  hub-load trigger.
- Click ▶ Run-now on Insurance Accrual → DRAFT JE shows up immediately in
  Audit Trail.

**Cost Centers tab in Accounting Setup:** 4 centers (ADMIN/OPS/RND/SALES).
- Tag any GL line — supports "P&L by department" reporting.

**Inventory Cost tab in Accounting Setup:**
- Per-asset cost-price grid. Feeds the Closing Stock auto-fill on the P&L.

### 11. The Smart Close Wizard — 2 min
**URL:** `/portal/accounting` → click **Close Period** Quick Action

- **Step 1**: Configure (Month-End or Year-End).
- **Step 2**: **Preflight** — system runs 6 checks:
  - All confirmed invoices posted ✓
  - No draft entries ✓ (or warns if any)
  - All entries balanced ✓
  - GST status
  - Depreciation will post for 3 assets
- **Step 3**: Confirm — auto-runs depreciation for all FAs, posts the rollover
  if Year-End, locks the period.
- *"Locked period rejects any JE dated on or before — admin has an unlock
  escape hatch."*

---

## Quick wins to highlight as you go

1. **"It's not a spreadsheet replacement — it's a decision engine."**
   The Hub Action Queue + Smart Insights surface what needs attention
   without month-end batching.
2. **"Every report ties out to the GL."** Trial Balance, P&L, BS, Cash Flow,
   GST — all computed from the same posted journal entries.
3. **"AI categorization is one click — and reviewable."** The Bank Rec
   suggest flow is the easiest to demo. Tell them "this works on hundreds
   of transactions."
4. **"Approval thresholds prevent mis-posts."** The $9.2K Office Equipment
   bill in PENDING APPROVAL is the visible proof.
5. **"Closing the books is a wizard, not a checklist on paper."**

---

## Known limitations to mention proactively

- **Cash Flow Statement** has a $1,200 reconciliation diff on this seed —
  depreciation non-cash addback not yet wired (separate bug, not data).
- **Closing Stock** uses current quantities, not as-of-date — fine for
  same-day month-end, would need replay for historical reconstruction.
- **Xero pull** is Phase A (CoA + Contacts only). Invoices / bills /
  payments / journals pull is Phase B.
- **PO → Bill 3-way match button** exists as an API call but no UI button
  on the PO list yet.

---

## If something looks off

- **TB doesn't balance?** Run `npx ts-node scripts/inspect-osiris.ts` —
  reports debit/credit totals from the journal directly.
- **AR Aging is empty?** Run `npx ts-node scripts/seed-customer-balances.ts` —
  populates the `CustomerBalance` table the aging endpoint reads from.
- **GST report empty?** Default date filter is current month —
  expand the From/To dates back to April.
- **Bank rec shows wrong account?** Default is CA004 (Cash In Hand) —
  switch dropdown to **CA100 (Bank — Main Account)**.

---

## To reset the demo

```sh
# Re-run from clean state (wipes everything Osiris):
npx ts-node scripts/wipe-osiris-demo.ts   # would need to write this
npx ts-node scripts/seed-osiris-demo.ts
npx ts-node scripts/seed-customer-balances.ts
```

The seed script is idempotent (skips dupes) so you can also just re-run
it without wiping.
