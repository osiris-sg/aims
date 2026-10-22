// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round P: the Sales dashboard's "To do" line, the inbox thread wording ("Linked to", what Confirm does, who / when).
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivingThisWeek, byLine, fromParts, linkedChip, linkedFileLine, orderHref, threadCounts, toDoLine, whatHappens } from "../app/portal/shipments/_lib/inbox-threads.ts";

test('dashboard top line: "To do: 4 questions (14 emails) · 2 tasks overdue · 3 arriving this week", singulars, and the empty state', () => {
  assert.equal(toDoLine({ questions: 4, emails: 14, overdue: 2, arriving: 3 }), "To do: 4 questions (14 emails) · 2 tasks overdue · 3 arriving this week");
  assert.equal(toDoLine({ questions: 1, emails: 1, overdue: 1, arriving: 0 }), "To do: 1 question (1 email) · 1 task overdue");
  assert.equal(toDoLine({ questions: 0, emails: 0, overdue: 0, arriving: 1 }), "To do: 1 arriving this week");
  assert.equal(toDoLine({ questions: 0, emails: 0, overdue: 0, arriving: 0 }), "Nothing to do — all emails are linked, no task overdue, nothing arriving this week.");
});

test("who sent it: name + address, or the local part", () => {
  assert.deepEqual(fromParts('"Sayaka Matsuki" <sayaka.matsuki@example.com>'), { name: "Sayaka Matsuki", email: "sayaka.matsuki@example.com" });
  assert.deepEqual(fromParts("ops@mitsui-soko.example"), { name: "ops", email: "ops@mitsui-soko.example" });
  assert.equal(fromParts("").name, "—");
});

const file = (o = {}) => ({ name: "COA_9000565680.pdf", docType: "COA", docLabel: "Certificate of analysis", status: "planned", ownerKind: "shipment", ownerId: "s28", ref: "#28-1", stepId: "st-3b", stepNo: "3b", stepTitle: "Shipping documents", ...o });

test('linked lines: "COA_9000565680.pdf → #28-1 · 3b · Certificate of analysis"; the chip "#28-1 · 1 file" / "#15-1 (no files)"', () => {
  assert.equal(linkedFileLine(file()), "COA_9000565680.pdf → #28-1 · 3b · Certificate of analysis");
  assert.equal(linkedFileLine(file({ stepNo: null, docLabel: null, docType: "COA" })), "COA_9000565680.pdf → #28-1 · COA");
  assert.equal(linkedChip({ orderId: "o", shipmentId: "s", ref: "#28-1", label: null, files: [file()], fields: [], linkOnly: false }), "#28-1 · 1 file");
  assert.equal(linkedChip({ orderId: "o", shipmentId: "s", ref: "#15-1", label: null, files: [], fields: [], linkOnly: true }), "#15-1 (no files)");
  assert.equal(linkedChip(null), null);
});

test('what Confirm does: "files COA.pdf to step 3b · Certificate of analysis; fills blNumber …", "links only (no files)", "no order picked yet"; past tense once done', () => {
  const linked = { orderId: "o", shipmentId: "s", ref: "#28-1", label: "#28-1 · Kato 6005 40t", files: [file()], fields: [{ field: "blNumber", value: "276956322", status: "planned" }], linkOnly: false };
  assert.equal(whatHappens({ linked, done: [] }), "files COA_9000565680.pdf to step 3b · Certificate of analysis; fills blNumber 276956322");
  assert.equal(whatHappens({ linked: { ...linked, files: [file({ status: "done" })], fields: [] }, done: [{ kind: "file", status: "done" }] }), "filed COA_9000565680.pdf to step 3b · Certificate of analysis");
  assert.equal(whatHappens({ linked: { ...linked, files: [], fields: [], linkOnly: true }, done: [] }), "links only (no files)");
  assert.equal(whatHappens({ linked: { ...linked, files: [], fields: [], linkOnly: true }, done: [{ kind: "subtask", status: "done" }] }), "Linked to #28-1 (no files)");
  assert.equal(whatHappens({ linked: null, done: [] }), "no order picked yet");
});

test('who / when: "Confirmed by Sayaka · 21 Oct 10:12" (Tokyo), "Auto · B/L 198GX…", "Auto · thread"', () => {
  assert.equal(byLine({ outcome: "ACCEPTED", name: "Sayaka", at: "2026-10-21T01:12:00.000Z", autoLabel: null }), "Confirmed by Sayaka · 21 Oct 10:12");
  assert.equal(byLine({ outcome: "AUTO", name: null, at: null, autoLabel: "B/L 198GX04630" }), "Auto · B/L 198GX04630");
  assert.equal(byLine({ outcome: "AUTO", name: null, at: null, autoLabel: "thread" }), "Auto · thread");
  assert.equal(byLine({ outcome: "CHANGED", name: "Sayaka", at: null, autoLabel: null }), "Changed by Sayaka");
  assert.equal(byLine(null), null);
});

test("the order link opens the shipment with the step expanded; thread counts; arriving this week (7 Tokyo days, soonest first)", () => {
  assert.equal(orderHref("o1", "s1", "st-3b"), "/portal/shipments/orders/o1?shipment=s1&step=st-3b");
  assert.equal(orderHref("o1"), "/portal/shipments/orders/o1");
  assert.equal(orderHref(null), null);
  assert.equal(threadCounts(5, 3), "5 emails · 3 files");
  assert.equal(threadCounts(1, 0), "1 email");
  const ships = [
    { id: "late", eta: "2026-10-30T00:00:00.000Z" },
    { id: "soon", eta: "2026-10-24T00:00:00.000Z" },
    { id: "today", eta: "2026-10-21T00:00:00.000Z" },
    { id: "past", eta: "2026-10-20T00:00:00.000Z" },
    { id: "none", eta: null },
  ];
  assert.deepEqual(arrivingThisWeek(ships, "2026-10-21").map((s) => s.id), ["today", "soon"]);
});
