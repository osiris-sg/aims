// Run: npm test (node --test, Node's built-in TypeScript stripping).
// 2026-11-02: customer UEN + old code (enableCustomerUen) matching for the pickers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { customerIdsLine, customerIdsMatch, customerLabel, oldCodeMatches, rankCustomers } from "./customerIds.ts";

test("old code matches whole, including one part of a merged ref", () => {
  assert.equal(oldCodeMatches("449", "449"), true);
  assert.equal(oldCodeMatches("449", " 449 "), true);
  assert.equal(oldCodeMatches("449", "44"), false);
  assert.equal(oldCodeMatches("228+229", "229"), true);
  assert.equal(oldCodeMatches("228+229", "22"), false);
  assert.equal(oldCodeMatches(null, "1"), false);
  assert.equal(oldCodeMatches("1", ""), false);
});

test("UEN matches as a case-insensitive substring", () => {
  assert.equal(customerIdsMatch({ uen: "201302496E" }, "201302"), true);
  assert.equal(customerIdsMatch({ uen: "T08LL1234A" }, "t08ll"), true);
  assert.equal(customerIdsMatch({ uen: "201302496E", externalRef: "77" }, "77"), true);
  assert.equal(customerIdsMatch({ uen: null, externalRef: null }, "x"), false);
  assert.equal(customerIdsMatch({ uen: "201302496E" }, "  "), false);
});

test("line under the name", () => {
  assert.equal(customerIdsLine({ uen: "201302496E", externalRef: "449" }), "UEN 201302496E · Old code 449");
  assert.equal(customerIdsLine({ externalRef: "228+229" }), "Old code 228+229");
  assert.equal(customerIdsLine({}), "");
});

test("picker ranking: exact code / old code / UEN, then prefix, then server order", () => {
  const list = [
    { id: "1", name: "Big Acme Holdings", customerCode: "CB001" },
    { id: "2", name: "Acme Pte Ltd", customerCode: "CA001" },
    { id: "3", name: "Zed", customerCode: "CZ001", externalRef: "acme" },
    { id: "4", name: "Other Acme", customerCode: "CO001" },
  ];
  assert.deepEqual(rankCustomers(list, "acme").map((c) => c.id), ["3", "2", "1", "4"]);
  assert.deepEqual(rankCustomers(list, "ca001").map((c) => c.id)[0], "2");
  assert.deepEqual(rankCustomers(list, "").map((c) => c.id), ["1", "2", "3", "4"]);
});

test("picker label", () => {
  assert.equal(customerLabel({ customerCode: "CA001", name: "Acme" }), "CA001 · Acme");
  assert.equal(customerLabel({ name: "Acme" }), "Acme");
  assert.equal(customerLabel(null), "");
});
