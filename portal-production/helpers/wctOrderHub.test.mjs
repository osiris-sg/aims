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
  assert.deepEqual(s.map((x) => x.title), ["Quotation", "Invoice", "DO", "Service report"]);
  assert.deepEqual(s.map((x) => x.done), [true, true, true, false]);
  assert.deepEqual(s.map((x) => x.current), [false, false, false, true]);
  assert.deepEqual(s[2].docs.map((d) => d.label), ["DO1"]); // the cancelled job's DO is not listed
  assert.equal(s[1].docs[0].status, "Sent, awaiting payment");
  assert.equal(s[3].docs[0].label, "Service report (draft)");
  assert.equal(s[2].href, undefined);
  assert.equal(s[2].docs[0].href, "/portal/documents/DELIVERY_ORDER/t2/d");
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
  assert.deepEqual(s[2].docs[0].file, { label: "PDF", path: "/delivery-group-posts/delivery/j1/signed-do?documentId=d1" });
  assert.equal(s[2].docs[1].file, null); // not signed yet
  assert.deepEqual(s[3].docs[0].file, { label: "Photos", path: "/maintenance-reports/r1/photos-file" });
  assert.equal(s[3].docs[1].file, null);
  const unsigned = hubSteps({ id: "o1", status: "QUOTATION_SIGNED", sourceQuotation: { id: "q", name: "QO1", status: "unconfirmed" } });
  assert.equal(unsigned[0].docs[0].file, null);
});

test("manual flow: Add service report opens the order's create / upload chooser", () => {
  const c = { orderId: "o1", completedJobId: "j3", manualFlow: true };
  assert.deepEqual(hubActionTarget("upload-report", c), { dialog: "service-report" });
  assert.deepEqual(hubListTarget("upload-report", c), { href: "/portal/orders/o1?open=service-report" });
  assert.deepEqual(hubActionTarget("upload-report", { ...c, manualFlow: false }), { href: "/portal/deliveries/j3?open=upload" });
});

test("DO first: Complete DO on a DO with no job, a job is optional", () => {
  // DO steps open the DO (its toolbar completes it); no Add job beside the button.
  // 2026-11-17: no View DO next-step button (the DO number is a link); Create invoice for an order with no invoice yet.
  assert.deepEqual(hubNextStep({ status: "DO_DRAFT", doFirst: true }), { primary: "create-invoice" });
  assert.deepEqual(hubNextStep({ status: "DO_SCHEDULED", doFirst: true }), { primary: "create-invoice" });
  assert.deepEqual(hubNextStep({ status: "AWAITING_VERIFICATION", doFirst: true, awaitingDo: true }), { primary: "create-invoice" });
  assert.deepEqual(hubRowActions("DO_DRAFT", { doFirst: true }), ["view-order", "view-quotation", "view-do", "complete-do", "sign-link", "create-invoice", "add-job", "cancel-order"]);
  const c = { orderId: "o1", manualFlow: true, openDoId: "d1", scheduledJobId: null };
  assert.deepEqual(hubActionTarget("complete-do", c), { dialog: "complete-do", doId: "d1" });
  assert.deepEqual(hubListTarget("complete-do", c), { href: "/portal/orders/o1?open=complete-do" });
  // A DO with a job: completed on the job, as before.
  assert.deepEqual(hubActionTarget("complete-do", { orderId: "o1", manualFlow: true, openDoId: null, scheduledJobId: "j2" }), { href: "/portal/deliveries/j2?open=complete" });
  const steps = hubSteps({ id: "o1", status: "DO_SCHEDULED", deliveryOrders: [{ id: "d1", name: "DO1", templateId: "t", completed: false, awaitingSignature: true }, { id: "d2", name: "DO2", templateId: "t", completed: true, jobs: [{ id: "j1", status: "completed" }] }] });
  assert.deepEqual(steps[2].docs.map((d) => `${d.label} ${d.status}`), ["DO1 Awaiting signature", "DO2 Completed"]);
  assert.equal(steps[2].docs[1].file.path, "/delivery-group-posts/delivery/j1/signed-do?documentId=d2");
});

test("DO first: a DO waiting for the customer offers its sign link", () => {
  assert.deepEqual(hubNextStep({ status: "AWAITING_VERIFICATION", awaitingDo: true }), { primary: "sign-link" });
  assert.deepEqual(hubNextStep({ status: "AWAITING_VERIFICATION" }), { primary: "open-job" });
  assert.deepEqual(hubActionTarget("sign-link", { orderId: "o1", awaitingDoId: "d2" }), { dialog: "sign-link", doId: "d2" });
  assert.deepEqual(hubListTarget("sign-link", { orderId: "o1", awaitingDoId: "d2" }), { href: "/portal/orders/o1?open=sign-link" });
  assert.equal(hubActionTarget("sign-link", { orderId: "o1" }), null);
});

// ── Invoice and DO in either order (2026-11-16) ─────────────────────────────
test("signed (manual flow): Create invoice only (no View DO button, 2026-11-17)", () => {
  for (const status of ["DO_DRAFT", "DO_SCHEDULED", "AWAITING_VERIFICATION"]) {
    assert.deepEqual(hubNextStep({ status, doFirst: true }), { primary: "create-invoice" });
    assert.ok(hubRowActions(status, { doFirst: true }).includes("create-invoice"));
  }
  // Older WCT orders (no manual flow) keep their one button.
  assert.deepEqual(hubNextStep({ status: "DO_DRAFT" }), { primary: "schedule-do" });
  assert.ok(!hubRowActions("DO_DRAFT").includes("create-invoice"));
});

test("invoiced first: the DO is what is left; DO first: the invoice is", () => {
  assert.deepEqual(hubNextStep({ status: "INVOICE_DRAFT_DO_PENDING" }), { primary: "confirm-invoice", secondary: "view-do" });
  assert.deepEqual(hubNextStep({ status: "INVOICED_DO_PENDING" }), { primary: "view-do" });
  assert.ok(hubRowActions("INVOICED_DO_PENDING").includes("complete-do"));
  assert.ok(!hubRowActions("INVOICED_DO_PENDING").includes("create-invoice"));
  assert.equal(hubNextStep({ status: "DO_COMPLETED", invoices: [] }).primary, "create-invoice");
  assert.equal(hubNextStep({ status: "READY_FOR_SERVICE_REPORT", serviceReportReady: false }).primary, "upload-report");
  assert.equal(hubNextStep({ status: "READY_FOR_SERVICE_REPORT", serviceReportReady: true }).primary, "send-report");
});

test("tracker: one row Quotation, Invoice, DO, Service report; Invoice and DO tick in either order", () => {
  const base = { id: "o1", sourceQuotation: { id: "q", name: "QO1", status: "confirmed" } };
  const view = (status) => hubSteps({ ...base, status }).map((x) => [x.key, x.done, x.current]);
  assert.deepEqual(view("DO_DRAFT"), [["quotation", true, false], ["invoice", false, true], ["do", false, true], ["report", false, false]]);
  assert.deepEqual(view("INVOICED_DO_PENDING"), [["quotation", true, false], ["invoice", true, false], ["do", false, true], ["report", false, false]]);
  assert.deepEqual(view("INVOICE_DRAFT_DO_PENDING"), [["quotation", true, false], ["invoice", false, true], ["do", false, true], ["report", false, false]]);
  assert.deepEqual(view("DO_COMPLETED"), [["quotation", true, false], ["invoice", false, true], ["do", true, false], ["report", false, false]]);
  assert.deepEqual(view("READY_FOR_SERVICE_REPORT"), [["quotation", true, false], ["invoice", true, false], ["do", true, false], ["report", false, true]]);
  assert.ok(hubSteps({ ...base, status: "DO_DRAFT" })[1].parallel && hubSteps({ ...base, status: "DO_DRAFT" })[2].parallel); // invoice, then DO
});

test("labels and tabs", () => {
  const label = (k) => HUB_STATUSES.find((s) => s.key === k).label;
  assert.equal(label("INVOICED_DO_PENDING"), "Invoiced, DO pending");
  assert.equal(label("DO_COMPLETED"), "DO completed, invoice pending");
  assert.equal(label("READY_FOR_SERVICE_REPORT"), "Ready for service report");
  const tabs = hubTabs([{ status: "INVOICED_DO_PENDING" }]);
  assert.ok(tabs.some((t) => t.key === "INVOICED_DO_PENDING" && t.count === 1));
  assert.ok(tabs.some((t) => t.key === "READY_FOR_SERVICE_REPORT"));
  assert.ok(!tabs.some((t) => t.key === "INVOICED")); // legacy: shown only when used
});

test("DO first: an unsigned DO offers its sign link on the list row and order page", () => {
  assert.ok(hubRowActions("DO_DRAFT", { doFirst: true }).includes("sign-link"));
  assert.ok(hubRowActions("DO_SCHEDULED", { doFirst: true }).includes("sign-link"));
  assert.ok(!hubRowActions("DO_DRAFT").includes("sign-link"));
  assert.deepEqual(hubActionTarget("sign-link", { orderId: "o1", openDoId: "d1" }), { dialog: "sign-link", doId: "d1" });
  assert.deepEqual(hubActionTarget("sign-link", { orderId: "o1", openDoId: "d1", awaitingDoId: "d2" }), { dialog: "sign-link", doId: "d2" });
  assert.deepEqual(hubListTarget("sign-link", { orderId: "o1", openDoId: "d1" }), { href: "/portal/orders/o1?open=sign-link" });
});

// 2026-11-17: Split payment on the tracker + the order page's one Documents list (manual flow).
import { hubDocuments } from "./wctOrderHub.ts";

const ORDER = {
  id: "o1",
  status: "INVOICE_DRAFT",
  sourceQuotation: { id: "q1", name: "QO202611-0030", status: "confirmed", type: "QUOTATION", documentTemplateId: "tq" },
  deliveryOrders: [{ id: "d1", name: "DO202611030", templateId: "td", completed: true, jobs: [{ id: "j1", status: "completed", isDraft: false }] }],
  jobs: [
    { id: "j1", deliveryNumber: 7, status: "completed", isDraft: false, deliveryOrder: { id: "d1" } },
    { id: "j2", deliveryNumber: 8, status: "scheduled", isDraft: true, deliveryOrder: null },
  ],
  jobReports: [{ id: "r1", reportNumber: 3, status: "completed" }],
};

test("tracker: split parts show '2 of 3 sent' and the step ticks only when all are sent", () => {
  const parts = (s3) => [
    { id: "i1", name: "INV202611-0014-1", status: "pending_payment", split: { part: 1, of: 3 } },
    { id: "i2", name: "INV202611-0014-2", status: "paid", split: { part: 2, of: 3 } },
    { id: "i3", name: "INV202611-0014-3", status: s3, split: { part: 3, of: 3 } },
  ];
  const inv = hubSteps({ ...ORDER, invoices: parts("unconfirmed") }).find((s) => s.key === "invoice");
  assert.equal(inv.note, "2 of 3 sent");
  assert.equal(inv.done, false);
  const all = hubSteps({ ...ORDER, status: "READY_FOR_SERVICE_REPORT", invoices: parts("pending_payment") }).find((s) => s.key === "invoice");
  assert.equal(all.note, "3 of 3 sent");
  assert.equal(all.done, true);
  // No split: no note (unchanged tracker).
  assert.equal(hubSteps({ ...ORDER, invoices: [{ id: "i1", name: "INV1", status: "draft" }] }).find((s) => s.key === "invoice").note, undefined);
});

test("Documents, off the manual flow: exactly the tracker's documents, as before", () => {
  const o = { ...ORDER, invoices: [{ id: "i1", name: "INV1", status: "draft", href: "/x" }] };
  const steps = hubSteps(o);
  const before = [
    ...steps[0].docs.map((d) => ({ type: "Quotation", ...d })),
    ...steps[1].docs.map((d) => ({ type: "Invoice", ...d })),
    ...steps[2].docs.map((d) => ({ type: "Delivery order", ...d })),
    ...steps[3].docs.map((d) => ({ type: "Service report", ...d, status: `${d.status}${d.status !== "Draft" ? " · photos on the report" : ""}` })),
  ];
  assert.deepEqual(hubDocuments(o).map(({ kind, ...r }) => r), before);
});

test("Documents, manual flow: every invoice part with its PDF, each DO then its jobs, loose jobs, reports", () => {
  const o = { ...ORDER, invoices: [{ id: "i1", name: "INV202611-0014-1", status: "pending_payment", href: "/a" }, { id: "i2", name: "INV202611-0014-2", status: "draft", href: "/b" }] };
  const rows = hubDocuments(o, { full: true, jobLabel: (j) => (j.isDraft ? "Draft" : "Done") });
  assert.deepEqual(rows.map((r) => [r.type, r.label, r.status]), [
    ["Quotation", "QO202611-0030", "Signed / accepted"],
    ["Invoice", "INV202611-0014-1", "Sent, awaiting payment"],
    ["Invoice", "INV202611-0014-2", "Draft"],
    ["Delivery order", "DO202611030", "Completed"],
    ["Job", "#7", "Done"],
    ["Job", "#8", "Draft"],
    ["Service report", "Service report #3", "Completed · photos on the report"],
  ]);
  assert.equal(rows[1].file.path, "/orders/o1/invoice-pdf?documentId=i1");
  assert.equal(rows[4].child, true);
  assert.equal(rows[4].href, "/portal/deliveries/j1");
  assert.equal(rows[3].id, "d1");
});

test("manual flow (2026-11-17): no View DO / Confirm invoice next-step buttons; other orders unchanged", () => {
  assert.equal(hubNextStep({ status: "INVOICE_DRAFT_DO_PENDING", doFirst: true }), null);
  assert.equal(hubNextStep({ status: "INVOICED_DO_PENDING", doFirst: true }), null);
  assert.deepEqual(hubNextStep({ status: "INVOICE_DRAFT", doFirst: true }), { primary: "send-invoice" });
  // Without the manual flow (WCT Racking and the rest): exactly as before.
  assert.deepEqual(hubNextStep({ status: "INVOICE_DRAFT_DO_PENDING" }), { primary: "confirm-invoice", secondary: "view-do" });
  assert.deepEqual(hubNextStep({ status: "INVOICED_DO_PENDING" }), { primary: "view-do" });
  assert.deepEqual(hubNextStep({ status: "INVOICE_DRAFT" }), { primary: "confirm-invoice", secondary: "send-invoice" });
  assert.deepEqual(hubNextStep({ status: "DO_DRAFT" }), { primary: "schedule-do" });
});

test("an invoice voided with its cancelled order reads Voided", () => {
  const inv = hubSteps({ ...ORDER, status: "CANCELLED", invoices: [{ id: "i1", name: "INV1", status: "unconfirmed", cancelled: true, href: "/i" }] })[1];
  assert.equal(inv.docs[0].status, "Voided");
});

test("links: every number goes to its own page", () => {
  const o = { ...ORDER, invoices: [{ id: "i1", name: "INV202611-0014-1", status: "draft", type: "INVOICE", documentTemplateId: "ti" }] };
  const rows = hubDocuments(o, { full: true });
  assert.deepEqual(rows.map((r) => [r.label, r.href]), [
    ["QO202611-0030", "/portal/documents/QUOTATION/tq/q1"],
    ["INV202611-0014-1", "/portal/documents/INVOICE/ti/i1"],
    ["DO202611030", "/portal/documents/DELIVERY_ORDER/td/d1"],
    ["#7", "/portal/deliveries/j1"],
    ["#8", "/portal/deliveries/j2"],
    ["Service report #3", "/portal/maintenance-reports/r1"],
  ]);
  const steps = hubSteps(o);
  assert.equal(steps[1].docs[0].href, "/portal/documents/INVOICE/ti/i1");
  assert.equal(steps[2].docs[0].href, "/portal/documents/DELIVERY_ORDER/td/d1");
});
