// Run: npm test. WCT quotation + invoice discounts (2026-11-25).
import { test } from "node:test";
import assert from "node:assert/strict";
import { withDocumentDiscountField, withLineDiscountColumn, wctDiscountsOn } from "./wctDiscount.ts";

test("Discount column before Amount on the WCT quotation / invoice only", () => {
  assert.deepEqual(withLineDiscountColumn(["item", "description", "quantity", "unitPrice", "amount"], true), ["item", "description", "quantity", "unitPrice", "discount", "amount"]);
  assert.deepEqual(withLineDiscountColumn(["description", "quantity"], true), ["description", "quantity", "discount"]);
  assert.deepEqual(withLineDiscountColumn(["unitPrice", "discount", "amount"], true), ["unitPrice", "discount", "amount"]);
  const cols = ["item", "description", "quantity", "unitPrice", "amount"];
  assert.equal(withLineDiscountColumn(cols, false), cols);
});

test("Disc row after Gross Total, once; untouched when off or without Gross Total", () => {
  const f = [{ fieldName: "documentInfo.rate" }, { fieldName: "documentInfo.grossTotal" }, { fieldName: "documentInfo.subTotal" }];
  assert.deepEqual(withDocumentDiscountField(f, true).map((x) => x.fieldName), ["documentInfo.rate", "documentInfo.grossTotal", "documentInfo.discountPercent", "documentInfo.subTotal"]);
  assert.equal(withDocumentDiscountField(f, false), f);
  const has = [...f, { fieldName: "documentInfo.discountPercent" }];
  assert.equal(withDocumentDiscountField(has, true), has);
  const left = [{ fieldName: "documentInfo.subject" }];
  assert.equal(withDocumentDiscountField(left, true), left);
});

test("only WCT doc nav quotations and invoices, never in template editing", () => {
  assert.equal(wctDiscountsOn({ wctDocNav: true, isQuotation: true, isInvoice: false, templateMode: false }), true);
  assert.equal(wctDiscountsOn({ wctDocNav: true, isQuotation: false, isInvoice: true, templateMode: false }), true);
  assert.equal(wctDiscountsOn({ wctDocNav: true, isQuotation: false, isInvoice: false, templateMode: false }), false);
  assert.equal(wctDiscountsOn({ wctDocNav: false, isQuotation: true, isInvoice: false, templateMode: false }), false);
  assert.equal(wctDiscountsOn({ wctDocNav: true, isQuotation: true, isInvoice: false, templateMode: true }), false);
});

test("Totals panel (1125b): line discounts total for Gross Total and the Disc amount", async () => {
  const { lineDiscountsTotal, lineDiscountOff } = await import("./wctDiscount.ts");
  const l1 = { quantity: 4, unitPrice: 200, discount: 10, discountType: "percent", amount: 720 };
  const l2 = { quantity: 1, unitPrice: 350, discount: 50, discountType: "amount", amount: 300 };
  const free = { quantity: 2, unitPrice: 100, discount: 100, amount: 0 };
  assert.equal(lineDiscountOff(l1), 80);
  assert.equal(lineDiscountOff({ quantity: 1, unitPrice: 30, discount: 90, discountType: "amount" }), 30);
  assert.equal(lineDiscountOff({ quantity: 1, unitPrice: 30 }), 0);
  // Gross Total shown = stored gross (net lines 1,020) + 130 = 1,150; Disc shown = document 51 + 130 = 181.
  assert.equal(lineDiscountsTotal([l1, l2]), 130);
  assert.equal(lineDiscountsTotal([l1, l2, free, { isGroupHeader: true, discount: 5, quantity: 1, unitPrice: 9 }, { rateMerge: true, discount: 5, quantity: 1, unitPrice: 9 }]), 330);
  assert.equal(lineDiscountsTotal([]), 0);
  assert.equal(lineDiscountsTotal(undefined), 0);
});
