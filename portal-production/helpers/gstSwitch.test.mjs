// Run: npm test. GST switch confirm pop-up (WCT group, 2026-11-24).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gstMoveRows, gstSwitchLabel } from "./gstSwitch.ts";

test("labels", () => {
  assert.equal(gstSwitchLabel(true), "GST invoice");
  assert.equal(gstSwitchLabel(false), "Non-GST invoice");
});
test("rows: moved and credited documents", () => {
  const rows = gstMoveRows({ blocked: null, headline: "x", to: { id: "b", name: "BC AIR PTE. LTD." }, documents: [{ id: "q", kind: "Quotation", name: "QO1", status: "confirmed", action: "move" }, { id: "i", kind: "Invoice", name: null, status: "pending_payment", action: "credit" }], creditNotes: [] });
  assert.deepEqual(rows, [
    { key: "q", kind: "Quotation", name: "QO1", action: "Moves to BC AIR PTE. LTD., new number" },
    { key: "i", kind: "Invoice", name: "Draft", action: "Credit note here, new draft invoice there" },
  ]);
});
