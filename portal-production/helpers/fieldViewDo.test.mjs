// Run: npm test. Field app Pending card "View full DO" (enableFieldDoViewAnyLine, Biofuel 2026-11-21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openRunViewDoHref, scheduledViewDo } from "../app/(field)/lib/viewDo.ts";

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

// In-progress screen (header, under End Delivery, Ready to finish card).
const run114 = { direction: "OUTBOUND", document: null, items: [{ assetId: null, document: DO }] };
const run110 = { direction: "OUTBOUND", document: DO, items: [{ assetId: null, document: DO }, { assetId: "asset-firefly", document: DO }] };

test("in progress, switch on (Biofuel): View DO opens the run's one DO", () => {
  assert.equal(openRunViewDoHref(run114, true), "/scan/asset/_/do/do-1/view");
  assert.equal(openRunViewDoHref(run110, true), "/scan/asset/asset-firefly/do/do-1/view");
  assert.equal(openRunViewDoHref({ direction: "OUTBOUND", document: DO, items: [{ assetId: null }] }, true), "/scan/asset/_/do/do-1/view");
});

test("in progress, switch off (WCT and every other org): no View DO", () => {
  assert.equal(openRunViewDoHref(run114, false), null);
  assert.equal(openRunViewDoHref(run110, false), null);
});

test("in progress: never for returns, runs with no DO, or runs spanning two DOs", () => {
  assert.equal(openRunViewDoHref({ ...run114, direction: "RETURN" }, true), null);
  assert.equal(openRunViewDoHref({ direction: "OUTBOUND", document: null, items: [{ assetId: null }] }, true), null);
  assert.equal(openRunViewDoHref({ direction: "OUTBOUND", document: null, items: [{ document: DO }, { document: { id: "do-2" } }] }, true), null);
});
