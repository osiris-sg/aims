// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round AV (Sayaka): the Answer flow's "Which shipment?" picker — rows, order groups, next #n-m, the email prefill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { factPrefill, factSuggestion, nextShipmentRef, orderGroups, orderHaystack, orderLine as orderLineOf, qtyLeft, sameFactValue, shipmentLine as shipmentLineOf } from "../app/portal/shipments/_lib/shipment-picker.ts";
import { fmtDay, shortCustomer } from "../app/portal/shipments/_lib/format.ts";

const fmt = { day: fmtDay, customer: shortCustomer };
const shipmentLine = (s) => shipmentLineOf(s, fmt);
const orderLine = (o) => orderLineOf(o, fmt);

const ship = (o = {}) => ({ ref: "#28-1", blNumber: null, netWeightMt: null, eta: null, customerName: "Kato Aluminium Co.", customer: null, order: { grade: "6063" }, contractLine: null, productLine: null, ...o });
const order = (o = {}) => ({ id: "o27", orderNo: 27, status: "OPEN", shipMonth: "2026-11", customerName: "Kato Aluminium Co.", customer: null, grade: "6005", qtyMt: "40", product: null, size: null, contractNo: "454003422", piNo: "SIAE_PI_26100906", label: "#27", previousOrderNos: [25], shipments: [], ...o });

test("a row without a weight shows its B/L, or 'no B/L yet' — never just '#28-1 · Kato · 6063'", () => {
  assert.equal(shipmentLine(ship()), "#28-1 · Kato · 6063 · no B/L yet");
  assert.equal(shipmentLine(ship({ blNumber: "198GX06524" })), "#28-1 · Kato · 6063 · B/L 198GX06524");
  assert.match(shipmentLine(ship({ netWeightMt: "20.416", eta: "2026-10-29T00:00:00.000Z" })), /^#28-1 · Kato · 6063 · 20\.4 t · ETA 29 Oct/);
});

test("an order line, its next shipment number (cancelled ones keep theirs) and its search text", () => {
  assert.equal(orderLine(order()), "#27 · Kato 6005 · 40 t");
  assert.equal(nextShipmentRef(order()), "#27-1");
  assert.equal(nextShipmentRef(order({ shipments: [{ seqNo: 1 }, { seqNo: 3, status: "CANCELLED" }] })), "#27-4");
  const h = orderHaystack(order());
  for (const q of ["#27", "#25", "kato", "6005", "454003422", "siae_pi"]) assert.ok(h.includes(q), q);
});

test("All shipments: grouped by order, newest ETA first, completed only on request, cancelled never", () => {
  const os = [
    order({ id: "a", orderNo: 20, shipments: [{ status: "OPEN", eta: "2026-10-24T00:00:00Z" }] }),
    order({ id: "b", orderNo: 22, shipments: [{ status: "OPEN", eta: "2026-11-05T00:00:00Z" }, { status: "CANCELLED", eta: "2026-12-30T00:00:00Z" }] }),
    order({ id: "c", orderNo: 27, shipMonth: "2026-11", shipments: [] }),
    order({ id: "d", orderNo: 10, status: "COMPLETED", shipments: [{ status: "COMPLETED", eta: "2026-12-01T00:00:00Z" }] }),
    order({ id: "e", orderNo: 9001, status: "CANCELLED" }),
  ];
  assert.deepEqual(orderGroups(os, { showCompleted: false }).map((o) => o.id), ["c", "b", "a"]);
  assert.deepEqual(orderGroups(os, { showCompleted: true }).map((o) => o.id), ["d", "c", "b", "a"]);
});

const facts = { fields: { blNumber: { value: "198GX06524", candidates: [{ value: "198GX06524", sources: ["AN.pdf"] }] }, eta: { value: null, candidates: [{ value: "2026-10-10", sources: ["t"] }, { value: "2026-11-01", sources: ["t"] }] }, netWeightMt: { value: "20.416", candidates: [{ value: "20.416", sources: ["AN.pdf"] }] } } };

test("a new shipment: only agreed values, only into empty fields", () => {
  assert.deepEqual(factPrefill({ blNumber: "", eta: "", netWeightMt: "", vessel: "" }, facts), { blNumber: "198GX06524", netWeightMt: "20.416" });
  assert.deepEqual(factPrefill({ blNumber: "TYPED", eta: "", netWeightMt: "20" }, facts), {});
  assert.deepEqual(factPrefill({ blNumber: "" }, null), {});
});

test("an edit: a differing email value is offered (Use this), an equal one is 'same'", () => {
  assert.deepEqual(factSuggestion("netWeightMt", "20.4160", facts).same?.value, "20.416");
  const s = factSuggestion("blNumber", "198GX06516", facts);
  assert.equal(s.same, null);
  assert.deepEqual(s.others.map((c) => c.value), ["198GX06524"]);
  const several = factSuggestion("eta", "", facts);
  assert.equal(several.several, true);
  assert.equal(several.others.length, 2);
  assert.equal(factSuggestion("vessel", "X", facts), null);
  assert.equal(sameFactValue("vessel", "wan hai 366", "WAN HAI 366"), true);
  assert.equal(sameFactValue("totalBundles", "", "0"), false);
});

test("the order's quantity left (max ± tolerance minus the others' net)", () => {
  assert.equal(qtyLeft({ max: 42, netTotal: 20.416 }), 21.584);
  assert.equal(qtyLeft({ max: 42, netTotal: 20.416 }, 20.416), 42);
  assert.equal(qtyLeft(null), null);
});
