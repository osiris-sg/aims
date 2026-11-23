// Save as revision (WCT group, guru 2026-11-23, flag enableQuotationRevisionOnSave): an accepted
// quotation saved as a revision takes "<number>-R1", "-R2"… (never "(Rev-1)"). The server decides
// the number (api documents/quotation-revision.ts); this only shows it on the Save buttons.
// Tested by helpers/quotationRevision.test.mjs.

const SUFFIX = /-R(\d+)$/;

/** The number the next revision of this quotation will carry. */
export function nextRevisionName(name: string | null | undefined): string {
  const n = String(name || "").trim();
  if (!n) return "";
  const m = SUFFIX.exec(n);
  return `${n.replace(SUFFIX, "")}-R${(m ? parseInt(m[1], 10) : 0) + 1}`;
}
