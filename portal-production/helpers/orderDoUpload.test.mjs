// Order page "Upload completed DO" (23 Nov): the DO page's own Complete DO upload, from the DO card and the DO row menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withDoUploads } from "./orderPage.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("only pending DOs get Upload completed DO on the DO card (not completed, not on a sign link, not ERP, manual flow only)", () => {
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
  assert.match(dialog, /useState<Mode>\(initialMode \?\? "signature"\)/);
  // The reset when it opens keeps the starting way too (review 23 Nov).
  assert.match(dialog, /setMode\(initialMode \?\? "signature"\);[\s\S]*\}, \[open, defaultName, initialMode\]\);/);
  const page = read("app/portal/orders/[id]/WctOrderDetail.tsx");
  assert.match(page, /<OfficeCompleteJobDialog/);
  assert.match(page, /initialMode=\{completeMode\}/);
  assert.match(page, /setCompleteMode\("stamped_do"\)/);
  assert.match(page, /if \(r\.file\.fileKey\) return void window\.open\(publicFileUrl\(r\.file\.fileKey\)/);
  const menu = read("app/portal/orders/[id]/OrderDosSection.tsx");
  assert.match(menu, /d && !d\.completed && !cancelled && onUploadDo && \(/);
  assert.match(menu, /Upload completed DO/);
  assert.match(read("app/portal/orders/[id]/OrderPageLayout.tsx"), /d\.uploadDoId && onUploadDo &&/);
  assert.match(read("helpers/orderPage.ts"), /d\.completed && d\.stampedFileKey\s*\? \{ label: "File", path: "", fileKey: String\(d\.stampedFileKey\) \}/);
});
