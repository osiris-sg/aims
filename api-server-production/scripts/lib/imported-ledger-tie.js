/**
 * Imported-ledger tie (verify-accounting-invariants.ts check 5c, owner 2026-11-25).
 *
 * An imported ledger (ABSS: JournalEntry.createdBy "abss-gl:<batch>") keeps a sale as several entries under one
 * number: the original plus later amendments (often dated the 1st of a GST quarter), discount / credit lines in the
 * same entry, customer swaps. Only the first entry is tied to the document, so comparing that one journal's total
 * debit with the document (check 5) flags real splits and amendments. Here ALL live entries under the number are
 * added up on the control account (AR for sales, AP for purchases) and compared with the document's gross; what
 * is still off is a warning (ABSS and the ERP disagree), not a failure. Same spirit as the Xero-import exclusion.
 */
const IMPORTED_LEDGER_PREFIX = 'abss-gl:';

const isImportedLedger = (createdBy) => typeof createdBy === 'string' && createdBy.startsWith(IMPORTED_LEDGER_PREFIX);

/**
 * @param {{ side: 'AR'|'AP', docGross: number, controlNet: number }} f
 *   controlNet: Σ(debit − credit) on the control account over every live entry under the number.
 * @returns {{ ok: boolean, diff: number }} ok within 2 cents. AR: the net debit should equal the gross; AP: the net
 *   credit should.
 */
function importedLedgerTie({ side, docGross, controlNet }) {
  const booked = side === 'AP' ? -controlNet : controlNet;
  const diff = Math.round((booked - docGross) * 100) / 100;
  return { ok: Math.abs(diff) <= 0.02, diff };
}

/** A document dated before the ledger's opening day: its original sale is in the opening balance (only later
 *  amendments are entries), so there is nothing to add up; skipped. Only ISO dates are compared. */
function beforeOpening(docDate, opening) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return !!docDate && !!opening && iso.test(docDate) && iso.test(opening) && docDate < opening;
}

/** Counts per org: [{ org, n }] -> "org1 3, org2 1" (stable order, most first). */
function perOrg(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.org, (m.get(r.org) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([o, n]) => `${o} ${n}`).join(', ');
}

module.exports = { IMPORTED_LEDGER_PREFIX, isImportedLedger, importedLedgerTie, perOrg, beforeOpening };
