// Run: npm test. The DO / RDO timeline's "Delivery Ended" is the run's completion time (2026-11-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryEndedAt } from "./deliveryTimeline.ts";

const signedOff = "2026-11-10T10:26:09.050Z"; // RDO202611-002: the rider's sign-off
const acks = [
  { kind: "DO_START", createdAt: "2026-11-10T10:25:28.000Z" },
  { kind: "DO_ACK", createdAt: "2026-11-11T08:10:21.103Z" }, // proof row added later (repair / link signature)
];

test("a completed run ends at its completion time, not at a later proof row", () => {
  assert.equal(deliveryEndedAt(signedOff, acks)?.toISOString(), signedOff);
});

test("a run not completed yet keeps the latest DO_ACK", () => {
  assert.equal(deliveryEndedAt(null, acks)?.toISOString(), "2026-11-11T08:10:21.103Z");
  assert.equal(
    deliveryEndedAt(undefined, [...acks, { kind: "DO_ACK", createdAt: "2026-11-11T09:00:00.000Z" }])?.toISOString(),
    "2026-11-11T09:00:00.000Z",
  );
});

test("nothing to show: no completion and no DO_ACK", () => {
  assert.equal(deliveryEndedAt(null, [{ kind: "DO_START", createdAt: signedOff }]), null);
  assert.equal(deliveryEndedAt(null, null), null);
});

test("an unreadable completion time falls back to the DO_ACKs", () => {
  assert.equal(deliveryEndedAt("not a date", acks)?.toISOString(), "2026-11-11T08:10:21.103Z");
});
