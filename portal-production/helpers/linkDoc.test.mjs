// Run: npm test. Link Document + doc chain + quotation remarks split (WCT group, 2026-11-22).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINK_DOC_FIELD, chainSections, linkDocOn, linkPills, linkedToastText, pageKindOf, pickDate, pickMoney, pickerPath, pickerTabs, remarksSplitOn, statusWords, unlinkConfirmText, withLinkDocFields } from "./linkDoc.ts";

test("tabs per page: Order, QO, DO, Invoice minus the page's own type", () => {
  assert.deepEqual(pickerTabs("QUOTATION").map((t) => t.label), ["Order", "DO", "Invoice"]);
  assert.deepEqual(pickerTabs("DELIVERY_ORDER").map((t) => t.label), ["Order", "QO", "Invoice"]);
  assert.deepEqual(pickerTabs("INVOICE").map((t) => t.label), ["Order", "QO", "DO"]);
  assert.equal(pageKindOf("TI2"), "INVOICE");
  assert.equal(pageKindOf("BILL"), null);
});

test("on only for WCT orders companies, on QO / DO / Invoice, never in template edit; remarks split on the WCT doc nav flag", () => {
  assert.equal(linkDocOn("QUOTATION", { wctOrders: true }), true);
  assert.equal(linkDocOn("INVOICE", { wctOrders: false }), false);
  assert.equal(linkDocOn("INVOICE", { wctOrders: true, templateEdit: true }), false);
  assert.equal(linkDocOn("BILL", { wctOrders: true }), false);
  assert.equal(remarksSplitOn("QO", { wctDocNav: true }), true);
  assert.equal(remarksSplitOn("INVOICE", { wctDocNav: true }), true);
  assert.equal(remarksSplitOn("DO", { wctDocNav: true }), true);
  assert.equal(remarksSplitOn("BILL", { wctDocNav: true }), false);
  assert.equal(remarksSplitOn("QO", { wctDocNav: false }), false);
});

test("pills: the order (x when removable), its quotation, each direct link (x); confirm text", () => {
  const pills = linkPills({
    kind: "INVOICE",
    order: { id: "o1", orderNumber: "ORDW202611-001", href: "/portal/orders/o1", unlinkable: true, quotation: { id: "q1", name: "QO202611-0041", href: "/q" } },
    direct: [{ id: "d1", type: "DELIVERY_ORDER", name: "DO202611-0002", href: "/d" }],
  });
  assert.deepEqual(pills.map((p) => [p.label, !!p.unlink]), [["ORDW202611-001", true], ["QO202611-0041", false], ["DO202611-0002", true]]);
  assert.equal(unlinkConfirmText(pills[0], "INV202611-0026"), "Take INV202611-0026 off ORDW202611-001?");
  assert.equal(unlinkConfirmText(pills[2], "INV202611-0026"), "Unlink INV202611-0026 and DO202611-0002?");
  assert.deepEqual(linkPills({ kind: "INVOICE", order: { id: "o", orderNumber: "ORD", href: "/", unlinkable: false, quotation: null }, direct: [] }).map((p) => !!p.unlink), [false]);
  assert.deepEqual(linkPills(null), []);
  for (const p of pills) assert.ok(!/—/.test(unlinkConfirmText(p, "X")));
});

test("picker path, toast text, money, status words, dates", () => {
  assert.equal(pickerPath("doc", "DELIVERY_ORDER", " ab "), "/order-refs/picker?documentId=doc&kind=DELIVERY_ORDER&q=ab");
  assert.equal(pickerPath("doc", "ORDER", ""), "/order-refs/picker?documentId=doc&kind=ORDER");
  assert.equal(linkedToastText({ mode: "order", orderNumber: "ORDW1", targetName: "DO1" }), "Linked to ORDW1 (through DO1)");
  assert.equal(linkedToastText({ mode: "order", orderNumber: "ORDW1", targetName: "ORDW1" }), "Linked to ORDW1");
  assert.equal(linkedToastText({ mode: "direct", targetName: "DO1" }), "Linked to DO1");
  assert.equal(linkedToastText({ mode: "order", orderNumber: "ORDW1", already: true }), "Already on ORDW1");
  assert.equal(pickMoney(10900), "S$ 10,900.00");
  assert.equal(pickMoney(null), "");
  assert.equal(statusWords("unconfirmed"), "Unconfirmed");
  assert.equal(statusWords("PART_BILLED"), "Part billed");
  assert.equal(statusWords("Part billed"), "Part billed");
  assert.equal(pickDate("2026-11-22"), "22/11/2026");
});

test("doc chain sections: Order, QO, DO(s), Invoice(s); Create only where the order has none; no order = none", () => {
  const s = chainSections({
    kind: "QUOTATION",
    order: { id: "o", orderNumber: "ORDW202611-001", href: "/o" },
    quotations: [{ id: "q", name: "QO1", href: "/q" }],
    dos: [],
    invoices: [{ id: "i1", name: "INV1", href: "/i1" }, { id: "i2", name: null, href: "/i2" }],
    canCreateDo: true,
    canCreateInvoice: false,
    direct: [],
  });
  assert.deepEqual(s.map((x) => [x.label, x.items.map((i) => i.name), x.create ?? null]), [
    ["Order", ["ORDW202611-001"], null],
    ["QO", ["QO1"], null],
    ["DO", [], "do"],
    ["Invoices", ["INV1", "Draft"], null],
  ]);
  assert.deepEqual(chainSections({ kind: "INVOICE", order: null, quotations: [], dos: [], invoices: [], canCreateDo: false, canCreateInvoice: false, direct: [] }), []);
});

test("fields: DO / Invoice Reference becomes Link Document; WCT group: no Customer Remarks row, Link Document in its place", () => {
  const base = [{ fieldName: "documentNo", displayLabel: "Invoice No." }, { fieldName: "documentInfo.referenceNo", displayLabel: "Reference" }, { fieldName: "customer", displayLabel: "Customer" }];
  // WCT group (split on, 2026-11-24): the Reference / Customer Remarks row is gone; the Link Document row takes its place.
  assert.deepEqual(withLinkDocFields(base, { page: "INVOICE", linkOn: true, remarksSplit: true }).map((f) => f.displayLabel), ["Invoice No.", "Link Document", "Customer"]);
  assert.deepEqual(withLinkDocFields(base, { page: "DELIVERY_ORDER", linkOn: true, remarksSplit: true }).map((f) => f.fieldName), ["documentNo", LINK_DOC_FIELD, "customer"]);
  // Split off, Link Document on: the Reference row is the pills row.
  assert.deepEqual(withLinkDocFields(base, { page: "INVOICE", linkOn: true, remarksSplit: false }).map((f) => f.displayLabel), ["Invoice No.", "Link Document", "Customer"]);
  assert.equal(withLinkDocFields(base, { page: "INVOICE", linkOn: false, remarksSplit: false }), base);
  const qo = withLinkDocFields(base, { page: "QUOTATION", linkOn: true, remarksSplit: true });
  assert.deepEqual(qo.map((f) => [f.fieldName, f.displayLabel]), [["documentNo", "Invoice No."], [LINK_DOC_FIELD, "Link Document"], ["customer", "Customer"]]);
  assert.equal(qo.some((f) => f.displayLabel === "Customer Remarks"), false);
  // YMM (doc nav on, no WCT orders): no Reference row and no Link Document row.
  assert.deepEqual(withLinkDocFields(base, { page: "QUOTATION", linkOn: false, remarksSplit: true }).map((f) => f.displayLabel), ["Invoice No.", "Customer"]);
  // Any other org: untouched.
  assert.equal(withLinkDocFields(base, { page: "QUOTATION", linkOn: false, remarksSplit: false }), base);
  // The Link Document row keeps the Reference row's place and is a full row.
  const ordered = withLinkDocFields([{ fieldName: "documentInfo.referenceNo", displayLabel: "Reference", displayOrder: 3, gridSize: 6 }], { page: "QUOTATION", linkOn: true, remarksSplit: true });
  assert.deepEqual(ordered.map((f) => [f.fieldName, f.displayOrder, f.gridSize]), [[LINK_DOC_FIELD, 3, 12]]);
});

// 2026-11-24: PO Number on the WCT invoice header (documentInfo.poNo).
import { withInvoicePoField } from "./linkDoc.ts";
test("PO Number: added once on a WCT invoice only", () => {
  const f = [{ fieldName: "documentInfo.date", displayLabel: "Date" }];
  const out = withInvoicePoField(f, { page: "INVOICE", remarksSplit: true });
  assert.deepEqual(out.map((x) => [x.fieldName, x.displayLabel]), [["documentInfo.date", "Date"], ["documentInfo.poNo", "PO Number"]]);
  assert.equal(withInvoicePoField(out, { page: "INVOICE", remarksSplit: true }).length, 2);
  assert.deepEqual(withInvoicePoField(f, { page: "INVOICE", remarksSplit: false }), f);
  assert.deepEqual(withInvoicePoField(f, { page: "QUOTATION", remarksSplit: true }), f);
  assert.deepEqual(withInvoicePoField(f, { page: "DELIVERY_ORDER", remarksSplit: true }), f);
});
