// Run: npm test. Imported orders (2026-11-18): list source filter, no row actions, links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { importedBilledPct, showBilledPctColumn, importedDocHref, importedLinkSourceLabel, importedMatchesTab, importedRowActions, importedTabs, isImportedTab, matchesOrderSource, defaultOrderSource, newestFirst } from "./importedOrders.ts";

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
  // "Part billed" is back as its own entry (2026-11-19, rule B).
  assert.deepEqual(importedTabs([{ imported: true, status: "PART_BILLED" }]), [{ key: "imported:PART_BILLED", label: "Part billed (imported)", count: 1 }]);
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

test("orgs with imported orders open on All orders; every other org keeps AIMS orders", () => {
  assert.equal(defaultOrderSource({ enableImportedOrders: true }), "all");
  assert.equal(defaultOrderSource({ enableImportedOrders: false }), "aims");
  assert.equal(defaultOrderSource({}), "aims");
  assert.equal(defaultOrderSource(null), "aims");
  assert.equal(defaultOrderSource(undefined), "aims");
});
test("newest first: a live order sits above imported history", () => {
  const rows = [
    { id: "imp-old", imported: true, createdAt: "2019-02-13T01:00:00.000Z" },
    { id: "live", createdAt: "2026-11-17T06:35:42.677Z" },
    { id: "imp-new", imported: true, createdAt: "2026-11-04T01:00:00.000Z" },
    { id: "nodate" },
  ];
  assert.deepEqual(newestFirst(rows).map((r) => r.id), ["live", "imp-new", "imp-old", "nodate"]);
  assert.equal(rows[0].id, "imp-old");
});

// 2026-11-19: Part billed / Complete statuses, "1 of 2", and the order page's actions only after success.
test("imported orders: Part billed and Complete tabs, hues, billed qty", async () => {
  const { IMPORTED_STATUS_TABS, importedTabs, importedStatusHue, importedProgress } = await import("./importedOrders.ts");
  assert.deepEqual(IMPORTED_STATUS_TABS.map((t) => t.label), ["Part billed", "Invoiced", "Paid", "Complete"]);
  assert.deepEqual(importedTabs([{ imported: true, status: "PART_BILLED" }, { imported: true, status: "PART_BILLED" }, { imported: true, status: "COMPLETED" }]).map((t) => [t.label, t.count]), [["Part billed (imported)", 2], ["Complete (imported)", 1]]);
  assert.equal(importedStatusHue("PART_BILLED"), "#d97706");
  assert.notEqual(importedStatusHue("COMPLETED"), importedStatusHue("PAID"));
  assert.equal(importedProgress({ billed: 1, quoted: 2 }), "1 of 2");
  assert.equal(importedProgress(null), "");
});

test("imported order page: Create invoice / Mark complete / Reopen act only when the call succeeded", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../app/portal/orders/[id]/ImportedOrderDetail.tsx", import.meta.url), "utf8");
  for (const fn of ["createInvoice", "markComplete", "reopen"]) {
    const body = src.slice(src.indexOf(`const ${fn} = async`), src.indexOf("};", src.indexOf(`const ${fn} = async`)));
    assert.match(body, /if \(requestFailed\(res\)\) return;/, fn);
  }
  assert.match(src, /invoice-remaining/);
  assert.match(src, /mark-complete/);
});
