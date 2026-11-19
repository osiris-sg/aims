// Run: npm test. Round 38 (WCT group, 2026-11-20): the Orders list "+" in empty Quotation / DO(s) / Invoice cells.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canAddCell, createInvoiceHref, LIST_ADD_PERMISSIONS } from "./orderListAdd.ts";

const perms = (list) => ({ admin: false, has: (r, a) => list.includes(`${r}:${a}`) });
const row = { add: { quotation: true, do: true, invoice: true } };

test("a row's '+' needs the row's own allowance (the order page's rules)", () => {
  const all = { admin: true, has: () => true };
  assert.equal(canAddCell({ add: { quotation: false, do: true, invoice: false } }, "quotation", all), false);
  assert.equal(canAddCell({ add: { quotation: false, do: true, invoice: false } }, "do", all), true);
  assert.equal(canAddCell({}, "invoice", all), false);
  assert.equal(canAddCell(null, "invoice", all), false);
});

test("read-only people (Orders: View) see no '+'; each '+' needs what its API call needs", () => {
  const view = perms(["orders:read", "documents:read"]);
  for (const k of ["quotation", "do", "invoice"]) assert.equal(canAddCell(row, k, view), false);
  // Orders: Edit (custom access) grants all three.
  const edit = perms(["orders:read", "orders:create", "orders:update", "documents:create-basic", "documents:update"]);
  for (const k of ["quotation", "do", "invoice"]) assert.equal(canAddCell(row, k, edit), true);
  // Jobs: Edit only (create-basic, no documents:update, no orders:update): "+" DO only.
  const jobs = perms(["documents:create-basic", "deliveries:update"]);
  assert.deepEqual(["quotation", "do", "invoice"].map((k) => canAddCell(row, k, jobs)), [false, true, false]);
  assert.deepEqual(LIST_ADD_PERMISSIONS.invoice, [["documents", "update"]]);
});

test("access still loading = no '+'; the admin sees every allowed '+'", () => {
  assert.equal(canAddCell(row, "do", null), false);
  assert.equal(canAddCell(row, "invoice", { admin: true, has: () => false }), true);
  assert.equal(createInvoiceHref("o1"), "/portal/orders/o1?open=create-invoice");
});
