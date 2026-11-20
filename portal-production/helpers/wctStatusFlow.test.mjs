// node --import ./helpers/test-alias.mjs --test helpers/wctStatusFlow.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { flowDocStatus, flowOrderStatus, flowStatusOptions } from "./wctStatusFlow.ts";

const label = (d) => flowDocStatus(d)?.label ?? null;

test("quotation: Pending until accepted", () => {
  assert.equal(label({ type: "QUOTATION", status: "unconfirmed" }), "Pending");
  assert.equal(label({ type: "QUOTATION", status: "draft" }), "Pending");
  assert.equal(label({ type: "QUOTATION" }), "Pending");
  assert.equal(label({ type: "QUOTATION", status: "confirmed" }), "Accepted");
});

test("invoice: Draft until someone saves it, then Pending, Awaiting Payment, Paid", () => {
  assert.equal(label({ type: "INVOICE", status: "unconfirmed", config: {} }), "Draft");
  assert.equal(label({ type: "INVOICE", status: "unconfirmed", config: { savedAt: "2026-11-19T01:00:00Z" } }), "Pending");
  assert.equal(label({ type: "INVOICE", status: "pending_payment", config: { savedAt: "x" } }), "Awaiting Payment");
  assert.equal(label({ type: "INVOICE", status: "confirmed" }), "Awaiting Payment");
  assert.equal(label({ type: "INVOICE", status: "pending_payment", config: { paidToDate: 10, outstandingBalance: 5 } }), "Partially Paid");
  assert.equal(label({ type: "INVOICE", status: "paid" }), "Paid");
  assert.equal(label({ type: "INVOICE", status: "unconfirmed", config: { voided: true, cancelledWithOrder: true } }), "Voided");
});

test("delivery order: Draft, Pending, Accepted, Cancelled", () => {
  assert.equal(label({ type: "DELIVERY_ORDER", status: "unconfirmed", config: {} }), "Draft");
  assert.equal(label({ type: "DELIVERY_ORDER", status: "unconfirmed", config: { savedAt: "x" } }), "Pending");
  assert.equal(label({ type: "DELIVERY_ORDER", status: "unconfirmed", config: { awaitingSignature: true } }), "Pending");
  assert.equal(label({ type: "DELIVERY_ORDER", status: "confirmed", config: {} }), "Pending");
  assert.equal(label({ type: "DELIVERY_ORDER", status: "delivered_installed", config: {} }), "Accepted");
  assert.equal(label({ type: "DELIVERY_ORDER", status: "unconfirmed", config: { cancelled: true } }), "Cancelled");
});

test("other document types keep their own wording", () => {
  assert.equal(flowDocStatus({ type: "PURCHASE_ORDER", status: "confirmed" }), null);
  assert.equal(flowDocStatus(null), null);
});

test("order: Completed only when delivered, signed and paid", () => {
  const l = (o) => flowOrderStatus(o).label;
  for (const s of ["QUOTATION_SIGNED", "DO_DRAFT", "DO_SCHEDULED", "AWAITING_VERIFICATION", "DO_COMPLETED", "INVOICE_DRAFT", "READY_FOR_SERVICE_REPORT", "OPEN", "INVOICED"]) assert.equal(l({ status: s }), "Pending", s);
  assert.equal(l({ status: "PAID" }), "Completed");
  assert.equal(l({ status: "CLOSED" }), "Completed");
  assert.equal(l({ status: "SERVICE_REPORT_SENT", invoices: [{ status: "pending_payment" }] }), "Pending");
  assert.equal(l({ status: "SERVICE_REPORT_SENT", invoices: [{ status: "paid" }, { status: "voided" }] }), "Completed");
  assert.equal(l({ status: "SERVICE_REPORT_SENT", invoices: [] }), "Pending");
  assert.equal(l({ status: "CANCELLED" }), "Cancelled");
});

test("list filter options follow the document type", () => {
  assert.deepEqual(flowStatusOptions(["QUOTATION"]).map((o) => o.label), ["Pending", "Accepted"]);
  assert.deepEqual(flowStatusOptions(["DELIVERY_ORDER"]).map((o) => o.label), ["Draft", "Pending", "Accepted"]);
  assert.deepEqual(flowStatusOptions(["INVOICE", "TI"]).map((o) => o.label), ["Draft", "Pending", "Awaiting Payment", "Partially Paid", "Paid"]);
  assert.equal(flowStatusOptions(["INVOICE"], { voided: true }).at(-1).label, "Voided");
  assert.equal(flowStatusOptions(["PURCHASE_ORDER"]), null);
  assert.equal(flowStatusOptions([]), null);
});
