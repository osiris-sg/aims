// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-26: account codes are found with their dash ignored ("42000" finds "4-2000").
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountFilterOptions, accountMatchesSearch, findAccountByTypedCode } from "./accountCodeSearch.ts";

const A = [
  { code: "4-2000", name: "Sales CD" },
  { code: "1-2100", name: "OCBC Bank" },
  { code: "1-210", name: "Short" },
  { code: "200", name: "Plain" },
  { code: "CA101", name: "Cash" },
];
const code = (typed, list = A) => findAccountByTypedCode(list, typed)?.code;

test("a typed code finds its account with or without the dash", () => {
  assert.equal(code("42000"), "4-2000");
  assert.equal(code("4-2000"), "4-2000");
  assert.equal(code("4 2000"), "4-2000");
  assert.equal(code("ca101"), "CA101");
  assert.equal(code("1210"), "1-210");
  assert.equal(code("12100"), "1-2100");
});

test("part of a code, nothing, or only a dash names no account", () => {
  assert.equal(code("420"), undefined);
  assert.equal(code(""), undefined);
  assert.equal(code("-"), undefined);
});

test("the exact code wins; two dashless candidates are no match", () => {
  assert.equal(code("1200", [{ code: "1-200" }, { code: "1200" }]), "1200");
  assert.equal(code("1200", [{ code: "1-200" }, { code: "12-00" }]), undefined);
});

test("dropdown and dialog search: code without the dash, name, extra text", () => {
  const codes = (q) => accountFilterOptions(A, { inputValue: q }).map((a) => a.code);
  assert.deepEqual(codes("420"), ["4-2000"]);
  assert.deepEqual(codes("4-20"), ["4-2000"]);
  assert.deepEqual(codes("bank"), ["1-2100"]);
  assert.equal(codes("").length, 5);
  assert.equal(accountMatchesSearch(A[0], "revenue", ["REVENUE"]), true);
  // a plain word is never tried as a code: "ca" must not match every code holding c…a
  assert.deepEqual(codes("ca"), ["CA101"]);
});
