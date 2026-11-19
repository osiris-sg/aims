// Run: npm test. Imported orders (2026-11-18): list source filter, no row actions, links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { importedBilledPct, showBilledPctColumn, importedDocHref, importedLinkSourceLabel, importedMatchesTab, importedRowActions, importedTabs, isImportedTab, matchesOrderSource, defaultOrderSource, newestFirst } from "./importedOrders.ts";

const native = { id: "n1" };
const imported = { id: "i1", imported: true };

test("default source (AIMS orders) hides imported orders; Imported shows only them; All shows both", () => {
  assert.deepEqual([native, imported].filter((r) => matchesOrderSource(r, "aims")), [native]);
  assert.deepEqual([native, imported].filter((r) => matchesOrderSource(r, "imported")), [imported]);
  assert.deepEqual([native, imported].filter((r) => matchesOrderSource(r, "all")), [native, imported]);
});
test("imported rows have no actions; native rows keep theirs", () => {
  assert.deepEqual(importedRowActions(imported), []);
  assert.equal(importedRowActions(native), null);
});
test("document links and link-source labels", () => {
  assert.equal(importedDocHref({ id: "d", name: "I-1", templateId: "t" }, "INVOICE"), "/portal/documents/INVOICE/t/d");
  assert.equal(importedDocHref({ id: "d", name: "Q-1", type: "QUOTATION", documentTemplateId: "t" }, "X"), "/portal/documents/QUOTATION/t/d");
  assert.equal(importedDocHref({ id: "d", name: "x" }, "INVOICE"), null);
  assert.equal(importedLinkSourceLabel("contract_no"), "ERP contract no.");
  assert.equal(importedLinkSourceLabel(null), "");
});
test("imported status filter: own entries (Part billed / Invoiced / Paid), never mixed with AIMS statuses", () => {
  const rows = [{ id: "n", status: "PAID" }, { id: "a", imported: true, status: "INVOICED" }, { id: "b", imported: true, status: "PAID" }, { id: "c", imported: true, status: "INVOICED" }];
  assert.deepEqual(importedTabs(rows), [
    { key: "imported:INVOICED", label: "Invoiced (imported)", count: 2 },
    { key: "imported:PAID", label: "Paid (imported)", count: 1 },
  ]);
  // "Part billed" is back as its own entry (2026-11-19, rule B).
  assert.deepEqual(importedTabs([{ imported: true, status: "PART_BILLED" }]), [{ key: "imported:PART_BILLED", label: "Part billed (imported)", count: 1 }]);
  assert.equal(isImportedTab("imported:PAID"), true);
  assert.equal(isImportedTab("PAID"), false);
  assert.deepEqual(rows.filter((r) => importedMatchesTab(r, "imported:INVOICED")).map((r) => r.id), ["a", "c"]);
  assert.deepEqual(rows.filter((r) => importedMatchesTab(r, "all")).map((r) => r.id), ["a", "b", "c"]);
  assert.equal(importedMatchesTab(rows[2], "PAID"), false);
  assert.equal(importedLinkSourceLabel("erp_quotation_link"), "ERP quotation link");
});
test("Billed %: one decimal, blank without a quotation total; column only with imported orders in view", () => {
  assert.equal(importedBilledPct(50), "50%");
  assert.equal(importedBilledPct(33.3), "33.3%");
  assert.equal(importedBilledPct(110.1), "110.1%");
  assert.equal(importedBilledPct(null), "");
  assert.equal(importedBilledPct(undefined), "");
  assert.equal(showBilledPctColumn(true, "imported"), true);
  assert.equal(showBilledPctColumn(true, "all"), true);
  assert.equal(showBilledPctColumn(true, "aims"), false);
  assert.equal(showBilledPctColumn(false, "all"), false);
});

test("orgs with imported orders open on All orders; every other org keeps AIMS orders", () => {
  assert.equal(defaultOrderSource({ enableImportedOrders: true }), "all");
  assert.equal(defaultOrderSource({ enableImportedOrders: false }), "aims");
  assert.equal(defaultOrderSource({}), "aims");
  assert.equal(defaultOrderSource(null), "aims");
  assert.equal(defaultOrderSource(undefined), "aims");
});
test("newest first: a live order sits above imported history", () => {
  const rows = [
    { id: "imp-old", imported: true, createdAt: "2019-02-13T01:00:00.000Z" },
    { id: "live", createdAt: "2026-11-17T06:35:42.677Z" },
    { id: "imp-new", imported: true, createdAt: "2026-11-04T01:00:00.000Z" },
    { id: "nodate" },
  ];
  assert.deepEqual(newestFirst(rows).map((r) => r.id), ["live", "imp-new", "imp-old", "nodate"]);
  assert.equal(rows[0].id, "imp-old");
});

// 2026-11-19: Part billed / Complete statuses, "1 of 2", and the order page's actions only after success.
test("imported orders: Part billed and Complete tabs, hues, billed qty", async () => {
  const { IMPORTED_STATUS_TABS, importedTabs, importedStatusHue, importedProgress } = await import("./importedOrders.ts");
  assert.deepEqual(IMPORTED_STATUS_TABS.map((t) => t.label), ["Part billed", "Invoiced", "Paid", "Complete", "DO draft", "DO completed, invoice pending"]);
  assert.deepEqual(importedTabs([{ imported: true, status: "PART_BILLED" }, { imported: true, status: "PART_BILLED" }, { imported: true, status: "COMPLETED" }]).map((t) => [t.label, t.count]), [["Part billed (imported)", 2], ["Complete (imported)", 1]]);
  assert.equal(importedStatusHue("PART_BILLED"), "#d97706");
  assert.notEqual(importedStatusHue("COMPLETED"), importedStatusHue("PAID"));
  assert.equal(importedProgress({ billed: 1, quoted: 2 }), "1 of 2");
  assert.equal(importedProgress(null), "");
});

test("imported order page: Create invoice / Mark complete / Reopen act only when the call succeeded", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../app/portal/orders/[id]/ImportedOrderDetail.tsx", import.meta.url), "utf8");
  for (const fn of ["createInvoice", "markComplete", "reopen"]) {
    const body = src.slice(src.indexOf(`const ${fn} = async`), src.indexOf("};", src.indexOf(`const ${fn} = async`)));
    assert.match(body, /if \(requestFailed\(res\)\) return;/, fn);
  }
  assert.match(src, /invoice-remaining/);
  assert.match(src, /mark-complete/);
});

test("imported orders: billed steps line, DO statuses (2026-11-19)", async () => {
  const { importedSteps, importedStatusHue } = await import("./importedOrders.ts");
  assert.equal(importedSteps([{ label: "1 of 2", state: "Paid" }, { label: "2 of 2", state: "Draft" }]), "1 of 2 Paid · 2 of 2 Draft");
  assert.equal(importedSteps([]), "");
  assert.equal(importedStatusHue("DO_DRAFT"), importedStatusHue("DO_COMPLETED"));
  assert.notEqual(importedStatusHue("DO_DRAFT"), importedStatusHue("INVOICED"));
});

// Round 19 (2026-11-19): imported orders open for backfilling: the Documents rows and their menus, the Link dialog.
import { importedDocRows, invoiceDialogLines, linkOptionState, IMPORTED_LINK_TYPES } from "./importedOrders.ts";

const r19 = {
  id: "o1",
  orderNumber: "ORD-Q-014154",
  status: "PAID",
  imported: true,
  createdAt: "2026-01-01",
  tracker: [],
  total: 2616,
  owed: 0,
  sourceQuotation: { id: "q1", name: "Q-014154", type: "QUOTATION", documentTemplateId: "tq", total: 2616 },
  quotations: [{ id: "q2", name: "QO202611-0050", type: "QUOTATION", templateId: "tq", total: 1090, unlinkable: true, linked: { at: "x", byName: "Finance" } }],
  invoices: [
    { id: "i1", name: "I-014521", templateId: "ti", total: 1308, owed: 0, state: "PAID", stateLabel: "Paid", linkSource: "contract_no", unlinkable: true },
    { id: "i2", name: "INV202611-0100", templateId: "ti", total: 1308, owed: 1308, state: "UNPAID", stateLabel: "Draft", native: true, unlinkable: false },
  ],
  creditNotes: [],
  deliveryOrders: [{ id: "d1", name: "DO202611070", status: "draft", templateId: "td", completed: false, awaitingSignature: false, jobs: [] }],
  linkedDos: [{ id: "d0", name: "DO012528", templateId: "td", done: true, imported: true, unlinkable: true, linked: null }],
  jobs: [{ id: "j1", deliveryNumber: 12, status: "scheduled", isDraft: true, scheduledFor: null }],
  jobReports: [{ id: "r1", reportNumber: 7, status: "completed", jobNumber: 12 }],
  attachments: [
    { id: "a1", kind: "report", reportId: "r1", report: { reportNumber: 7, status: "completed" } },
    { id: "a2", kind: "report", reportId: "r2", report: { reportNumber: 9, status: "draft" } },
    { id: "a3", kind: "file", fileKey: "k", fileName: "signed.pdf" },
  ],
};

test("round 19: Documents rows in order, each with what its menu can do", () => {
  const rows = importedDocRows(r19);
  assert.deepEqual(rows.map((r) => [r.kind, r.label]), [
    ["quotation", "Quotation Q-014154"],
    ["linkedQuotation", "Quotation QO202611-0050"],
    ["invoice", "Invoice I-014521"],
    ["invoice", "Invoice INV202611-0100"],
    ["do", "DO DO202611070"],
    ["linkedDo", "DO DO012528"],
    ["job", "Job #12"],
    ["report", "Service report #7"],
    ["report", "Service report #9"],
    ["file", "signed.pdf"],
  ]);
  // The order's own quotation and an invoice made on the order: no Unlink.
  assert.equal(rows[0].unlink, undefined);
  assert.equal(rows[3].unlink, null);
  assert.deepEqual(rows[1].unlink, { type: "QUOTATION", id: "q2", name: "QO202611-0050" });
  assert.equal(rows[1].by, "Linked by Finance");
  assert.deepEqual(rows[2].unlink, { type: "INVOICE", id: "i1", name: "I-014521" });
  assert.equal(rows[2].by, "ERP contract no.");
  assert.equal(rows[4].doId, "d1");
  assert.deepEqual(rows[5].unlink, { type: "DELIVERY_ORDER", id: "d0", name: "DO012528" });
  assert.equal(rows[5].href, "/portal/documents/DELIVERY_ORDER/td/d0");
  // A linked report already listed as a job report is not repeated; a linked one is unlinkable; a file is removable.
  assert.deepEqual(rows[8].unlink, { type: "SERVICE_REPORT", id: "r2", name: "Service report #9" });
  assert.equal(rows[9].attachmentId, "a3");
  assert.equal(rows[6].href, "/portal/deliveries/j1");
});

test("round 19: Link dialog options and Create invoice lines", () => {
  assert.deepEqual(IMPORTED_LINK_TYPES.map((t) => t.key), ["QUOTATION", "INVOICE", "DELIVERY_ORDER", "SERVICE_REPORT"]);
  assert.deepEqual(linkOptionState({ onOrder: null, onThisOrder: false }), { disabled: false, note: "" });
  assert.deepEqual(linkOptionState({ onOrder: { id: "x", orderNumber: "ORD202611-020" }, onThisOrder: false }), { disabled: true, note: "On ORD202611-020" });
  assert.deepEqual(linkOptionState({ onOrder: null, onThisOrder: true }), { disabled: true, note: "On this order" });
  assert.deepEqual(invoiceDialogLines({ invoiceLines: [{ description: "MA", quantity: 2, unitPrice: 1200, amount: 2400, priced: true }] }), [{ description: "MA", quantity: "2", unitPrice: "1200", priced: true }]);
  assert.deepEqual(invoiceDialogLines({ remaining: { lines: [{ description: "Left", quantity: 1, unitPrice: 5, amount: 5, priced: true }] } }), [{ description: "Left", quantity: "1", unitPrice: "5", priced: true }]);
  assert.deepEqual(invoiceDialogLines({}), [{ description: "", quantity: "1", unitPrice: "0", priced: true }]);
});
