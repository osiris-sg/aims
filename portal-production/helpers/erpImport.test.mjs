// ERP-imported documents keep their stored totals: helpers/erpImport.ts + where it is wired.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { erpStoredTotalsOf, moneySignature, storedTotalsFor } from "./erpImport.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const cfg = {
  erpImport: { source: "wct-erp", erpId: "1" },
  items: [{ description: "a", quantity: 1, unitPrice: 850, amount: 850 }],
  grossTotal: 850, subTotal: 850, gstAmount: 198, nettTotal: 1048, gstPercent: 9,
};

test("I-010944: the stored 198 / 1,048 stand while the lines are unchanged", () => {
  const s = erpStoredTotalsOf(cfg);
  assert.deepEqual(storedTotalsFor(s, [{ description: "<p>a</p>", quantity: "1", unitPrice: "850.00", amount: "850" }]), { grossTotal: 850, discountAmount: 0, subTotal: 850, gstAmount: 198, nettTotal: 1048 });
  assert.equal(storedTotalsFor(s, [{ quantity: 2, unitPrice: 850, amount: 1700 }]), null);
  assert.equal(erpStoredTotalsOf({ ...cfg, erpImport: undefined }), null);
  assert.equal(moneySignature([{ isGroupHeader: true }, ...cfg.items]), moneySignature(cfg.items));
});

test("wired: document pages pass the stored totals, the editor uses them", () => {
  for (const p of ["app/portal/documents/[type]/[id]/[documentId]/page.tsx", "app/portal/documents/view/[type]/[id]/[documentId]/page.tsx"]) {
    assert.match(read(p), /erpStoredTotals = erpStoredTotalsOf\(config\)/);
  }
  assert.match(read("containers/DocumentTemplates/components/TabbedDocumentCreator.tsx"), /storedTotalsFor\(existingData\?\.erpStoredTotals, items\)/);
});
