// Document status model (guru 2026-07-24): no more "draft" — documents are
// UNCONFIRMED until confirmed. Invoices/bills then go straight to
// pending_payment (displayed "Awaiting payment") and finally paid; other
// types end at confirmed. 'draft' remains readable everywhere because prod
// data still carries it until its backfill runs.

export const UNCONFIRMED_DOC_STATUSES = ['draft', 'unconfirmed'];

export function isUnconfirmedDoc(status?: string | null): boolean {
  return UNCONFIRMED_DOC_STATUSES.includes(String(status || '').toLowerCase());
}
