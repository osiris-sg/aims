// Order page "Attach signed copy" (23 Nov): the DO page's own Complete DO upload, from the DO card and the DO row menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withDoUploads } from "./orderPage.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("only pending DOs get Attach signed copy on the DO card (not completed, not on a sign link, not ERP, manual flow only)", () => {
  const dos = [
    { id: "a", name: "DO202611030", completed: false },
    { id: "b", name: "DO202611031", completed: true },
    { id: "c", name: "DO202611032", completed: false, awaitingSignature: true },
    { id: "d", name: "DO011981", completed: false, imported: true },
  ];
  const docs = () => dos.map((d) => ({ label: d.name }));
  assert.deepEqual(withDoUploads(docs(), dos, true).map((d) => d.uploadDoId ?? null), ["a", null, null, null]);
  assert.deepEqual(withDoUploads(docs(), dos, false).map((d) => d.uploadDoId ?? null), [null, null, null, null]);
});

test("same dialog as the DO page, opened on Upload signed DO; the file opens from FILE", () => {
  const dialog = read("components/delivery/OfficeCompleteJobDialog.tsx");
  // 25 Nov: opened on "stamped_do" it is the attach form (Attach and complete); otherwise Send for signature / Confirm.
  assert.match(dialog, /const attach = initialMode === "stamped_do";/);
  assert.match(dialog, /void submit\("stamped_do"\)/);
  assert.match(dialog, /void submit\("confirm"\)/);
  assert.ok(!dialog.includes("<ToggleButton"), "no 3-tab pop-up any more");
  const page = read("app/portal/orders/[id]/WctOrderDetail.tsx");
  assert.match(page, /<OfficeCompleteJobDialog/);
  assert.match(page, /initialMode=\{completeMode\}/);
  assert.match(page, /setCompleteMode\("stamped_do"\)/);
  assert.match(page, /if \(r\.file\.fileKey\) return void window\.open\(publicFileUrl\(r\.file\.fileKey\)/);
  const menu = read("app/portal/orders/[id]/OrderDosSection.tsx");
  assert.match(menu, /d && !d\.completed && !cancelled && onUploadDo && \(/);
  assert.match(menu, /Attach signed copy/);
  assert.match(read("app/portal/orders/[id]/OrderPageLayout.tsx"), /d\.uploadDoId && onUploadDo &&/);
  assert.match(read("helpers/orderPage.ts"), /d\.completed && d\.stampedFileKey\s*\? \{ label: "File", path: "", fileKey: String\(d\.stampedFileKey\) \}/);
});

test("balance DO 'Check qty' (24 Nov): on screen above the lines of a draft DO only, never printed", () => {
  const editor = read("containers/DocumentTemplates/components/TabbedDocumentCreator.tsx");
  assert.match(editor, /isDeliveryOrder && !isDocumentConfirmedStatus && checkQtyWarningOf\(existingData\) && \(/);
  assert.match(editor, /data-testid="do-check-qty-warning"/);
  const server = readFileSync(new URL("../../api-server-production/src/deliveries/deliveries.service.ts", import.meta.url), "utf8");
  assert.match(server, /\(doConfig as any\)\.checkQtyWarning = unmatchedRemark;/);
  assert.ok(!/internalRemarks = \[String\(\(doConfig as any\)\.internalRemarks/.test(server));
  const pdf = readFileSync(new URL("../../api-server-production/src/common/services/document-html/wct.ts", import.meta.url), "utf8");
  assert.ok(!pdf.includes("checkQtyWarning"), "the PDF never reads it");
});
