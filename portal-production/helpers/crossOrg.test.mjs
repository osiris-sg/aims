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

import { importedOrderPage } from "./orderPage.ts";
test("BC Air order: counted WCT (S) invoice links through open-in-org; placeholder greyed and not counted", () => {
  const cross = (id, name, canOpen) => ({ id, name, type: "INVOICE", templateId: "t", crossOrg: { orgId: ORG, orgName: "WCT (S)", canOpen } });
  const m = importedOrderPage({
    id: "o1",
    orderNumber: "ORD-Q-012964",
    sourceQuotation: { id: "q1", name: "Q-012964", type: "QUOTATION", documentTemplateId: "tq" },
    invoices: [{ ...cross("i1", "I-013121", true), total: 2250, stateLabel: "Paid" }],
    crossPlaceholders: [{ ...cross("i2", "I-013120", false), total: 1 }],
  });
  const inv = m.documents.filter((r) => r.kind === "invoice");
  assert.deepEqual(inv.map((r) => [r.number, !!r.placeholder, r.unlink, r.file]), [["I-013121 · WCT (S)", false, null, null], ["I-013120 · WCT (S)", true, null, null]]);
  assert.ok(inv[0].href.startsWith("/portal/open-in-org?org="));
  assert.equal(inv[1].href, null);
  assert.equal(inv[1].note, "placeholder, not counted");
  const card = m.cards.find((c) => c.key === "invoice");
  assert.deepEqual(card.docs.map((d) => !!d.placeholder), [false, true]);
});

// 2026-11-24: the company-switch hop renders without the portal shell (no org bootstrap to get stuck on).
import { isBarePortalRoute } from "./crossOrg.ts";
test("only /portal/open-in-org is a bare route", () => {
  assert.equal(isBarePortalRoute("/portal/open-in-org"), true);
  assert.equal(isBarePortalRoute("/portal/open-in-org/"), true);
  for (const p of ["/portal", "/portal/orders", "/portal/open-in-org-x", null, undefined, ""]) assert.equal(isBarePortalRoute(p), false);
});
