// helpers/newDocument.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDocumentUrl, readNewDocument, savedDocumentUrl, numberOnSaveLabel, asThenAction, NEW_DOC_ID } from "./newDocument.ts";

const mem = () => { const m = new Map(); return { setItem: (k, v) => m.set(k, v), getItem: (k) => m.get(k) ?? null, m }; };

test("newDocumentUrl: opens the editor on 'new' and keeps the request out of the URL", () => {
  const s = mem();
  const url = newDocumentUrl({ type: "QUOTATION", templateId: "t1", numberFormatId: "f1", config: { items: [{ d: "x" }] } }, { from: "/portal/sales/quotations", storage: s });
  assert.match(url, new RegExp(`^/portal/documents/QUOTATION/t1/${NEW_DOC_ID}\\?nd=`));
  assert.ok(url.includes("from=%2Fportal%2Fsales%2Fquotations"));
  assert.ok(!url.includes("items"), "the prefill never rides in the URL");
  const key = new URL(url, "http://x").searchParams.get("nd");
  assert.deepEqual(readNewDocument(key, { type: "QUOTATION", templateId: "t1" }, s), { type: "QUOTATION", templateId: "t1", numberFormatId: "f1", config: { items: [{ d: "x" }] } });
});

test("readNewDocument: falls back to the URL's type + template when nothing is stored (or it belongs to another template)", () => {
  const s = mem();
  assert.deepEqual(readNewDocument(null, { type: "INVOICE", templateId: "t2" }, s), { type: "INVOICE", templateId: "t2" });
  const url = newDocumentUrl({ type: "INVOICE", templateId: "t9" }, { storage: s });
  const key = new URL(url, "http://x").searchParams.get("nd");
  assert.deepEqual(readNewDocument(key, { type: "INVOICE", templateId: "t2" }, s), { type: "INVOICE", templateId: "t2" });
});

test("savedDocumentUrl: the real document after the first save, with the action that asked for the save", () => {
  assert.equal(savedDocumentUrl("QUOTATION", "t1", "d1", { from: "/portal/sales/quotations", then: "sign" }), "/portal/documents/QUOTATION/t1/d1?from=%2Fportal%2Fsales%2Fquotations&then=sign");
  assert.equal(savedDocumentUrl("QUOTATION", "t1", "d1"), "/portal/documents/QUOTATION/t1/d1");
});

test("labels and actions", () => {
  assert.equal(numberOnSaveLabel("Quotation"), "New Quotation (number on save)");
  assert.equal(asThenAction("sign"), "sign");
  assert.equal(asThenAction("delete"), null);
});
