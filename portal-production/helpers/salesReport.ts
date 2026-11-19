// Sales report + quotation category (WCT group, 2026-11-18; enableSalesReport / enableQuotationCategory).
// Pure helpers, tested by helpers/salesReport.test.mjs. The server (api-server-production/src/sales-report)
// decides rows, statuses and who sees what; this file only shapes them for the screen and the export.

import type { ReportExportModel } from "@/app/portal/accounting/_lib/report-export";

export const UNCATEGORISED = "Uncategorised";

// Round 35: Expired = an old ERP draft quotation (more than 6 months): its own status, never in the Pending totals.
export type SalesStatus = "Draft" | "Pending" | "Signed" | "Cancelled" | "Expired";

export interface SalesReportRow {
  /** WCT imported quotation still open in the ERP: "ERP draft" / "ERP sent". */
  erpTag?: string | null;
  id: string;
  number: string;
  date: string; // yyyy-mm-dd
  customer: string;
  subject: string;
  category: string;
  amount: number;
  status: SalesStatus;
  templateId: string | null;
}

export interface CategoryTotal {
  category: string;
  signedCount: number;
  signedAmount: number;
  pendingCount: number;
  pendingAmount: number;
}

export interface SalesReportData {
  scope: "all" | "own";
  salesperson: string | null;
  from: string | null;
  to: string | null;
  salespeople: Array<{ key: string; label: string }>;
  rows: SalesReportRow[];
  summary: { byCategory: CategoryTotal[]; total: CategoryTotal };
  truncated?: boolean;
}

/** The editor's Category choices: Uncategorised (blank) first, the org's list, and a stored pick no longer on it. */
export function categoryChoices(list: string[], current?: string | null): Array<{ value: string; label: string }> {
  const out = [{ value: "", label: UNCATEGORISED }, ...list.map((c) => ({ value: c, label: c }))];
  const cur = typeof current === "string" ? current.trim() : "";
  if (cur && !list.some((c) => c === cur)) out.push({ value: cur, label: cur });
  return out;
}

/** The settings list cleaned like the server does: trimmed, no blanks, no repeats (any case). An empty list is fine. */
export function cleanQuotationCategoryList(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const s = String(v ?? "").replace(/\s+/g, " ").trim();
    if (!s || seen.has(s.toLowerCase()) || s.toLowerCase() === UNCATEGORISED.toLowerCase()) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

const money = (n: number) => (Number(n) || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** dd/mm/yyyy from yyyy-mm-dd (the report prints dates the way the paper does). */
export const paperDate = (iso: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export const ROW_HEADERS = ["QO No.", "Date", "Customer", "Subject", "Category", "Amount (excl. GST)", "Status"];
export const SUMMARY_HEADERS = ["Category", "Signed", "Signed amount", "Pending", "Pending amount", "Total amount"];

/** Summary rows (by category + a Total row) for the screen and the export. */
export function summaryRows(data: Pick<SalesReportData, "summary">): string[][] {
  const line = (t: CategoryTotal) => [t.category, String(t.signedCount), money(t.signedAmount), String(t.pendingCount), money(t.pendingAmount), money(t.signedAmount + t.pendingAmount)];
  return [...data.summary.byCategory.map(line), line(data.summary.total)];
}

/** The one model the shared Print / Export button prints, saves as PDF and exports to Excel / CSV. */
export function salesReportModel(data: SalesReportData, opts: { orgName: string; salespersonLabel: string }): ReportExportModel {
  const period = data.from || data.to ? `${data.from ? paperDate(data.from) : "Start"} to ${data.to ? paperDate(data.to) : "Today"}` : "All dates";
  const rows = data.rows.map((r) => [r.number, paperDate(r.date), r.customer, r.subject, r.category, money(r.amount), r.status]);
  const listed = data.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const summary = summaryRows(data);
  return {
    title: "SALES REPORT",
    orgName: opts.orgName,
    metaLines: [`Salesperson : ${opts.salespersonLabel}`, `Quotation date : ${period}`],
    tables: [
      { heading: "Summary by category", headers: SUMMARY_HEADERS, rows: summary, boldRows: [summary.length - 1] },
      { heading: "Quotations", headers: ROW_HEADERS, rows: [...rows, ["TOTAL", "", "", "", "", money(listed), ""]], boldRows: [rows.length] },
    ],
  };
}
