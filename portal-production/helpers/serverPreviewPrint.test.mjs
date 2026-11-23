// Run: npm test (node --test). WCT browser print (2026-11-23): ServerDocumentPreview prints the WCT sheet with
// @page margin 0 (Chrome then has no room for its own date / URL header and footer) and gives the document its own
// margins back; the CSS is added to the iframe only around print() and only targets the WCT layout, so CIEL's ID
// quotation (the other server-rendered layout) and the server PDF keep their geometry. Static read of the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../containers/DocumentTemplates/components/ServerDocumentPreview.tsx", import.meta.url), "utf8");
const css = /export const WCT_BROWSER_PRINT_CSS = `([^`]*)`/.exec(src)?.[1] ?? "";
const printFn = /export function printServerDocument\(w: Window\): void \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
const handle = /useImperativeHandle\(ref, \(\) => \(\{([\s\S]*?)\}\)\);/.exec(src)?.[1] ?? "";

test("the browser-print CSS sets @page { size: A4; margin: 0 } inside @media print", () => {
  assert.ok(css, "WCT_BROWSER_PRINT_CSS found");
  assert.match(css, /^@media print \{/);
  assert.match(css, /@page \{ size: A4; margin: 0 \}/);
});

test("every other rule targets the WCT layout only (.wct / table.wct-sheet)", () => {
  const body = css.replace(/^@media print \{/, "").replace(/\}\s*$/, "").replace(/@page \{[^}]*\}/, "");
  const selectors = [...body.matchAll(/([^{}]+)\{[^}]*\}/g)].map((m) => m[1].trim());
  assert.ok(selectors.length >= 3, `rules found: ${selectors.join(" | ")}`);
  for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^(\.wct\b|table\.wct-sheet\b)/, `selector "${part.trim()}" is WCT-only`);
  // Margins back on every page: side padding + the renderer's repeating spacer rows.
  assert.match(css, /\.wct \{ padding: 0 14mm; \}/);
  assert.match(css, /tr\.wct-pgtop > td \{ height: 12mm !important; \}/);
  assert.match(css, /tr\.wct-pgbot > td \{ height: 12mm !important; \}/);
});

test("the CSS is injected only around print, only for a WCT sheet, and removed after", () => {
  assert.ok(printFn, "printServerDocument found");
  assert.match(printFn, /querySelector\("table\.wct-sheet"\)/);
  const inject = printFn.indexOf("appendChild(style)");
  const print = printFn.indexOf("w.print()");
  assert.ok(inject > 0 && print > inject, "style appended before print()");
  assert.match(printFn, /addEventListener\("afterprint", cleanup/);
  assert.match(printFn, /style\?\.remove\(\)/);
  // The preview's print() goes through it; the CSS is not part of the on-screen preview HTML.
  assert.match(handle, /printServerDocument\(w\)/);
  assert.doesNotMatch(handle, /w\.print\(\)/);
  const preview = /const PREVIEW_CSS = `([^`]*)`/.exec(src)?.[1] ?? "";
  assert.doesNotMatch(preview, /@page/);
  assert.equal((src.match(/WCT_BROWSER_PRINT_CSS/g) || []).length, 2, "used only by printServerDocument");
});
