// Drag-and-drop (2026-11-03): helpers/fileDrop.ts + where it is wired; WCT SIN Quotation No.: helpers/sinQuotation.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acceptKinds, dragHasFiles, matchesAccept, skippedMessage, splitDropped } from "./fileDrop.ts";
import { quotationOptionLabel, quotationTotal, tagOf } from "./sinQuotation.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const UPLOAD_ACCEPT = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.zip,application/pdf,image/*,application/zip";

test("accept lists: the SIN box takes PDF / image / ZIP, Source Documents PDF / image", () => {
  const f = (name, type = "") => ({ name, type });
  for (const x of [f("a.pdf", "application/pdf"), f("b.JPG"), f("c.png", "image/png"), f("d.zip", "application/zip"), f("e.heic", "image/heic")]) assert.ok(matchesAccept(x, UPLOAD_ACCEPT), x.name);
  for (const x of [f("notes.docx", "application/vnd.openxmlformats"), f("sheet.xlsx"), f("x.txt", "text/plain")]) assert.ok(!matchesAccept(x, UPLOAD_ACCEPT), x.name);
  const src = "application/pdf,image/*";
  assert.ok(matchesAccept(f("a.pdf", "application/pdf"), src));
  assert.ok(matchesAccept(f("scan", "image/jpeg"), src));
  assert.ok(!matchesAccept(f("a.zip", "application/zip"), src));
  assert.ok(matchesAccept(f("anything.bin"), ""));
});

test("a mixed drop: accepted files go on, the rest are named in one message", () => {
  const { accepted, skipped } = splitDropped([{ name: "a.pdf", type: "application/pdf" }, { name: "notes.docx", type: "" }, { name: "b.zip", type: "application/zip" }], UPLOAD_ACCEPT);
  assert.deepEqual(accepted.map((x) => x.name), ["a.pdf", "b.zip"]);
  assert.deepEqual(skipped, ["notes.docx"]);
  assert.equal(skippedMessage(skipped, acceptKinds(UPLOAD_ACCEPT)), "notes.docx skipped: only PDF, image or ZIP files can be added.");
  assert.equal(skippedMessage(["a.doc", "b.doc"], acceptKinds("application/pdf,image/*")), "2 files skipped (a.doc, b.doc): only PDF or image files can be added.");
  assert.equal(skippedMessage([], "PDF"), null);
  assert.doesNotMatch(skippedMessage(["x"], "PDF"), /[–—]/);
});

test("Safari: a file drag is recognised by its 'Files' type (the files themselves are hidden until the drop)", () => {
  assert.ok(dragHasFiles({ types: ["Files"] }));
  assert.ok(dragHasFiles({ types: ["text/uri-list", "Files"] }));
  assert.ok(!dragHasFiles({ types: ["text/plain"] }));
  assert.ok(!dragHasFiles(null));
});

test("wired: the SIN box and every Source Documents section are drop zones", () => {
  const sin = read("app/portal/accounting/bills/_components/BillEditorDialog.tsx");
  assert.match(sin, /useFileDrop\(\{ accept: UPLOAD_ACCEPT, onFiles: \(fs\) => void handleFiles\(fs\)/);
  assert.match(sin, /\{\.\.\.uploadDrop\.bind\}/);
  const up = read("components/AttachmentUploader.tsx");
  assert.match(up, /useFileDrop\(\{ accept, onFiles: \(fs\) => void handleFiles\(fs\)/);
  assert.match(up, /\{\.\.\.bind\}/);
  const hook = read("hooks/useFileDrop.ts");
  assert.match(hook, /e\.preventDefault\(\); \/\/ required \(Chrome and Safari\) for the drop to fire/);
  assert.match(hook, /window\.addEventListener\("drop", stop\)/);
});

test("WCT Quotation No.: label, total, tag; shown only for WCT supplier invoices", () => {
  assert.equal(quotationOptionLabel("QO202611-0020", "Ajiya", 1234.5), "QO202611-0020 · Ajiya · S$1,234.50");
  assert.equal(quotationOptionLabel("QO202611-0020", "N/A", null), "QO202611-0020");
  assert.equal(quotationTotal({ nettTotal: 98.1 }), 98.1);
  assert.equal(quotationTotal({ totalWithTax: "10.5" }), 10.5);
  assert.equal(quotationTotal({}), null);
  assert.deepEqual(tagOf({ quotationId: "q", quotationNumber: "QO1" }), { id: "q", number: "QO1" });
  assert.equal(tagOf({}), null);
  const sin = read("app/portal/accounting/bills/_components/BillEditorDialog.tsx");
  assert.match(sin, /const showQuotation = !!isWctOrdersEnabled && kind === "SIN";/);
  // 2026-11-04: per line — a column after Account, the header field gone; a posted SIN saves the line tags at once.
  assert.match(sin, /\{showQuotation && <TableCell sx=\{\{ fontWeight: 700, width: 170 \}\}>Quotation No\.<\/TableCell>\}/);
  assert.match(sin, /if \(isReadOnly && editing\?\.id\) void saveLineQuotations\(rows, prev\)/);
  assert.doesNotMatch(sin, /value=\{quotation\}/);
  const pj = read("app/portal/accounting/payables/purchase-journal/page.tsx");
  assert.match(pj, /header: "Quotation No\."/);
  assert.match(pj, /\/portal\/documents\/open\/\$\{q\.id\}/);
  assert.match(read("app/portal/orders/[id]/WctOrderDetail.tsx"), /Supplier invoices total/);
});
