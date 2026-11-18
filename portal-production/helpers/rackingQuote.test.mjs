// Run: npm test. WCT Racking quotation editor helpers (enableRackingLayout, 2026-11-18).
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedByDefault, withRackingUom } from "./rackingQuote.ts";

test("UOM goes right after Qty, once", () => {
  assert.deepEqual(withRackingUom(["item", "description", "quantity", "unitPrice", "amount"]), ["item", "description", "quantity", "uom", "unitPrice", "amount"]);
  assert.deepEqual(withRackingUom(["item", "description", "quantity", "uom", "unitPrice"]), ["item", "description", "quantity", "uom", "unitPrice"]);
  assert.deepEqual(withRackingUom(["description", "amount"]), ["description", "amount"]);
});

test("Signed by defaults to the salesperson only while never set", () => {
  assert.equal(signedByDefault({ salesPersonName: "Nee Meng Tan" }), "Nee Meng Tan");
  assert.equal(signedByDefault({ salesPersonName: "Nee Meng Tan", signedBy: "Someone" }), null);
  assert.equal(signedByDefault({ salesPersonName: "Nee Meng Tan", signedBy: "" }), null);
  assert.equal(signedByDefault({ salesPersonName: "" }), null);
  assert.equal(signedByDefault(undefined), null);
});
