// Run: npm test. 2026-11-13: WCT orders as the hub (list tabs / row menu / order page tracker + next step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { HUB_STATUSES, hubStatus, hubTabs, hubMatchesTab, hubRowActions, hubNextStep, hubSteps, HUB_DESTRUCTIVE } from "./wctOrderHub.ts";

test("every status has its own colour and label", () => {
  assert.equal(new Set(HUB_STATUSES.map((s) => s.hue)).size, HUB_STATUSES.length);
  assert.equal(HUB_STATUSES.at(-2).key, "SERVICE_REPORT_SENT"); // the last step before Cancelled
  for (const s of HUB_STATUSES) assert.ok(!s.label.includes("—"));
});

test("tabs count the real statuses (3 DO drafts read DO draft (3), not Open (0))", () => {
  const orders = [{ status: "DO_DRAFT" }, { status: "DO_DRAFT" }, { status: "DO_DRAFT" }, { status: "CANCELLED" }];
  const tabs = hubTabs(orders);
  assert.equal(tabs[0].key, "all");
  assert.equal(tabs[0].count, 4);
  assert.equal(tabs.find((t) => t.key === "DO_DRAFT").count, 3);
  assert.equal(tabs.find((t) => t.key === "CANCELLED").count, 1);
  assert.equal(tabs.find((t) => t.key === "PAID").count, 0);
  assert.ok(!tabs.some((t) => t.key === "AWAITING_VERIFICATION")); // shown only when used
  assert.equal(orders.filter((o) => hubMatchesTab(o, "DO_DRAFT")).length, 3);
});

test("older WCT statuses map onto the hub's stages", () => {
  assert.equal(hubStatus("OPEN"), "DO_DRAFT");
  assert.equal(hubStatus("IN_PROGRESS"), "DO_SCHEDULED");
  assert.equal(hubStatus("CLOSED"), "SERVICE_REPORT_SENT");
});

test("row menu by status (owner's list)", () => {
  assert.deepEqual(hubRowActions("DO_DRAFT"), ["view-order", "view-quotation", "view-do", "schedule-do", "add-job", "cancel-order"]);
  assert.deepEqual(hubRowActions("DO_SCHEDULED"), ["view-order", "view-do", "complete-do", "reschedule", "cancel-job"]);
  assert.deepEqual(hubRowActions("DO_COMPLETED"), ["view-signed-do", "create-invoice"]);
  assert.deepEqual(hubRowActions("INVOICE_DRAFT"), ["view-invoice", "confirm-invoice", "send-invoice"]);
  assert.deepEqual(hubRowActions("INVOICED"), ["view-invoice", "record-payment", "upload-report", "send-report"]);
  assert.deepEqual(hubRowActions("PAID"), ["view-invoice", "upload-report", "send-report"]);
  assert.deepEqual(hubRowActions("SERVICE_REPORT_SENT"), ["view-order", "resend-report"]);
  assert.deepEqual(hubRowActions("CANCELLED"), ["view-order"]);
  assert.ok(HUB_DESTRUCTIVE.has("cancel-order") && HUB_DESTRUCTIVE.has("cancel-job"));
});

test("next step: one primary button per status, none when done", () => {
  assert.equal(hubNextStep({ status: "DO_DRAFT" }).primary, "schedule-do");
  assert.equal(hubNextStep({ status: "DO_SCHEDULED" }).primary, "complete-do");
  assert.equal(hubNextStep({ status: "DO_COMPLETED", invoices: [] }).primary, "create-invoice");
  assert.equal(hubNextStep({ status: "DO_COMPLETED", invoices: [{}] }).primary, "view-invoice");
  assert.deepEqual(hubNextStep({ status: "INVOICE_DRAFT" }), { primary: "confirm-invoice", secondary: "send-invoice" });
  assert.equal(hubNextStep({ status: "INVOICED", serviceReportReady: false }).primary, "upload-report");
  assert.equal(hubNextStep({ status: "PAID", serviceReportReady: true }).primary, "send-report");
  assert.equal(hubNextStep({ status: "SERVICE_REPORT_SENT" }), null);
  assert.equal(hubNextStep({ status: "CANCELLED" }), null);
});

test("tracker: 4 steps, ticks follow the status, docs listed", () => {
  const order = {
    status: "INVOICED",
    statusDates: { QUOTATION_SIGNED: "2026-11-01T00:00:00Z", DO_COMPLETED: "2026-11-03T00:00:00Z", INVOICED: "2026-11-04T00:00:00Z" },
    sourceQuotation: { id: "q", name: "QO1", status: "confirmed", type: "QUOTATION", documentTemplateId: "t" },
    jobs: [{ status: "completed", deliveryOrder: { id: "d", name: "DO1", tag: "Delivered", templateId: "t2" } }, { status: "cancelled", deliveryOrder: { id: "x", name: "DOX" } }],
    invoices: [{ id: "i", name: "INV1", status: "pending_payment", type: "INVOICE", documentTemplateId: "t3" }],
    jobReports: [{ id: "r", reportNumber: null, status: "draft" }],
  };
  const s = hubSteps(order);
  assert.deepEqual(s.map((x) => x.title), ["Quotation", "DO", "Invoice", "Service report"]);
  assert.deepEqual(s.map((x) => x.done), [true, true, true, false]);
  assert.deepEqual(s.map((x) => x.current), [false, false, false, true]);
  assert.deepEqual(s[1].docs.map((d) => d.label), ["DO1"]); // the cancelled job's DO is not listed
  assert.equal(s[2].docs[0].status, "Sent, awaiting payment");
  assert.equal(s[3].docs[0].label, "Service report (draft)");
  assert.equal(s[1].href, undefined);
  assert.equal(s[1].docs[0].href, "/portal/documents/DELIVERY_ORDER/t2/d");
  const done = hubSteps({ ...order, status: "SERVICE_REPORT_SENT" });
  assert.ok(done.every((x) => x.done && !x.current));
});

import { hubActionTarget, hubListTarget } from "./wctOrderHub.ts";
test("actions reuse the existing screens and dialogs", () => {
  const c = { orderId: "o1", quotationHref: "/q", doHref: "/d", invoiceHref: "/i", draftJobId: "j1", scheduledJobId: "j2", completedJobId: "j3" };
  assert.deepEqual(hubActionTarget("schedule-do", c), { href: "/portal/deliveries/j1?open=schedule" });
  assert.deepEqual(hubActionTarget("complete-do", c), { href: "/portal/deliveries/j2?open=complete" });
  assert.deepEqual(hubActionTarget("reschedule", c), { href: "/portal/deliveries/j2?open=schedule" });
  assert.deepEqual(hubActionTarget("upload-report", c), { href: "/portal/deliveries/j3?open=upload" });
  assert.deepEqual(hubActionTarget("confirm-invoice", c), { href: "/i" });
  assert.deepEqual(hubActionTarget("cancel-job", c), { dialog: "cancel-job", jobId: "j2" });
  assert.deepEqual(hubActionTarget("send-report", c), { dialog: "send-report" });
  assert.deepEqual(hubListTarget("send-report", c), { href: "/portal/orders/o1?open=send-report" });
  assert.deepEqual(hubListTarget("create-invoice", c), { href: "/portal/orders/o1?open=create-invoice" });
  assert.deepEqual(hubListTarget("cancel-order", c), { dialog: "cancel-order" });
  assert.equal(hubActionTarget("view-do", { orderId: "o1" }), null); // nothing to open: hidden
});

test("Documents list: PDF for the signed quotation and finished DOs, Photos for reports with a photos file", () => {
  const s = hubSteps({
    id: "o1",
    status: "PAID",
    sourceQuotation: { id: "q", name: "QO1", status: "confirmed", type: "QUOTATION", documentTemplateId: "t" },
    jobs: [
      { id: "j1", status: "completed", deliveryOrder: { id: "d1", name: "DO1", templateId: "t2" } },
      { id: "j2", status: "scheduled", deliveryOrder: { id: "d2", name: "DO2", templateId: "t2" } },
    ],
    jobReports: [{ id: "r1", reportNumber: 7, status: "completed", photosFile: true }, { id: "r2", status: "draft" }],
  });
  assert.deepEqual(s[0].docs[0].file, { label: "PDF", path: "/orders/o1/quotation-pdf" });
  assert.deepEqual(s[1].docs[0].file, { label: "PDF", path: "/delivery-group-posts/delivery/j1/signed-do?documentId=d1" });
  assert.equal(s[1].docs[1].file, null); // not signed yet
  assert.deepEqual(s[3].docs[0].file, { label: "Photos", path: "/maintenance-reports/r1/photos-file" });
  assert.equal(s[3].docs[1].file, null);
  const unsigned = hubSteps({ id: "o1", status: "QUOTATION_SIGNED", sourceQuotation: { id: "q", name: "QO1", status: "unconfirmed" } });
  assert.equal(unsigned[0].docs[0].file, null);
});
