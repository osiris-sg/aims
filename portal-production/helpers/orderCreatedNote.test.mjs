// "Order ORD… created" once, right after the confirm made the order (2026-11-23): helpers/orderCreatedNote.ts + wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmKey, markQuotationConfirmed, takeOrderCreated } from "./orderCreatedNote.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("an order made by this confirm shows once", () => {
  const s = memStore();
  markQuotationConfirmed(s, "q1", new Date("2026-11-23T06:00:00.000Z"));
  assert.equal(takeOrderCreated(s, "q1", { createdAt: "2026-11-23T06:00:01.000Z" }), true);
  assert.equal(s.m.has(confirmKey("q1")), false);
  assert.equal(takeOrderCreated(s, "q1", { createdAt: "2026-11-23T06:00:01.000Z" }), false);
});

test("reopening a quotation whose order already existed shows nothing", () => {
  const s = memStore();
  assert.equal(takeOrderCreated(s, "q1", { createdAt: "2026-11-22T14:36:50.821Z" }), false);
  markQuotationConfirmed(s, "q1", new Date("2026-11-23T06:00:00.000Z"));
  assert.equal(takeOrderCreated(s, "q1", { createdAt: "2026-11-22T14:36:50.821Z" }), false);
  assert.equal(s.m.size, 0);
});

test("a slightly fast browser clock still shows it; another quotation's stamp does not count", () => {
  const s = memStore();
  markQuotationConfirmed(s, "q1", new Date("2026-11-23T06:01:30.000Z"));
  assert.equal(takeOrderCreated(s, "q2", { createdAt: "2026-11-23T06:00:00.000Z" }), false);
  assert.equal(takeOrderCreated(s, "q1", { createdAt: "2026-11-23T06:00:00.000Z" }), true);
});

test("no storage or no order: nothing shows, nothing throws", () => {
  assert.equal(takeOrderCreated(null, "q1", { createdAt: "2026-11-23T06:00:00.000Z" }), false);
  const s = memStore();
  markQuotationConfirmed(s, "q1");
  assert.equal(takeOrderCreated(s, "q1", null), false);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
  markQuotationConfirmed(broken, "q1");
  assert.equal(takeOrderCreated(broken, "q1", { createdAt: "2026-11-23T06:00:00.000Z" }), false);
});

test("wired: the quotation confirm stamps, the page shows the banner only when the check passes", () => {
  const editor = read("containers/DocumentTemplates/components/TabbedDocumentCreator.tsx");
  assert.match(editor, /markQuotationConfirmed\(/);
  const page = read("app/portal/documents/[type]/[id]/[documentId]/page.tsx");
  assert.match(page, /takeOrderCreated\(/);
  assert.match(page, /const linkedOrder = orderCreatedNow \?/);
});
