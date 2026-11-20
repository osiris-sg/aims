// Run: npm test. Round 39 (WCT group, 2026-11-20): the invoice / DO Reference = order link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isEmptyItems, itemsFromLines, referenceOf, refDocKind, refLinkOn, refOptionRow, refOptionsPath, withReference } from "./orderRef.ts";

test("on for WCT orders companies only: invoices and DOs everywhere there (round 40: Racking invoices too)", () => {
  const wct = { wctOrders: true, manualFlow: true };
  assert.equal(refLinkOn("INVOICE", wct), true);
  assert.equal(refLinkOn("DELIVERY_ORDER", wct), true);
  // Racking (no manual flow, no imported orders): invoices and DOs (round 40).
  assert.equal(refLinkOn("INVOICE", { wctOrders: true }), true);
  assert.equal(refLinkOn("DO", { wctOrders: true }), true);
  // Other companies (flag off): the plain Reference text field as today.
  assert.equal(refLinkOn("INVOICE", { manualFlow: true }), false);
  assert.equal(refLinkOn("QUOTATION", wct), false);
  assert.deepEqual([refDocKind("TI2"), refDocKind("INVOICE")], [null, "INVOICE"]);
});

test("free text stays a plain reference: typing only changes the text", () => {
  const f = withReference({ documentInfo: { date: "2026-11-20" } }, "PO 4471");
  assert.equal(referenceOf(f), "PO 4471");
  assert.equal(f.documentInfo.referenceNo, "PO 4471");
  assert.equal(f.documentInfo.date, "2026-11-20");
});

test("options path, rows, empty items, filled rows", () => {
  assert.equal(refOptionsPath("", null, false), "/order-refs/options");
  assert.equal(refOptionsPath(" 0051 ", "c1", true), "/order-refs/options?q=0051&customerId=c1&all=1");
  const row = refOptionRow({ quotationId: "q", quotationName: "QO202611-0051", subject: "Hood cleaning", total: 1200, billedPct: 40, customerId: "c", customerName: "TEST Client", orderId: "o", orderNumber: "ORDW202611-004", statusLabel: "Confirmed", open: true, linkable: true });
  assert.equal(row.title, "QO202611-0051 · ORDW202611-004");
  assert.equal(row.detail, "TEST Client · Hood cleaning · S$ 1,200.00 · Billed 40%");
  assert.equal(isEmptyItems([{ description: "", quantity: 1, unitPrice: 0, amount: 0 }]), true);
  assert.equal(isEmptyItems([{ description: "Degreasing", amount: 0 }]), false);
  assert.deepEqual(itemsFromLines([{ description: "A", quantity: 2, unitPrice: 5, amount: 10 }], 7)[0], { id: 7, itemCode: "", inventoryItemId: "", description: "A", quantity: 2, unitPrice: 5, uom: "", discount: 0, amount: 10 });
});
