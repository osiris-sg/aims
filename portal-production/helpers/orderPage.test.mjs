// Run: npm test. Round 24 (2026-11-19): ONE order page for AIMS (native) and imported orders (WCT group).
// The same sections, card keys, summary keys, action keys and Documents columns on both kinds; every action still
// reachable with its own gating; other orgs' order pages (SlimOrderDetail / CappitechOrderDetail) untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEFT_TO_BILL_COLUMNS,
  ORDER_ACTION_KEYS,
  ORDER_CARD_KEYS,
  ORDER_DOC_COLUMNS,
  ORDER_SECTIONS,
  ORDER_SUMMARY_KEYS,
  UNLINK_BLOCKED,
  addJobMode,
  canUnlinkRow,
  deletableDraft,
  docRowMenu,
  fmtDate,
  importedOrderPage,
  nativeCreateInvoice,
  nativeInvoiceAsk,
  nativeOrderPage,
  orderPageModel,
} from "./orderPage.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// An AIMS order on the manual flow: invoice made first (split in 2), one DO completed by its job, a report, a linked report, a file.
const native = (over = {}) => ({
  id: "n1",
  orderNumber: "ORD202611-020",
  status: "READY_FOR_SERVICE_REPORT",
  createdAt: "2026-11-10T02:00:00.000Z",
  manualFlow: true,
  invoicing: true,
  customer: { id: "c1", name: "Bar Roque Grill" },
  subject: "Degreasing",
  sourceQuotation: { id: "q1", name: "QO202611-0049", status: "confirmed", type: "QUOTATION", documentTemplateId: "tq", date: "2026-11-09", total: 2616 },
  statusDates: { QUOTATION_SIGNED: "2026-11-10T02:00:00.000Z", READY_FOR_SERVICE_REPORT: "2026-11-12T02:00:00.000Z" },
  invoices: [
    { id: "i1", name: "INV202611-0080", status: "paid", href: "/portal/documents/INVOICE/ti/i1", total: 1308, gross: 1308, owed: 0, date: "2026-11-10", split: { part: 1, of: 2 } },
    { id: "i2", name: "INV202611-0080-2", status: "pending_payment", href: "/portal/documents/INVOICE/ti/i2", total: 1308, gross: 1308, owed: 1308, date: "2026-11-11", split: { part: 2, of: 2 } },
  ],
  toInvoice: [],
  toInvoiceDos: [],
  deliveryOrders: [{ id: "d1", name: "DO202611023", status: "delivered_installed", templateId: "td", date: "2026-11-11", completed: true, awaitingSignature: false, jobs: [{ id: "j1", deliveryNumber: 7, status: "completed", isDraft: false }] }],
  jobs: [{ id: "j1", deliveryNumber: 7, status: "completed", isDraft: false, scheduledFor: "2026-11-11T01:00:00.000Z", deliveryOrder: { id: "d1", templateId: "td" } }],
  jobReports: [{ id: "r1", reportNumber: 12, status: "completed", jobNumber: 7, uploaded: false, date: "2026-11-11", photosFile: true }],
  attachments: [
    { id: "a1", kind: "report", reportId: "r2", reportNumber: 13, report: { reportNumber: 13, status: "completed" }, addedByName: "Finance", addedAt: "2026-11-12T03:00:00.000Z" },
    { id: "a2", kind: "file", fileKey: "orders/n1/signed.pdf", fileName: "signed.pdf", label: "Service report", addedAt: "2026-11-12T03:00:00.000Z" },
  ],
  summary: { quoteTotal: 2616, billed: 2616, billedPct: 100, owed: 1308, billingSteps: [], progress: null, remaining: { matched: true, remainingNet: 0, remainingGross: 0, lines: [] } },
  supplierInvoices: { rows: [], total: 0 },
  ...over,
});

// An imported order, part billed, open for backfilling (round 19): a linked quotation, imported + AIMS invoices, an AIMS DO, an ERP DO.
const imported = (over = {}) => ({
  id: "o1",
  orderNumber: "ORD-Q-014154",
  status: "PART_BILLED",
  statusLabel: "Part billed",
  imported: true,
  createdAt: "2025-01-01",
  manualFlow: true,
  customer: { id: "c1", name: "Bar Roque Grill" },
  subject: "Degreasing",
  sourceQuotation: { id: "q1", name: "Q-014154", type: "QUOTATION", documentTemplateId: "tq", date: "2025-01-05", total: 2616 },
  quotations: [{ id: "q2", name: "QO202611-0050", type: "QUOTATION", templateId: "tq", total: 1090, unlinkable: true, linked: { at: "x", byName: "Finance" } }],
  tracker: [
    { key: "quotation", label: "Quotation", state: "done" },
    { key: "invoice", label: "Invoice", state: "done", note: "Part billed" },
    { key: "do", label: "DO", state: "todo", note: "Not yet", subNote: "ERP DO DO011764", action: "addDo" },
    { key: "serviceReport", label: "Service report", state: "todo", note: "Not yet", action: "addServiceReport" },
  ],
  invoices: [
    { id: "i1", name: "I-014521", type: "INVOICE", templateId: "ti", date: "2025-01-10", total: 1308, owed: 0, state: "PAID", stateLabel: "Paid", linkSource: "contract_no", erpDoNumber: "DO011764", unlinkable: true },
    { id: "i2", name: "I-014521-02", type: "INVOICE", status: "draft", templateId: "ti", date: "2026-11-19", total: 1308, owed: 1308, paid: 0, state: "UNPAID", stateLabel: "Draft", native: true, unlinkable: false },
  ],
  creditNotes: [],
  total: 2616,
  owed: 0,
  billed: 1308,
  billedPct: 50,
  quoteTotal: 2616,
  billingSteps: [{ label: "1 of 2", state: "Paid" }, { label: "2 of 2", state: "Draft" }],
  remaining: { matched: true, remainingNet: 1200, remainingGross: 1308, lines: [{ description: "Maintenance agreement\nTwice a year", quantity: 1, unitPrice: 1200, amount: 1200, quotedQty: 2, billedQty: 1, priced: true }, { description: "G- Provide tools", quantity: 1, unitPrice: 0, amount: 0, priced: false }] },
  draftInvoice: { id: "i2", name: "I-014521-02", templateId: "ti" },
  canInvoice: false,
  canComplete: true,
  canReopen: false,
  canLink: true,
  deliveryOrders: [{ id: "d1", name: "DO202611070", status: "draft", templateId: "td", completed: false, awaitingSignature: false, jobs: [] }],
  linkedDos: [{ id: "d0", name: "DO012528", templateId: "td", done: true, imported: true, unlinkable: true, linked: null }],
  jobs: [{ id: "j1", deliveryNumber: 12, status: "scheduled", isDraft: true, scheduledFor: null, deliveryOrder: { id: "d1", templateId: "td" } }],
  jobReports: [{ id: "r1", reportNumber: 7, status: "completed", jobNumber: 12 }],
  attachments: [
    { id: "a1", kind: "report", reportId: "r1", report: { reportNumber: 7, status: "completed" } },
    { id: "a2", kind: "report", reportId: "r2", report: { reportNumber: 9, status: "draft" }, addedByName: "Finance" },
    { id: "a3", kind: "file", fileKey: "k", fileName: "signed.pdf" },
  ],
  supplierInvoices: null,
  ...over,
});

const keys = (xs) => xs.map((x) => x.key);

test("native and imported orders render the same structure: card keys, summary keys, action keys, columns", () => {
  const n = nativeOrderPage(native(), { jobsCalendar: true, doFirst: true });
  const i = importedOrderPage(imported(), { jobsCalendar: true });
  for (const m of [n, i]) {
    assert.deepEqual(keys(m.cards), ORDER_CARD_KEYS);
    assert.deepEqual(m.cards.map((c) => c.title), ["Quotation", "Invoice", "DO", "Service report"]);
    assert.deepEqual(keys(m.summary), ORDER_SUMMARY_KEYS);
    assert.deepEqual(m.summary.map((f) => f.label), ["Quotation total", "Billed", "Billed %", "Billed qty", "Left to bill", "Owed"]);
    assert.deepEqual(keys(m.actions), ORDER_ACTION_KEYS);
    assert.deepEqual(keys(m.info), ["customer", "quotation", "date", "subject"]);
  }
  assert.deepEqual(ORDER_DOC_COLUMNS, ["Document", "Date", "Status", "Linked by", "Amount", "Owed", "File", ""]);
  assert.deepEqual(LEFT_TO_BILL_COLUMNS, ["Item", "Quoted", "Billed", "Left", "Unit price", "Amount"]);
  assert.deepEqual([...ORDER_SECTIONS], ["header", "info", "summary", "tracker", "actions", "documents", "leftToBill", "supplierInvoices", "photos"]);
  // The one dispatcher picks by the imported flag.
  assert.equal(orderPageModel(native()).kind, "native");
  assert.equal(orderPageModel(imported()).kind, "imported");
  assert.equal(n.imported, false);
  assert.equal(i.imported, true);
});

test("the layout draws every section in order and the page renders it for both kinds (no separate imported page)", () => {
  const layout = read("app/portal/orders/[id]/OrderPageLayout.tsx");
  const at = ["header", "info", "summary", "tracker", "actions", "documents", "leftToBill", "supplierInvoices"].map((s) => layout.indexOf(`data-section="${s}"`));
  assert.ok(at.every((x) => x > 0), "every section is drawn");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in this order");
  assert.match(layout, /\{photos && <Photos orderId=\{m\.id\} \/>\}/);
  assert.match(layout, /ORDER_DOC_COLUMNS\.map/);
  // No separate Invoices / Service report / Jobs sections, no helper sentence.
  for (const gone of [">Invoices<", "No service report on this order yet", "not invoiced yet", "No jobs yet"]) assert.ok(!layout.includes(gone), gone);
  const page = read("app/portal/orders/[id]/WctOrderDetail.tsx");
  assert.match(page, /orderPageModel\(order, \{ jobsCalendar: !!isJobsCalendarEnabled, doFirst \}\)/);
  assert.doesNotMatch(page, /ImportedOrderDetail|OrderHubPanel/);
  // Every action key has its handler.
  for (const k of ORDER_ACTION_KEYS) assert.match(page, new RegExp(`case "${k}":`), k);
  // The no-autodraft reading of DO first stays on the page (2026-11-19).
  assert.match(page, /const doFirst = manualFlow && \(dos\.length > 0 \|\| !liveJobs\.length\);/);
});

test("native actions: each keeps its gating; Mark complete / Reopen (round 29); Cancel only where the list allows", () => {
  const m = nativeOrderPage(native(), { jobsCalendar: true, doFirst: true });
  const a = Object.fromEntries(m.actions.map((x) => [x.key, x]));
  assert.equal(a["create-invoice"].show, true);
  assert.equal(a["create-invoice"].disabled, true, "nothing new to bill");
  assert.equal(a["add-do"].show, true);
  assert.deepEqual([a["add-job"].show, a["add-job"].mode], [true, "quick"]);
  assert.equal(a["service-report"].show, true);
  assert.deepEqual([a["send-report"].show, a["send-report"].disabled, a["send-report"].primary], [true, false, true], "next step: Send service report");
  assert.equal(a["link-document"].show, true);
  assert.deepEqual([a["mark-complete"].show, a["mark-complete"].disabled, a["mark-complete"].label, a["mark-complete"].mode], [true, false, "Mark complete", "complete"]);
  assert.equal(a["cancel-order"].show, false, "an invoiced order cannot be cancelled");
  assert.deepEqual(m.linkTypes, ["QUOTATION", "INVOICE", "DELIVERY_ORDER", "SERVICE_REPORT"], "manual flow: every type (round 29)");
  assert.deepEqual(nativeOrderPage(native({ manualFlow: false }), {}).linkTypes, ["QUOTATION", "DELIVERY_ORDER", "SERVICE_REPORT"], "WCT Racking: no invoice (its page does not read linked invoices)");
  // Before anything is invoiced: Create invoice from the quotation is the next step; Cancel is offered.
  const fresh = nativeOrderPage(native({ status: "QUOTATION_SIGNED", invoices: [], deliveryOrders: [], jobs: [], jobReports: [], attachments: [] }), { jobsCalendar: false, doFirst: true });
  const f = Object.fromEntries(fresh.actions.map((x) => [x.key, x]));
  assert.deepEqual([f["create-invoice"].disabled, f["create-invoice"].primary], [false, true]);
  assert.equal(f["cancel-order"].show, true);
  assert.equal(f["add-job"].show, false, "manual flow without the calendar and no DO: no broken Add job");
  assert.deepEqual([f["send-report"].disabled, f["send-report"].tip], [true, "Complete or upload a service report first"]);
  // Cancelled: no work actions.
  const c = nativeOrderPage(native({ status: "CANCELLED" }), { jobsCalendar: true });
  assert.deepEqual(c.actions.filter((x) => x.show).map((x) => x.key), ["service-report", "send-report", "link-document"], "a cancelled order is never marked complete");
  assert.equal(c.cancelled, true);
});

test("manual flow, DO completed, invoice pending: always Create invoice (never Open draft invoice), as the next step", () => {
  const o = native({ status: "DO_COMPLETED", invoices: [{ id: "i1", name: "INV1", status: "draft", href: "/i1", total: 10 }], toInvoiceDos: [] });
  const ci = nativeCreateInvoice(o);
  assert.deepEqual([ci.mode, ci.disabled], ["create", false]);
  const m = nativeOrderPage(o, { doFirst: true });
  const a = m.actions.find((x) => x.key === "create-invoice");
  assert.deepEqual([a.label, a.primary, a.disabled], ["Create invoice", true, false]);
  assert.deepEqual(m.nextSteps, []);
  assert.match(nativeInvoiceAsk(o), /When there is nothing new to bill, the order's invoice opens instead\./);
  assert.match(nativeInvoiceAsk({ ...o, toInvoiceDos: ["DO202611023"] }), /^Create the invoice now for DO202611023\? The quotation is already billed/);
  // Off the manual flow (WCT Racking): unchanged, the draft opens.
  const r = nativeOrderPage({ ...o, manualFlow: false }, {});
  assert.deepEqual(r.actions.find((x) => x.key === "create-invoice").label, "Open draft invoice");
  // A draft invoice with nothing new to bill (manual flow, DO pending): Open draft invoice in the Create invoice slot.
  const d = nativeOrderPage(native({ status: "INVOICE_DRAFT_DO_PENDING", invoices: [{ id: "i1", name: "INV1", status: "draft", href: "/i1", total: 10 }] }), { doFirst: true });
  assert.deepEqual(d.actions.find((x) => x.key === "create-invoice").label, "Open draft invoice");
  assert.equal(d.actions.find((x) => x.key === "create-invoice").href, "/i1");
});

test("native next steps that are not row actions keep their own button (Schedule DO, Confirm invoice + Send invoice)", () => {
  const off = (status) => nativeOrderPage(native({ status, manualFlow: false }), { doFirst: false });
  assert.deepEqual(off("DO_DRAFT").nextSteps.map((s) => s.label), ["Schedule DO"]);
  assert.deepEqual(off("INVOICE_DRAFT").nextSteps.map((s) => s.label), ["Confirm invoice", "Send invoice"]);
  assert.deepEqual(off("SERVICE_REPORT_SENT").nextSteps, []);
});

test("imported actions: Open draft invoice, Mark complete / Reopen, all four link types, never Cancel", () => {
  const m = importedOrderPage(imported(), { jobsCalendar: false });
  const a = Object.fromEntries(m.actions.map((x) => [x.key, x]));
  assert.deepEqual([a["create-invoice"].label, a["create-invoice"].mode, a["create-invoice"].href, a["create-invoice"].primary], ["Open draft invoice I-014521-02", "open-draft", "/portal/documents/INVOICE/ti/i2", true]);
  assert.deepEqual([a["add-job"].show, a["add-job"].mode], [true, "do-job"], "manual flow without the calendar: a job on the open DO");
  assert.deepEqual([a["mark-complete"].label, a["mark-complete"].mode], ["Mark complete", "complete"]);
  assert.equal(a["cancel-order"].show, false);
  assert.equal(a["link-document"].show, true);
  assert.deepEqual(m.linkTypes, ["QUOTATION", "INVOICE", "DELIVERY_ORDER", "SERVICE_REPORT"]);
  const done = importedOrderPage(imported({ status: "COMPLETED", canComplete: false, canReopen: true, draftInvoice: null, canInvoice: true }), {});
  const d = Object.fromEntries(done.actions.map((x) => [x.key, x]));
  assert.deepEqual([d["mark-complete"].label, d["mark-complete"].mode], ["Reopen", "reopen"]);
  assert.deepEqual([d["create-invoice"].label, d["create-invoice"].primary], ["Create invoice", false]);
  assert.equal(importedOrderPage(imported({ draftInvoice: null, canInvoice: true }), {}).actions[0].primary, true, "Part billed: Create invoice is the next step");
});

test("tracker cards: numbers as links, the card opens its first document, else its add action; never Not applicable", () => {
  const n = nativeOrderPage(native(), { doFirst: true });
  assert.deepEqual(n.cards.map((c) => c.click), [
    { href: "/portal/documents/QUOTATION/tq/q1" },
    { href: "/portal/documents/INVOICE/ti/i1" },
    { href: "/portal/documents/DELIVERY_ORDER/td/d1" },
    { href: "/portal/maintenance-reports/r1" },
  ]);
  assert.equal(n.cards[1].note, "2 of 2 sent");
  const i = importedOrderPage(imported(), {});
  assert.deepEqual(i.cards.map((c) => c.docs.map((d) => d.label)), [["Q-014154", "QO202611-0050"], ["I-014521", "I-014521-02"], [], []]);
  assert.deepEqual(i.cards.map((c) => c.click), [{ href: "/portal/documents/QUOTATION/tq/q1" }, { href: "/portal/documents/INVOICE/ti/i1" }, { action: "add-do" }, { action: "service-report" }]);
  assert.equal(i.cards[2].subNote, "ERP DO DO011764");
  assert.deepEqual(i.cards.map((c) => c.empty), ["Not yet", "Not yet", "Next", "Not yet"]);
  assert.ok(!JSON.stringify(i.cards).includes("Not applicable"));
  // With documents, the imported report card reads like the native one.
  const r = importedOrderPage(imported({ tracker: [...imported().tracker.slice(0, 3), { key: "serviceReport", label: "Service report", state: "done", docs: [{ label: "#7", status: "Completed", href: "/portal/maintenance-reports/r1" }] }] }), {});
  assert.deepEqual(r.cards[3].docs, [{ label: "Service report #7", status: "Completed", href: "/portal/maintenance-reports/r1" }]);
  // An empty native order: Quotation next, the others not yet; the DO card adds a DO (manual flow), the Invoice card creates one.
  const e = nativeOrderPage(native({ status: "QUOTATION_SIGNED", sourceQuotation: null, invoices: [], deliveryOrders: [], jobs: [], jobReports: [], attachments: [] }), { doFirst: true });
  assert.deepEqual(e.cards.map((c) => [c.empty, c.click]), [["Next", null], ["Not yet", { action: "create-invoice" }], ["Not yet", { action: "add-do" }], ["Not yet", { action: "service-report" }]]);
});

test("summary row on both: Quotation total, Billed, Billed %, Billed qty, Left to bill, Owed", () => {
  const val = (m) => m.summary.map((f) => f.value);
  assert.deepEqual(val(nativeOrderPage(native(), {})), ["S$ 2,616.00", "S$ 2,616.00", "100%", "-", "S$ 0.00", "S$ 1,308.00"]);
  assert.deepEqual(val(importedOrderPage(imported(), {})), ["S$ 2,616.00", "S$ 1,308.00", "50%", "1 of 2 Paid · 2 of 2 Draft", "S$ 1,308.00", "S$ 0.00"]);
  // An older API without the summary: dashes, never a crash.
  assert.deepEqual(val(nativeOrderPage(native({ summary: undefined, sourceQuotation: null }), {})), ["-", "-", "-", "-", "-", "-"]);
  const ex = importedOrderPage(imported({ credited: 109, completed: { reason: "Imported, assumed closed", at: "2026-11-19T07:00:00.000Z", byName: null, auto: true } }), {}).extras;
  assert.deepEqual(ex.map((f) => [f.label, f.value]), [["Credited", "S$ 109.00"], ["Complete (assumed closed)", "Imported, assumed closed, 19/11/2026"]]);
});

test("Documents, native: quotation, each invoice part with its PDF, DO with its job under it, reports, linked report, file", () => {
  const rows = nativeOrderPage(native(), {}).documents;
  assert.deepEqual(rows.map((r) => [r.type, r.number, r.child ?? false]), [
    ["Quotation", "QO202611-0049", false],
    ["Invoice", "INV202611-0080", false],
    ["Invoice", "INV202611-0080-2", false],
    ["DO", "DO202611023", false],
    ["Job", "#7", true],
    ["Service report", "#12", false],
    ["Service report", "#13", false],
    ["File", "signed.pdf", false],
  ]);
  assert.deepEqual(rows[0].file, { label: "PDF", path: "/orders/n1/quotation-pdf" });
  assert.deepEqual([rows[1].note, rows[1].amount, rows[1].owed, rows[1].status], ["Part 1 of 2", 1308, 0, "Paid"]);
  assert.deepEqual(rows[2].file, { label: "PDF", path: "/orders/n1/invoice-pdf?documentId=i2" });
  assert.deepEqual(rows[3].file, { label: "PDF", path: "/delivery-group-posts/delivery/j1/signed-do?documentId=d1" });
  assert.deepEqual(rows[5].file, { label: "Photos", path: "/maintenance-reports/r1/photos-file" });
  assert.deepEqual([rows[6].by, rows[6].unlink], ["Linked by Finance", { type: "SERVICE_REPORT", id: "r2", name: "Service report #13" }]);
  assert.deepEqual([rows[0].unlinkBlocked, rows[1].unlinkBlocked, rows[3].unlinkBlocked, rows[5].unlinkBlocked], ["The order's own quotation", "Made on this order", "Made on this order", "Written for this order"]);
  assert.deepEqual([rows[7].attachmentId, rows[7].fileKey], ["a2", "orders/n1/signed.pdf"]);
});

test("Documents, imported: quotation (+ linked), invoices with how they were linked, AIMS DO + job, ERP DO, reports, file", () => {
  const rows = importedOrderPage(imported(), {}).documents;
  assert.deepEqual(rows.map((r) => [r.type, r.number]), [
    ["Quotation", "Q-014154"],
    ["Quotation", "QO202611-0050"],
    ["Invoice", "I-014521"],
    ["Invoice", "I-014521-02"],
    ["DO", "DO202611070"],
    ["Job", "#12"],
    ["DO", "DO012528"],
    ["Service report", "#7"],
    ["Service report", "#9"],
    ["File", "signed.pdf"],
  ]);
  assert.equal(rows[0].unlink, null, "the order's own quotation: no Unlink");
  assert.deepEqual([rows[1].by, rows[1].unlink], ["Linked by Finance", { type: "QUOTATION", id: "q2", name: "QO202611-0050" }]);
  assert.deepEqual([rows[2].by, rows[2].note, rows[2].unlink], ["ERP contract no.", "ERP DO DO011764", { type: "INVOICE", id: "i1", name: "I-014521" }]);
  assert.equal(rows[3].unlink, null, "an invoice made on the order: no Unlink");
  assert.deepEqual(rows[2].file, { label: "PDF", path: "/orders/o1/invoice-pdf?documentId=i1" });
  assert.equal(rows[4].doId, "d1");
  assert.equal(rows[5].child, true);
  assert.deepEqual([rows[6].by, rows[6].unlink, rows[6].href], ["Imported", { type: "DELIVERY_ORDER", id: "d0", name: "DO012528" }, "/portal/documents/DELIVERY_ORDER/td/d0"]);
  assert.deepEqual(rows[8].unlink, { type: "SERVICE_REPORT", id: "r2", name: "Service report #9" });
  assert.equal(rows[9].attachmentId, "a3");
});

test("row menus at the click: DO menu or Open, Unlink from order on every document row (greyed with its reason), Delete on AIMS drafts", () => {
  const rows = importedOrderPage(imported(), {}).documents;
  const by = (n) => rows.find((r) => r.number === n);
  assert.deepEqual(docRowMenu(by("DO202611070"), { manualFlow: true }), ["do-menu", "unlink", "delete"]);
  assert.deepEqual(docRowMenu(by("DO202611070"), { manualFlow: false }), ["open", "unlink", "delete"]);
  assert.deepEqual(docRowMenu(by("#12"), { manualFlow: true }), ["open-job", "view-do"]);
  assert.deepEqual(docRowMenu(by("QO202611-0050"), { manualFlow: true }), ["open", "unlink"]);
  assert.deepEqual(docRowMenu(by("signed.pdf"), { manualFlow: true }), ["open", "unlink"]);
  assert.deepEqual(docRowMenu(by("Q-014154"), { manualFlow: true }), ["open", "unlink"]);
  // Unlink from order: enabled where the API takes it; greyed with the reason where it refuses.
  assert.deepEqual(rows.map((r) => [r.number, canUnlinkRow(r), r.unlinkBlocked ?? null]), [
    ["Q-014154", false, UNLINK_BLOCKED.ownQuotation],
    ["QO202611-0050", true, null],
    ["I-014521", true, null],
    ["I-014521-02", false, UNLINK_BLOCKED.madeOnOrder],
    ["DO202611070", false, UNLINK_BLOCKED.madeOnOrder],
    ["#12", false, null],
    ["DO012528", true, null],
    ["#7", false, UNLINK_BLOCKED.writtenForOrder],
    ["#9", true, null],
    ["signed.pdf", true, null],
  ]);
  // Delete: only AIMS drafts with nothing paid; never the imported invoice, the ERP DO or the quotation.
  assert.deepEqual(rows.filter((r) => r.deletePath).map((r) => [r.number, r.deletePath]), [["I-014521-02", "/documents/delete/i2"], ["DO202611070", "/documents/delete/d1"], ["#7", "/maintenance-reports/r1"]]);
  const n = nativeOrderPage(native({ invoices: [...native().invoices, { id: "i3", name: "INV202611-0099", status: "draft", href: "/i3", total: 50, gross: 50, owed: null, paid: 0, unlinkable: true }] }), {}).documents;
  assert.deepEqual(n.filter((r) => r.deletePath).map((r) => [r.number, r.deletePath]), [["INV202611-0099", "/documents/delete/i3"], ["#12", "/maintenance-reports/r1"]]);
  // A service report written for the order: Delete while not sent (DELETE /maintenance-reports/:id); a sent one never.
  assert.deepEqual(nativeOrderPage(native({ jobReports: [{ id: "r1", reportNumber: 12, status: "draft" }, { id: "r5", reportNumber: 14, status: "completed", sentAt: "2026-11-12" }] }), {}).documents.filter((r) => r.kind === "report").map((r) => [r.number, r.deletePath ?? null]), [["#12", "/maintenance-reports/r1"], ["#14", null], ["#13", null]]);
  assert.deepEqual(n.filter((r) => canUnlinkRow(r)).map((r) => r.number), ["INV202611-0099", "#13", "signed.pdf"]);
  assert.equal(deletableDraft({ status: "draft", paid: 10 }), false, "a draft with a payment is never offered");
  assert.equal(deletableDraft({ status: "draft", erpImport: { source: "wct-erp" } }), false);
  assert.equal(deletableDraft({ status: "confirmed" }), false);
  const page = read("app/portal/orders/[id]/OrderPageLayout.tsx") + read("app/portal/orders/[id]/WctOrderDetail.tsx") + read("app/portal/orders/[id]/OrderPageDialogs.tsx");
  assert.match(page, /anchorReference="anchorPosition" anchorPosition=\{rowMenu\?\.pos\}/);
  assert.match(page, /onRowMenu\(r, at\(e\)\)/);
  assert.doesNotMatch(page, /anchorEl=/);
  // Destructive items in red, both asked first naming the document; the order reloads after either.
  assert.match(page, /sx=\{\{ color: "error\.main" \}\} onClick=\{go\(\(\) => setRowAsk\(\{ kind: "unlink", row: r \}\)\)\}/);
  assert.match(page, /sx=\{\{ color: "error\.main" \}\} onClick=\{go\(\(\) => setRowAsk\(\{ kind: "delete", row: r \}\)\)\}/);
  assert.match(page, /`Unlink \$\{rowName\(rowAsk\.row\)\} from \$\{order\.orderNumber\}\?`/);
  assert.match(page, /request\(\{ path: r\.deletePath, method: "DELETE" \}/);
  assert.match(page, /`Delete "\$\{rowAsk\.row\.number\}"\?`/);
  assert.match(page, /"Its number stays as a gap\."/);
});

test("Left to bill below Documents on both, only when something is left (priced lines, first line of the text)", () => {
  assert.deepEqual(importedOrderPage(imported(), {}).leftToBill, [{ description: "Maintenance agreement", quotedQty: 2, billedQty: 1, quantity: 1, unitPrice: 1200, amount: 1200 }]);
  assert.deepEqual(importedOrderPage(imported({ remaining: null }), {}).leftToBill, []);
  assert.deepEqual(nativeOrderPage(native(), {}).leftToBill, []);
  const left = nativeOrderPage(native({ summary: { ...native().summary, remaining: { matched: false, remainingNet: 1200, remainingGross: 1308, lines: [{ description: "Balance of quotation QO202611-0049", quantity: 1, unitPrice: 1200, amount: 1200, quotedQty: null, billedQty: null, priced: true }] } } }), {});
  assert.equal(left.leftToBill.length, 1);
});

test("Add job: New job dialog (manual flow + calendar + quotation), a job on the open DO, the schedule dialog off the manual flow", () => {
  assert.equal(addJobMode(native(), { jobsCalendar: true }), "quick");
  assert.equal(addJobMode(native({ deliveryOrders: [{ id: "d", completed: false }] }), { jobsCalendar: false }), "do-job");
  assert.equal(addJobMode(native(), { jobsCalendar: false }), null);
  assert.equal(addJobMode(native({ manualFlow: false }), {}), "schedule");
  assert.equal(addJobMode(native({ status: "CANCELLED" }), { jobsCalendar: true }), null);
});

test("dates read DD/MM/YYYY on the Singapore calendar", () => {
  assert.equal(fmtDate("2026-11-09"), "09/11/2026");
  assert.equal(fmtDate("2026-11-18T17:30:00.000Z"), "19/11/2026");
  assert.equal(fmtDate(null), "");
});

test("UI copy: no em-dashes, no trailing ellipsis in the order page", () => {
  for (const f of ["helpers/orderPage.ts", "app/portal/orders/[id]/OrderPageLayout.tsx", "app/portal/orders/[id]/OrderPageDialogs.tsx", "app/portal/orders/[id]/WctOrderDetail.tsx"]) {
    const src = read(f).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"));
    for (const l of src) {
      const strings = l.match(/"[^"]*"|`[^`]*`|>[^<>{}]+</g) ?? [];
      for (const s of strings) {
        assert.ok(!s.includes("—"), `${f}: ${s}`);
        assert.ok(!/(…|\.\.\.)["`<]?$/.test(s), `${f}: ${s}`);
      }
    }
  }
});

test("other orgs' order pages are untouched: the router still sends only WCT orders here", () => {
  const router = read("app/portal/orders/[id]/page.tsx");
  assert.match(router, /if \(isWctOrdersEnabled\) return <WctOrderDetail id=\{params\.id\} \/>;/);
  assert.match(router, /isCappitechOrdersEnabled \? \(\s*<CappitechOrderDetail params=\{params\} \/>\s*\) : \(\s*<SlimOrderDetail params=\{params\} \/>/);
  for (const f of ["app/portal/orders/[id]/SlimOrderDetail.tsx", "app/portal/orders/[id]/CappitechOrderDetail.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /OrderPageLayout|orderPage|OrderPageDialogs/, f);
  }
});

test("Guide: every order page anchor the Guide knows is stamped on the page (both kinds share them)", () => {
  const know = read("../api-server-production/src/guide/app-knowledge.ts");
  const line = know.split("\n").find((l) => l.startsWith("ONE ORDER PAGE"));
  assert.ok(line, "the ONE ORDER PAGE knowledge line");
  const anchors = [...new Set([...line.matchAll(/"(wct-order-[a-z-]+)"/g)].map((m) => m[1]))];
  assert.ok(anchors.length >= 15);
  const src = ["helpers/orderPage.ts", "app/portal/orders/[id]/OrderPageLayout.tsx", "app/portal/orders/[id]/WctOrderDetail.tsx", "app/portal/orders/[id]/OrderDosSection.tsx"].map(read).join("\n");
  for (const a of anchors) assert.ok(src.includes(`"${a}"`), a);
  // The retired anchors are gone from the page and the Guide.
  const footer = read("../api-server-production/src/guide/guide.service.ts");
  for (const gone of ["wct-order-invoice-now", "wct-order-add-job-doc", "imported-order-tracker", "imported-order-create-invoice"]) {
    assert.ok(!src.includes(gone), gone);
    assert.ok(!know.includes(`"${gone}"`) && !footer.includes(`"${gone}"`), gone);
  }
});

test("round 29: an AIMS order marked complete reads Complete, its steps read the status underneath; Reopen in the row; no next step or Cancel", () => {
  const o = native({ status: "MARKED_COMPLETE", completed: { reason: "Customer closed the job", at: "2026-11-19T08:00:00.000Z", byName: "Finance", underlying: "DO_COMPLETED" }, invoices: [], toInvoiceDos: [] });
  const m = nativeOrderPage(o, { doFirst: true });
  assert.deepEqual([m.statusLabel, m.statusHue], ["Complete", "#64748b"]);
  const a = Object.fromEntries(m.actions.map((x) => [x.key, x]));
  assert.deepEqual([a["mark-complete"].label, a["mark-complete"].mode, a["mark-complete"].disabled], ["Reopen", "reopen", false]);
  assert.equal(a["cancel-order"].show, false);
  assert.equal(m.nextSteps.length, 0);
  assert.ok(m.actions.every((x) => !x.primary), "no highlighted next step on a complete order");
  assert.equal(m.cards.find((c) => c.key === "do").done, true, "the DO card ticks from the status underneath (DO completed)");
  assert.ok(m.cards.every((c) => !c.current));
  assert.deepEqual(m.extras, [{ key: "completed", label: "Marked complete", value: "Customer closed the job, Finance, 19/11/2026" }]);
  // Same structure as any order.
  assert.deepEqual(m.actions.map((x) => x.key), ORDER_ACTION_KEYS);
  assert.deepEqual(m.cards.map((c) => c.key), ORDER_CARD_KEYS);
});

test("round 29: linked quotations and DOs on an AIMS order: Quotation card + Documents rows with Unlink from order; a linked DO has no DO menu", () => {
  const o = native({
    quotations: [{ id: "q9", name: "QO202611-0050", type: "QUOTATION", status: "confirmed", templateId: "tq", date: "2026-11-15", total: 1090, unlinkable: true, linked: { at: "x", byName: "Finance" } }],
    deliveryOrders: [...native().deliveryOrders, { id: "d9", name: "DO202611050", status: "draft", templateId: "td", completed: false, awaitingSignature: false, jobs: [], linkedOnly: true, linked: { at: "x", byName: "Finance" } }],
  });
  const m = nativeOrderPage(o, { doFirst: true });
  assert.deepEqual(m.cards[0].docs.map((d) => d.label), ["QO202611-0049", "QO202611-0050"]);
  const lq = m.documents.find((r) => r.number === "QO202611-0050");
  assert.deepEqual([lq.type, lq.by, lq.amount, lq.status, canUnlinkRow(lq)], ["Quotation", "Linked by Finance", 1090, "Confirmed", true]);
  assert.deepEqual(lq.unlink, { type: "QUOTATION", id: "q9", name: "QO202611-0050" });
  const ld = m.documents.find((r) => r.number === "DO202611050");
  assert.deepEqual([ld.by, ld.doId, ld.unlink, ld.deletePath], ["Linked by Finance", undefined, { type: "DELIVERY_ORDER", id: "d9", name: "DO202611050" }, "/documents/delete/d9"]);
  assert.deepEqual(docRowMenu(ld, { manualFlow: true }), ["open", "unlink", "delete"]);
  // The order's own DO keeps its DO menu and stays "Made on this order".
  const own = m.documents.find((r) => r.number === "DO202611023");
  assert.deepEqual([docRowMenu(own, { manualFlow: true })[0], own.unlinkBlocked], ["do-menu", UNLINK_BLOCKED.madeOnOrder]);
});

