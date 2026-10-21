// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round U: the collapsed inbox row's text — the thread chip ("#15-1" or "2 shipments"), its tooltip, the ONE status word per message.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowStatus, threadChipText, threadChipTooltip } from "../app/portal/shipments/_lib/inbox-threads.ts";

test('thread chip: one shipment shows its ref; messages going to different shipments show "2 shipments" with both in the tooltip', () => {
  assert.equal(threadChipText({ ref: "#15-1", combined: [] }), "#15-1");
  assert.equal(threadChipText({ ref: "#15-1", combined: [{ ref: "#15-1" }, { ref: "#16-2" }] }), "2 shipments");
  assert.equal(threadChipText({ ref: "#15-1", combined: [{ ref: "#15-1" }, { ref: "#15-1" }] }), "#15-1");
  assert.equal(threadChipText(null), null);
  assert.equal(threadChipTooltip({ label: "#15-1 · SUS 6063 305.9t · B/L 198GX05383", combined: [] }), "#15-1 · SUS 6063 305.9t · B/L 198GX05383");
  assert.equal(threadChipTooltip({ label: null, combined: [{ ref: "#15-1", label: "#15-1 · SUS 6063 305.9t" }, { ref: "#16-2", label: "#16-2 · SUS 6005 20.4t" }] }), "#15-1 · SUS 6063 305.9t\n#16-2 · SUS 6005 20.4t");
});

test("one status per message: the wait reason, Auto · label, or who handled it (WhatsApp marked)", () => {
  assert.deepEqual(rowStatus({ inboxState: "SUGGESTED", reason: { label: "Confirm match" } }), { label: "Confirm match", tone: "wait" });
  assert.equal(rowStatus({ inboxState: "UNMATCHED", reason: null }), null);
  assert.deepEqual(rowStatus({ inboxState: "PROCESSED", by: { outcome: "AUTO", name: null, autoLabel: "reviewed · B/L 198GX06003" } }), { label: "Auto · reviewed · B/L 198GX06003", tone: "auto" });
  assert.deepEqual(rowStatus({ inboxState: "PROCESSED", by: { outcome: "ACCEPTED", name: "Sayaka", via: "whatsapp" } }), { label: "Confirmed by Sayaka (WhatsApp)", tone: "person" });
  assert.deepEqual(rowStatus({ inboxState: "PROCESSED", by: { outcome: "CHANGED", name: "Toshiro" } }), { label: "Changed by Toshiro", tone: "person" });
  assert.equal(rowStatus({ inboxState: "PROCESSED", by: null }), null);
});
