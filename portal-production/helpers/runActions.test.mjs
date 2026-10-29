// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-10-30: delivery runs — "Started" only when someone started the run; confirm copy for cancel / delete / permanent delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runWasStarted, liveSiteClockJob, confirmCopy, canPurge } from "../app/portal/deliveries/_lib/run-actions.ts";

test("a run nobody started shows no Started time", () => {
  assert.equal(runWasStarted({ status: "scheduled" }), false);
  assert.equal(runWasStarted({ status: "scheduled", isDraft: true }), false);
  // WCT #9: cancelled before any rider claimed it (startedAt is just the creation time)
  assert.equal(runWasStarted({ status: "cancelled", riderUserId: null, items: [{ deliveryStatus: "not_delivered" }] }), false);
  // a seeded in_progress run with no rider and no field work
  assert.equal(runWasStarted({ status: "in_progress", riderUserId: null, items: [] }), false);
});

test("a run someone started keeps its Started time", () => {
  assert.equal(runWasStarted({ status: "in_progress", riderUserId: "u1" }), true);
  assert.equal(runWasStarted({ status: "cancelled", riderUserId: "u1" }), true);
  assert.equal(runWasStarted({ status: "completed", riderUserId: null }), true);
  assert.equal(runWasStarted({ status: "cancelled", riderUserId: null, items: [{ deliveringAt: "2026-09-24T08:20:00Z" }] }), true);
});

test("the SiteClock line appears only while the job is live", () => {
  assert.deepEqual(liveSiteClockJob({ workerId: "w", workerName: "Ali", lastPushedStatus: "SCHEDULED", syncState: "SYNCED" }), { workerName: "Ali" });
  assert.deepEqual(liveSiteClockJob({ workerId: "w", workerName: "Ali", lastPushedStatus: null, syncState: "PENDING" }), { workerName: "Ali" });
  assert.equal(liveSiteClockJob({ workerId: "w", lastPushedStatus: "CANCELLED", syncState: "SYNCED" }), null);
  assert.equal(liveSiteClockJob({ workerId: null, lastPushedStatus: null, syncState: "SYNCED" }), null);
  assert.equal(liveSiteClockJob(null), null);
  const c = confirmCopy("cancel", { deliveryNumber: 9, siteclock: { workerId: "w", workerName: "Elroy", lastPushedStatus: "SCHEDULED", syncState: "SYNCED" } });
  assert.equal(c.title, "Cancel delivery #9?");
  assert.equal(c.siteclock, "This also cancels the SiteClock job for Elroy.");
  assert.equal(confirmCopy("cancel", { deliveryNumber: 9 }).siteclock, null);
  assert.match(confirmCopy("delete", { deliveryNumber: 4, isDraft: true, siteclock: { workerId: "w", lastPushedStatus: "SCHEDULED" } }).siteclock, /SiteClock job\./);
});

test("permanent delete: Osiris admins, cancelled runs only", () => {
  assert.equal(canPurge({ status: "cancelled" }, true), true);
  assert.equal(canPurge({ status: "cancelled" }, false), false);
  assert.equal(canPurge({ status: "completed" }, true), false);
  const p = confirmCopy("purge", { deliveryNumber: 9 });
  assert.equal(p.title, "Delete delivery #9 permanently?");
  assert.equal(p.button, "Delete permanently");
});
