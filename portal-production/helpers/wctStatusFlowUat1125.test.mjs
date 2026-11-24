// Run: npm test. UAT 2026-11-25: Draft -> Pending after an autosave is the WCT rule (Draft = made by the system,
// nobody saved it; Pending = a person saved it; the stored status stays "unconfirmed"). Split parts read alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { flowDocStatus } from "./wctStatusFlow.ts";

const inv = (config) => ({ type: "INVOICE", status: "unconfirmed", config });

test("a system-made draft invoice reads Draft; after a person's save (autosave included) it reads Pending", () => {
  assert.equal(flowDocStatus(inv({}))?.label, "Draft");
  assert.equal(flowDocStatus(inv({ savedAt: "2026-11-25T04:25:50Z", poNumber: "PO-1" }))?.label, "Pending");
});

test("split parts carry the original's savedAt: every part reads the same", () => {
  const saved = { savedAt: "2026-11-25T04:25:50Z" };
  const parts = [inv({ ...saved, invoiceSplit: { groupId: "g", part: 1 } }), inv({ ...saved, invoiceSplit: { groupId: "g", part: 2 } })];
  assert.deepEqual(parts.map((p) => flowDocStatus(p)?.label), ["Pending", "Pending"]);
  const system = [inv({ invoiceSplit: { groupId: "g", part: 1 } }), inv({ invoiceSplit: { groupId: "g", part: 2 } })];
  assert.deepEqual(system.map((p) => flowDocStatus(p)?.label), ["Draft", "Draft"]);
});
