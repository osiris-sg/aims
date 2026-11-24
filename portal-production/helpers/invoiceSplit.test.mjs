// Run: npm test. 2026-11-17: Split payment (enableInvoiceSplit). Same fixtures as the API's invoice-split.spec.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewSplit, splitButtons, fmtMoney } from "./invoiceSplit.ts";

const CFG = {
  sourceDocumentNumber: "QO202611-0030",
  sourceDocumentType: "QUOTATION",
  gstPercent: 9,
  taxApplicable: "Y",
  absorbTax: "N",
  items: [
    { description: "Supply and install exhaust hood", quantity: 1, unitPrice: 8000, amount: 8000 },
    { description: "Ductwork", quantity: 2, unitPrice: 1000, amount: 2000 },
  ],
};
const B = "INV202611-0014";

test("by rate: starts as 100% (one part) and asks for another", () => {
  assert.equal(previewSplit(CFG, { mode: "rate", parts: [100] }, B).error, "Add at least one more invoice to split.");
});

test("by rate: amounts, GST per part, texts", () => {
  const p = previewSplit(CFG, { mode: "rate", parts: [30, 40, 30] }, B);
  assert.equal(p.error, null);
  assert.deepEqual(
    p.parts.map((x) => [x.label, x.subTotal, x.gstAmount, x.total]),
    [
      ["INV202611-0014-1", 3000, 270, 3270],
      ["INV202611-0014-2", 4000, 360, 4360],
      ["INV202611-0014-3", 3000, 270, 3270],
    ],
  );
  assert.deepEqual(
    p.parts.map((x) => x.description),
    [
      "First payment (30%) of contract value $10,000.00, ref QO202611-0030",
      "Second payment (40%) of contract value $10,000.00, ref QO202611-0030",
      "Final payment (30%) of contract value $10,000.00, ref QO202611-0030",
    ],
  );
});

test("the last part takes the rounding cents", () => {
  const p = previewSplit({ ...CFG, items: [{ amount: 100 }] }, { mode: "rate", parts: [33.33, 33.33, 33.34] }, B);
  assert.deepEqual(p.parts.map((x) => x.amount), [33.33, 33.33, 33.34]);
  const q = previewSplit({ ...CFG, items: [{ amount: 1000.01 }] }, { mode: "rate", parts: [50, 50] }, B);
  assert.deepEqual(q.parts.map((x) => x.amount), [500.01, 500]);
});

test("deposit + rate", () => {
  const p = previewSplit(CFG, { mode: "deposit", deposit: { percent: 30 }, parts: [50, 50] }, B);
  assert.deepEqual(p.parts.map((x) => x.amount), [3000, 3500, 3500]);
  assert.deepEqual(
    p.parts.map((x) => x.description),
    [
      "Deposit (30%) of contract value $10,000.00, ref QO202611-0030",
      "Second payment (50% of balance $7,000.00) of contract value $10,000.00, ref QO202611-0030",
      "Final payment (50% of balance $7,000.00) of contract value $10,000.00, ref QO202611-0030",
    ],
  );
  const f = previewSplit({ ...CFG, sourceDocumentNumber: "" }, { mode: "deposit", deposit: { amount: 2000 }, parts: [100] }, B);
  assert.deepEqual(f.parts.map((x) => x.description), ["Deposit ($2,000.00) of contract value $10,000.00", "Final payment (balance $8,000.00) of contract value $10,000.00"]);
  assert.match(previewSplit(CFG, { mode: "deposit", deposit: { percent: 30 }, parts: [50, 40] }, B).error, /total 100% \(now 90%\)/);
});

test("labels carry no em-dash or ellipsis", () => {
  for (const x of previewSplit(CFG, { mode: "deposit", deposit: { percent: 30 }, parts: [50, 50] }, B).parts) assert.ok(!/[—…]|\.\.\./.test(x.description));
  assert.equal(fmtMoney(1234567.5), "$1,234,567.50");
});

test("toolbar buttons: setting off = nothing (every other org)", () => {
  assert.deepEqual(splitButtons({ enabled: false, isInvoice: true, saved: true, status: "unconfirmed", config: {} }), { split: false, undo: false });
});

test("toolbar buttons: draft only, not imported, not paid, not already split", () => {
  const on = { enabled: true, isInvoice: true, saved: true };
  assert.deepEqual(splitButtons({ ...on, status: "unconfirmed", config: {} }), { split: true, undo: false });
  assert.deepEqual(splitButtons({ ...on, status: "pending_payment", config: {} }), { split: false, undo: false });
  assert.deepEqual(splitButtons({ ...on, status: "draft", config: { erpImport: { source: "ABSS" } } }), { split: false, undo: false });
  assert.deepEqual(splitButtons({ ...on, status: "draft", config: {}, paid: 10 }), { split: false, undo: false });
  assert.deepEqual(splitButtons({ ...on, status: "draft", config: { invoiceSplit: { groupId: "a", part: 2, of: 2 } } }), { split: false, undo: true });
  assert.deepEqual(splitButtons({ ...on, status: "confirmed", config: { invoiceSplit: { groupId: "a", part: 2, of: 2 } } }), { split: false, undo: false });
  assert.deepEqual(splitButtons({ ...on, isInvoice: false, status: "draft", config: {} }), { split: false, undo: false });
});

test("rounding: the parts' subtotal, GST and total add up to the invoice exactly (last part takes the cents)", async () => {
  const { totalsOf } = await import("./invoiceSplit.ts");
  const r = (n) => Math.round(n * 100) / 100;
  for (const absorb of ["N", "Y"]) {
    for (const amt of [0.11, 1.07, 10.01, 99.99, 101.01, 1234.57]) {
      const cfg = { gstPercent: 9, absorbTax: absorb, items: [{ amount: amt }] };
      const o = totalsOf(cfg.items, cfg);
      for (const plan of [{ mode: "rate", parts: [33.33, 33.33, 33.34] }, { mode: "deposit", deposit: { percent: 30 }, parts: [50, 50] }]) {
        const p = previewSplit(cfg, plan, B);
        if (p.error) continue;
        assert.deepEqual(
          [r(p.parts.reduce((s, x) => s + x.subTotal, 0)), r(p.parts.reduce((s, x) => s + x.gstAmount, 0)), r(p.parts.reduce((s, x) => s + x.total, 0))],
          [o.subTotal, o.gstAmount, o.nettTotal],
        );
      }
    }
  }
});

test("a split part keeps its stored totals in the editor while its line is unchanged (erpStoredTotalsOf)", async () => {
  const { erpStoredTotalsOf, storedTotalsFor } = await import("./erpImport.ts");
  const items = [{ amount: 33.34, quantity: 1, unitPrice: 33.34 }];
  const part = { invoiceSplit: { groupId: "g", part: 3, of: 3 }, items, subTotal: 33.34, gstAmount: 2.99, nettTotal: 36.33 };
  assert.equal(storedTotalsFor(erpStoredTotalsOf(part), items).gstAmount, 2.99);
  assert.equal(storedTotalsFor(erpStoredTotalsOf(part), [{ amount: 40, quantity: 1, unitPrice: 40 }]), null);
  assert.equal(erpStoredTotalsOf({ items, subTotal: 33.34, gstAmount: 2.99, nettTotal: 36.33 }), null); // any other invoice: unchanged
});

// 2026-11-24: each row by % or $ (same fixtures as the API's "split rows by amount ($) or %").
import { splitLeft } from "./invoiceSplit.ts";
test("rows by $ or %: mixed rows add up to the contract value", () => {
  const p = previewSplit(CFG, { mode: "rate", parts: [{ amount: 3000 }, 70] }, B);
  assert.equal(p.error, null);
  assert.deepEqual(p.parts.map((x) => [x.subTotal, x.gstAmount, x.total]), [[3000, 270, 3270], [7000, 630, 7630]]);
  assert.equal(p.parts[0].description, "First payment ($3,000.00) of contract value $10,000.00, ref QO202611-0030");
});
test("rows by $: left / over messages, same as the API", () => {
  assert.equal(previewSplit(CFG, { mode: "rate", parts: [{ amount: 3000 }, { amount: 6000 }] }, B).error, "The invoices must add up to the contract value $10,000.00 ($1,000.00 left).");
  assert.equal(previewSplit(CFG, { mode: "rate", parts: [{ amount: 3000 }, 80] }, B).error, "The invoices must add up to the contract value $10,000.00 ($1,000.00 over).");
  assert.equal(previewSplit(CFG, { mode: "deposit", deposit: { amount: 1000 }, parts: [{ amount: 8000 }] }, B).error, "The invoices must add up to the remainder $9,000.00 ($1,000.00 left).");
});
test("deposit + rate keeps working; remainder rows by $", () => {
  const p = previewSplit(CFG, { mode: "deposit", deposit: { amount: 1000 }, parts: [{ amount: 4000 }, { amount: 5000 }] }, B);
  assert.equal(p.error, null);
  assert.deepEqual(p.parts.map((x) => x.subTotal), [1000, 4000, 5000]);
  assert.equal(p.parts[1].description, "Second payment ($4,000.00 of balance $9,000.00) of contract value $10,000.00, ref QO202611-0030");
});
test("what is left to place", () => {
  assert.equal(splitLeft(10000, { mode: "rate", parts: [{ amount: 3000 }, 50] }), 2000);
  assert.equal(splitLeft(10000, { mode: "rate", parts: [{ amount: 3000 }, NaN] }), 7000);
  assert.equal(splitLeft(10000, { mode: "rate", parts: [{ amount: 12000 }] }), -2000);
  assert.equal(splitLeft(10000, { mode: "deposit", deposit: { percent: 10 }, parts: [50] }), 4500);
});
