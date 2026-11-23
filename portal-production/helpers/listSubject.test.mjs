// Run: npm test. Subject column on the WCT group's Quotations / DOs / Invoices lists (2026-11-24).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUBJECT_SORT, subjectCell, subjectColumnOn } from "./listSubject.ts";

test("Subject column only with the WCT doc nav flag on a quotation / DO / invoice list", () => {
  assert.equal(subjectColumnOn(["QUOTATION", "QO1"], true), true);
  assert.equal(subjectColumnOn(["DELIVERY_ORDER", "DO"], true), true);
  assert.equal(subjectColumnOn(["INVOICE", "TI", "TI2"], true), true);
  assert.equal(subjectColumnOn(["INVOICE", "TI", "TI2"], false), false);
  assert.equal(subjectColumnOn(["CREDIT_NOTE", "CN"], true), false);
  assert.equal(subjectColumnOn([], true), false);
});

test("cell: own Subject plain, the quotation's muted, none blank", () => {
  assert.deepEqual(subjectCell({ listSubject: { text: "Degrease", inherited: false } }), { text: "Degrease", muted: false });
  assert.deepEqual(subjectCell({ listSubject: { text: "From QO", inherited: true } }), { text: "From QO", muted: true });
  assert.equal(subjectCell({ listSubject: null, config: { subject: "ignored" } }), null);
  // An older API (no listSubject key): the row's own Subject.
  assert.deepEqual(subjectCell({ config: { documentInfo: { subject: " Hood " } } }), { text: "Hood", muted: false });
  assert.equal(subjectCell({ config: {} }), null);
  assert.equal(SUBJECT_SORT, "subject");
});

test("DocumentListView: Subject replaces Remarks behind the flag, sortable, muted for the quotation's", () => {
  const src = readFileSync(new URL("../app/portal/components/DocumentListView.tsx", import.meta.url), "utf8");
  assert.match(src, /subjectColumnOn\(documentTypes, isWctDocNavEnabled\)/);
  assert.match(src, /header: "Subject"/);
  assert.match(src, /\[SUBJECT_SORT\]: SUBJECT_SORT/);
  assert.match(src, /color: cell\.muted \? "text\.secondary"/);
  // Every other org keeps the Remarks column.
  assert.match(src, /header: "Remarks"/);
});

test("editor: WCT QO / DO / Invoice right box is Remarks on config.remarks; no Customer Remarks / Internal remarks", () => {
  const src = readFileSync(new URL("../containers/DocumentTemplates/components/TabbedDocumentCreator.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /title="Internal remarks"/);
  assert.doesNotMatch(src, /"Internal remarks" : "Remarks"/);
  assert.doesNotMatch(src, /quotation-customer-remarks/);
  assert.match(src, /: remarksSplit\n\s+\? \(formData as any\)\.remarks \|\| ""/);
  assert.match(src, /\{ \.\.\.prev, remarks: next \}/);
  // Old internal remarks are carried through a save, never edited.
  assert.doesNotMatch(src, /internalRemarks: next/);
  assert.match(src, /internalRemarks: \(existingData as any\)\?\.internalRemarks/);
});

test("the Subject column can be sorted (an accessor is needed for the header to sort)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../app/portal/components/DocumentListView.tsx", import.meta.url), "utf8");
  const i = src.indexOf("id: SUBJECT_SORT,");
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 400), /accessorFn: \(r: any\) => subjectCell\(r\)\?\.text \?\? ""/);
  assert.match(src.slice(i, i + 400), /enableSorting: true/);
});
