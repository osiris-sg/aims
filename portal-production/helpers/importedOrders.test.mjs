// Run: npm test. Imported orders (2026-11-18): list source filter, no row actions, links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { importedBilledPct, showBilledPctColumn, importedDocHref, importedLinkSourceLabel, importedMatchesTab, importedRowActions, importedTabs, isImportedTab, matchesOrderSource } from "./importedOrders.ts";

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
test("imported status filter: own entries (Part billed / Invoiced / Paid), never mixed with AIMS statuses", () => {
  const rows = [{ id: "n", status: "PAID" }, { id: "a", imported: true, status: "INVOICED" }, { id: "b", imported: true, status: "PAID" }, { id: "c", imported: true, status: "INVOICED" }];
  assert.deepEqual(importedTabs(rows), [
    { key: "imported:INVOICED", label: "Invoiced (imported)", count: 2 },
    { key: "imported:PAID", label: "Paid (imported)", count: 1 },
  ]);
  // An old stored "Part billed" status has no entry of its own (dropped 2026-11-18).
  assert.deepEqual(importedTabs([{ imported: true, status: "PART_BILLED" }]), []);
  assert.equal(isImportedTab("imported:PAID"), true);
  assert.equal(isImportedTab("PAID"), false);
  assert.deepEqual(rows.filter((r) => importedMatchesTab(r, "imported:INVOICED")).map((r) => r.id), ["a", "c"]);
  assert.deepEqual(rows.filter((r) => importedMatchesTab(r, "all")).map((r) => r.id), ["a", "b", "c"]);
  assert.equal(importedMatchesTab(rows[2], "PAID"), false);
  assert.equal(importedLinkSourceLabel("erp_quotation_link"), "ERP quotation link");
});
test("Billed %: one decimal, blank without a quotation total; column only with imported orders in view", () => {
  assert.equal(importedBilledPct(50), "50%");
  assert.equal(importedBilledPct(33.3), "33.3%");
  assert.equal(importedBilledPct(110.1), "110.1%");
  assert.equal(importedBilledPct(null), "");
  assert.equal(importedBilledPct(undefined), "");
  assert.equal(showBilledPctColumn(true, "imported"), true);
  assert.equal(showBilledPctColumn(true, "all"), true);
  assert.equal(showBilledPctColumn(true, "aims"), false);
  assert.equal(showBilledPctColumn(false, "all"), false);
});
