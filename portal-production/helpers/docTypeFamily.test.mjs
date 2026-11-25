import { test } from "node:test";
import assert from "node:assert/strict";
import { docTypeFamily } from "./docTypeFamily.ts";

test("every spelling of a type maps to the whole family", () => {
  assert.deepEqual(docTypeFamily("TI2"), ["INVOICE", "TAX_INVOICE", "INV", "TI", "TI2"]);
  assert.deepEqual(docTypeFamily("invoice"), docTypeFamily("INVOICE"));
  assert.deepEqual(docTypeFamily(["DO"]), ["DELIVERY_ORDER", "DO"]);
  assert.ok(docTypeFamily("QO1").includes("QUOTATION"));
});

test("an unknown type is its own family; nothing gives nothing", () => {
  assert.deepEqual(docTypeFamily("VARIATION_ORDER"), ["VARIATION_ORDER"]);
  assert.deepEqual(docTypeFamily(undefined), []);
  assert.deepEqual(docTypeFamily(""), []);
});

test("docTypeTitle: one display name per family, own wording for returns/receipts/vouchers, Document when unknown", async () => {
  const { docTypeTitle } = await import("./docTypeFamily.ts");
  assert.equal(docTypeTitle("DO"), "Delivery Order");
  assert.equal(docTypeTitle("DELIVERY_ORDER"), "Delivery Order");
  assert.equal(docTypeTitle("TI2"), "Invoice");
  assert.equal(docTypeTitle("invoice"), "Invoice"); // never "Tax Invoice"
  assert.equal(docTypeTitle("QO1"), "Quotation");
  assert.equal(docTypeTitle("PO"), "Purchase Order");
  assert.equal(docTypeTitle("CN"), "Credit Note");
  assert.equal(docTypeTitle("RDO"), "Return Delivery Order");
  assert.equal(docTypeTitle("MSR"), "Maintenance Service Report");
  assert.equal(docTypeTitle("OR"), "Official Receipt");
  assert.equal(docTypeTitle("PAYMENT_VOUCHER"), "Payment Voucher");
  assert.equal(docTypeTitle("BILL"), "Supplier Invoice");
  assert.equal(docTypeTitle(""), "Document");
  assert.equal(docTypeTitle("WHATEVER"), "Document");
});
