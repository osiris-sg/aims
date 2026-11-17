// WCT jobs calendar "New job" with a Quotation (2026-11-17): helpers/quickJobQuotation.ts + where it is wired.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyQuotationPick, doOptionLabel, linkedToast, needsDoPick, quotationLabel, quotationRow, quotationSearchPath } from "./quickJobQuotation.ts";
import { quickJobBody } from "./calendarAdd.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const detail = (over = {}) => ({
  id: "q1",
  name: "QO202611-0040",
  customerId: "c1",
  customerName: "TEST Client",
  subject: "Chemical degreasing",
  site: "51 Circular Road",
  status: "unconfirmed",
  statusLabel: "Not signed",
  orderId: null,
  orderNumber: null,
  customer: { id: "c1", name: "TEST Client", address: "1 Raffles Place" },
  siteOrAddress: "51 Circular Road",
  openDos: [],
  ...over,
});
const form = (over = {}) => ({ customerId: null, siteAddress: "", date: "2026-12-09", time: "10:00", durationMin: 60, workers: [], remarks: "", ptwStatus: "NOT_NEEDED", ptwRemark: "", ...over });

test("picking a quotation fills customer, site and empty remarks from Subject", () => {
  const f = applyQuotationPick(form(), detail());
  assert.equal(f.customerId, "c1");
  assert.equal(f.siteAddress, "51 Circular Road");
  assert.equal(f.remarks, "Chemical degreasing");
});

test("typed remarks are kept; no site on the quotation keeps the typed site; the customer address comes from the server", () => {
  assert.equal(applyQuotationPick(form({ remarks: "bring ladder" }), detail()).remarks, "bring ladder");
  assert.equal(applyQuotationPick(form({ siteAddress: "typed" }), detail({ siteOrAddress: null })).siteAddress, "typed");
  assert.equal(applyQuotationPick(form(), detail({ siteOrAddress: "1 Raffles Place" })).siteAddress, "1 Raffles Place");
  // A quotation without a customer keeps the picked one.
  assert.equal(applyQuotationPick(form({ customerId: "c9" }), detail({ customer: null, customerId: null })).customerId, "c9");
});

test("the list is searched on the server, narrowed to the picked customer", () => {
  assert.equal(quotationSearchPath("  degr ", null), "/deliveries/quick-job/quotations?q=degr&limit=20");
  assert.equal(quotationSearchPath("", "c1"), "/deliveries/quick-job/quotations?customerId=c1&limit=20");
  assert.equal(quotationSearchPath("QO 2026&x", "c1"), "/deliveries/quick-job/quotations?q=QO+2026%26x&customerId=c1&limit=20");
});

test("a row shows QO number, status, customer and Subject", () => {
  assert.deepEqual(quotationRow(detail()), { title: "QO202611-0040", status: "Not signed", detail: "TEST Client · Chemical degreasing" });
  assert.deepEqual(quotationRow(detail({ subject: null })), { title: "QO202611-0040", status: "Not signed", detail: "TEST Client" });
  assert.equal(quotationLabel(detail()), "QO202611-0040");
  assert.equal(quotationLabel(null), "");
});

test("DO pick only when the order has several open DOs", () => {
  assert.equal(needsDoPick(detail()), false);
  assert.equal(needsDoPick(detail({ orderId: "o1", openDos: [{ id: "d1", name: "DO1", date: null }] })), false);
  assert.equal(needsDoPick(detail({ orderId: "o1", openDos: [{ id: "d1", name: "DO1", date: null }, { id: "d2", name: "DO2", date: "2026-11-20" }] })), true);
  assert.equal(doOptionLabel({ id: "d2", name: "DO202611031", date: "2026-11-20" }), "DO202611031 · 2026-11-20");
});

test("the save body carries the quotation (and the DO) only when picked; a required DO is checked", () => {
  const base = form({ customerId: "c1" });
  assert.equal("quotationId" in quickJobBody(base).body, false);
  assert.deepEqual(Object.keys(quickJobBody(base).body).sort(), ["customerId", "durationMin", "ptwRemark", "ptwStatus", "remarks", "scheduledFor", "siteAddress", "workers"]);
  assert.equal(quickJobBody({ ...base, quotationId: "q1" }).body.quotationId, "q1");
  assert.equal(quickJobBody({ ...base, quotationId: "q1", doRequired: true }).error, "Pick the DO");
  assert.deepEqual(
    (({ quotationId, doId }) => ({ quotationId, doId }))(quickJobBody({ ...base, quotationId: "q1", doRequired: true, doId: "d2" }).body),
    { quotationId: "q1", doId: "d2" },
  );
  // A DO left over after the quotation was cleared is not sent.
  assert.equal("doId" in quickJobBody({ ...base, quotationId: null, doId: "d2" }).body, false);
});

test("toast says where the job went", () => {
  assert.equal(linkedToast({ orderNumber: "ORD202611-020", doName: "DO202611030" }, "QO1"), "Job added to ORD202611-020, DO202611030");
  assert.equal(linkedToast({ orderNumber: "ORD202611-020", doName: null }, "QO1"), "Job added to ORD202611-020");
  assert.equal(linkedToast({ orderNumber: null }, "QO202611-0040"), "Job added. It moves onto the order when QO202611-0040 is signed");
  assert.equal(linkedToast(undefined, null), "Job added");
});

test("wiring: Quotation is the first field, only on the calendar's New job; the edit dialog is unchanged", () => {
  const dlg = read("components/Dashboard/jobs-calendar/QuickJobDialog.tsx");
  const quotationAt = dlg.indexOf("<QuotationPicker");
  assert.ok(quotationAt > 0 && quotationAt < dlg.indexOf("<CustomerPicker"), "Quotation comes before Customer");
  assert.match(dlg, /const quotationOn = withQuotation && !edit;/);
  assert.match(dlg, /withQuotation = false/);
  assert.match(dlg, /customerId=\{form\.customerId\}/, "the customer narrows the quotation list");
  const cal = read("components/Dashboard/JobsCalendar.tsx");
  assert.match(cal, /withQuotation/);
  // The calendar dialog is mounted only for canAdd (WCT orders + jobs calendar); the job page's edit has no Quotation.
  assert.match(cal, /\{canAdd && \(/);
  const jobPage = read("app/portal/deliveries/[id]/page.tsx");
  assert.doesNotMatch(jobPage, /withQuotation/);
});

test("SiteClock not connected: the sentence moved into an (i) tooltip by the workers label", () => {
  const dlg = read("components/Dashboard/jobs-calendar/QuickJobDialog.tsx");
  assert.match(dlg, /<Tooltip title="SiteClock is not connected, so workers can't be assigned here\."/);
  assert.doesNotMatch(dlg, /<Typography variant="caption" color="text.secondary">\s*SiteClock is not connected/);
  assert.match(dlg, /InfoOutlinedIcon/);
});

test("copy: no em dashes and no ellipsis in the new labels", () => {
  const src = read("helpers/quickJobQuotation.ts");
  const strings = src.match(/"[^"\n]*"|`[^`\n]*`/g) || [];
  for (const s of strings) {
    assert.doesNotMatch(s, /—/, s);
    assert.doesNotMatch(s, /\.\.\.|…/, s);
  }
});

// 2026-11-17: the order page's "Add job" (manual flow) = this dialog with the order's quotation picked at once.
test("order page Add job: the order's quotation prefills Customer + Site; one open DO is linked, several = pick one", () => {
  const onOrder = detail({ status: "confirmed", orderId: "o1", orderNumber: "ORD202611-020" });
  const one = { ...onOrder, openDos: [{ id: "d1", name: "DO202611040", date: "2026-11-20" }] };
  const f = applyQuotationPick(form(), one);
  assert.equal(f.customerId, "c1");
  assert.equal(f.siteAddress, "51 Circular Road");
  assert.equal(needsDoPick(one), false);
  // One open DO: the dialog sets it itself (doId = the only open DO), so the save links the job to it.
  assert.deepEqual(quickJobBody({ ...f, quotationId: "q1", doId: one.openDos[0].id, doRequired: false }).body.doId, "d1");
  const two = { ...onOrder, openDos: [{ id: "d1", name: "DO1", date: null }, { id: "d2", name: "DO2", date: null }] };
  assert.equal(needsDoPick(two), true);
  assert.equal(quickJobBody({ ...f, quotationId: "q1", doId: null, doRequired: true }).error, "Pick the DO");
  assert.equal(linkedToast({ orderNumber: "ORD202611-020", doName: "DO202611040" }, "QO1"), "Job added to ORD202611-020, DO202611040");
});

test("wiring: the order page opens the New job dialog with its quotation; the dialog picks it on open", () => {
  const dlg = read("components/Dashboard/jobs-calendar/QuickJobDialog.tsx");
  assert.match(dlg, /initialQuotationId = null/);
  assert.match(dlg, /if \(open && quotationOn && initialQuotationId\) void pickQuotation/);
  assert.match(dlg, /doId: q\.openDos\.length === 1 \? q\.openDos\[0\]\.id : null/);
  const page = read("app/portal/orders/[id]/WctOrderDetail.tsx");
  assert.match(page, /<QuickJobDialog[\s\S]*withQuotation[\s\S]*initialQuotationId=\{q\.id\}/);
  // Manual flow only, with the jobs calendar (the quick-job API's gate); never on a cancelled order.
  assert.match(page, /onAddJob=\{manualFlow && isJobsCalendarEnabled && q && order\.status !== "CANCELLED"/);
  const panel = read("app/portal/orders/[id]/OrderHubPanel.tsx");
  assert.ok(panel.indexOf("            Add DO") < panel.indexOf("            Add job"), "Add job sits next to Add DO by the Documents heading");
});
