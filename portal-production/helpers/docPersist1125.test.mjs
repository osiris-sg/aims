// Run: npm test. WCT editor-only keys survive save + reload (2026-11-25): Add company stamp, the injected Disc row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { transformBackendDataForForm, transformFormDataForBackend } from "../containers/DocumentTemplates/utils/documentDataTransformer.ts";

const cfgWithout = { tabs: [{ tabId: "general", fields: [{ fieldName: "documentInfo.subject" }, { fieldName: "documentInfo.grossTotal" }] }] };
const cfgWith = { tabs: [{ tabId: "general", fields: [{ fieldName: "documentInfo.discountPercent" }] }] };

test("Add company stamp and the injected Disc row (% / $) round-trip", () => {
  const saved = transformFormDataForBackend({ items: [], documentInfo: { subject: "S", addCompanyStamp: true, discountPercent: 40, discountType: "amount" } }, cfgWithout, {});
  assert.equal(saved.addCompanyStamp, true);
  assert.equal(saved.discountPercent, 40);
  assert.equal(saved.discountType, "amount");
  const back = transformBackendDataForForm(saved, cfgWithout);
  assert.equal(back.documentInfo.addCompanyStamp, true);
  assert.equal(back.documentInfo.discountPercent, 40);
  assert.equal(back.documentInfo.discountType, "amount");
});

test("untouched documents and templates with their own Disc field: unchanged", () => {
  const plain = transformFormDataForBackend({ items: [], documentInfo: { subject: "S" } }, cfgWithout, {});
  assert.ok(!("addCompanyStamp" in plain) && !("discountPercent" in plain) && !("discountType" in plain));
  // A template listing documentInfo.discountPercent saves it through its field (as before); no extra discountType.
  const own = transformFormDataForBackend({ items: [], documentInfo: { discountPercent: 5, discountType: "amount" } }, cfgWith, {});
  assert.equal(own.discountPercent, 5);
  assert.ok(!("discountType" in own));
});
