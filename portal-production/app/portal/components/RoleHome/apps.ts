// The app launcher's apps (the mock-up's data/apps.js), each mapped onto REAL
// AIMS screens. An "app" is a way of grouping the menu, not a new module: its
// `functions` are existing pages, and `module` names the AIMS module that must
// be on (and allowed for the user) for the tile to show at all.
//
// When the current page belongs to an app, the top bar swaps its role menus
// for that app's functions (the mock-up's FeatureButton + AppFunctions).

export type AppId = "accounting" | "finance" | "sales" | "inventory" | "delivery" | "hr" | "ops" | "settings";

export type AppFn = { label: string; href: string };

export type AppDef = {
  id: AppId;
  name: string;
  /** Tile colour (the mock-up's). */
  bg: string;
  /** AIMS module gating the tile; omitted = always shown. */
  module?: string;
  /** Where the tile lands. */
  home: string;
  functions: AppFn[];
};

export const APPS: Record<AppId, AppDef> = {
  accounting: {
    id: "accounting",
    name: "Accounting",
    bg: "#2B2257",
    module: "ACCOUNTING",
    home: "/portal/accounting",
    functions: [
      { label: "General Ledger", href: "/portal/accounting/ledger" },
      { label: "Trial Balance", href: "/portal/accounting/trial-balance" },
      { label: "Profit & Loss", href: "/portal/accounting/profit-loss" },
      { label: "Bank Reconciliation", href: "/portal/accounting/bank-reconciliation" },
      { label: "GST", href: "/portal/accounting/gst" },
      { label: "Posting Queue", href: "/portal/accounting/posting-queue" },
    ],
  },
  finance: {
    id: "finance",
    name: "Finance",
    bg: "#1BA39C",
    module: "ACCOUNTING",
    home: "/portal/accounting/receivables",
    functions: [
      { label: "Receivables", href: "/portal/accounting/receivables" },
      { label: "Payables", href: "/portal/accounting/payables" },
      { label: "Purchase Journal", href: "/portal/accounting/payables/purchase-journal" },
      // The OR and PV listings are reports inside the AR/AP sections, not
      // pages of their own: /portal/accounting/receipts has no index (only
      // [documentId]), so a plain path here was a 404.
      { label: "Receipts", href: "/portal/accounting/receivables?tab=receipt-listing" },
      { label: "Payment Vouchers", href: "/portal/accounting/payables?tab=pv-listing" },
      { label: "Budgets", href: "/portal/accounting/budget" },
    ],
  },
  sales: {
    id: "sales",
    name: "Sales",
    bg: "#F59E0B",
    module: "SALES",
    home: "/portal/sales/quotations",
    functions: [
      { label: "Quotations", href: "/portal/sales/quotations" },
      { label: "Sales Orders", href: "/portal/sales/sales-orders" },
      { label: "Invoices", href: "/portal/sales/invoices" },
      { label: "Credit Notes", href: "/portal/sales/credit-notes" },
      { label: "Debit Notes", href: "/portal/sales/debit-notes" },
      { label: "Customers", href: "/portal/customers" },
    ],
  },
  inventory: {
    id: "inventory",
    name: "Inventory",
    bg: "#178F8A",
    module: "INVENTORY",
    home: "/portal/inventory",
    functions: [
      { label: "Stock Levels", href: "/portal/inventory" },
      { label: "Purchases", href: "/portal/inventory/purchases" },
      { label: "Purchase Returns", href: "/portal/inventory/purchases-return" },
      { label: "Adjustment In", href: "/portal/inventory/adjustment-in" },
      { label: "Adjustment Out", href: "/portal/inventory/adjustment-out" },
      { label: "Stock Card", href: "/portal/inventory/stock-card" },
    ],
  },
  delivery: {
    id: "delivery",
    name: "Delivery",
    bg: "#4B3F8F",
    module: "DELIVERIES",
    home: "/portal/deliveries",
    functions: [
      { label: "Deliveries", href: "/portal/deliveries" },
      { label: "Delivery Orders", href: "/portal/sales/delivery-orders" },
      { label: "Return Delivery Orders", href: "/portal/sales/return-delivery-orders" },
    ],
  },
  hr: {
    id: "hr",
    name: "HR",
    bg: "#E5293F",
    module: "USER_MANAGEMENT",
    home: "/portal/user-management/users",
    functions: [{ label: "Employees", href: "/portal/user-management/users" }],
  },
  ops: {
    id: "ops",
    name: "Ops",
    bg: "#0E7490",
    module: "PROJECTS",
    home: "/portal/projects",
    functions: [
      { label: "Projects", href: "/portal/projects" },
      { label: "Service Reports", href: "/portal/maintenance-reports" },
      { label: "Suppliers", href: "/portal/suppliers" },
    ],
  },
  settings: {
    id: "settings",
    name: "Settings",
    bg: "#64748B",
    home: "/portal/settings/company-profile",
    functions: [
      { label: "Company Profile", href: "/portal/settings/company-profile" },
      { label: "Accounting Setup", href: "/portal/settings/accounting-setup" },
      { label: "Master Files", href: "/portal/masterfiles" },
      { label: "Users & Roles", href: "/portal/user-management/users" },
    ],
  },
};

export const APP_ORDER: AppId[] = ["accounting", "finance", "sales", "inventory", "delivery", "hr", "ops", "settings"];

/** An href's path, without the query string a deep-linked report carries. */
const pathOf = (href: string) => href.split("?")[0];

/**
 * Which app does this page belong to? The longest matching function path
 * wins, so /portal/accounting/receivables is Finance while
 * /portal/accounting/ledger is Accounting, even though both sit under
 * /portal/accounting. `prefer` breaks ties for pages two apps share (the
 * app the user actually opened).
 */
export function appForPath(pathname: string, prefer?: AppId | null): AppDef | null {
  let best: { app: AppDef; len: number } | null = null;
  for (const id of APP_ORDER) {
    const app = APPS[id];
    for (const p of [app.home, ...app.functions.map((f) => pathOf(f.href))]) {
      if (pathname === p || pathname.startsWith(p + "/")) {
        const better = !best || p.length > best.len || (p.length === best.len && id === prefer);
        if (better) best = { app, len: p.length };
      }
    }
  }
  return best?.app ?? null;
}

/** Is this function the current page? Exact for an app's root, prefix otherwise. */
export function isFnActive(fn: AppFn, pathname: string, all: AppFn[]): boolean {
  const href = pathOf(fn.href);
  if (pathname === href) return true;
  if (!pathname.startsWith(href + "/")) return false;
  // A longer sibling owns the page (e.g. Purchase Journal under Payables).
  return !all.some((o) => {
    const h = pathOf(o.href);
    return o !== fn && h.length > href.length && (pathname === h || pathname.startsWith(h + "/"));
  });
}
