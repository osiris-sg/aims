// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Inbox Accept toast (round N): say what really happened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptedText } from "../app/portal/shipments/_lib/inbox-text.ts";

test("an email with no attachments (link only) → \"Linked to #15-1\"", () => {
  assert.equal(acceptedText({ matched: "#15-1", done: [] }), "Linked to #15-1");
  assert.equal(acceptedText({ matched: "#15-1", done: [{ kind: "file", status: "skipped" }] }), "Linked to #15-1");
});

test("files / fields filed are counted", () => {
  assert.equal(acceptedText({ matched: "#20-1", done: [{ kind: "file", status: "done" }, { kind: "file", status: "done" }] }), "Filed 2 documents on #20-1");
  assert.equal(acceptedText({ matched: "#20-1", done: [{ kind: "file", status: "done" }, { kind: "field", status: "done" }] }), "Filed 1 document, filled 1 field on #20-1");
});
