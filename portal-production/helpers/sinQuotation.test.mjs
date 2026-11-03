// WCT: a supplier invoice's quotations are per line (2026-11-04).
import { test } from "node:test";
import assert from "node:assert/strict";
import { billQuotations, lineTagOf, quotationsCell } from "./sinQuotation.ts";

test("the Purchase Journal cell: one or two numbers, more → the first plus +N", () => {
  assert.deepEqual(quotationsCell([]), { shown: [], more: 0 });
  assert.deepEqual(quotationsCell(["QO1"]), { shown: ["QO1"], more: 0 });
  assert.deepEqual(quotationsCell(["QO1", "QO2"]), { shown: ["QO1", "QO2"], more: 0 });
  assert.deepEqual(quotationsCell(["QO1", "QO2", "QO3"]), { shown: ["QO1"], more: 2 });
});

test("a bill's quotations: the API list, else the old header tag; a line's own tag, else the header's on an old bill", () => {
  assert.deepEqual(billQuotations({ quotations: [{ id: "q1", number: "QO1" }] }), [{ id: "q1", number: "QO1" }]);
  assert.deepEqual(billQuotations({ quotationId: "q9", quotationNumber: "QO9" }), [{ id: "q9", number: "QO9" }]);
  assert.deepEqual(billQuotations({}), []);
  assert.deepEqual(lineTagOf({ quotationId: "q2", quotationNumber: "QO2" }), { id: "q2", number: "QO2" });
  assert.equal(lineTagOf({}), null);
});
