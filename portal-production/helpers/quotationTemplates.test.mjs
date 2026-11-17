// Run: npm test (node --test). Quotation templates (features.enableQuotationTemplates, WCT group).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editorItemsToTemplateLines,
  isQuotationDocType,
  money,
  quotationTemplateControls,
  templateHeaderFrom,
  templateTotals,
} from "./quotationTemplates.ts";

const none = { legacyAddSplit: false, standardAddSplit: false, saveAsTemplate: false };

test("setting off: no template controls in either layout, any document type (other orgs unchanged)", () => {
  for (const legacyLayout of [true, false]) {
    for (const documentType of ["QUOTATION", "QO", "INVOICE", "DELIVERY_ORDER", null]) {
      assert.deepEqual(quotationTemplateControls({ enabled: false, documentType, legacyLayout, templateMode: false }), none);
    }
  }
});

test("setting on, legacy layout (enableHeaderGlAccount): the toolbar Add becomes the split button + Save as template", () => {
  assert.deepEqual(quotationTemplateControls({ enabled: true, documentType: "QUOTATION", legacyLayout: true, templateMode: false }), {
    legacyAddSplit: true,
    standardAddSplit: false,
    saveAsTemplate: true,
  });
});

test("setting on, standard layout: a split Add on the toolbar + Save as template", () => {
  assert.deepEqual(quotationTemplateControls({ enabled: true, documentType: "QO1", legacyLayout: false, templateMode: false }), {
    legacyAddSplit: false,
    standardAddSplit: true,
    saveAsTemplate: true,
  });
});

test("setting on: only quotations, never in layout-template edit mode", () => {
  for (const t of ["INVOICE", "DO", "PO", "CN", ""]) {
    assert.deepEqual(quotationTemplateControls({ enabled: true, documentType: t, legacyLayout: true, templateMode: false }), none);
  }
  assert.deepEqual(quotationTemplateControls({ enabled: true, documentType: "QUOTATION", legacyLayout: true, templateMode: true }), none);
  assert.equal(isQuotationDocType("qt"), true);
});

test("save as template copies the editor lines (item, description, qty, unit price, line type)", () => {
  const lines = editorItemsToTemplateLines([
    { id: 1, itemCode: "SV001", description: "Exhaust cleaning", quantity: 2, unitPrice: 350, amount: 700, isService: true, revenueTag: "service" },
    { id: 2, itemCode: "FLT-1", inventoryItemId: "inv-1", description: "Baffle filter", quantity: "4", unitPrice: "45.5", uom: "pcs", rateMerge: { id: "m" } },
    { id: 3, isGroupHeader: true, description: "Hood" },
    { id: 4, description: "", itemCode: "" },
  ]);
  assert.deepEqual(lines, [
    { itemCode: "SV001", description: "Exhaust cleaning", quantity: 2, unitPrice: 350, lineType: "SERVICE" },
    { itemCode: "FLT-1", description: "Baffle filter", quantity: 4, unitPrice: 45.5, lineType: "PRODUCT", inventoryItemId: "inv-1", uom: "pcs" },
    { itemCode: "", description: "Hood", quantity: 0, unitPrice: 0, lineType: "SERVICE", isGroupHeader: true },
  ]);
  assert.deepEqual(templateTotals(lines), { lineCount: 2, total: 882 });
  assert.equal(money(882), "882.00");
});

test("the header fields come from documentInfo (Subject, Category, T&Cs)", () => {
  assert.deepEqual(templateHeaderFrom({ documentInfo: { subject: " Hood ", category: "Service", termsAndConditions: "50%" } }), {
    subject: "Hood",
    category: "Service",
    termsAndConditions: "50%",
  });
  assert.deepEqual(templateHeaderFrom({ category: "Top" }), { subject: "", category: "Top", termsAndConditions: "" });
  assert.deepEqual(templateHeaderFrom(null), { subject: "", category: "", termsAndConditions: "" });
});
