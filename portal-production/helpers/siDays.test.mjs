// Run: npm test. Round BG: 出庫・納入依頼書 truck days (Sayaka's #18/#19 SUS schedule, 11/9–11/27, 6005 + 6063).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleTotals, daysBetween, groupSchedule, nextRow, parseDay, parseSchedule, rowsFor, shipDateFor, sortRows, withDelivery, withWeights } from "../app/portal/shipments/_lib/si-days.ts";

const HOL = new Set(["2026-11-03", "2026-11-23"]);
const LOTS = [
  { lot: "6005", billet: "6005 ロングビレット203 X 5800", bundles: 87, netMt: 221.97, grossMt: 222.84, avgNetMt: 221.97 / 87, avgGrossMt: 222.84 / 87 },
  { lot: "6063", billet: "6063 ロングビレット203 X 5800", bundles: 118, netMt: 297.215, grossMt: 298.395, avgNetMt: 297.215 / 118, avgGrossMt: 298.395 / 118 },
];
// Her Excel: 納品日 · LOT · バンドル数/台, one line per truck; the date only on a day's first truck.
const PASTE = `納品日\tLOT\tバンドル数/台
11/9(月)\t6005\t8
\t6005\t8
11/10(火)\t6005\t8
\t6005\t8
\t6005\t8
11/11(水)\t6005\t8
\t6005\t8
\t6005\t8
11/12(木)\t6063\t8
\t6063\t8
\t6063\t7
11/13(金)\t6063\t8
\t6063\t7
\t6063\t7
11/16(月)\t6063\t8
\t6063\t8
\t6063\t8
11/17(火)\t6063\t8
\t6063\t8
\t6063\t8
11/18(水)\t6063\t8
\t6063\t8
\t6063\t8
11/27(金)\t6063\t8
\t6063\t8
\t6063\t8`;

test("出荷日 = 納入日 − 1 working day: Monday → Friday, holidays skipped", () => {
  assert.equal(shipDateFor("2026-11-09", HOL), "2026-11-06");
  assert.equal(shipDateFor("2026-11-27", HOL), "2026-11-26");
  assert.equal(shipDateFor("2026-11-24", HOL), "2026-11-20"); // 11/23 勤労感謝の日 (Mon)
  assert.equal(shipDateFor("2026-11-04", HOL), "2026-11-02"); // 11/3 文化の日
});

test("dates: 11/9(月), 2026/11/9, 11月9日; next year after a half-year gap", () => {
  assert.equal(parseDay("11/9(月)", "2026-11-06"), "2026-11-09");
  assert.equal(parseDay("２０２６／１１／９", "2026-11-06"), "2026-11-09");
  assert.equal(parseDay("11月9日（月）", "2026-11-06"), "2026-11-09");
  assert.equal(parseDay("1/8", "2026-11-06"), "2027-01-08");
  assert.equal(parseDay("2/30", "2026-11-06"), null);
});

test("her paste → one row per day + LOT (11/9 6005: 2 trucks, 16 bundles), as on the issued SI", () => {
  const p = parseSchedule(PASTE, "2026-11-06", ["6005", "6063"]);
  assert.equal(p.problems.length, 0);
  assert.equal(p.lines.length, 26);
  const g = groupSchedule(p.lines);
  assert.deepEqual(g[0], { deliveryDate: "2026-11-09", lot: "6005", bundles: 16, trucks: 2 });
  const rows = rowsFor(g, LOTS, "SUS福島工場", HOL);
  assert.deepEqual(rows.map((r) => [r.shipDate.slice(5), r.deliveryDate.slice(5), r.lot, r.bundles, r.trucks]), [
    ["11-06", "11-09", "6005", 16, 2],
    ["11-09", "11-10", "6005", 24, 3],
    ["11-10", "11-11", "6005", 24, 3],
    ["11-11", "11-12", "6063", 23, 3],
    ["11-12", "11-13", "6063", 22, 3],
    ["11-13", "11-16", "6063", 24, 3],
    ["11-16", "11-17", "6063", 24, 3],
    ["11-17", "11-18", "6063", 24, 3],
    ["11-26", "11-27", "6063", 24, 3],
  ]);
  assert.equal(rows[0].billet, "6005 ロングビレット203 X 5800");
  const t = bundleTotals(rows, LOTS);
  assert.deepEqual(t.perLot.map((x) => [x.lot, x.rows, x.bl, x.diff]), [["6005", 64, 87, -23], ["6063", 141, 118, 23]]);
  assert.equal(t.total, 205);
  assert.equal(t.diff, 0);
});

test("any column order, no header; problems named", () => {
  const p = parseSchedule("8\t11/9\t6005\n8\t\t6005\nx\t11/10\t6005", "2026-11-06", ["6005", "6063"]);
  assert.deepEqual(p.columns, { date: 1, lot: 2, bundles: 0 });
  assert.equal(p.lines.length, 2);
  assert.deepEqual(p.problems.map((x) => [x.line, x.why]), [[3, "noBundles"]]);
});

test("add row = next working day, same product; fill days; sort; edited 出荷日 sticks; weights", () => {
  const rows = [{ shipDate: "2026-11-19", deliveryDate: "2026-11-20", destination: "SUS福島工場", billet: "6063 ロングビレット203 X 5800", bundles: 24, lot: "6063" }];
  const n = nextRow(rows, HOL, "2026-11-06");
  assert.deepEqual([n.deliveryDate, n.shipDate, n.lot, n.destination], ["2026-11-24", "2026-11-20", "6063", "SUS福島工場"]);
  assert.deepEqual(daysBetween("2026-11-20", "2026-11-25", HOL), ["2026-11-20", "2026-11-24", "2026-11-25"]);
  assert.equal(daysBetween("2026-11-20", "2026-11-25", HOL, false).length, 6);
  assert.deepEqual(sortRows([{ deliveryDate: "2026-11-11" }, { deliveryDate: "" }, { deliveryDate: "2026-11-09" }]).map((r) => r.deliveryDate), ["2026-11-09", "2026-11-11", ""]);
  const edited = { ...rows[0], shipDate: "2026-11-18", shipDateEdited: true };
  assert.equal(withDelivery(edited, "2026-11-25", HOL).shipDate, "2026-11-18");
  assert.equal(withDelivery(rows[0], "2026-11-25", HOL).shipDate, "2026-11-24");
  const w = withWeights({ ...rows[0], bundles: 24 }, LOTS);
  assert.equal(w.netMt, 60.451);
});
