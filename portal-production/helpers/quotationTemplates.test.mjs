// Run: npm test (node --test). Quotation templates (features.enableQuotationTemplates, WCT group).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isQuotationDocType,
  nameTaken,
  quotationListTemplates,
  saveAsBody,
  saveAsSummary,
  savableItems,
  money,
  quotationTemplateControls,
  templateHeaderFrom,
  templateTotals,
  readReply,
  templatesFrom,
  savedFrom,
  usedDocFrom,
  clashFrom,
  withSaved,
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

const ITEMS = [
  { id: 1, isGroupHeader: true, description: "Hood", quantity: null, unitPrice: null, amount: null },
  { id: 2, itemCode: "SV001", inventoryItemId: "", description: "Exhaust cleaning", quantity: 2, unitPrice: 350, amount: 700, uom: "lot", isService: true, revenueTag: "service", tax: "SR", accountCode: "4000" },
  { id: 3, itemCode: "FLT-1", inventoryItemId: "inv-1", description: "Baffle filter", quantity: 4, unitPrice: 45.5, amount: 182, uom: "pcs", isService: false, tax: "SR" },
  { id: 4, itemCode: "", inventoryItemId: "", description: "", quantity: 1, unitPrice: 0, amount: 0 },
  { id: 5, isGroupHeader: true, description: "  " },
];
const FORM = { documentInfo: { subject: "Hood cleaning", quotationCategory: "Service", termsAndConditions: "50% deposit", remarks: "Call first" }, customer: { id: "c1" } };

test("save as template sends the quotation lines exactly as in the editor (blank rows left out), and the Category", () => {
  assert.deepEqual(savableItems(ITEMS), ITEMS.slice(0, 3));
  // The very same row objects: nothing is reshaped on the way (the API drops only the row id).
  assert.equal(savableItems(ITEMS)[1], ITEMS[1]);
  const body = saveAsBody("  Hood standard ", ITEMS, FORM);
  assert.deepEqual(body, { name: "Hood standard", items: ITEMS.slice(0, 3), category: "Service" });
  assert.deepEqual(saveAsSummary(ITEMS), { lineCount: 2, total: 882 });
  assert.equal(money(882), "882.00");
});

test("save as template never sends Subject, T&Cs, customer, dates or Remarks", () => {
  const json = JSON.stringify(saveAsBody("X", ITEMS, FORM));
  for (const s of ["Hood cleaning", "50% deposit", "Call first", "c1", "subject", "termsAndConditions"]) assert.equal(json.includes(s), false, s);
});

test("a name in use is found (any case); the choice goes as onExisting replace / new", () => {
  const list = [{ id: "t1", name: "Hood standard" }];
  assert.deepEqual(nameTaken(" hood STANDARD ", list), { id: "t1", name: "Hood standard" });
  assert.equal(nameTaken("Other", list), null);
  assert.equal(nameTaken("", list), null);
  assert.equal(saveAsBody("Hood standard", ITEMS, FORM, "replace").onExisting, "replace");
  assert.equal(saveAsBody("Hood standard", ITEMS, FORM, "new").onExisting, "new");
  assert.equal("onExisting" in saveAsBody("Hood standard", ITEMS, FORM), false);
});

test("quotations list: Create Quotation gets the arrow only with the setting on and on a quotation list", () => {
  assert.equal(quotationListTemplates(true, "QUOTATION"), true);
  assert.equal(quotationListTemplates(true, "INVOICE"), false);
  assert.equal(quotationListTemplates(false, "QUOTATION"), false);
  assert.equal(quotationListTemplates(true, undefined), false);
});

test("the header fields come from documentInfo (Subject, Category, T&Cs)", () => {
  assert.deepEqual(templateHeaderFrom({ documentInfo: { subject: " Hood ", quotationCategory: "Service", termsAndConditions: "50%" } }), {
    subject: "Hood",
    category: "Service",
    termsAndConditions: "50%",
  });
  assert.deepEqual(templateHeaderFrom({ quotationCategory: "Top" }), { subject: "", category: "Top", termsAndConditions: "" });
  assert.deepEqual(templateHeaderFrom(null), { subject: "", category: "", termsAndConditions: "" });
});

// ── 2026-11-19 prod bug: "Save as template" saved, but the lists said "No templates yet" ────────────────────────────
// The exact bodies the browser gets (api-server-production quotation-templates.spec.ts "replies as the browser
// receives them"): every reply wrapped { success, data, message }; Use wrapped twice; errors { success: false,
// message, data } and request() adds { details: <that body> }.
const T1 = { id: "t1", name: "Suntec Subj", lines: [], category: null, lineCount: 2, total: 350, unlinked: 0 };
const T2 = { id: "t2", name: "Hood standard", lines: [], category: "Service", lineCount: 1, total: 700, unlinked: 0 };
const LIST_REPLY = { success: true, data: [T2, T1], message: "Action Succeeded" };
const SAVE_REPLY = { success: true, data: { ...T1 }, message: "Action Succeeded" };
const REPLACE_REPLY = { success: true, data: { ...T1, total: 500, replaced: true }, message: "Action Succeeded" };
const USE_REPLY = { success: true, data: { success: true, data: { id: "doc1", type: "QUOTATION", documentTemplateId: "layout-qo", name: "QO202611-0038" } }, message: "Action Succeeded" };
const HIDE_REPLY = { success: true, data: { success: true, id: "t1" }, message: "Action Succeeded" };
const failedCall = (message, data = {}) => ({ success: false, message, details: { success: false, message, data } });

test("the list reply is read inside its envelope (the old bare-array read gave [] = No templates yet)", () => {
  assert.equal(Array.isArray(LIST_REPLY), false);
  assert.deepEqual(templatesFrom(LIST_REPLY), [T2, T1]);
  assert.deepEqual(templatesFrom({ success: true, data: [], message: "x" }), []);
  // A bare array still reads (older replies / tests).
  assert.deepEqual(templatesFrom([T1]), [T1]);
  // A failed call is null (an error, not "No templates yet"); junk rows are dropped.
  assert.equal(templatesFrom(failedCall("Quotation templates are not enabled for this organisation")), null);
  assert.equal(templatesFrom(undefined), null);
  assert.deepEqual(templatesFrom({ success: true, data: [T1, { id: "" }, null, { name: "x" }] }), [T1]);
});

test("a save reads the template from the reply; a failure is never a success", () => {
  assert.deepEqual(savedFrom(SAVE_REPLY), T1);
  assert.equal(savedFrom(REPLACE_REPLY).replaced, true);
  assert.equal(savedFrom(failedCall("A template named Suntec Subj already exists")), null);
  assert.equal(savedFrom({ success: true, data: null }), null);
  assert.equal(savedFrom({ success: true, data: { success: false, message: "x" } }), null);
  assert.equal(savedFrom(undefined), null);
  assert.equal(readReply(failedCall("Name is required")).message, "Name is required");
});

test("a name taken after the list loaded comes back as a clash (Replace / Save as new), other failures do not", () => {
  const clash = failedCall("A template named Suntec Subj already exists", { existingId: "t1", existingName: "Suntec Subj" });
  assert.deepEqual(clashFrom(clash), { id: "t1", name: "Suntec Subj" });
  assert.equal(clashFrom(failedCall("Name is required")), null);
  assert.equal(clashFrom(SAVE_REPLY), null);
  assert.equal(clashFrom(undefined), null);
});

test("Use reads the new quotation through both envelopes (it used to stop silently)", () => {
  assert.deepEqual(usedDocFrom(USE_REPLY), { id: "doc1", type: "QUOTATION", documentTemplateId: "layout-qo", name: "QO202611-0038" });
  assert.equal(USE_REPLY.data.id, undefined);
  assert.equal(usedDocFrom(failedCall("Not a quotation layout")), null);
  assert.equal(usedDocFrom({ success: true, data: { success: true, data: {} } }), null);
  assert.equal(readReply(HIDE_REPLY).ok, true);
  assert.equal(readReply(failedCall("Template not found")).ok, false);
});

test("after a save the shared list shows it at once: new joins by name, Replace swaps the row", () => {
  assert.deepEqual(withSaved(undefined, T1).map((t) => t.id), ["t1"]);
  assert.deepEqual(withSaved([T2], T1).map((t) => t.name), ["Hood standard", "Suntec Subj"]);
  const replaced = withSaved([T2, T1], savedFrom(REPLACE_REPLY));
  assert.deepEqual(replaced.map((t) => t.id), ["t2", "t1"]);
  assert.equal(replaced[1].total, 500);
  assert.equal("replaced" in replaced[1], false);
});
