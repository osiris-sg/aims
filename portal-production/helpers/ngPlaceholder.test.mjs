// Run: npm test. Moved "(NG)" $1 placeholders on a BC Air order (WCT group, 2026-11-25): the order's own document,
// greyed "placeholder, not counted", a plain link (no company switch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { importedOrderPage } from "./orderPage.ts";
import { chainSections } from "./linkDoc.ts";

test("own placeholder: greyed pill with its own link, not an invoice of the order", () => {
  const m = importedOrderPage({
    id: "o1",
    orderNumber: "ORD-Q-012302",
    sourceQuotation: { id: "q1", name: "Q-012302", type: "QUOTATION", documentTemplateId: "tq" },
    invoices: [{ id: "i1", name: "I002508", type: "INVOICE", templateId: "t", total: 1800, stateLabel: "Paid" }],
    crossPlaceholders: [{ id: "p1", name: "I-012164", type: "INVOICE", templateId: "t", total: 1, crossOrg: null }],
  });
  const inv = m.documents.filter((r) => r.kind === "invoice");
  assert.deepEqual(inv.map((r) => [r.number, !!r.placeholder]), [["I002508", false], ["I-012164", true]]);
  assert.equal(inv[1].href, "/portal/documents/INVOICE/t/p1");
  assert.equal(inv[1].note, "placeholder, not counted");
  assert.deepEqual(m.cards.find((c) => c.key === "invoice").docs.map((d) => !!d.placeholder), [false, true]);
});

test("doc chain: an own placeholder is greyed and does not stop + Create invoice", () => {
  const s = chainSections({ kind: "INVOICE", order: { id: "o1", orderNumber: "ORD-Q-1", href: "/portal/orders/o1" }, quotations: [], dos: [], invoices: [{ id: "p1", name: "I-1", type: "INVOICE", href: "/x", placeholder: true }], canCreateDo: true, canCreateInvoice: true, direct: [] });
  const invSec = s.find((x) => x.key === "invoice");
  assert.deepEqual(invSec.items.map((i) => !!i.placeholder), [true]);
  assert.equal(invSec.create, "invoice");
});

test("labels: a moved invoice reads Moved from WCT (S); a moved placeholder is own, not another company's", () => {
  const m = importedOrderPage({
    id: "o1",
    orderNumber: "ORD-Q-014936",
    sourceQuotation: { id: "q1", name: "Q-014936", type: "QUOTATION", documentTemplateId: "tq" },
    invoices: [{ id: "i1", name: "I-015304", type: "INVOICE", templateId: "t", total: 250, stateLabel: "Unpaid", linkSource: "moved-from-wct" }],
    crossPlaceholders: [
      { id: "p1", name: "I-007118", type: "INVOICE", templateId: "t", total: 1, crossOrg: null, linkSource: "moved-from-wct" },
      { id: "p2", name: "I-013120", type: "INVOICE", templateId: "t", total: 1, crossOrg: { orgId: "5c700000-0000-4000-8000-5c7000000001", orgName: "WCT (S)", canOpen: false } },
    ],
  });
  const inv = m.documents.filter((r) => r.kind === "invoice");
  assert.deepEqual(inv.map((r) => [r.number, r.by, !!r.placeholder]), [
    ["I-015304", "Moved from WCT (S)", false],
    ["I-007118", "Moved from WCT (S)", true],
    ["I-013120 · WCT (S)", "WCT (S) (read only)", true],
  ]);
  assert.equal(inv[1].href, "/portal/documents/INVOICE/t/p1");
  assert.equal(inv[1].unlinkBlocked, "Placeholder, not counted");
  assert.equal(inv[2].href, null);
  assert.ok(inv.every((r) => !String(r.by).includes("\u2014")));
});
