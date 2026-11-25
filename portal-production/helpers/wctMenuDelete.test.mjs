// ⋮ menu Delete (WCT group, 2026-11-25): helpers/wctMenuDelete.ts + wiring in the lists and the editor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bulkDeleteSummary, canMenuDelete, deleteConfirmTitle, deleteToast, menuDeleteOn } from "./wctMenuDelete.ts";

test("on for the WCT group's quotation / DO / invoice lists only", () => {
  assert.equal(menuDeleteOn({ softDelete: true, wctDocNav: true, types: ["QUOTATION"] }), true);
  assert.equal(menuDeleteOn({ softDelete: true, wctDocNav: true, types: ["DELIVERY_ORDER"] }), true);
  assert.equal(menuDeleteOn({ softDelete: true, wctDocNav: true, types: ["INVOICE"] }), true);
  assert.equal(menuDeleteOn({ softDelete: true, wctDocNav: true, types: ["BILL"] }), false);
  assert.equal(menuDeleteOn({ softDelete: false, wctDocNav: true, types: ["INVOICE"] }), false);
  assert.equal(menuDeleteOn({ softDelete: true, wctDocNav: false, types: ["INVOICE"] }), false);
});

test("only people with Edit on Sales (documents:delete)", () => {
  assert.equal(canMenuDelete((r, a) => r === "documents" && a === "delete"), true);
  assert.equal(canMenuDelete(() => false), false);
  assert.equal(canMenuDelete(() => false, [{ name: "Viewer" }]), false);
  // No roles in the org = the platform admin (server-checked).
  assert.equal(canMenuDelete(() => false, []), true);
});

test("confirm title, bulk mix summary, toast", () => {
  assert.equal(deleteConfirmTitle("INV202611-0044"), "Delete INV202611-0044?");
  const v = { a: { ok: true, reason: null }, b: { ok: false, reason: "Paid invoices can't be deleted" }, c: { ok: true, reason: null } };
  assert.deepEqual(bulkDeleteSummary(v, ["a", "b", "c", "d"]), { ok: ["a", "c"], skipped: [{ id: "b", reason: "Paid invoices can't be deleted" }, { id: "d", reason: "Can't be deleted" }] });
  assert.deepEqual(deleteToast([{ id: "a", name: "QO1", deleted: true, reason: null, journalsVoided: 0 }]), { ok: "QO1 deleted", error: null });
  assert.deepEqual(deleteToast([{ id: "a", name: "QO1", deleted: true, reason: null, journalsVoided: 0 }, { id: "b", name: "INV2", deleted: false, reason: "Paid invoices can't be deleted", journalsVoided: 0 }]), { ok: "QO1 deleted", error: "INV2: Paid invoices can't be deleted" });
});

test("wired: list row ⋮ Delete under Open with the server's reason, bulk Delete, editor ⋮ Delete", () => {
  const list = readFileSync(new URL("../app/portal/components/DocumentListView.tsx", import.meta.url), "utf8");
  assert.match(list, /menuDel && void loadRowVerdict/);
  assert.match(list, /startBulkMenuDelete/);
  assert.ok(list.indexOf(">\n          Open\n") < list.indexOf("WCT group ⋮ menu Delete"));
  const ed = readFileSync(new URL("../containers/DocumentTemplates/components/TabbedDocumentCreator.tsx", import.meta.url), "utf8");
  assert.match(ed, /data-testid="editor-menu-delete"/);
  assert.match(ed, /deleteConfirmTitle\(/);
});
