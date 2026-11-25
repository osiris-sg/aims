// Run: node --experimental-strip-types --import ./helpers/test-alias.mjs --test helpers/lineNumberBox.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { numberBoxWidthPx, numberColumnWidth, numberBoxTitle, numberBoxInputProps } from "./lineNumberBox.ts";

test("a short price keeps the box at its minimum; a long one grows with the digits", () => {
  assert.equal(numberBoxWidthPx(0, 100), 100);
  assert.equal(numberBoxWidthPx("", 100), 100);
  assert.equal(numberBoxWidthPx(1234.5, 100), 100);
  assert.equal(numberBoxWidthPx(353232323, 100), 30 + 9 * 9); // 111px
  assert.equal(numberBoxWidthPx("1234567890.12", 100), 30 + 13 * 9);
});

test("the column holds the widest box, its icons and the cell padding, never under the base (guru's clipped 353232323)", () => {
  assert.equal(numberColumnWidth([0, 1], 100, 112, 32), "148px"); // 100 + 16 + 32
  assert.equal(numberColumnWidth([353232323, 5], 100, 112, 32), "159px"); // 111 + 16 + 32
  assert.equal(numberColumnWidth([], 80, 96, 0), "96px");
  assert.equal(numberColumnWidth([1], 50, 96, 0), "96px"); // base wins when the box is small
});

test("hover title is the full number with separators; money gets 2dp", () => {
  assert.equal(numberBoxTitle(353232323, true), "353,232,323.00");
  assert.equal(numberBoxTitle(2.5), "2.5");
  assert.equal(numberBoxTitle(""), "");
  assert.equal(numberBoxTitle("abc"), "");
  assert.equal(numberBoxInputProps.style.textAlign, "right");
});

test("money box at rest shows at least 2dp, keeps extra typed decimals, blank stays blank", async () => {
  const { moneyBoxDisplay } = await import("./lineNumberBox.ts");
  assert.equal(moneyBoxDisplay(500), "500.00");
  assert.equal(moneyBoxDisplay("500"), "500.00");
  assert.equal(moneyBoxDisplay(1.3434), "1.3434");
  assert.equal(moneyBoxDisplay(2.5), "2.50");
  assert.equal(moneyBoxDisplay(0), "0.00");
  assert.equal(moneyBoxDisplay(""), "");
  assert.equal(moneyBoxDisplay(null), "");
  assert.equal(moneyBoxDisplay("x"), "");
});

test("character cap: the box stops growing at the cap and the cap rejects longer typing; Amount column fits its widest text", async () => {
  const { MAX_MONEY_CHARS, MAX_QTY_CHARS, withinCharCap, numberTextColumnWidth } = await import("./lineNumberBox.ts");
  assert.equal(MAX_MONEY_CHARS, 16);
  assert.equal(withinCharCap("999999999999.99", MAX_MONEY_CHARS), true);
  assert.equal(withinCharCap("64465654654654660000000", MAX_MONEY_CHARS), false);
  assert.equal(withinCharCap("123456789012", MAX_QTY_CHARS), true);
  assert.equal(withinCharCap("1234567890123", MAX_QTY_CHARS), false);
  assert.equal(numberBoxWidthPx("1".repeat(40), 100), 30 + 16 * 9); // capped at 16 chars
  assert.equal(numberTextColumnWidth(["50000.00"], 112), "112px");
  assert.equal(numberTextColumnWidth(["999999999999.99"], 112), `${15 * 9 + 16 + 4}px`);
});

test("Product Code column: short codes keep the base width, long ones widen it up to 22 characters, longer wrap", async () => {
  const { codeColumnWidth } = await import("./lineNumberBox.ts");
  assert.equal(codeColumnWidth(["SVC01", ""], "10%"), "10%");
  assert.equal(codeColumnWidth(["STR-AEROX155 (GID)"], "10%"), `${18 * 8 + 16}px`);
  assert.equal(codeColumnWidth(["SHOEI-GTA3REALM10XL-EXTRA-LONG-CODE"], "10%"), `${22 * 8 + 16}px`);
});
