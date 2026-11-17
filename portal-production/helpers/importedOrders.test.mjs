// Run: npm test. Imported orders (2026-11-18): list source filter, no row actions, links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { importedDocHref, importedLinkSourceLabel, importedRowActions, matchesOrderSource } from "./importedOrders.ts";

const native = { id: "n1" };
const imported = { id: "i1", imported: true };

test("default source (AIMS orders) hides imported orders; Imported shows only them; All shows both", () => {
  assert.deepEqual([native, imported].filter((r) => matchesOrderSource(r, "aims")), [native]);
  assert.deepEqual([native, imported].filter((r) => matchesOrderSource(r, "imported")), [imported]);
  assert.deepEqual([native, imported].filter((r) => matchesOrderSource(r, "all")), [native, imported]);
});
test("imported rows have no actions; native rows keep theirs", () => {
  assert.deepEqual(importedRowActions(imported), []);
  assert.equal(importedRowActions(native), null);
});
test("document links and link-source labels", () => {
  assert.equal(importedDocHref({ id: "d", name: "I-1", templateId: "t" }, "INVOICE"), "/portal/documents/INVOICE/t/d");
  assert.equal(importedDocHref({ id: "d", name: "Q-1", type: "QUOTATION", documentTemplateId: "t" }, "X"), "/portal/documents/QUOTATION/t/d");
  assert.equal(importedDocHref({ id: "d", name: "x" }, "INVOICE"), null);
  assert.equal(importedLinkSourceLabel("contract_no"), "ERP contract no.");
  assert.equal(importedLinkSourceLabel(null), "");
});
