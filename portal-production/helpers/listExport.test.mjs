// Run: npm test. Document list Export summary (.xlsx) / Print list (WCT group Invoices, Quotations, DOs; 2026-11-24/25).
import { test } from "node:test";
import assert from "node:assert/strict";
import { listExportModel } from "./listExport.ts";

const cols = [
  { header: "Invoice #", text: (r) => r.no },
  { header: "Customer", text: (r) => r.c },
  { header: "Amount", text: () => "", money: (r) => r.a },
  { header: "Status", text: (r) => r.s },
];
const rows = [
  { no: "INV1", c: "TEST Client", a: 1090, s: "Draft" },
  { no: "INV2", c: 'A "quoted" co', a: 0.1, s: "Unpaid" },
];

test("rows as displayed, money 2dp, TOTAL row bold", () => {
  const m = listExportModel({ title: "Invoices", orgName: "WCT", rows, columns: cols });
  // UAT 2026-11-25: a printed list closes with "document", not "Statement".
  assert.equal(m.generatedNote, "This is a computer generated document. No signature is required.");
  assert.deepEqual(m.tables[0].headers, ["Invoice #", "Customer", "Amount", "Status"]);
  assert.deepEqual(m.tables[0].rows, [
    ["INV1", "TEST Client", "1,090.00", "Draft"],
    ["INV2", 'A "quoted" co', "0.10", "Unpaid"],
    ["TOTAL", "", "1,090.10", ""],
  ]);
  assert.deepEqual(m.tables[0].boldRows, [2]);
  assert.deepEqual(m.metaLines, ["2 selected"]);
});

// ── Export summary (.xlsx), 2026-11-25 ──
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { listExportSheet, listExportXlsx, listCellStyle, listSummaryFilename } from "./listExport.ts";

const sheetCols = [
  { header: "Invoice #", text: (r) => r.no },
  { header: "Customer", text: (r) => r.c },
  { header: "Amount", text: () => "", money: (r) => r.a },
  { header: "Paid", text: () => "", money: (r) => r.p },
  { header: "Status", text: (r) => r.s },
];
const sheetRows = [
  { no: "INV1", c: "TEST Client", a: 1090, p: 0, s: "Draft" },
  { no: "INV2", c: "Domino's Pizza Singapore", a: 0.1, p: 0.1, s: "Paid" },
  { no: "INV3", c: "Yoshinoya (S)", a: 2180.456, p: 100, s: "Unpaid" },
];

test("summary sheet: same columns, money as numbers 2dp, TOTAL row, sized columns", () => {
  const s = listExportSheet({ title: "Invoices", orgName: "WCT", rows: sheetRows, columns: sheetCols });
  assert.deepEqual(s.aoa.slice(0, 4), [["WCT"], ["Invoices"], ["3 selected"], []]);
  assert.equal(s.headerRow, 4);
  assert.deepEqual(s.aoa[4], ["Invoice #", "Customer", "Amount", "Paid", "Status"]);
  assert.deepEqual(s.aoa[5], ["INV1", "TEST Client", 1090, 0, "Draft"]);
  assert.deepEqual(s.aoa[7], ["INV3", "Yoshinoya (S)", 2180.46, 100, "Unpaid"]);
  assert.deepEqual(s.aoa[8], ["TOTAL", "", 3270.56, 100.1, ""]);
  assert.equal(s.totalRow, 8);
  assert.deepEqual(s.moneyCols, [2, 3]);
  assert.equal(s.widths[1], "Domino's Pizza Singapore".length + 2);
  assert.ok(s.widths.every((w) => w >= 10 && w <= 62));
});

test("cell styles: bold header and TOTAL, money format on money cells only", () => {
  const s = { headerRow: 4, totalRow: 8, moneyCols: [2, 3] };
  assert.equal(listCellStyle(s, 4, 0), 1);
  assert.equal(listCellStyle(s, 4, 2), 1); // the header text is not a number
  assert.equal(listCellStyle(s, 5, 2), 2);
  assert.equal(listCellStyle(s, 5, 0), 0);
  assert.equal(listCellStyle(s, 8, 0), 1);
  assert.equal(listCellStyle(s, 8, 3), 3);
  assert.equal(listCellStyle(s, 0, 0), 1);
});

test("the workbook is a real .xlsx: numbers stay numbers, bold font and #,##0.00 stamped", async () => {
  const s = listExportSheet({ title: "Invoices", orgName: "WCT", rows: sheetRows, columns: sheetCols });
  const bytes = await listExportXlsx(s, "Invoices");
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  assert.equal(wb.SheetNames[0], "Invoices");
  assert.equal(ws.A5.v, "Invoice #");
  assert.equal(ws.C6.t, "n");
  assert.equal(ws.C6.v, 1090);
  assert.equal(ws.A9.v, "TOTAL");
  assert.equal(ws.C9.v, 3270.56);
  const zip = await JSZip.loadAsync(bytes);
  const styles = await zip.file("xl/styles.xml").async("string");
  assert.match(styles, /<font><b\/>/);
  assert.match(styles, /numFmtId="4" fontId="1"/);
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(xml, /<c r="A5" s="1"/);
  assert.match(xml, /<c r="C6" s="2"/);
  assert.match(xml, /<c r="C9" s="3"/);
  assert.match(xml, /<c r="B6" t=/); // plain text cell, no style id
  assert.equal((xml.match(/<col /g) || []).length, 5);
  assert.match(xml, /<autoFilter ref="A5:E8"/);
});

test("filename: local date, summary suffix", () => {
  assert.equal(listSummaryFilename("Delivery Orders", new Date(2026, 10, 25)), "delivery-orders-summary-2026-11-25.xlsx");
});

test("DocumentListView: Export summary on WCT Invoices / Quotations / DO lists, Print list kept, CSV button gone", () => {
  const src = readFileSync(new URL("../app/portal/components/DocumentListView.tsx", import.meta.url), "utf8");
  assert.match(src, /LIST_EXPORT_TYPE_SET = new Set\(\[\.\.\.INVOICE_TYPE_SET, "QUOTATION", "QO1", "DELIVERY_ORDER", "DO"\]\)/);
  assert.match(src, /const listExportOn = !!isWctDocNavEnabled &&/);
  assert.match(src, /label: bulkExporting \? "Preparing…" : "Export summary"/);
  assert.match(src, /key: "print-list"/);
  assert.doesNotMatch(src, /"Export CSV"/);
});
