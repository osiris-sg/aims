// Run: npm test. 2026-11-19: WCT group status set (enableWctStatuses) on quotation / DO / invoice lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wctStatusOptionsFor, wctStatusLabel, wctStatusColor } from "./wctStatuses.ts";

test("WCT status filters per list; flag off or mixed lists: none (the usual options stay)", () => {
  const labels = (types) => (wctStatusOptionsFor(types, true) || []).map((o) => o.label);
  assert.deepEqual(labels(["QUOTATION"]), ["Unconfirmed", "Confirmed", "Expired", "Cancelled", "Declined"]);
  assert.deepEqual(labels(["DELIVERY_ORDER", "DO"]), ["Draft", "Completed", "Cancelled"]);
  assert.deepEqual(labels(["INVOICE", "TI", "TI2"]), ["Draft", "Unpaid", "Part paid", "Paid", "Overdue", "Credited", "Voided"]);
  for (const types of [["INVOICE"], ["QUOTATION"], ["DELIVERY_ORDER"]]) {
    const vals = (wctStatusOptionsFor(types, true) || []).map((o) => o.value);
    for (const gone of ["pending_delivery", "delivered_not_installed", "delivered_installed", "pending_return", "returned", "pending_payment"]) assert.ok(!vals.includes(gone));
  }
  assert.equal(wctStatusOptionsFor(["INVOICE"], false), null);
  assert.equal(wctStatusOptionsFor(["INVOICE", "QUOTATION"], true), null);
  assert.equal(wctStatusOptionsFor(["CREDIT_NOTE"], true), null);
});

test("WCT chip labels and colours", () => {
  assert.equal(wctStatusLabel("part_paid"), "Part paid");
  assert.equal(wctStatusLabel("completed"), "Completed");
  assert.equal(wctStatusColor("overdue"), "error");
  assert.equal(wctStatusColor("paid"), "success");
  // Past due with some paid (Elroy 2026-11-19): its own label, the Overdue colour; still ONE Overdue filter option.
  assert.equal(wctStatusLabel("overdue_part_paid"), "Overdue · part paid");
  assert.equal(wctStatusColor("overdue_part_paid"), wctStatusColor("overdue"));
  assert.equal((wctStatusOptionsFor(["INVOICE"], true) || []).filter((o) => o.label.startsWith("Overdue")).length, 1);
});

test("round 35: Expired (old ERP draft quotation): its own grey chip and filter option", () => {
  assert.equal(wctStatusLabel("expired"), "Expired");
  assert.equal(wctStatusColor("expired"), "default");
  assert.ok((wctStatusOptionsFor(["QUOTATION"], true) || []).some((o) => o.value === "expired"));
  assert.ok(!(wctStatusOptionsFor(["INVOICE"], true) || []).some((o) => o.value === "expired"));
});

