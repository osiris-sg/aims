// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round Y: the module route guard — a portal path belongs to a module; a page the
// org does not have is never rendered under that org.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPathAllowed, landingFor, requiredModuleFor } from "./moduleRoutes.ts";

const mod = (moduleCode, enabled, route) => ({ moduleCode, enabled, config: route ? { route } : null });

/** ADH-style: Sales on, generic Dashboard off, trade documents under the DOCUMENTS row. */
const adh = [
  mod("DASHBOARD", false, "/portal"),
  mod("SHIPMENTS", true, "/portal/shipments"),
  mod("DOCUMENTS", true, "/portal/trade-documents"),
  mod("CUSTOMERS", true, "/portal/customers"),
  mod("ACCOUNTING", false, "/portal/accounting"),
  mod("ADMIN", true, "/portal/admin"),
];

/** Biofuel-style: Sales off, Accounting on. */
const biofuel = [
  mod("DASHBOARD", true, "/portal"),
  mod("SHIPMENTS", false, "/portal/shipments"),
  mod("ACCOUNTING", true, "/portal/accounting"),
  mod("DOCUMENTS", true, "/portal/documents"),
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
});

test("other paths resolve through config.route — the longest prefix wins, exact or followed by /", () => {
  assert.equal(requiredModuleFor("/portal/accounting/bills", biofuel), "ACCOUNTING");
  assert.equal(requiredModuleFor("/portal/accounting", biofuel), "ACCOUNTING");
  assert.equal(requiredModuleFor("/portal/documents/create", biofuel), "DOCUMENTS");
  // "/portal/documents" must not claim "/portal/documentsx".
  assert.equal(requiredModuleFor("/portal/documentsx", biofuel), null);
  // Longest prefix: a module routed deeper than another wins for its subtree.
  const nested = [...biofuel, mod("BILLS", true, "/portal/accounting/bills")];
  assert.equal(requiredModuleFor("/portal/accounting/bills/123", nested), "BILLS");
  assert.equal(requiredModuleFor("/portal/accounting/ledger", nested), "ACCOUNTING");
  // Query strings and trailing slashes do not change the answer.
  assert.equal(requiredModuleFor("/portal/accounting/bills/?page=2", biofuel), "ACCOUNTING");
});

test("/portal, /portal/settings and /portal/chat need nothing; ADMIN and the /portal route are ignored", () => {
  assert.equal(requiredModuleFor("/portal", biofuel), null);
  assert.equal(requiredModuleFor("/portal/", biofuel), null);
  assert.equal(requiredModuleFor("/portal/settings", biofuel), null);
  assert.equal(requiredModuleFor("/portal/chat", biofuel), null);
  assert.equal(requiredModuleFor("/portal/admin/organizations", biofuel), null);
  assert.equal(isPathAllowed("/portal", adh), true);
  assert.equal(isPathAllowed("/portal/settings", adh), true);
});

test("a disabled module's path is not allowed; an enabled one's is; no module → allowed", () => {
  assert.equal(isPathAllowed("/portal/accounting/bills", biofuel), true);
  assert.equal(isPathAllowed("/portal/accounting/bills", adh), false);
  assert.equal(isPathAllowed("/portal/customers", adh), true);
  // A module not in the list at all cannot be enabled.
  assert.equal(isPathAllowed("/portal/shipments/orders", [mod("ACCOUNTING", true, "/portal/accounting")]), false);
});

test("Biofuel on /portal/shipments/orders is not allowed; ADH is", () => {
  assert.equal(isPathAllowed("/portal/shipments/orders", biofuel), false);
  assert.equal(isPathAllowed("/portal/shipments/orders", adh), true);
  assert.equal(isPathAllowed("/portal/trade-documents/generated", biofuel), false);
  assert.equal(isPathAllowed("/portal/trade-documents/generated", adh), true);
});

test("landingFor: Sales › Dashboard with SHIPMENTS on, the portal home otherwise", () => {
  assert.equal(landingFor(adh), "/portal/shipments/dashboard");
  assert.equal(landingFor(biofuel), "/portal");
  assert.equal(landingFor([]), "/portal");
});
