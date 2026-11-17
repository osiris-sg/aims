// Run: npm test (node --test). Job category (WCT group): blank = the default, the settings list, the chip tooltip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryChipTitle, categoryShown, cleanCategoryList, moveCategory } from "./jobCategory.ts";

const def = { id: "f1", options: ["Service order", "Delivery", "Site visit", "Others"], defaultValue: "Service order" };

test("a job without a category shows the default (no backfill)", () => {
  assert.equal(categoryShown(def, null), "Service order");
  assert.equal(categoryShown(def, ""), "Service order");
  assert.equal(categoryShown(def, "  "), "Service order");
  assert.equal(categoryShown(def, "Site visit"), "Site visit");
});

test("settings list: trimmed, blanks and repeats dropped, order kept", () => {
  assert.deepEqual(cleanCategoryList([" Service order ", "", "delivery", "Delivery", "Site  visit"]), ["Service order", "delivery", "Site visit"]);
  assert.deepEqual(moveCategory(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
  assert.deepEqual(moveCategory(["a", "b"], 0, -1), ["a", "b"]);
});

test("chip tooltip: names the category; none for orgs without categories", () => {
  assert.equal(categoryChipTitle({ category: "Delivery" }, "#12 Domino's"), "#12 Domino's\nCategory: Delivery");
  assert.equal(categoryChipTitle({}, "#12"), null);
  assert.equal(categoryChipTitle({ category: null }, "#12"), null);
  assert.equal(categoryChipTitle(undefined, "#12"), null);
});
