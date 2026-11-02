// helpers/latestDocument.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { latestDocumentAction } from "./latestDocument.ts";

test("latestDocumentAction: an empty list is an empty state, never a create", () => {
  assert.equal(latestDocumentAction([]), "empty");
  assert.equal(latestDocumentAction(null), "empty");
  assert.equal(latestDocumentAction(undefined), "empty");
  assert.equal(latestDocumentAction([{ id: "d1" }]), "open");
});

test("GoToLatestDocument never posts /documents/basic by itself (only through the create button's flow)", () => {
  const src = readFileSync(new URL("../app/portal/components/GoToLatestDocument.tsx", import.meta.url), "utf8");
  assert.equal(src.includes("/documents/basic"), false);
  assert.match(src, /onClick=\{\(\) => void create\(\)\}/);
});
