// Run: npm test. Round AY part 3: the Clients tables — sort, search, CSV of the chosen rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { csvOf, searchRows, sortRows } from "../app/portal/shipments/_lib/clients-table.ts";

const rows = [
  { name: "SUS", open: 6, country: "Japan", last: "2026-10-28" },
  { name: "Kato", open: 4, country: null, last: null },
  { name: "Houei Metal", open: 1, country: "Thailand", last: "2026-09-02" },
];

test("sort: numbers numerically, text case-insensitively, empty values last (both directions)", () => {
  assert.deepEqual(sortRows(rows, (r) => r.open, "asc").map((r) => r.name), ["Houei Metal", "Kato", "SUS"]);
  assert.deepEqual(sortRows(rows, (r) => r.country, "asc").map((r) => r.name), ["SUS", "Houei Metal", "Kato"]);
  assert.deepEqual(sortRows(rows, (r) => r.last, "desc").map((r) => r.name), ["SUS", "Houei Metal", "Kato"]);
});

test("search: every word, case / width-insensitive", () => {
  assert.deepEqual(searchRows(rows, "houei thai", (r) => `${r.name} ${r.country ?? ""}`).map((r) => r.name), ["Houei Metal"]);
  assert.deepEqual(searchRows(rows, "ＳＵＳ", (r) => r.name).map((r) => r.name), ["SUS"]);
  assert.equal(searchRows(rows, "  ", (r) => r.name).length, 3);
});

test("CSV: BOM, header, quoted cells", () => {
  const csv = csvOf([{ a: 'x, "y"', b: 2 }], [{ label: "A", value: (r) => r.a }, { label: "B", value: (r) => r.b }]);
  assert.equal(csv, '﻿A,B\r\n"x, ""y""",2');
});
