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
