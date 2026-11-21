// Run: npm test. Field app Pending card "View full DO" (enableFieldDoViewAnyLine, Biofuel 2026-11-21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduledViewDo } from "../app/(field)/lib/viewDo.ts";

const DO = { id: "do-1" };
// Run #110 shape: typed "Rubber Fender" first, a catalog FIREFLY line second.
const typedFirst = { direction: "OUTBOUND", document: DO, items: [{ assetId: null }, { assetId: "asset-firefly" }] };
// Run #114 shape: one typed pump line, no catalog item at all.
const typedOnly = { direction: "OUTBOUND", document: DO, items: [{ assetId: null }] };
// Run #79 shape: catalog LION375 first.
const catalogFirst = { direction: "OUTBOUND", document: DO, items: [{ assetId: "asset-lion" }] };

test("switch on (Biofuel): typed-text first line still shows View full DO", () => {
  assert.deepEqual(scheduledViewDo(typedFirst, true), { assetId: "asset-firefly", docId: "do-1" });
  assert.deepEqual(scheduledViewDo(typedOnly, true), { assetId: "_", docId: "do-1" });
  assert.deepEqual(scheduledViewDo(catalogFirst, true), { assetId: "asset-lion", docId: "do-1" });
});

test("switch off (WCT and every other org): unchanged, first line must be a catalog item", () => {
  assert.equal(scheduledViewDo(typedFirst, false), null);
  assert.equal(scheduledViewDo(typedOnly, false), null);
  assert.deepEqual(scheduledViewDo(catalogFirst, false), { assetId: "asset-lion", docId: "do-1" });
});

test("never for returns or runs without exactly one DO, switch on or off", () => {
  for (const on of [true, false]) {
    assert.equal(scheduledViewDo({ ...catalogFirst, direction: "RETURN" }, on), null);
    assert.equal(scheduledViewDo({ ...typedFirst, document: null }, on), null);
  }
});
