// Role-based home screen — the role definitions (guru 2026-11-06, from the
// ui-roles-demo mock-up).
//
// The LAYOUT is the mock-up's; the FUNCTIONS are AIMS's. Every priority row,
// summary card and quick action points at a real AIMS screen or a real create
// flow — nothing here opens a placeholder. The numbers themselves are sample
// data (guru: sample, like the demo) so the screen reads properly on a fresh
// org; swap a `value` for a live query when a card graduates.

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
  change: string;
  /** "down" draws a down arrow; `bad` paints the figure red. */
  dir?: "up" | "down";
  bad?: boolean;
  sub?: string;
  data: number[];
};

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
};

export type RoleDef = {
  id: RoleId;
  title: string;
  summary: { label: string; unit: string; count: number; href: string }[];
  prioritiesTitle?: string;
  prioritiesBadge?: string;
  priorities: Priority[];
  overview: Metric[];
  actionPool: QuickActionId[];
  prompts: string[];
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

// A 14-point sample trend for the sparklines. Deterministic: the same role
// always draws the same line, so screenshots are stable.
const trend = (seed: number) =>
  Array.from({ length: 14 }, (_, i) => 20 + i * 3 + Math.sin(i * seed) * 8 + (i % 3) * seed);

export const QUICK_ACTIONS: Record<QuickActionId, QuickAction> = {
  createInvoice: { label: "Create Invoice", icon: "invoicePlus", createType: "INVOICE" },
  createQuotation: { label: "Create Quotation", icon: "invoice", createType: "QUOTATION" },
  createPO: { label: "Create Purchase Order", icon: "cart", createType: "PO" },
  newSalesOrder: { label: "New Sales Order", icon: "card", createType: "SO" },
  recordPayment: { label: "Record Payment", icon: "wallet", href: R.payments },
  addEmployee: { label: "Add User", icon: "userPlus", href: R.users },
  runPayroll: { label: "Payables", icon: "payroll", href: R.payables },
  approveLeave: { label: "Posting Queue", icon: "check", href: R.postingQueue },
  newDelivery: { label: "New Delivery", icon: "truck", href: R.deliveries },
  stockAdjust: { label: "Stock Adjustment", icon: "box", href: R.inventory },
  newProject: { label: "New Project", icon: "briefcase", href: R.projects },
};

export const ROLES: Record<RoleId, RoleDef> = {
  owner: {
    id: "owner",
    title: "Business Owner",
    summary: [
      { label: "Due today", unit: "items", count: 4, href: R.postingQueue },
      { label: "Pending", unit: "items", count: 7, href: R.receivables },
    ],
    priorities: [
      { icon: "invoice", title: "Approve payments to supplier", area: "Finance", note: "Due today at 5:00 PM", action: "Review", href: R.purchaseJournal, urgent: true },
      { icon: "card", title: "Review customer quotation", area: "Sales", note: "Awaiting approval", action: "Review", href: R.quotations },
      { icon: "box", title: "Review Inventory — Scrap", area: "Operations", note: "Due tomorrow", action: "Review", href: R.inventory },
    ],
    overview: [
      { icon: "coins", label: "Revenue", value: "$124,532", change: "12%", data: trend(1.1) },
      { icon: "cart", label: "Sales Orders", value: "428", change: "8%", data: trend(0.7) },
      { icon: "invoice", label: "Outstanding Invoices", value: "$32,480", change: "6%", data: trend(1.6) },
      { icon: "wallet", label: "Cash Balance", value: "$267,430", change: "3%", data: trend(0.9) },
    ],
    actionPool: ["createInvoice", "addEmployee", "createPO", "newSalesOrder"],
    prompts: ["Show my pending tasks", "Prepare a report", "Check cash flow"],
  },
  hrfin: {
    id: "hrfin",
    title: "HR + Finance Manager",
    summary: [
      { label: "Due today", unit: "items", count: 2, href: R.postingQueue },
      { label: "Pending", unit: "items", count: 8, href: R.payables },
    ],
    priorities: [
      { icon: "payroll", title: "Approve month-end salary payment", area: "HR + Finance", note: "48 staff • $86,210 • Due 5:00 PM", action: "Review", href: R.payables, urgent: true },
      { icon: "people", title: "Review pending leave applications", area: "HR", note: "5 applications awaiting approval", action: "Review", href: R.users },
      { icon: "reconcile", title: "Confirm customer reconciliations", area: "Finance", note: "3 of 7 customers confirmed balance", action: "View", href: R.statements },
    ],
    overview: [
      { icon: "coins", label: "Receivables", value: "$142,300", change: "7%", sub: "Due to collect this month", data: trend(1.1) },
      { icon: "wallet", label: "Expenditure", value: "$128,450", change: "4%", bad: true, sub: "Spent this month", data: trend(0.9) },
      { icon: "alert", label: "Overdue Receivables", value: "$18,920", change: "5%", dir: "down", sub: "Unpaid over 30 days", data: trend(1.7) },
      { icon: "payroll", label: "Payroll Cost", value: "$86,210", change: "2%", bad: true, sub: "67% of expenditure", data: trend(0.6) },
    ],
    actionPool: ["createInvoice", "recordPayment", "runPayroll", "approveLeave"],
    prompts: ["Show unpaid supplier invoices", "Month-end summary", "Who owes us the most?"],
  },
  ops: {
    id: "ops",
    title: "Ops Manager",
    summary: [
      { label: "Jobs today", unit: "jobs", count: 5, href: R.deliveries },
      { label: "Upcoming jobs", unit: "next 5 days", count: 6, href: R.deliveries },
    ],
    prioritiesTitle: "Job issues",
    prioritiesBadge: "open",
    priorities: [
      { icon: "people", title: "Crew shortage — Raffles Place fit-out", area: "Manpower", note: "2 workers short • Starts 9:30 AM", action: "Assign", href: R.deliveries, urgent: true },
      { icon: "box", title: "Material delay — Tampines plumbing parts", area: "Supplier", note: "ETA moved to 2:00 PM", action: "Review", href: R.inventory },
      { icon: "calendar", title: "Customer reschedule request", area: "Customer", note: "Bukit Timah • Wants Thursday", action: "Review", href: R.deliveryOrders },
      { icon: "alert", title: "Equipment fault — Scissor lift SL-04", area: "Equipment", note: "Under maintenance until Friday", action: "View", href: R.serviceReports },
    ],
    overview: [
      { icon: "check", label: "Jobs Completed", value: "86", change: "9%", sub: "Month to date", data: trend(0.7) },
      { icon: "clock", label: "On-time Completion", value: "94%", change: "2%", sub: "Target 95%", data: trend(1.2) },
      { icon: "people", label: "Crew Utilisation", value: "108%", change: "6%", bad: true, sub: "Over 100% = overtime", data: trend(1.8) },
      { icon: "alert", label: "Open Job Issues", value: "4", change: "3", dir: "down", sub: "vs last week", data: trend(0.6) },
    ],
    actionPool: ["newDelivery", "stockAdjust", "createPO", "newProject"],
    prompts: ["Show today's deliveries", "What is low on stock?", "Open service reports"],
  },
};

export const ROLE_ORDER: RoleId[] = ["owner", "hrfin", "ops"];
