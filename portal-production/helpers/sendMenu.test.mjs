// Run: npm test (node --test). The toolbar Send menu (features.enableWctDocNav): options per document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { editorSendControls, editorSendOptions, reportSendControls, reportSendOptions, sendDocKind } from "./sendMenu.ts";

const base = { saved: true, confirmed: false, templateMode: false, quotationESign: true, doOnOrder: false, doCompleted: false };
const keys = (opts) => opts.map((o) => `${o.key}${o.disabled ? "(off)" : ""}`);

test("quotation (e-sign org): Send for signature + Send email + WhatsApp (disabled)", () => {
  assert.deepEqual(keys(editorSendOptions({ ...base, documentType: "QUOTATION" })), ["sign", "email", "whatsapp(off)"]);
  assert.deepEqual(editorSendOptions({ ...base, documentType: "QO" }).map((o) => o.label), ["Send for signature", "Send email", "Send WhatsApp"]);
});

test("quotation: signature only while saved, unconfirmed, not a template (the old button's rule); email any status", () => {
  assert.deepEqual(keys(editorSendOptions({ ...base, documentType: "QUOTATION", confirmed: true })), ["email", "whatsapp(off)"]);
  assert.deepEqual(keys(editorSendOptions({ ...base, documentType: "QUOTATION", saved: false })), ["email", "whatsapp(off)"]);
  assert.deepEqual(keys(editorSendOptions({ ...base, documentType: "QUOTATION", templateMode: true })), ["email", "whatsapp(off)"]);
  assert.deepEqual(keys(editorSendOptions({ ...base, documentType: "QUOTATION", quotationESign: false })), ["email", "whatsapp(off)"]);
});

test("invoice: Send email (any status) + WhatsApp; no signature", () => {
  for (const t of ["INVOICE", "TI", "TI2"]) {
    assert.deepEqual(keys(editorSendOptions({ ...base, documentType: t })), ["email", "whatsapp(off)"]);
    assert.deepEqual(keys(editorSendOptions({ ...base, documentType: t, confirmed: true })), ["email", "whatsapp(off)"]);
  }
});

test("DO: Send for signature + WhatsApp; no email (the API emails only invoices and quotations)", () => {
  assert.deepEqual(keys(editorSendOptions({ ...base, documentType: "DELIVERY_ORDER", doOnOrder: true })), ["sign", "whatsapp(off)"]);
  assert.deepEqual(keys(editorSendOptions({ ...base, documentType: "DO" })), ["sign", "whatsapp(off)"]);
  // A completed DO on an order shows no sign link (as the old toolbar); nothing else = no Send button.
  assert.deepEqual(editorSendOptions({ ...base, documentType: "DELIVERY_ORDER", doOnOrder: true, doCompleted: true }), []);
  assert.deepEqual(editorSendOptions({ ...base, documentType: "DELIVERY_ORDER", saved: false }), []);
  assert.deepEqual(editorSendOptions({ ...base, documentType: "DELIVERY_ORDER", templateMode: true }), []);
});

test("other documents get no Send menu", () => {
  for (const t of ["PURCHASE_ORDER", "SALES_ORDER", "RDO", "OFFICIAL_RECEIPT", "", null]) {
    assert.deepEqual(editorSendOptions({ ...base, documentType: t }), []);
  }
  assert.equal(sendDocKind("qo2"), "quotation");
  assert.equal(sendDocKind("BILL"), "other");
});

test("service report: WCT paper on an order = Send email (disabled until completed) + WhatsApp; no signature", () => {
  const r = { isWctPaper: true, isUploaded: false, manualOrderFlow: true, onOrder: true, deleted: false };
  assert.deepEqual(keys(reportSendOptions({ ...r, status: "draft" })), ["email(off)", "whatsapp(off)"]);
  assert.deepEqual(keys(reportSendOptions({ ...r, status: "completed" })), ["email", "whatsapp(off)"]);
  assert.deepEqual(keys(reportSendOptions({ ...r, status: "completed", deleted: true })), ["email(off)", "whatsapp(off)"]);
  // Not on an order, or no manual flow: no email send exists; WCT paper has no sign link: no Send button.
  assert.deepEqual(reportSendOptions({ ...r, status: "completed", onOrder: false }), []);
  assert.deepEqual(reportSendOptions({ ...r, status: "completed", manualOrderFlow: false }), []);
});

test("service report: generic report, not completed = Send for signature (the old Customer sign link rule)", () => {
  const r = { isWctPaper: false, isUploaded: false, manualOrderFlow: false, onOrder: false, deleted: false };
  assert.deepEqual(keys(reportSendOptions({ ...r, status: "draft" })), ["sign", "whatsapp(off)"]);
  assert.deepEqual(reportSendOptions({ ...r, status: "completed" }), []);
  assert.deepEqual(reportSendOptions({ ...r, status: "draft", isUploaded: true }), []);
});

// The old toolbar expressions, copied from TabbedDocumentCreator before the Send menu (setting off must equal them).
const OLD_TYPES = ["QUOTATION", "QO", "QO1", "QO2", "QT", "INVOICE", "TI", "TI2", "DO", "DELIVERY_ORDER", "PURCHASE_ORDER", "SALES_ORDER", "quotation"];
function oldEditor(o) {
  const t = o.documentType;
  const isQuotation = t === "QUOTATION" || t === "QO" || t === "QO1" || t === "QO2" || t === "QT";
  const cielSignFlow = isQuotation && o.quotationESign;
  return {
    menu: null,
    legacySign: !!(cielSignFlow && o.saved && !o.confirmed && !o.templateMode),
    legacyEmail: !!(t === "TI" || t === "TI2" || t === "INVOICE" || (isQuotation && !cielSignFlow)),
  };
}
const bools = [true, false];

test("setting off: the editor shows exactly the old Send for signature / Send Email buttons, no menu (every combination)", () => {
  let n = 0;
  for (const documentType of OLD_TYPES)
    for (const saved of bools)
      for (const confirmed of bools)
        for (const templateMode of bools)
          for (const quotationESign of bools)
            for (const doOnOrder of bools) {
              const o = { documentType, saved, confirmed, templateMode, quotationESign, doOnOrder, doCompleted: false };
              assert.deepEqual(editorSendControls(false, o), oldEditor(o), JSON.stringify(o));
              n++;
            }
  assert.ok(n > 400);
});

test("setting on: no old buttons, the menu instead", () => {
  const c = editorSendControls(true, { ...base, documentType: "INVOICE" });
  assert.equal(c.legacySign, false);
  assert.equal(c.legacyEmail, false);
  assert.deepEqual(keys(c.menu), ["email", "whatsapp(off)"]);
});

test("service report, setting off: exactly the old Copy sign link rule, no menu", () => {
  for (const status of ["draft", "completed", "scheduled"])
    for (const isWctPaper of bools)
      for (const isUploaded of bools)
        for (const manualOrderFlow of bools)
          for (const onOrder of bools) {
            const o = { status, isWctPaper, isUploaded, manualOrderFlow, onOrder, deleted: false };
            assert.deepEqual(reportSendControls(false, o), { menu: null, legacySignLink: status !== "completed" && !isWctPaper && !isUploaded });
          }
  assert.equal(reportSendControls(true, { status: "draft", isWctPaper: false, isUploaded: false, manualOrderFlow: false, onOrder: false, deleted: false }).legacySignLink, false);
});

test("an invoice voided with its cancelled order offers no send; anything else is untouched", async () => {
  const { withoutSendWhenVoided } = await import("./sendMenu.ts");
  const c = { menu: [{ key: "email" }], legacySign: true, legacyEmail: true };
  assert.deepEqual(withoutSendWhenVoided(c, true), { menu: null, legacySign: false, legacyEmail: false });
  assert.equal(withoutSendWhenVoided(c, false), c);
});
