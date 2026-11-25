/*
 * "Printed by <user> on <date time>" at the foot of EVERY printed document, every
 * org (guru 2026-11-25). It is the moment of PRINTING and the person printing —
 * never the document's creation. Drawn in the page's bottom margin box
 * (@page @bottom-left), so it repeats on every page and never moves the
 * document's own layout; the WCT sheet prints with a 0 page margin, so there it
 * is drawn inside the sheet's repeating bottom spacer row instead.
 * Pure; tested by helpers/printedBy.test.mjs.
 */
export const PRINTED_BY_STYLE_ID = "aims-printed-by";

const two = (n: number) => String(n).padStart(2, "0");

/** dd/mm/yyyy HH:mm — the portal's date order (dates are dd/mm/yyyy everywhere). */
export const formatPrintedAt = (at: Date): string =>
  `${two(at.getDate())}/${two(at.getMonth() + 1)}/${at.getFullYear()} ${two(at.getHours())}:${two(at.getMinutes())}`;

/** The name shown: full name, else first name, else username, else email. */
export const printerName = (user: any): string =>
  String(
    user?.fullName ||
      user?.firstName ||
      user?.username ||
      user?.primaryEmailAddress?.emailAddress ||
      user?.emailAddresses?.[0]?.emailAddress ||
      "",
  ).trim();

export const printedByLine = (name: string, at: Date): string =>
  `Printed by ${name || "—"} on ${formatPrintedAt(at)}`;

/** A CSS string literal (quotes and backslashes escaped, no line breaks). */
export const cssString = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;

const FONT = "font: 8pt Helvetica, Arial, sans-serif; color: #555;";

/** Print-only CSS: the line in the bottom-left page margin box, and inside the WCT sheet's bottom spacer row. */
export const printedByPrintCss = (line: string): string => {
  const c = cssString(line);
  return `@media print {
  @page { @bottom-left { content: ${c}; ${FONT} vertical-align: top; padding-top: 1mm; } }
  table.wct-sheet > tfoot > tr.wct-pgbot > td::after { content: ${c}; display: block; ${FONT} line-height: 1.2; padding: 2mm 0 0; text-align: left; }
}`;
};

/** Adds the print-only <style> to a document (replacing an earlier one); returns a remover. */
export function installPrintedBy(doc: Document, line: string): () => void {
  doc.getElementById(PRINTED_BY_STYLE_ID)?.remove();
  const style = doc.createElement("style");
  style.id = PRINTED_BY_STYLE_ID;
  style.textContent = printedByPrintCss(line);
  (doc.head || doc.body || doc.documentElement).appendChild(style);
  return () => style.remove();
}
