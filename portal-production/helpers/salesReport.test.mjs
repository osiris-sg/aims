// Run: npm test (node --test). Sales report + quotation category (WCT group): choices, the settings list, the export model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryChoices, cleanQuotationCategoryList, paperDate, salesReportModel, summaryRows } from "./salesReport.ts";

test("category choices: Uncategorised (blank) first, the list, a stored pick no longer on it", () => {
  assert.deepEqual(categoryChoices(["Kitchen exhaust", "Ductwork"], ""), [
    { value: "", label: "Uncategorised" },
    { value: "Kitchen exhaust", label: "Kitchen exhaust" },
    { value: "Ductwork", label: "Ductwork" },
  ]);
  assert.deepEqual(categoryChoices([], "Old name").map((c) => c.value), ["", "Old name"]);
  assert.deepEqual(categoryChoices(["A"], "A").map((c) => c.value), ["", "A"]);
});

test("settings list: trimmed, blanks and repeats dropped, Uncategorised refused, empty allowed", () => {
  assert.deepEqual(cleanQuotationCategoryList([" Kitchen  exhaust ", "", "kitchen exhaust", "Uncategorised", "Ductwork"]), ["Kitchen exhaust", "Ductwork"]);
  assert.deepEqual(cleanQuotationCategoryList([]), []);
});

const data = {
  scope: "all",
  salesperson: "u:1",
  from: "2026-11-01",
  to: "2026-11-30",
  salespeople: [],
  rows: [
    { id: "a", number: "QO202611-0001", date: "2026-11-03", customer: "TEST Client", subject: "Degreasing", category: "Kitchen exhaust", amount: 1000, status: "Signed", templateId: "t" },
    { id: "b", number: "QO202611-0002", date: "2026-11-04", customer: "TEST Client", subject: "", category: "Uncategorised", amount: 250.5, status: "Pending", templateId: "t" },
    { id: "c", number: "QO202611-0003", date: "2026-11-05", customer: "TEST Client", subject: "", category: "Uncategorised", amount: 99, status: "Draft", templateId: "t" },
  ],
  summary: {
    byCategory: [
      { category: "Kitchen exhaust", signedCount: 1, signedAmount: 1000, pendingCount: 0, pendingAmount: 0 },
      { category: "Uncategorised", signedCount: 0, signedAmount: 0, pendingCount: 1, pendingAmount: 250.5 },
    ],
    total: { category: "Total", signedCount: 1, signedAmount: 1000, pendingCount: 1, pendingAmount: 250.5 },
  },
};

test("export model: summary on top (Signed vs Pending, Total row bold), then the quotations stopping at Status, money 2dp", () => {
  const m = salesReportModel(data, { orgName: "WCT (S) SYSTEMS PTE LTD", salespersonLabel: "Henry Hoo" });
  assert.equal(m.title, "SALES REPORT");
  assert.deepEqual(m.metaLines, ["Salesperson : Henry Hoo", "Quotation date : 01/11/2026 to 30/11/2026"]);
  assert.equal(m.tables[0].heading, "Summary by category");
  assert.deepEqual(m.tables[0].rows[2], ["Total", "1", "1,000.00", "1", "250.50", "1,250.50"]);
  assert.deepEqual(m.tables[0].boldRows, [2]);
  assert.deepEqual(m.tables[1].headers, ["QO No.", "Date", "Customer", "Subject", "Category", "Amount (excl. GST)", "Status"]);
  assert.deepEqual(m.tables[1].rows[0], ["QO202611-0001", "03/11/2026", "TEST Client", "Degreasing", "Kitchen exhaust", "1,000.00", "Signed"]);
  assert.deepEqual(m.tables[1].rows[3], ["TOTAL", "", "", "", "", "1,349.50", ""]);
  assert.deepEqual(m.tables[1].boldRows, [3]);
  assert.equal(summaryRows(data).length, 3);
});

test("dates: dd/mm/yyyy; open-ended ranges read Start / Today; none = All dates", () => {
  assert.equal(paperDate("2026-11-18"), "18/11/2026");
  assert.equal(paperDate(""), "");
  assert.deepEqual(salesReportModel({ ...data, from: null, to: null }, { orgName: "X", salespersonLabel: "All" }).metaLines[1], "Quotation date : All dates");
  assert.deepEqual(salesReportModel({ ...data, from: "2026-01-01", to: null }, { orgName: "X", salespersonLabel: "All" }).metaLines[1], "Quotation date : 01/01/2026 to Today");
});
