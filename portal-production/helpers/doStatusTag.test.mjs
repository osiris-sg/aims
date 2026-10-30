// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-10-30: WCT real DO numbers — the Pending / Completed / Cancelled tag next to a DO number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoTag, docDoTag, DO_TAG_COLOR } from "./doStatusTag.ts";

test("run status → tag", () => {
  for (const s of ["scheduled", "in_progress", "delivered", undefined, null]) assert.equal(runDoTag(s), "Pending");
  assert.equal(runDoTag("completed"), "Completed");
  assert.equal(runDoTag("cancelled"), "Cancelled");
});

test("DO → tag: cancelled config wins, delivered_installed is Completed, everything else Pending", () => {
  assert.equal(docDoTag({ status: "unconfirmed", config: { cancelled: true } }), "Cancelled");
  assert.equal(docDoTag({ status: "unconfirmed", cancelled: true }), "Cancelled");
  assert.equal(docDoTag({ status: "delivered_installed", config: {} }), "Completed");
  assert.equal(docDoTag({ status: "confirmed" }), "Pending");
  assert.equal(docDoTag({ status: "unconfirmed", config: { cancelled: false } }), "Pending");
});

test("every tag has a colour", () => {
  for (const t of ["Pending", "Completed", "Cancelled"]) assert.ok(DO_TAG_COLOR[t]);
});
