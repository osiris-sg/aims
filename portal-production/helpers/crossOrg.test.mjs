// Run: npm test. Cross-company invoice pills (WCT group, 2026-11-23).
import { test } from "node:test";
import assert from "node:assert/strict";
import { crossOrgHref, crossOrgLabel, safeOpenInOrg } from "./crossOrg.ts";

const ORG = "5c700000-0000-4000-8000-5c7000000001";
test("link and label", () => {
  assert.equal(crossOrgHref(ORG, "/portal/documents/INVOICE/t/i"), `/portal/open-in-org?org=${ORG}&to=%2Fportal%2Fdocuments%2FINVOICE%2Ft%2Fi`);
  assert.equal(crossOrgLabel("I-012345", "WCT (S)"), "I-012345 · WCT (S)");
});
test("only a real org id and an in-app portal path are followed", () => {
  assert.deepEqual(safeOpenInOrg(ORG, "/portal/documents/INVOICE/t/i"), { org: ORG, to: "/portal/documents/INVOICE/t/i" });
  assert.equal(safeOpenInOrg("x", "/portal/a"), null);
  assert.equal(safeOpenInOrg(ORG, "https://evil.example/portal"), null);
  assert.equal(safeOpenInOrg(ORG, "//evil.example"), null);
  assert.equal(safeOpenInOrg(ORG, "/portal/a?b=1"), null);
});
