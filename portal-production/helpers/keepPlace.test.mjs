// Run: npm test. Round BX (Sayaka): switching shipment from the sticky bar keeps the same card at the same height.
import { test } from "node:test";
import assert from "node:assert/strict";
import { neighbours, pickPlace } from "../app/portal/shipments/_lib/keep-place.ts";

const bar = 110; // bottom of the sticky bar under the top nav
const vh = 800;

test("the first card starting under the bar is the place (its top = the offset)", () => {
  const boxes = [
    { key: "section:Contract", top: -400, bottom: 90 },
    { key: "port", top: 140, bottom: 420 },
    { key: "section:Weights", top: 440, bottom: 700 },
  ];
  assert.deepEqual(pickPlace(boxes, bar, vh), { key: "port", offset: 140 });
});

test("deep inside a tall card (the bar cuts it): that card, with its negative offset", () => {
  const boxes = [
    { key: "step:STEP_6", top: -900, bottom: 60 },
    { key: "step:CUSTOMS_TAX_ESTIMATE", top: -500, bottom: 1400 },
  ];
  assert.deepEqual(pickPlace(boxes, bar, vh), { key: "step:CUSTOMS_TAX_ESTIMATE", offset: -500 });
});

test("a card cut by the bar wins over one starting low on the screen", () => {
  const boxes = [
    { key: "step:A", top: -300, bottom: 600 },
    { key: "step:B", top: 620, bottom: 900 },
  ];
  assert.deepEqual(pickPlace(boxes, bar, vh), { key: "step:A", offset: -300 });
});

test("nothing visible: no place", () => {
  assert.equal(pickPlace([{ key: "x", top: -500, bottom: 50 }], bar, vh), null);
  assert.equal(pickPlace([], bar, vh), null);
});

test("neighbours: prev / next without wrapping", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(neighbours(list, "b"), { prev: { id: "a" }, next: { id: "c" }, index: 1 });
  assert.deepEqual(neighbours(list, "a"), { prev: null, next: { id: "b" }, index: 0 });
  assert.deepEqual(neighbours(list, "c"), { prev: { id: "b" }, next: null, index: 2 });
  assert.deepEqual(neighbours(list, undefined), { prev: null, next: null, index: -1 });
});
