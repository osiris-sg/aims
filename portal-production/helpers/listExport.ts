// Document list bulk "Export summary" (.xlsx) / "Print list" (WCT group Invoices, Quotations and DO lists,
// enableWctDocNav; 2026-11-24, Excel 2026-11-25 replaced the CSV). Print: the ticked rows become ONE ReportExportModel
// (app/portal/accounting/_lib/report-export.tsx) printed through the generated A4 PDF (never window.print of the screen).
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

// ── Export summary (.xlsx), WCT group Invoices / Quotations / DO lists (enableWctDocNav, 2026-11-25) ──────────────
// A REAL workbook through SheetJS (the report export standard; never HTML renamed .xls): the same columns as the table,
// money cells as numbers shown #,##0.00, a TOTAL row, bold header and TOTAL, columns sized to their text. SheetJS's
// community build drops cell styles on write, so the bold font and the money format are stamped into the package
// afterwards (styles.xml + the sheet's cell style ids) with JSZip.

export interface ListSheet {
  /** Rows as written: org, title, meta, blank, header, data…, TOTAL. Money cells are numbers. */
  aoa: Array<Array<string | number>>;
  /** 0-based row index of the header row. */
  headerRow: number;
  /** 0-based row index of the TOTAL row, or -1. */
  totalRow: number;
  /** 0-based column indexes holding money. */
  moneyCols: number[];
  /** Column widths (characters). */
  widths: number[];
}

export function listExportSheet<R>(o: { title: string; orgName: string; rows: R[]; columns: Array<ListExportColumn<R>>; metaLines?: string[] }): ListSheet {
  const moneyCols = o.columns.map((c, i) => (c.money ? i : -1)).filter((i) => i >= 0);
  const data = o.rows.map((r) => o.columns.map((c) => (c.money ? R2(Number(c.money(r)) || 0) : String(c.text(r) ?? "").trim())));
  const total = moneyCols.length
    ? o.columns.map((c, i) => (c.money ? R2(o.rows.reduce((s, r) => s + (Number(c.money!(r)) || 0), 0)) : i === 0 ? "TOTAL" : ""))
    : null;
  const top: Array<Array<string | number>> = [[o.orgName], [o.title], [`${o.rows.length} selected`], ...(o.metaLines ?? []).map((m) => [m]), []];
  const headerRow = top.length;
  const aoa = [...top, o.columns.map((c) => c.header), ...data, ...(total ? [total] : [])];
  const totalRow = total ? aoa.length - 1 : -1;
  const widths = o.columns.map((c, i) => {
    const cells = [c.header, ...data.map((r) => r[i]), ...(total ? [total[i]] : [])].map((v) => (typeof v === "number" ? money2(v) : String(v)));
    return Math.min(60, Math.max(10, ...cells.map((s) => s.length)) + 2);
  });
  return { aoa, headerRow, totalRow, moneyCols, widths };
}

/** Cell style ids written into styles.xml: 0 plain, 1 bold, 2 money, 3 bold money. */
export const LIST_XLSX_STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

const colIndex = (letters: string) => letters.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/** The style id of a cell: bold for the org / title lines, the header and the TOTAL row; money format for money cells. */
export function listCellStyle(sheet: Pick<ListSheet, "headerRow" | "totalRow" | "moneyCols">, row: number, col: number): number {
  const bold = row < 2 || row === sheet.headerRow || row === sheet.totalRow;
  const money = row > sheet.headerRow && sheet.moneyCols.includes(col);
  return money ? (bold ? 3 : 2) : bold ? 1 : 0;
}

/** The workbook's bytes (.xlsx). */
export async function listExportXlsx(sheet: ListSheet, sheetName: string): Promise<Uint8Array> {
  const XLSX: any = await import("xlsx");
  const JSZip: any = (await import("jszip")).default;
  const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
  ws["!cols"] = sheet.widths.map((wch) => ({ wch }));
  const last = sheet.totalRow >= 0 ? sheet.totalRow : sheet.aoa.length - 1;
  if (last > sheet.headerRow) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: sheet.headerRow, c: 0 }, e: { r: last - (sheet.totalRow >= 0 ? 1 : 0), c: sheet.widths.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Summary").trim());
  const raw: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const zip = await JSZip.loadAsync(raw);
  zip.file("xl/styles.xml", LIST_XLSX_STYLES);
  const path = "xl/worksheets/sheet1.xml";
  const xml: string = await zip.file(path).async("string");
  const styled = xml.replace(/<c r="([A-Z]+)(\d+)"( s="\d+")?/g, (_m: string, col: string, row: string) => {
    const s = listCellStyle(sheet, Number(row) - 1, colIndex(col));
    return `<c r="${col}${row}"${s ? ` s="${s}"` : ""}`;
  });
  zip.file(path, styled);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** "invoices-summary-2026-11-25.xlsx" (local date). */
export function listSummaryFilename(title: string, now = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${title.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").toLowerCase()}-summary-${d}.xlsx`;
}
