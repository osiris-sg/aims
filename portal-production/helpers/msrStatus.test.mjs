// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-02: an unsigned report reads "Pending sign", not "Completed".
import { test } from "node:test";
import assert from "node:assert/strict";
import { msrStatusChip } from "./msrStatus.ts";

test("unsigned draft = Pending sign (warning, outlined)", () => {
  assert.deepEqual(msrStatusChip({ status: "draft", kind: "SERVICE", serviceData: {} }), { label: "Pending sign", color: "warning", variant: "outlined" });
  assert.equal(msrStatusChip({ status: "draft", kind: "DO_ACK" }).label, "Pending sign");
  assert.equal(msrStatusChip({ status: "draft" }).label, "Pending sign");
});

test("WCT scheduled draft, started delivery, signed, unknown", () => {
  assert.equal(msrStatusChip({ status: "draft", kind: "SERVICE", serviceData: { scheduled: true } }).label, "Scheduled");
  assert.equal(msrStatusChip({ status: "draft", kind: "DO_START" }).label, "In progress");
  assert.deepEqual(msrStatusChip({ status: "completed" }), { label: "Completed", color: "success", variant: "filled" });
  assert.equal(msrStatusChip({ status: "weird" }).label, "weird");
  assert.equal(msrStatusChip({ status: null }).label, "—");
});
