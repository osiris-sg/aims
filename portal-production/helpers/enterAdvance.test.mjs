// Run: node --experimental-strip-types --import ./helpers/test-alias.mjs --test helpers/enterAdvance.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { textareaEdgeAllowsWalk } from "./enterAdvance.ts";

test("multi-line box: ↑ walks out only from the first line, ↓ only from the last; a selection never walks", () => {
  assert.equal(textareaEdgeAllowsWalk("sauduaisd", 3, 3, -1), true); // one line: up leaves
  assert.equal(textareaEdgeAllowsWalk("sauduaisd", 3, 3, 1), true); // one line: down leaves
  assert.equal(textareaEdgeAllowsWalk("line1\nline2", 2, 2, -1), true); // first line, up leaves
  assert.equal(textareaEdgeAllowsWalk("line1\nline2", 8, 8, -1), false); // second line, up moves inside
  assert.equal(textareaEdgeAllowsWalk("line1\nline2", 2, 2, 1), false); // first line, down moves inside
  assert.equal(textareaEdgeAllowsWalk("line1\nline2", 8, 8, 1), true); // last line, down leaves
  assert.equal(textareaEdgeAllowsWalk("", 0, 0, -1), true); // empty box leaves either way
  assert.equal(textareaEdgeAllowsWalk("abc", 0, 2, -1), false); // selection stays
});
