// Run: node --experimental-strip-types --import ./helpers/test-alias.mjs --test helpers/printedBy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cssString, formatPrintedAt, printedByLine, printedByPrintCss, printerName } from "./printedBy.ts";

test("the line is the moment of printing in dd/mm/yyyy HH:mm, with the printing user's name", () => {
  const at = new Date(2026, 10, 25, 9, 5); // 25 Nov 2026 09:05 local
  assert.equal(formatPrintedAt(at), "25/11/2026 09:05");
  assert.equal(printedByLine("Chong Aik Admin", at), "Printed by Chong Aik Admin on 25/11/2026 09:05");
  assert.equal(printedByLine("", at), "Printed by — on 25/11/2026 09:05");
});

test("printer name: full name, else first name, else username, else email", () => {
  assert.equal(printerName({ fullName: "Kumara Guru", firstName: "Kumara" }), "Kumara Guru");
  assert.equal(printerName({ firstName: "Kumara" }), "Kumara");
  assert.equal(printerName({ username: "guru" }), "guru");
  assert.equal(printerName({ emailAddresses: [{ emailAddress: "admin@osiris.sg" }] }), "admin@osiris.sg");
  assert.equal(printerName(null), "");
});

test("print CSS: bottom-left page margin box plus the WCT spacer row, with a safe CSS string", () => {
  assert.equal(cssString('Say "hi"\\now'), '"Say \\"hi\\"\\\\now"');
  const css = printedByPrintCss('Printed by A on 25/11/2026 09:05');
  assert.match(css, /@page \{ @bottom-left \{ content: "Printed by A on 25\/11\/2026 09:05";/);
  assert.match(css, /tr\.wct-pgbot > td::after \{ content: "Printed by A on 25\/11\/2026 09:05"/);
  assert.match(css, /^@media print/);
});
