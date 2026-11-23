// Run: npm test. Delivery contacts "Add new contact" (enableOfficeDoEdits, Biofuel 2026-11-23).
import { test } from "node:test";
import assert from "node:assert/strict";
import { canSaveNewContact } from "./newContact.ts";

test("default mode (projects wizard, other orgs): name alone is enough", () => {
  assert.equal(canSaveNewContact({ name: "Tan", phone: "" }), true);
  assert.equal(canSaveNewContact({ name: "  ", phone: "9123" }), false);
});

test("inline mode (Schedule a delivery, flag on): name and phone both required", () => {
  assert.equal(canSaveNewContact({ name: "Tan", phone: "", requirePhone: true }), false);
  assert.equal(canSaveNewContact({ name: "Tan", phone: "  ", requirePhone: true }), false);
  assert.equal(canSaveNewContact({ name: "", phone: "91234567", requirePhone: true }), false);
  assert.equal(canSaveNewContact({ name: "Tan", phone: "91234567", requirePhone: true }), true);
});
