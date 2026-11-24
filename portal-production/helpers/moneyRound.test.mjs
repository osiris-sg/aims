// Run: npm test. WCT group UAT 2026-11-25: the editor rounds like the API (document-money.ts roundCents /
// wctTotalsFromNet). Same UAT case as the API's src/documents/wct-rounding-1125.spec.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundCents, wctTotalsFromNet } from "./moneyRound.ts";
import { previewSplit } from "./invoiceSplit.ts";

test("roundCents: half up, float-safe", () => {
  assert.equal(roundCents(1491.5 * 0.09), 134.24);
  assert.equal(roundCents(1.005), 1.01);
  assert.equal(roundCents(-1.005), -1.01);
  assert.equal(roundCents(2.344), 2.34);
  assert.equal(roundCents(NaN), 0);
});

test("the UAT quotation: subtotal 1491.50, GST 134.24, Nett 1625.74 (not 134.23 / 1625.73)", () => {
  const gross = 720 + 650 + 200;
  const net = gross - gross * 0.05;
  assert.deepEqual(wctTotalsFromNet(net, 9, false), { subTotal: 1491.5, gstAmount: 134.24, nettTotal: 1625.74 });
  assert.deepEqual(wctTotalsFromNet(1625.74, 9, true), { subTotal: 1491.5, gstAmount: 134.24, nettTotal: 1625.74 });
});

test("split preview: the parts' GST adds up to the unsplit 134.24, the last part takes the remainder", () => {
  const cfg = {
    gstPercent: 9, taxApplicable: "Y", absorbTax: "N", discountAmount: 78.5,
    items: [
      { description: "Hood", quantity: 1, unitPrice: 800, discount: 10, discountType: "percent", amount: 720 },
      { description: "Duct", quantity: 2, unitPrice: 350, discount: 50, discountType: "amount", amount: 650 },
      { description: "Check", quantity: 1, unitPrice: 200, amount: 200 },
    ],
  };
  const r = previewSplit(cfg, { mode: "rate", parts: [40, { amount: 894.9 }] }, "INV1");
  assert.equal(r.error, null);
  assert.deepEqual(r.parts.map((p) => p.gstAmount), [53.69, 80.55]);
  assert.equal(roundCents(r.parts.reduce((s, p) => s + p.total, 0)), 1625.74);
});
