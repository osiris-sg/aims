// Save as revision (WCT group, guru 2026-11-23, flag enableQuotationRevisionOnSave).
// An accepted quotation that is edited and saved again can be saved as a REVISION:
// the quotation keeps its row (so its order, delivery orders and invoices stay
// linked) and its number becomes "<number>-R1", "-R2"…; the version it replaces
// is kept as a read-only copy under the old number (config.voided, baseDocumentId
// = the live quotation) and listed in the editor's Revision history.
// Not the Biofuel "Create Revision" (a new unconfirmed "(Rev-1)" document).
// Portal twin: portal-production/helpers/quotationRevision.ts.

export const QUOTATION_REVISION_FLAG = 'enableQuotationRevisionOnSave';

const SUFFIX = /-R(\d+)$/;

/** "QO202611-0016-R2" → "QO202611-0016". */
export const stripRevisionSuffix = (name: string): string => String(name || '').trim().replace(SUFFIX, '');

/** The revision a number carries: 0 for the original, n for "-Rn". */
export const revisionOfName = (name: string): number => {
  const m = SUFFIX.exec(String(name || '').trim());
  return m ? parseInt(m[1], 10) : 0;
};

/** The next revision of a quotation: its number and revision count. */
export function nextRevision(name: string, revisionNumber?: number | null): { name: string; revisionNumber: number } {
  const n = Math.max(revisionOfName(name), Number(revisionNumber) || 0) + 1;
  return { name: `${stripRevisionSuffix(name)}-R${n}`, revisionNumber: n };
}
