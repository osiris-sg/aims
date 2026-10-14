// Run: npm test (node --test, Node's built-in TypeScript stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { showAccountingSetup } from "./settingsVisibility.ts";

const org = (...on) => (code) => on.includes(code);

test("hidden for a trade org: SHIPMENTS on, ACCOUNTING off", () => {
  assert.equal(showAccountingSetup(org("SHIPMENTS", "SALES")), false);
});

test("shown for every other org, as on main", () => {
  assert.equal(showAccountingSetup(org("SALES")), true); // Sales without Accounting
  assert.equal(showAccountingSetup(org("ACCOUNTING", "SALES")), true);
  assert.equal(showAccountingSetup(org("SHIPMENTS", "ACCOUNTING")), true);
  assert.equal(showAccountingSetup(org()), true);
});

import { showShippingSettings, shownInMenu } from "./settingsVisibility.ts";

test("Shipping & documents settings only with the SHIPMENTS module", () => {
  assert.equal(showShippingSettings(org("SHIPMENTS")), true);
  assert.equal(showShippingSettings(org("SALES", "ACCOUNTING")), false);
});

test("a module flagged hideInMenu stays enabled but leaves the menus; others unchanged", () => {
  assert.equal(shownInMenu({ moduleCode: "SALES", enabled: true, config: { route: "/portal/sales", hideInMenu: true } }), false);
  assert.equal(shownInMenu({ moduleCode: "SALES", enabled: true, config: { route: "/portal/sales" } }), true);
  assert.equal(shownInMenu({ moduleCode: "SALES", enabled: true, config: null }), true);
  assert.equal(shownInMenu({ moduleCode: "SALES", enabled: true, config: { hideInMenu: false } }), true);
});
