// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-01: WCT "My jobs" (enableWctMyJobs): scope filter, start confirmation, card line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeJobs, startConfirmText, plannedLine } from "./wctMyJobs.ts";

const me = { userId: "u1", name: "Babu", isMe: true };
const other = { userId: "u2", name: "Raja", isMe: false };

test("My jobs keeps only the jobs planned for me; All keeps everything", () => {
  const runs = [{ id: 1, plannedRider: me }, { id: 2, plannedRider: other }, { id: 3, plannedRider: null }, { id: 4 }];
  assert.deepEqual(scopeJobs(runs, "mine").map((r) => r.id), [1]);
  assert.equal(scopeJobs(runs, "all").length, 4);
});

test("starting someone else's job asks first; mine or unplanned starts at once", () => {
  assert.equal(startConfirmText({ plannedRider: other }), "This job is planned for Raja. Start it anyway?");
  assert.equal(startConfirmText({ plannedRider: { userId: "u3", name: null, isMe: false } }), "This job is planned for another worker. Start it anyway?");
  assert.equal(startConfirmText({ plannedRider: me }), null);
  assert.equal(startConfirmText({ plannedRider: null }), null);
  // a worker with no AIMS login yet (name only): nobody to protect, no question
  assert.equal(startConfirmText({ plannedRider: { userId: null, name: "Vasu", isMe: false } }), null);
});

test("card line", () => {
  assert.equal(plannedLine({ plannedRider: me }), "Your job");
  assert.equal(plannedLine({ plannedRider: other }), "Planned for Raja");
  assert.equal(plannedLine({}), null);
});
