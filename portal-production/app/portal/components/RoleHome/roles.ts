// Role-based home screen — the role definitions (guru 2026-11-06, from the
// ui-roles-demo mock-up).
//
// The LAYOUT is the mock-up's; the FUNCTIONS and the FIGURES are AIMS's.
// Every priority row, summary card and quick action points at a real AIMS
// screen or a real create flow, and every number is cut from the org's own
// snapshot (GET /dashboard/role-home — guru 2026-11-12: "make sure all the
// data is correct and not sample data"). A role's `cut()` turns the snapshot
// into its cards; with no snapshot yet the cards show dashes.

export type RoleId = "owner" | "hrfin" | "ops";

export type IconKey =
  | "invoice" | "card" | "box" | "people" | "payroll" | "reconcile" | "calendar"
  | "alert" | "coins" | "cart" | "wallet" | "check" | "clock" | "truck"
  | "briefcase" | "userPlus" | "invoicePlus";

export type Priority = {
  icon: IconKey;
  title: string;
  area: string;
  note: string;
  action: string;
  /** Real AIMS screen this row opens. */
  href: string;
  urgent?: boolean;
};

export type Metric = {
  icon: IconKey;
  label: string;
  value: string;
  /** Change against the previous period; absent when there is nothing to compare with. */
  change?: string;
  /** "down" draws a down arrow; `bad` paints the figure red. */
  dir?: "up" | "down";
  bad?: boolean;
  sub?: string;
  /** Trend line for the period; absent for a figure that has no history. */
  data?: number[];
};

export type Summary = { label: string; unit: string; count: number | null; href: string };

export type QuickActionId =
  | "createInvoice" | "createQuotation" | "createPO" | "newSalesOrder"
  | "recordPayment" | "addEmployee" | "runPayroll" | "approveLeave"
  | "newDelivery" | "stockAdjust" | "newProject";

export type QuickAction = {
  label: string;
  icon: IconKey;
  /** A document type to CREATE through the normal create flow… */
  createType?: string;
  /** …or a screen to open. */
  href?: string;
  /** The module that owns the screen: the tile is hidden when the org has it off. */
  module?: string;
};

/** What GET /dashboard/role-home returns (api-server: dashboard/role-home.service.ts). */
export type Snapshot = {
  today: string;
  days: number;
  currency: string;
  receivables: Side;
  payables: Side;
  revenue: Flow;
  expenditure: Flow;
  cash: { balance: number; atStart: number; series: number[] };
  invoicesIssued: Flow;
  receipts: Flow;
  pending: { unconfirmedDocuments: number; draftJournals: number; quotationsAwaiting: number; deliveryOrdersPending: number };
  stock: { low: number };
  deliveries: { today: number; upcoming5d: number; open: number; completed: number; completedPrevious: number; onTimePct: number | null } | null;
};
type Side = { openCount: number; outstanding: number; overdue: number; overdueCount: number; dueToday: number; dueTodayCount: number };
type Flow = { current: number; previous: number; series: number[] };

export type RoleCut = { summary: Summary[]; priorities: Priority[]; overview: Metric[] };

export type RoleDef = {
  id: RoleId;
  title: string;
  prioritiesTitle?: string;
  prioritiesBadge?: string;
  actionPool: QuickActionId[];
  /** Suggested AIMEE prompts; a module-bound one falls back when the org has that module off. */
  prompts: Array<string | { text: string; module: string; fallback: string }>;
  /** The role's cards from the org's snapshot (null = still loading). */
  cut: (s: Snapshot | null) => RoleCut;
};

// Real AIMS routes (routes.ts covers the older ones; accounting pages are
// plain paths).
const R = {
  invoices: "/portal/sales/invoices",
  quotations: "/portal/sales/quotations",
  salesOrders: "/portal/sales/sales-orders",
  deliveryOrders: "/portal/sales/delivery-orders",
  purchaseJournal: "/portal/accounting/payables/purchase-journal",
  payables: "/portal/accounting/payables",
  receivables: "/portal/accounting/receivables",
  ledger: "/portal/accounting/ledger",
  payments: "/portal/payments",
  postingQueue: "/portal/accounting/posting-queue",
  statements: "/portal/reports/statement-of-account",
  inventory: "/portal/inventory",
  deliveries: "/portal/deliveries",
  projects: "/portal/projects",
  customers: "/portal/customers",
  suppliers: "/portal/suppliers",
  users: "/portal/user-management/users",
  serviceReports: "/portal/maintenance-reports",
};

export const QUICK_ACTIONS: Record<QuickActionId, QuickAction> = {
  createInvoice: { label: "Create Invoice", icon: "invoicePlus", createType: "INVOICE" },
  createQuotation: { label: "Create Quotation", icon: "invoice", createType: "QUOTATION" },
  createPO: { label: "Create Purchase Order", icon: "cart", createType: "PO" },
  newSalesOrder: { label: "New Sales Order", icon: "card", createType: "SO" },
  recordPayment: { label: "Record Payment", icon: "wallet", href: R.payments },
  addEmployee: { label: "Add User", icon: "userPlus", href: R.users },
  runPayroll: { label: "Payables", icon: "payroll", href: R.payables },
  approveLeave: { label: "Posting Queue", icon: "check", href: R.postingQueue },
  newDelivery: { label: "New Delivery", icon: "truck", href: R.deliveries, module: "DELIVERIES" },
  stockAdjust: { label: "Stock Adjustment", icon: "box", href: R.inventory, module: "INVENTORY" },
  newProject: { label: "New Project", icon: "briefcase", href: R.projects, module: "PROJECTS" },
};

// ── Formatting ────────────────────────────────────────────────────────────
const DASH = "—";
const moneyFmt = (currency: string) => {
  try {
    return new Intl.NumberFormat("en-SG", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 });
  } catch {
    return new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 });
  }
};
const money = (n: number, currency: string) => moneyFmt(currency).format(Math.round(n));
const count = (n: number) => n.toLocaleString("en-SG");
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
/** % change against the previous period; nothing to say when there was no previous figure. */
const delta = (cur: number, prev: number): Pick<Metric, "change" | "dir"> => {
  if (!prev) return {};
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (!pct) return {}; // unchanged: no arrow to draw
  return { change: `${Math.abs(pct)}%`, dir: pct < 0 ? "down" : "up" };
};
const empty = (summary: Summary[], overview: Metric[]): RoleCut => ({ summary, priorities: [], overview });

// Candidate priority rows, in the order each role wants them; only the ones
// with something behind them are shown, at most four.
type Cand = Priority | null;
const take = (rows: Cand[], n = 4): Priority[] => rows.filter((r): r is Priority => !!r).slice(0, n);

const payOverdue = (s: Snapshot): Cand =>
  s.payables.overdueCount
    ? { icon: "invoice", title: `Pay ${plural(s.payables.overdueCount, "overdue supplier bill")}`, area: "Finance", note: `${money(s.payables.overdue, s.currency)} past due`, action: "Review", href: R.payables, urgent: true }
    : null;
const payDueToday = (s: Snapshot): Cand =>
  s.payables.dueTodayCount
    ? { icon: "invoice", title: `${plural(s.payables.dueTodayCount, "supplier bill")} due today`, area: "Finance", note: `${money(s.payables.dueToday, s.currency)} to pay`, action: "Review", href: R.payables, urgent: true }
    : null;
const arOverdue = (s: Snapshot): Cand =>
  s.receivables.overdueCount
    ? { icon: "alert", title: `Chase ${plural(s.receivables.overdueCount, "overdue invoice")}`, area: "Sales", note: `${money(s.receivables.overdue, s.currency)} unpaid past due`, action: "Review", href: R.receivables }
    : null;
const arDueToday = (s: Snapshot): Cand =>
  s.receivables.dueTodayCount
    ? { icon: "coins", title: `${plural(s.receivables.dueTodayCount, "invoice")} due today`, area: "Sales", note: `${money(s.receivables.dueToday, s.currency)} to collect`, action: "View", href: R.receivables }
    : null;
const unconfirmed = (s: Snapshot): Cand =>
  s.pending.unconfirmedDocuments
    ? { icon: "check", title: `Confirm ${plural(s.pending.unconfirmedDocuments, "document")}`, area: "Accounting", note: "Awaiting confirmation", action: "Review", href: R.postingQueue }
    : null;
const quotes = (s: Snapshot): Cand =>
  s.pending.quotationsAwaiting
    ? { icon: "card", title: `Review ${plural(s.pending.quotationsAwaiting, "quotation")}`, area: "Sales", note: "Not yet confirmed", action: "Review", href: R.quotations }
    : null;
const lowStock = (s: Snapshot): Cand =>
  s.stock.low
    ? { icon: "box", title: `Reorder ${plural(s.stock.low, "product")}`, area: "Operations", note: "At or below minimum stock", action: "Review", href: R.inventory }
    : null;
const drafts = (s: Snapshot): Cand =>
  s.pending.draftJournals
    ? { icon: "reconcile", title: `Post ${plural(s.pending.draftJournals, "draft journal")}`, area: "Accounting", note: "Not yet posted to the ledger", action: "Review", href: R.ledger }
    : null;
const doPending = (s: Snapshot): Cand =>
  s.pending.deliveryOrdersPending
    ? { icon: "truck", title: `Deliver ${plural(s.pending.deliveryOrdersPending, "delivery order")}`, area: "Operations", note: "Confirmed, not yet delivered", action: "Review", href: R.deliveryOrders }
    : null;
const jobsToday = (s: Snapshot): Cand =>
  s.deliveries?.today
    ? { icon: "calendar", title: `${plural(s.deliveries.today, "job")} scheduled today`, area: "Deliveries", note: `${plural(s.deliveries.open, "job")} open in all`, action: "View", href: R.deliveries, urgent: true }
    : null;
const jobsOpen = (s: Snapshot): Cand =>
  s.deliveries?.open
    ? { icon: "truck", title: `${plural(s.deliveries.open, "job")} in progress`, area: "Deliveries", note: `${plural(s.deliveries.upcoming5d, "job")} in the next 5 days`, action: "View", href: R.deliveries }
    : null;

// Shared tiles.
const revenueTile = (s: Snapshot): Metric => ({ icon: "coins", label: "Revenue", value: money(s.revenue.current, s.currency), ...delta(s.revenue.current, s.revenue.previous), data: s.revenue.series });
const invoicesTile = (s: Snapshot): Metric => ({ icon: "cart", label: "Invoices issued", value: count(s.invoicesIssued.current), ...delta(s.invoicesIssued.current, s.invoicesIssued.previous), data: s.invoicesIssued.series });
const arTile = (s: Snapshot, label = "Outstanding Invoices"): Metric => ({
  icon: "invoice",
  label,
  value: money(s.receivables.outstanding, s.currency),
  sub: `${plural(s.receivables.openCount, "invoice")} open · ${money(s.receivables.overdue, s.currency)} overdue`,
});
const cashTile = (s: Snapshot): Metric => ({ icon: "wallet", label: "Cash Balance", value: money(s.cash.balance, s.currency), ...delta(s.cash.balance, s.cash.atStart), data: s.cash.series });
const expenditureTile = (s: Snapshot): Metric => ({ icon: "wallet", label: "Expenditure", value: money(s.expenditure.current, s.currency), ...delta(s.expenditure.current, s.expenditure.previous), bad: true, data: s.expenditure.series });
const overdueArTile = (s: Snapshot): Metric => ({ icon: "alert", label: "Overdue Receivables", value: money(s.receivables.overdue, s.currency), bad: s.receivables.overdue > 0, sub: `${plural(s.receivables.overdueCount, "invoice")} past due` });
const apTile = (s: Snapshot): Metric => ({ icon: "payroll", label: "Payables", value: money(s.payables.outstanding, s.currency), bad: s.payables.overdue > 0, sub: `${plural(s.payables.openCount, "bill")} open · ${money(s.payables.overdue, s.currency)} overdue` });
const receiptsTile = (s: Snapshot): Metric => ({ icon: "coins", label: "Money received", value: money(s.receipts.current, s.currency), ...delta(s.receipts.current, s.receipts.previous), data: s.receipts.series });
const lowStockTile = (s: Snapshot): Metric => ({ icon: "box", label: "Low stock", value: count(s.stock.low), bad: s.stock.low > 0, sub: "At or below minimum" });
const doPendingTile = (s: Snapshot): Metric => ({ icon: "truck", label: "Pending delivery", value: count(s.pending.deliveryOrdersPending), sub: "Confirmed delivery orders" });

const loading = (icon: IconKey, label: string): Metric => ({ icon, label, value: DASH });

export const ROLES: Record<RoleId, RoleDef> = {
  owner: {
    id: "owner",
    title: "Business Owner",
    actionPool: ["createInvoice", "addEmployee", "createPO", "newSalesOrder"],
    prompts: ["Show my pending tasks", "Prepare a report", "Check cash flow"],
    cut(s) {
      if (!s)
        return empty([{ label: "Due today", unit: "items", count: null, href: R.receivables }, { label: "Pending", unit: "items", count: null, href: R.postingQueue }], [loading("coins", "Revenue"), loading("cart", "Invoices issued"), loading("invoice", "Outstanding Invoices"), loading("wallet", "Cash Balance")]);
      return {
        summary: [
          // Invoices to collect and bills to pay that fall due today.
          { label: "Due today", unit: "items", count: s.receivables.dueTodayCount + s.payables.dueTodayCount, href: R.receivables },
          // Documents waiting for someone's confirmation.
          { label: "Pending", unit: "items", count: s.pending.unconfirmedDocuments + s.pending.quotationsAwaiting, href: R.postingQueue },
        ],
        priorities: take([payOverdue(s), payDueToday(s), arOverdue(s), unconfirmed(s), quotes(s), lowStock(s), drafts(s), jobsToday(s)]),
        overview: [revenueTile(s), invoicesTile(s), arTile(s), cashTile(s)],
      };
    },
  },
  hrfin: {
    id: "hrfin",
    title: "HR + Finance Manager",
    actionPool: ["createInvoice", "recordPayment", "runPayroll", "approveLeave"],
    prompts: ["Show unpaid supplier invoices", "Month-end summary", "Who owes us the most?"],
    cut(s) {
      if (!s)
        return empty([{ label: "Due today", unit: "bills", count: null, href: R.payables }, { label: "Pending", unit: "documents", count: null, href: R.postingQueue }], [loading("coins", "Receivables"), loading("wallet", "Expenditure"), loading("alert", "Overdue Receivables"), loading("payroll", "Payables")]);
      return {
        summary: [
          { label: "Due today", unit: "bills", count: s.payables.dueTodayCount, href: R.payables },
          { label: "Pending", unit: "documents", count: s.pending.unconfirmedDocuments, href: R.postingQueue },
        ],
        priorities: take([payOverdue(s), payDueToday(s), unconfirmed(s), arOverdue(s), arDueToday(s), drafts(s)]),
        overview: [arTile(s, "Receivables"), expenditureTile(s), overdueArTile(s), apTile(s)],
      };
    },
  },
  ops: {
    id: "ops",
    title: "Ops Manager",
    prioritiesTitle: "Job issues",
    prioritiesBadge: "open",
    actionPool: ["newDelivery", "stockAdjust", "createPO", "newProject"],
    prompts: [{ text: "Show today's deliveries", module: "DELIVERIES", fallback: "Which delivery orders are pending?" }, "What is low on stock?", "Open service reports"],
    cut(s) {
      if (!s)
        return empty([{ label: "Jobs today", unit: "jobs", count: null, href: R.deliveries }, { label: "Upcoming jobs", unit: "next 5 days", count: null, href: R.deliveries }], [loading("check", "Jobs completed"), loading("clock", "On-time completion"), loading("truck", "Open jobs"), loading("box", "Low stock")]);
      const d = s.deliveries;
      if (d) {
        return {
          summary: [
            { label: "Jobs today", unit: "jobs", count: d.today, href: R.deliveries },
            { label: "Upcoming jobs", unit: "next 5 days", count: d.upcoming5d, href: R.deliveries },
          ],
          priorities: take([jobsToday(s), jobsOpen(s), doPending(s), lowStock(s), quotes(s)]),
          overview: [
            { icon: "check", label: "Jobs completed", value: count(d.completed), ...delta(d.completed, d.completedPrevious), sub: "In the period" },
            { icon: "clock", label: "On-time completion", value: d.onTimePct === null ? DASH : `${d.onTimePct}%`, sub: "Closed by the scheduled day" },
            { icon: "truck", label: "Open jobs", value: count(d.open), sub: "Scheduled or in progress" },
            lowStockTile(s),
          ],
        };
      }
      // No delivery runs on this org: the ops view works off documents and stock.
      return {
        summary: [
          { label: "Pending delivery", unit: "delivery orders", count: s.pending.deliveryOrdersPending, href: R.deliveryOrders },
          { label: "Low stock", unit: "products", count: s.stock.low, href: R.inventory },
        ],
        priorities: take([doPending(s), lowStock(s), quotes(s), unconfirmed(s)]),
        overview: [invoicesTile(s), doPendingTile(s), lowStockTile(s), receiptsTile(s)],
      };
    },
  },
};

export const ROLE_ORDER: RoleId[] = ["owner", "hrfin", "ops"];
