// "New <type> (number on save)": the editor and every Create entry point.
// Source-level checks (the editor is a 9k-line client component with no test
// harness); the server side (atomic numbering, draft creates nothing) is the
// dev e2e api-server-production/scripts/_number-on-save-e2e.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const TDC = read("containers/DocumentTemplates/components/TabbedDocumentCreator.tsx");
const PAGE = read("app/portal/documents/[type]/[id]/[documentId]/page.tsx");

/** The body of `const <name> = async (...) => {` up to its first statements. */
const head = (src, name, n = 600) => {
  const i = src.indexOf(`const ${name} = `);
  assert.ok(i >= 0, `${name} not found`);
  return src.slice(i, i + n);
};

test("opening a new document creates nothing: the page loads the draft, and creates only on the first save", () => {
  const load = PAGE.slice(PAGE.indexOf("if (isNew && newDocRequest)"), PAGE.indexOf("// Check cache first"));
  assert.match(load, /\/documents\/basic\/draft/);
  assert.equal(/path: "\/documents\/basic"[^/]/.test(load), false, "no create while opening");
  const save = PAGE.slice(PAGE.indexOf("const handleSave = async"), PAGE.indexOf("const handlePrint = () =>"));
  assert.match(save, /if \(isNew\) \{\s*const created = await request\(\s*\{ path: "\/documents\/basic", method: "POST" \}/);
});

test("every Create entry point opens a new, unsaved document (no POST /documents/basic)", () => {
  for (const p of [
    "app/portal/components/useCreateDocumentFlow.tsx",
    "app/portal/components/GoToLatestDocument.tsx",
    "app/portal/sales/components/SalesDocumentList.tsx",
    "app/portal/documents/create/page.tsx",
    "app/portal/invoices/create/page.tsx",
    "app/scan/[sku]/page.tsx",
  ]) {
    assert.equal(read(p).includes('"/documents/basic"'), false, `${p} still creates on Create`);
  }
  const inv = read("app/portal/invoices/page.tsx");
  assert.match(inv, /newDocumentUrl\(/);
  const proj = read("app/portal/projects/[id]/page.tsx");
  assert.match(proj.slice(proj.indexOf("const handleCreateQuotation"), proj.indexOf("const handleCreateQuotation") + 900), /newDocumentUrl\(/);
  assert.match(TDC.slice(TDC.indexOf("const docTypeForCreate"), TDC.indexOf("const docTypeForCreate") + 800), /router\.push\(newDocumentUrl\(/);
});

test("each action that needs a number saves a new document first", () => {
  assert.match(head(TDC, "handlePrint"), /if \(isNewUnsaved\) \{\s*void saveThen\("print"\)/);
  assert.match(head(TDC, "handleOpenSendEmail"), /if \(isNewUnsaved\) return saveThen\("email"\)/);
  for (const fn of ["handleConfirmDocument", "handleConfirmQuotation", "handleConfirmPO", "handleConfirmAdjustment", "handleConfirmDO", "handleConfirmPR", "handleConfirmInvoice"]) {
    assert.match(head(TDC, fn), /if \(isNewUnsaved\) return saveThen\("confirm"\)/, `${fn} does not save first`);
  }
  for (const action of ["sign", "attachments", "share-delivery", "share-do-view"]) {
    assert.ok(TDC.includes(`if (isNewUnsaved) void saveThen("${action}")`), `menu action ${action} does not save first`);
  }
});

test("after the first save the action runs on the saved document, once", () => {
  const runner = TDC.slice(TDC.indexOf("const thenRanRef = useRef(false);"), TDC.indexOf("const openConfirmForThisType"));
  for (const a of ["sign", "print", "email", "attachments", "history", "share-do-view", "share-delivery", "confirm"]) assert.ok(runner.includes(`action === "${a}"`), `no runner for ${a}`);
  assert.match(runner, /url\.searchParams\.delete\("then"\)/);
  assert.match(PAGE, /savedDocumentUrl\(/);
});

test("the header says the number comes on save", () => {
  assert.match(TDC, /isNewUnsaved \? numberOnSaveLabel\(getDocumentTitle\(\)\)/);
});
