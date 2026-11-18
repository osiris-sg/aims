// Run: npm test (node --test). WCT document screens (features.enableWctDocNav): no "Back to order", narrow S/No.
// Setting off = every org's screens exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SNO_COLUMN, WCT_SNO_WIDTH, documentListSubtitle, editorTitleBar, isNarrowSnoCell, lineColumnWidth, showBackToOrder } from "./wctDocUi.ts";

test("Back to order: shown with the setting off (other orgs), gone with it on", () => {
  assert.equal(showBackToOrder(false), true);
  assert.equal(showBackToOrder(true), false);
});

test("line column widths with the setting off are the editor's old map (S/No auto like any custom column)", () => {
  const old = { description: "auto", item: "10%", uom: "8%", quantity: "8%", unitPrice: "10%", salePrice: "10%", tax: "8%", discount: "11%", amount: "10%", receivedQty: "10%", no: "auto", remarks: "auto", location: "auto" };
  for (const [col, w] of Object.entries(old)) assert.equal(lineColumnWidth(col, false), w, col);
  assert.equal(lineColumnWidth("no"), "auto");
  assert.equal(isNarrowSnoCell("no", false), false);
});

test("WCT group (setting on): only S/No changes, to about 4 characters", () => {
  assert.equal(SNO_COLUMN, "no");
  assert.equal(lineColumnWidth("no", true), WCT_SNO_WIDTH);
  assert.equal(WCT_SNO_WIDTH, "56px");
  for (const col of ["description", "item", "quantity", "unitPrice", "amount", "remarks"]) assert.equal(lineColumnWidth(col, true), lineColumnWidth(col, false), col);
  assert.equal(isNarrowSnoCell("no", true), true);
  assert.equal(isNarrowSnoCell("description", true), false);
});

test("document list subtitle: other orgs keep it, the WCT group (setting on) and hideSubtitle pages have none", () => {
  assert.equal(documentListSubtitle("Quotations", false, false), "All Quotations for this organization");
  assert.equal(documentListSubtitle("Quotations", false, true), undefined);
  assert.equal(documentListSubtitle("Invoices", true, false), undefined);
});

test("editor title bar, setting off (other orgs): the old one-row layout, byte for byte", () => {
  const b = editorTitleBar(false);
  assert.deepEqual(b.barWrap, { xs: "wrap", md: "nowrap" });
  assert.deepEqual(b.left, { display: "flex", alignItems: "center", gap: 1, minWidth: 0, flex: "1 1 auto" });
  assert.deepEqual(b.back, {});
  assert.equal(b.noWrap, true);
  assert.deepEqual(b.title, { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" });
  assert.deepEqual(b.actions, {});
});

test("editor title bar, WCT group: the arrow never shrinks, the title is never cut, the buttons wrap instead", () => {
  const b = editorTitleBar(true);
  assert.equal(b.barWrap.md, "wrap");
  assert.equal(b.back.flexShrink, 0);
  assert.equal(b.left.flex, "1 0 auto");
  assert.equal(b.left.maxWidth, "100%");
  assert.equal(b.noWrap, false);
  assert.equal(b.title.textOverflow, undefined);
  assert.equal(b.title.whiteSpace, "normal");
  assert.equal(b.actions.flexWrap, "wrap");
  assert.equal(b.actions.ml, "auto");
});
