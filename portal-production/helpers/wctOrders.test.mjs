// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-01: WCT orders (enableWctOrders): status labels / tabs, job labels, counts line, "Add job" prefill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentLine, invoiceNowText, orderStatusLabel, orderStatusColor, orderMatchesTab, orderMatchesSearch, jobStatusLabel, jobStatusColor, jobCountsLine, fmtJobWhen, addJobPrefill } from "./wctOrders.ts";

test("order status: labels, colours, unknown values pass through", () => {
  assert.equal(orderStatusLabel("IN_PROGRESS"), "In progress");
  assert.equal(orderStatusLabel("OPEN"), "Open");
  assert.equal(orderStatusLabel("WHATEVER"), "WHATEVER");
  assert.equal(orderStatusLabel(null), "—");
  assert.equal(orderStatusColor("COMPLETED"), "success");
  assert.equal(orderStatusColor("nope"), "default");
});

test("tabs: open / scheduled-or-in-progress / completed", () => {
  const o = (status) => ({ status });
  assert.equal(orderMatchesTab(o("OPEN"), "open"), true);
  assert.equal(orderMatchesTab(o("SCHEDULED"), "active"), true);
  assert.equal(orderMatchesTab(o("IN_PROGRESS"), "active"), true);
  assert.equal(orderMatchesTab(o("COMPLETED"), "active"), false);
  assert.equal(orderMatchesTab(o("COMPLETED"), "completed"), true);
  assert.equal(orderMatchesTab(o("OPEN"), "all"), true);
});

test("search: order no., customer, quotation", () => {
  const o = { orderNumber: "ORD202611-001", customer: { name: "Acme Kitchens", customerCode: "C-9" }, sourceQuotation: { name: "QO202611-0016" } };
  assert.equal(orderMatchesSearch(o, "ord202611"), true);
  assert.equal(orderMatchesSearch(o, "acme"), true);
  assert.equal(orderMatchesSearch(o, "0016"), true);
  assert.equal(orderMatchesSearch(o, "zzz"), false);
  assert.equal(orderMatchesSearch(o, "  "), true);
});

test("job labels: a draft is Draft, otherwise the run status", () => {
  assert.equal(jobStatusLabel({ status: "scheduled", isDraft: true }), "Draft");
  assert.equal(jobStatusLabel({ status: "scheduled", isDraft: false }), "Scheduled");
  assert.equal(jobStatusLabel({ status: "in_progress" }), "In progress");
  assert.equal(jobStatusColor({ status: "completed" }), "success");
  assert.equal(jobStatusColor({ status: "scheduled", isDraft: true }), "default");
});

test("counts line", () => {
  assert.equal(jobCountsLine({ total: 0, drafts: 0, completed: 0, cancelled: 0 }), "No jobs");
  assert.equal(jobCountsLine({ total: 1, drafts: 1, completed: 0, cancelled: 0 }), "1 job · 1 draft");
  assert.equal(jobCountsLine({ total: 3, drafts: 0, completed: 1, cancelled: 1 }), "3 jobs · 1 done · 1 cancelled");
});

test("job time reads in Singapore time", () => {
  assert.equal(fmtJobWhen("2026-11-03T02:00:00.000Z"), "Tue 03 Nov, 10:00");
  assert.equal(fmtJobWhen(null), "No date");
});

test("Add job prefill: order id + number, customer, site, quotation lines (blank lines dropped)", () => {
  const p = addJobPrefill({
    id: "o1",
    orderNumber: "ORD202611-001",
    customer: { id: "c1", name: "Acme", customerCode: null, address: "1 Tuas Ave" },
    prefill: {
      siteAddress: "10 Anson Road",
      lines: [
        { asset: null, description: "Kitchen exhaust degrease", quantity: 1, assetClass: "SERVICE" },
        { asset: { id: "a1", name: "Filter", skuKey: "F-1" }, description: "Filter", quantity: 2, assetClass: null },
        { asset: null, description: "  ", quantity: 1, assetClass: "SERVICE" },
      ],
    },
  });
  assert.equal(p.orderId, "o1");
  assert.equal(p.orderNumber, "ORD202611-001");
  assert.deepEqual(p.customer, { id: "c1", name: "Acme", customerCode: null, address: "1 Tuas Ave" });
  assert.equal(p.siteAddress, "10 Anson Road");
  assert.equal(p.lines.length, 2);
  assert.equal(addJobPrefill({ id: "o2", orderNumber: "ORD202611-002" }).lines.length, 0);
});

test("Invoice now text: names the jobs and says where the rest go", () => {
  assert.equal(invoiceNowText([12], 0), "Create the invoice now for the verified job #12? It bills the quotation once, plus any lines added to this job on top of it.");
  assert.equal(
    invoiceNowText([12, 13], 1),
    "Create the invoice now for the verified jobs #12, #13? It bills the quotation once, plus any lines added to these jobs on top of it. The 1 job not done or not verified yet is covered by this invoice. Lines added to it on top of the quotation go on a second invoice once verified.",
  );
  assert.equal(
    invoiceNowText([14], 0, true),
    "Invoice the verified job #14 now? The quotation is already billed on this order, so only lines added to this job on top of the quotation are invoiced. If there are none, no invoice is made and the job is marked as covered.",
  );
});

test("billing tab: invoiced / paid / closed", () => {
  for (const s of ["INVOICED", "PAID", "CLOSED"]) assert.equal(orderMatchesTab({ status: s }, "billing"), true);
  assert.equal(orderMatchesTab({ status: "COMPLETED" }, "billing"), false);
  assert.equal(orderStatusLabel("PAID"), "Paid");
});

test("service report lines: uploaded file / linked report", () => {
  assert.deepEqual(attachmentLine({ id: "a", kind: "file", fileName: "SR-12.pdf", label: "Service report", addedByName: "Ann", addedAt: "2026-11-01T03:00:00Z" }), { title: "SR-12.pdf", detail: "Service report · added by Ann · 01 Nov 2026" });
  assert.equal(attachmentLine({ id: "d", kind: "report", reportId: "r", addedByName: "Elroy Lee", addedAt: "2026-11-01T15:27:51Z", report: { id: "r", reportNumber: 5, status: "completed" } }).detail, "Completed · linked by Elroy Lee · 01 Nov 2026");
  assert.equal(attachmentLine({ id: "e", kind: "report", reportId: "r", addedByName: null, addedAt: "2026-11-01T15:27:51Z", report: { id: "r", reportNumber: 5, status: "completed" } }).detail, "Completed · linked 01 Nov 2026");
  assert.equal(attachmentLine({ id: "b", kind: "report", reportId: "r", reportNumber: 7, report: { id: "r", reportNumber: 7, status: "completed" } }).title, "Service report #7");
  assert.equal(attachmentLine({ id: "c", kind: "report", reportId: "r", report: null }).detail, "Report not found");
});
