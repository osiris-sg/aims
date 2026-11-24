// Run: npm test. Document list Export CSV / Print list (WCT group Invoices, 2026-11-24).
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
  assert.deepEqual(m.tables[0].headers, ["Invoice #", "Customer", "Amount", "Status"]);
  assert.deepEqual(m.tables[0].rows, [
    ["INV1", "TEST Client", "1,090.00", "Draft"],
    ["INV2", 'A "quoted" co', "0.10", "Unpaid"],
    ["TOTAL", "", "1,090.10", ""],
  ]);
  assert.deepEqual(m.tables[0].boldRows, [2]);
  assert.deepEqual(m.metaLines, ["2 selected"]);
});
