// Run: npm test (node --test). Inventory Reports: the registry, the cells and the export model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REPORTS, cellText, inventoryReportModel, money, paperDate, periodLine, qty, reportBySlug, rowsOf } from "./inventoryReports.ts";

test("the ten legacy reports, by their legacy names", () => {
  assert.equal(REPORTS.length, 10);
  assert.deepEqual(
    REPORTS.map((r) => r.title),
    [
      "Stock Status",
      "Unconfirn Inventory Transactions",
      "Purchase Order Listing",
      "Purchase Summary By Supplier",
      "Detailed Stock Analysis By Supplier / Stock",
      "Detailed Stock Analysis By Category",
      "Stock Movement Analysis",
      "Stock Take Listing",
      "Last Buy Price Report",
      "Reorder Level Analysis",
    ],
  );
  // Every report reaches its own endpoint and is reachable by its slug.
  for (const r of REPORTS) {
    assert.equal(reportBySlug(r.slug), r);
    assert.ok(r.path.startsWith("/inventory-reports/"));
    assert.ok(r.columns.length > 0);
  }
  assert.equal(reportBySlug("nope"), undefined);
});

test("quantities print plain, money prints to the cent, dates print dd/mm/yyyy", () => {
  assert.equal(qty(4), "4");
  assert.equal(qty(4.5), "4.5");
  assert.equal(money(1234.5), "1,234.50");
  assert.equal(paperDate("2026-11-25"), "25/11/2026");
  assert.equal(paperDate(""), "");
});

test("a blank cell stays blank — the count sheet is written in by hand", () => {
  const spec = reportBySlug("stock-take-listing");
  const counted = spec.columns.find((c) => c.key === "countedQty");
  assert.equal(cellText(counted, { countedQty: null }), "");
  assert.equal(cellText(counted, { countedQty: 9 }), "");
});

test("a grouped report flattens into its rows and a subtotal per group", () => {
  const spec = reportBySlug("stock-analysis-by-supplier");
  const data = {
    rows: [
      { supplier: "Tenda", items: [{ code: "A", quantity: 2, amount: 10 }], subtotal: { quantity: 2, amount: 10 } },
      { supplier: "Jurong Port", items: [{ code: "B", quantity: 1, amount: 5 }], subtotal: { quantity: 1, amount: 5 } },
    ],
    totals: { quantity: 3, amount: 15 },
  };
  const rows = rowsOf(spec, data);
  assert.deepEqual(rows.map((r) => r.__kind), ["row", "subtotal", "row", "subtotal"]);
  assert.equal(rows[1].supplier, "Supplier total — Tenda");
  assert.equal(rows[1].amount, 10);
});

test("the export model: legacy title, the prompts, the subtotals and the TOTAL in bold", () => {
  const spec = reportBySlug("stock-analysis-by-supplier");
  const data = {
    rows: [{ supplier: "Tenda", items: [{ code: "A", description: "Filter", uom: "PCS", quantity: 2, amount: 10, last: "2026-11-01" }], subtotal: { quantity: 2, amount: 10 } }],
    totals: { quantity: 2, amount: 10 },
  };
  const model = inventoryReportModel(spec, data, { orgName: "Biofuel", metaLines: ["Period : 01/11/2026 to 25/11/2026"] });
  assert.equal(model.title, "DETAILED STOCK ANALYSIS BY SUPPLIER / STOCK");
  assert.equal(model.orgName, "Biofuel");
  const table = model.tables[0];
  assert.deepEqual(table.headers, ["Supplier", "Stock Code", "Description", "UOM", "Qty", "Amount", "Last Bought"]);
  // item row, supplier subtotal, TOTAL
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.rows[0], ["Tenda", "A", "Filter", "PCS", "2", "10.00", "01/11/2026"]);
  assert.equal(table.rows[2][0], "TOTAL");
  assert.deepEqual(table.boldRows, [1, 2]);
});

test("the period line reads back what was asked for", () => {
  assert.equal(periodLine("2026-11-01", "2026-11-25"), "01/11/2026 to 25/11/2026");
  assert.equal(periodLine(null, null), "All dates");
  assert.equal(periodLine("2026-11-01", null), "01/11/2026 to Today");
});
