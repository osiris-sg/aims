// Run: npm test. Task D (2026-11-17): customer UEN for enableCustomerUen orgs
// (the WCT group). Flag off = the picker layout every other org had.
import { test } from "node:test";
import assert from "node:assert/strict";
import { customerIdsLine, normalizeUen, oldCodeOf, uenLooksValid } from "./customerIds.ts";
import { customerPickerLayout } from "./customerPickerLayout.ts";

test("import batch tags are never shown as an old code", () => {
  assert.equal(oldCodeOf("erp-import:wct-erp-2026-11-05"), null);
  assert.equal(oldCodeOf("erp-import:bcair-books-2026-11-06"), null);
  assert.equal(oldCodeOf(" 449 "), "449");
  assert.equal(oldCodeOf("228+229"), "228+229");
  assert.equal(oldCodeOf(null), null);
  assert.equal(customerIdsLine({ uen: "202414659R", externalRef: "erp-import:wct-erp-2026-11-05" }), "UEN 202414659R");
  assert.equal(customerIdsLine({ externalRef: "erp-import:wct-erp-2026-11-05" }), "");
});

test("customerIdsLine keeps its old output by default", () => {
  assert.equal(customerIdsLine({ uen: "201302496E", externalRef: "449" }), "UEN 201302496E · Old code 449");
  assert.equal(customerIdsLine({ uen: "201302496E", externalRef: "449" }, { withUen: false }), "Old code 449");
  assert.equal(customerIdsLine({ uen: "201302496E" }, { withUen: false }), "");
});

test("UEN is trimmed and upper-cased; blank is null", () => {
  assert.equal(normalizeUen("  201302496e "), "201302496E");
  assert.equal(normalizeUen("t08ll1234a"), "T08LL1234A");
  assert.equal(normalizeUen("   "), null);
  assert.equal(normalizeUen(null), null);
});

test("Singapore UEN shapes pass, others only warn", () => {
  for (const ok of ["53123456K", "201302496E", "202414659r", "T08LL1234A", "S99SS0001B", "M90312345A", "MR-8500016-3", "", null]) {
    assert.equal(uenLooksValid(ok), true, String(ok));
  }
  for (const bad of ["123", "TBA", "201302496", "S1234567D", "ABCDEFGHIJ"]) assert.equal(uenLooksValid(bad), false, bad);
});

test("flag off: the Locate Customer layout is exactly the old one", () => {
  const off = customerPickerLayout(false);
  assert.deepEqual(off.columns.map((c) => [c.label, c.width]), [
    ["Customer Code", "20%"],
    ["Company Name", "40%"],
    ["Phone", "20%"],
    ["Email", "20%"],
  ]);
  assert.equal(off.showHints, true);
  assert.equal(off.subline({ uen: "201302496E", externalRef: "449" }), "UEN 201302496E · Old code 449");
});

test("flag on: UEN column after Company Name, no hints, subline without UEN", () => {
  const on = customerPickerLayout(true);
  assert.deepEqual(on.columns.map((c) => c.label), ["Customer Code", "Company Name", "UEN", "Phone", "Email"]);
  assert.equal(on.showHints, false);
  assert.equal(on.subline({ uen: "201302496E", externalRef: "449" }), "Old code 449");
  assert.equal(on.subline({ uen: "201302496E", externalRef: "erp-import:wct-erp-2026-11-05" }), "");
});
