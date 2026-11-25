// Inventory → Reports: the ten legacy Inventory Reports (guru 2026-11-25, from the legacy
// system's "Inventory Report" menu — the names are its names, word for word).
//
// Built like the sales report (helpers/salesReport.ts): the server
// (api-server-production/src/inventory-reports) decides every figure; this file only
// says how each report is prompted for, which columns it prints, and how it exports.
// Pure — no React, no fetch. Tested by helpers/inventoryReports.test.mjs.

import type { ReportExportModel } from "@/app/portal/accounting/_lib/report-export";

export const money = (n: unknown): string =>
  (Number(n) || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A quantity prints as a plain number — 4, not 4.00 — unless it really has decimals. */
export const qty = (n: unknown): string => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toLocaleString("en-SG", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
};

/** dd/mm/yyyy from yyyy-mm-dd — every report date, like the paper (and the rest of AIMS). */
export const paperDate = (iso: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export type ColumnType = "text" | "qty" | "money" | "date" | "blank";
export type FilterKey = "dateRange" | "category" | "supplier" | "product" | "includeZero" | "belowOnly";

export interface ReportColumn {
  key: string;
  label: string;
  type?: ColumnType;
}

export interface ReportSpec {
  slug: string;
  /** The legacy menu's own wording. */
  title: string;
  description: string;
  path: string;
  filters: FilterKey[];
  /**
   * What the date boxes start on. "month" = this month (the usual listing);
   * "all" = empty, for a report about what is still OUTSTANDING rather than
   * about a period — a draft keyed in June is exactly what its reader wants to
   * see in November.
   */
  defaultRange?: "month" | "all";
  columns: ReportColumn[];
  /** Grouped reports arrive nested; this flattens them into printable rows. */
  flatten?: (data: any) => any[];
  /** The TOTAL line under the table, by column key. */
  total?: (data: any, rows: any[]) => Record<string, string | number>;
  /** A note the report prints under its table, where the legacy one explains itself. */
  note?: string;
}

const sum = (rows: any[], key: string) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

/** Supplier / Category groups come back as { group, items, subtotal } — print a row per item, then its subtotal. */
const flattenGroups = (groups: any[], groupKey: string, label: string, subtotalKeys: string[]): any[] => {
  const out: any[] = [];
  for (const g of groups || []) {
    for (const it of g.items || []) out.push({ ...it, [groupKey]: g[groupKey], __kind: "row" });
    const sub: any = { [groupKey]: `${label} total — ${g[groupKey]}`, __kind: "subtotal" };
    for (const k of subtotalKeys) sub[k] = g.subtotal?.[k] ?? 0;
    out.push(sub);
  }
  return out;
};

export const REPORTS: ReportSpec[] = [
  {
    slug: "stock-status",
    title: "Stock Status",
    description: "What is on hand right now, what is still on order, and what it is worth at cost.",
    path: "/inventory-reports/stock-status",
    filters: ["category", "includeZero"],
    columns: [
      { key: "code", label: "Stock Code" },
      { key: "description", label: "Description" },
      { key: "category", label: "Category" },
      { key: "uom", label: "UOM" },
      { key: "onHand", label: "On Hand", type: "qty" },
      { key: "onOrder", label: "On Order", type: "qty" },
      { key: "reserved", label: "Reserved", type: "qty" },
      { key: "available", label: "Available", type: "qty" },
      { key: "unitCost", label: "Unit Cost", type: "money" },
      { key: "value", label: "Stock Value", type: "money" },
    ],
    total: (_d, rows) => ({ code: "TOTAL", onHand: sum(rows, "onHand"), onOrder: sum(rows, "onOrder"), value: sum(rows, "value") }),
    note: "On Hand counts units with status In stock; Available is On Hand less Reserved. Value is at the product's cost price.",
  },
  {
    slug: "unconfirmed-transactions",
    title: "Unconfirn Inventory Transactions",
    description: "Purchases, returns and adjustments still sitting as draft — they have not moved any stock yet.",
    path: "/inventory-reports/unconfirmed-transactions",
    filters: ["dateRange"],
    defaultRange: "all",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "type", label: "Type" },
      { key: "number", label: "Doc No." },
      { key: "supplier", label: "Supplier" },
      { key: "reference", label: "Reference" },
      { key: "quantity", label: "Qty", type: "qty" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "status", label: "Status" },
    ],
    total: (_d, rows) => ({ date: "TOTAL", quantity: sum(rows, "quantity"), amount: sum(rows, "amount") }),
    note: "Nothing here has touched stock: a document moves stock only once it is confirmed.",
  },
  {
    slug: "purchase-order-listing",
    title: "Purchase Order Listing",
    description: "Every purchase order for the period, with what is still outstanding on it.",
    path: "/inventory-reports/purchase-order-listing",
    filters: ["dateRange", "supplier"],
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "number", label: "P/O No." },
      { key: "supplier", label: "Supplier" },
      { key: "reference", label: "Reference" },
      { key: "quantity", label: "Ordered", type: "qty" },
      { key: "outstanding", label: "Outstanding", type: "qty" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "status", label: "Status" },
    ],
    total: (_d, rows) => ({ date: "TOTAL", quantity: sum(rows, "quantity"), outstanding: sum(rows, "outstanding"), amount: sum(rows, "amount") }),
  },
  {
    slug: "purchase-summary-by-supplier",
    title: "Purchase Summary By Supplier",
    description: "One line per supplier: how many orders, how much quantity and how much money.",
    path: "/inventory-reports/purchase-summary-by-supplier",
    filters: ["dateRange"],
    columns: [
      { key: "supplier", label: "Supplier" },
      { key: "orders", label: "Orders", type: "qty" },
      { key: "quantity", label: "Qty", type: "qty" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "last", label: "Last Order", type: "date" },
    ],
    total: (_d, rows) => ({ supplier: "TOTAL", orders: sum(rows, "orders"), quantity: sum(rows, "quantity"), amount: sum(rows, "amount") }),
    note: "Confirmed purchase orders only.",
  },
  {
    slug: "stock-analysis-by-supplier",
    title: "Detailed Stock Analysis By Supplier / Stock",
    description: "What was bought from each supplier, item by item, with a total per supplier.",
    path: "/inventory-reports/stock-analysis-by-supplier",
    filters: ["dateRange"],
    columns: [
      { key: "supplier", label: "Supplier" },
      { key: "code", label: "Stock Code" },
      { key: "description", label: "Description" },
      { key: "uom", label: "UOM" },
      { key: "quantity", label: "Qty", type: "qty" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "last", label: "Last Bought", type: "date" },
    ],
    flatten: (d) => flattenGroups(d?.rows, "supplier", "Supplier", ["quantity", "amount"]),
    total: (d) => ({ supplier: "TOTAL", quantity: d?.totals?.quantity ?? 0, amount: d?.totals?.amount ?? 0 }),
    note: "Purchase returns are netted off what was bought.",
  },
  {
    slug: "stock-analysis-by-category",
    title: "Detailed Stock Analysis By Category",
    description: "Movement in and out per product, grouped by category, with what is left on hand.",
    path: "/inventory-reports/stock-analysis-by-category",
    filters: ["dateRange", "category"],
    columns: [
      { key: "category", label: "Category" },
      { key: "code", label: "Stock Code" },
      { key: "description", label: "Description" },
      { key: "uom", label: "UOM" },
      { key: "qtyIn", label: "Qty In", type: "qty" },
      { key: "qtyOut", label: "Qty Out", type: "qty" },
      { key: "onHand", label: "On Hand", type: "qty" },
      { key: "value", label: "Stock Value", type: "money" },
    ],
    flatten: (d) => flattenGroups(d?.rows, "category", "Category", ["qtyIn", "qtyOut", "onHand", "value"]),
    total: (d) => ({ category: "TOTAL", qtyIn: d?.totals?.qtyIn ?? 0, qtyOut: d?.totals?.qtyOut ?? 0, onHand: d?.totals?.onHand ?? 0, value: d?.totals?.value ?? 0 }),
  },
  {
    slug: "stock-movement",
    title: "Stock Movement Analysis",
    description: "Opening, in, out and closing for the period — pick one product to see every movement behind it.",
    path: "/inventory-reports/stock-movement",
    filters: ["dateRange", "product"],
    columns: [
      { key: "code", label: "Stock Code" },
      { key: "description", label: "Description" },
      { key: "uom", label: "UOM" },
      { key: "opening", label: "Opening", type: "qty" },
      { key: "qtyIn", label: "In", type: "qty" },
      { key: "qtyOut", label: "Out", type: "qty" },
      { key: "closing", label: "Closing", type: "qty" },
      { key: "onHand", label: "On Hand Now", type: "qty" },
    ],
    total: (d) => ({ code: "TOTAL", opening: d?.totals?.opening ?? 0, qtyIn: d?.totals?.qtyIn ?? 0, qtyOut: d?.totals?.qtyOut ?? 0, closing: d?.totals?.closing ?? 0 }),
    note: "Closing is opening plus in less out — the movement position. On Hand Now is what the product card says today; the two differ wherever stock was set by hand.",
  },
  {
    slug: "stock-take-listing",
    title: "Stock Take Listing",
    description: "The count sheet: what the system says is there, with blank columns to write the count into.",
    path: "/inventory-reports/stock-take-listing",
    filters: ["category", "includeZero"],
    columns: [
      { key: "code", label: "Stock Code" },
      { key: "description", label: "Description" },
      { key: "category", label: "Category" },
      { key: "uom", label: "UOM" },
      { key: "systemQty", label: "System Qty", type: "qty" },
      { key: "countedQty", label: "Counted Qty", type: "blank" },
      { key: "variance", label: "Variance", type: "blank" },
    ],
    total: (_d, rows) => ({ code: "TOTAL", systemQty: sum(rows, "systemQty") }),
    note: "Print this, count the shelf, write the count in — then correct any difference with a Stock Adjustment In or Out.",
  },
  {
    slug: "last-buy-price",
    title: "Last Buy Price Report",
    description: "The last price paid for each product, who it was bought from and when.",
    path: "/inventory-reports/last-buy-price",
    filters: ["category"],
    columns: [
      { key: "code", label: "Stock Code" },
      { key: "description", label: "Description" },
      { key: "uom", label: "UOM" },
      { key: "lastDate", label: "Last Bought", type: "date" },
      { key: "lastPo", label: "P/O No." },
      { key: "supplier", label: "Supplier" },
      { key: "lastQty", label: "Qty", type: "qty" },
      { key: "lastPrice", label: "Last Price", type: "money" },
      { key: "costPrice", label: "Cost Price", type: "money" },
      { key: "variance", label: "Variance", type: "money" },
    ],
    note: "Variance is the last price paid against the cost price on the product card — a positive figure means the card is now understating what the item costs.",
  },
  {
    slug: "reorder-level",
    title: "Reorder Level Analysis",
    description: "Products at or below their reorder level, and how many to buy once what is on order is counted.",
    path: "/inventory-reports/reorder-level",
    filters: ["category", "belowOnly"],
    columns: [
      { key: "code", label: "Stock Code" },
      { key: "description", label: "Description" },
      { key: "category", label: "Category" },
      { key: "uom", label: "UOM" },
      { key: "onHand", label: "On Hand", type: "qty" },
      { key: "reserved", label: "Reserved", type: "qty" },
      { key: "available", label: "Available", type: "qty" },
      { key: "reorderLevel", label: "Reorder Level", type: "qty" },
      { key: "onOrder", label: "On Order", type: "qty" },
      { key: "shortfall", label: "To Order", type: "qty" },
    ],
    total: (_d, rows) => ({ code: "TOTAL", onHand: sum(rows, "onHand"), onOrder: sum(rows, "onOrder"), shortfall: sum(rows, "shortfall") }),
    note: "A product only appears here once it has a reorder level set on its product card (Minimum quantity).",
  },
];

export const reportBySlug = (slug: string): ReportSpec | undefined => REPORTS.find((r) => r.slug === slug);

/** The rows a report prints: grouped reports flatten, the rest come as they are. */
export const rowsOf = (spec: ReportSpec, data: any): any[] => (spec.flatten ? spec.flatten(data) : data?.rows || []);

/** One cell, formatted for its column type. */
export const cellText = (col: ReportColumn, row: any): string => {
  const v = row?.[col.key];
  if (col.type === "blank") return "";
  if (v == null || v === "") return col.type === "money" || col.type === "qty" ? "" : "";
  if (col.type === "money") return money(v);
  if (col.type === "qty") return qty(v);
  if (col.type === "date") return paperDate(String(v));
  return String(v);
};

/** The period line the legacy report echoes back above its figures. */
export const periodLine = (from?: string | null, to?: string | null): string =>
  from || to ? `${from ? paperDate(from) : "Start"} to ${to ? paperDate(to) : "Today"}` : "All dates";

/** The one model the shared Print / Export button prints, saves as PDF and exports to Excel / CSV. */
export function inventoryReportModel(
  spec: ReportSpec,
  data: any,
  opts: { orgName: string; metaLines: string[] },
): ReportExportModel {
  const rows = rowsOf(spec, data);
  const body = rows.map((r) => spec.columns.map((c) => cellText(c, r)));
  const boldRows: number[] = [];
  rows.forEach((r, i) => { if (r.__kind === "subtotal") boldRows.push(i); });
  if (spec.total) {
    const t = spec.total(data, rows);
    body.push(spec.columns.map((c) => (t[c.key] == null ? "" : typeof t[c.key] === "number" ? (c.type === "money" ? money(t[c.key]) : qty(t[c.key])) : String(t[c.key]))));
    boldRows.push(body.length - 1);
  }
  return {
    title: spec.title.toUpperCase(),
    orgName: opts.orgName,
    metaLines: opts.metaLines,
    tables: [{ headers: spec.columns.map((c) => c.label), rows: body, boldRows }],
    note: spec.note,
    // Anything past eight columns reads better across the page.
    landscape: spec.columns.length > 8,
  };
}
