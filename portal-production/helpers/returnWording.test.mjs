// Run: npm test. A RETURN collects, it does not deliver (2026-11-12): the field app's return wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobLabel, returnLabel, RETURN_RUN_STATUS_LABEL, returnStageCard } from "./jobWording.ts";

test("a return's chips and headings say Collected / Collecting", () => {
  assert.equal(returnLabel("DELIVERED", true), "COLLECTED");
  assert.equal(returnLabel("DELIVERING", true), "COLLECTING");
  assert.equal(returnLabel("Delivered", true), "Collected");
  assert.equal(returnLabel("Delivering", true), "Collecting");
  assert.equal(returnLabel("COMPLETED", true), "COMPLETED");
});

test("an outbound run keeps its labels, and WCT still reads Done", () => {
  assert.equal(returnLabel("DELIVERED", false), "DELIVERED");
  assert.equal(jobLabel(returnLabel("DELIVERED", false), true), "DONE");
});

test("a collected return waits for the signature, never for installation; no em-dashes", () => {
  assert.equal(RETURN_RUN_STATUS_LABEL.delivered, "Collected, awaiting signature");
  assert.equal(RETURN_RUN_STATUS_LABEL.in_progress, "Collecting");
  for (const v of Object.values(RETURN_RUN_STATUS_LABEL)) assert.doesNotMatch(v, /—|install/i);
});

test("the asset scan card for a return run", () => {
  assert.deepEqual(returnStageCard("ack_install", 107), { title: "Collected, awaiting signature", subtitle: "Return #107, RDO on sign-off" });
  assert.deepEqual(returnStageCard("ack_delivery", 107), { title: "Continue Return", subtitle: "Return #107, RDO on sign-off" });
  assert.deepEqual(returnStageCard("completed", 107), { title: "Return Completed", subtitle: "Return #107" });
});
