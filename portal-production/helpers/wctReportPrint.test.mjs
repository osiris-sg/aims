// Run: npm test (node --test). WCT service report browser print (2026-11-23): WctReportView prints the server's
// paper with @page margin 0 (Chrome then has no room for its own date / URL header and footer) and gives the report
// its own margins back: top from padding in the repeating letterhead thead (table.sheet), sides + bottom from body
// padding cloned onto every page by box-decoration-break. The CSS is added to the print frame only around print()
// and removed on afterprint, so the on-screen paper and the server PDF keep their geometry. Static read of the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/portal/maintenance-reports/_components/WctReportView.tsx", import.meta.url), "utf8");
const css = /export const WCT_REPORT_BROWSER_PRINT_CSS = `([^`]*)`/.exec(src)?.[1] ?? "";
const printFn = /export function printWctReport\(w: Window\): void \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
const printAction = /const print = async \(\) => \{([\s\S]*?)\n  \};/.exec(src)?.[1] ?? "";

test("the browser-print CSS sets @page { size: A4; margin: 0 } inside @media print", () => {
  assert.ok(css, "WCT_REPORT_BROWSER_PRINT_CSS found");
  assert.match(css, /^@media print \{/);
  assert.match(css, /\}\s*$/);
  assert.match(css, /@page \{ size: A4; margin: 0 \}/);
  // Every rule sits inside the one @media print block (nothing applies on screen).
  const inner = css.replace(/^@media print \{/, "").replace(/\}\s*$/, "");
  assert.doesNotMatch(inner, /@media/);
});

test("the report keeps its margins on every page", () => {
  // 14mm sides + 12mm bottom on the body, cloned onto each page fragment.
  assert.match(css, /body \{ padding: 0 14mm 12mm; box-decoration-break: clone; -webkit-box-decoration-break: clone; \}/);
  // 12mm top from the letterhead thead, which Chromium repeats on every page.
  assert.match(css, /table\.sheet > thead > tr > td \{ padding-top: 12mm; \}/);
});

test("the CSS is injected only around print, only for the WCT paper, and removed after", () => {
  assert.ok(printFn, "printWctReport found");
  assert.match(printFn, /querySelector\("table\.sheet"\)/);
  const inject = printFn.indexOf("appendChild(style)");
  const print = printFn.indexOf("w.print()");
  assert.ok(inject > 0 && print > inject, "style appended before print()");
  assert.match(printFn, /addEventListener\("afterprint", cleanup/);
  assert.match(printFn, /style\?\.remove\(\)/);
  // Both print paths (plain frame, and the hidden frame used while editing) go through it.
  assert.ok(printAction, "print action found");
  assert.equal((printAction.match(/printWctReport\(frame\.contentWindow\)/g) || []).length, 2);
  assert.doesNotMatch(printAction, /\.print\(\)/);
  // Only printWctReport uses the CSS: it is not part of the on-screen paper.
  assert.equal((src.match(/WCT_REPORT_BROWSER_PRINT_CSS/g) || []).length, 2, "used only by printWctReport");
});
