// Document list bulk "Export CSV" / "Print list" (WCT group Invoices list, enableWctDocNav; 2026-11-24).
// The ticked rows become ONE ReportExportModel (app/portal/accounting/_lib/report-export.tsx): CSV through
// exportReportCsv, Print through the generated A4 PDF with the print dialog (never window.print of the screen).
// Columns = the table's columns, values as the table shows them, money 2dp, a TOTAL row under the money columns.

export interface ListExportColumn<R> {
  header: string;
  /** The cell as text (as the table shows it). */
  text: (row: R) => string;
  /** A money column: 2dp, summed into the TOTAL row. */
  money?: (row: R) => number;
}

const R2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const money2 = (n: number) => (Number(n) || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function listExportModel<R>(o: { title: string; orgName: string; rows: R[]; columns: Array<ListExportColumn<R>>; metaLines?: string[] }) {
  const rows = o.rows.map((r) => o.columns.map((c) => (c.money ? money2(c.money(r)) : String(c.text(r) ?? "").trim())));
  const anyMoney = o.columns.some((c) => c.money);
  const total = anyMoney
    ? o.columns.map((c, i) => (c.money ? money2(R2(o.rows.reduce((s, r) => s + (Number(c.money!(r)) || 0), 0))) : i === 0 ? "TOTAL" : ""))
    : null;
  return {
    title: o.title,
    orgName: o.orgName,
    metaLines: [`${o.rows.length} selected`, ...(o.metaLines ?? [])],
    tables: [{ headers: o.columns.map((c) => c.header), rows: total ? [...rows, total] : rows, ...(total ? { boldRows: [rows.length] } : {}) }],
  };
}
