// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round Y: the module route guard — a portal path belongs to a module; a page the
// org does not have is never rendered under that org. Hotfix 2026-10-23: only the
// Sales (SHIPMENTS) hubs are guarded; every other path needs nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPathAllowed, landingFor, requiredModuleFor } from "./moduleRoutes.ts";

const mod = (moduleCode, enabled, route, displayName) => ({ moduleCode, enabled, displayName, config: route ? { route } : null });

/** ADH-style: Sales on, generic Dashboard off, trade documents under the DOCUMENTS row. */
const adh = [
  mod("DASHBOARD", false, "/portal"),
  mod("SHIPMENTS", true, "/portal/shipments", "Sales"),
  mod("DOCUMENTS", false, "/portal/trade-documents"),
  mod("SALES", true, "/portal/sales", "Sales"),
  mod("CUSTOMERS", false, "/portal/customers"),
  mod("ACCOUNTING", false, "/portal/accounting"),
  mod("ADMIN", true, "/portal/admin"),
];

/** Biofuel-style: Sales (SHIPMENTS) off, Documents off, Payments off, Accounting on. */
const biofuel = [
  mod("DASHBOARD", true, "/portal"),
  mod("SHIPMENTS", false, "/portal/shipments"),
  mod("SALES", true, "/portal/sales"),
  mod("ACCOUNTING", true, "/portal/accounting"),
  mod("DOCUMENTS", false, "/portal/documents"),
  mod("PAYMENTS", false, "/portal/payments"),
  mod("ADMIN", true, "/portal/admin"),
];

test("the Sales hubs need SHIPMENTS whatever the module rows say", () => {
  assert.equal(requiredModuleFor("/portal/shipments/dashboard", adh), "SHIPMENTS");
  assert.equal(requiredModuleFor("/portal/shipments", adh), "SHIPMENTS");
  assert.equal(requiredModuleFor("/portal/trade-documents/generated", adh), "SHIPMENTS");
  // DOCUMENTS pointing at /portal/trade-documents does not claim it.
  assert.equal(requiredModuleFor("/portal/trade-documents", adh), "SHIPMENTS");
  // Without any module rows at all the Sales hubs still belong to SHIPMENTS.
  assert.equal(requiredModuleFor("/portal/shipments/orders", []), "SHIPMENTS");
  // Query strings and trailing slashes do not change the answer; "/portal/shipmentsx" is not a hub.
  assert.equal(requiredModuleFor("/portal/shipments/orders/?page=2", biofuel), "SHIPMENTS");
  assert.equal(requiredModuleFor("/portal/shipmentsx", biofuel), null);
});

test("no other path is guarded, whatever config.route says (hotfix 2026-10-23)", () => {
  // The invoice editor lives under /portal/documents/<TYPE>/… — it must open
  // for an org with the DOCUMENTS module off.
  assert.equal(requiredModuleFor("/portal/documents/INVOICE/tpl/doc", biofuel), null);
  assert.equal(isPathAllowed("/portal/documents/INVOICE/tpl/doc", biofuel), true);
  assert.equal(requiredModuleFor("/portal/sales/invoices", biofuel), null);
  assert.equal(requiredModuleFor("/portal/documents", biofuel), null);
  assert.equal(requiredModuleFor("/portal/payments", biofuel), null);
  assert.equal(requiredModuleFor("/portal/accounting/bills", biofuel), null);
  assert.equal(requiredModuleFor("/portal/accounting/bills", adh), null);
  assert.equal(isPathAllowed("/portal/accounting/bills", adh), true);
  assert.equal(isPathAllowed("/portal/customers", adh), true);
  assert.equal(isPathAllowed("/portal/projects", adh), true);
});

test("/portal, /portal/settings, /portal/chat and /portal/admin need nothing", () => {
  assert.equal(requiredModuleFor("/portal", biofuel), null);
  assert.equal(requiredModuleFor("/portal/", biofuel), null);
  assert.equal(requiredModuleFor("/portal/settings", biofuel), null);
  assert.equal(requiredModuleFor("/portal/chat", biofuel), null);
  assert.equal(requiredModuleFor("/portal/admin/organizations", biofuel), null);
  assert.equal(isPathAllowed("/portal", adh), true);
  assert.equal(isPathAllowed("/portal/settings", adh), true);
});

test("SHIPMENTS is matched by module code only, never by the display name", () => {
  // ADH's SALES row is also labelled "Sales"; only the SHIPMENTS code counts.
  const salesLabelOnly = [mod("SALES", true, "/portal/sales", "Sales"), mod("SHIPMENTS", false, "/portal/shipments", "Shipments")];
  assert.equal(isPathAllowed("/portal/shipments/orders", salesLabelOnly), false);
  assert.equal(landingFor(salesLabelOnly), "/portal");
  // A module not in the list at all cannot be enabled.
  assert.equal(isPathAllowed("/portal/shipments/orders", [mod("ACCOUNTING", true, "/portal/accounting")]), false);
});

test("Biofuel on /portal/shipments/orders is not allowed; ADH is", () => {
  assert.equal(isPathAllowed("/portal/shipments/orders", biofuel), false);
  assert.equal(isPathAllowed("/portal/shipments/orders", adh), true);
  assert.equal(isPathAllowed("/portal/trade-documents/generated", biofuel), false);
  assert.equal(isPathAllowed("/portal/trade-documents/generated", adh), true);
});

test("landingFor: the portal home for everyone (the Sales dashboard renders there)", () => {
  assert.equal(landingFor(adh), "/portal");
  assert.equal(landingFor(biofuel), "/portal");
  assert.equal(landingFor([]), "/portal");
});
