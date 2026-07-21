// Canonical per-document-type reference prefixes (guru, 2026-07-20):
// every accounting reference reads "{PREFIX} {documentNumber}" — e.g.
// "INV BI2026070004", "REC OR-000004", "SIN B-000123" — in the DB (journal
// references at post time) and in every accounting report.
//
// Confirmed list (see memory doc-type-prefix-plan):
//   INV C/N D/N QO SO DO RDO | SIN PO PR | REC (receipts + customer payments)
//   P/V (supplier payments) J/V (manual journals) | AJI AJO MSR
// MANUAL_OFFSET is deliberately ABSENT — "it's just a function", offsets keep
// their MO- numbering but are never surfaced as a prefixed type.

export const DOC_TYPE_PREFIX: Record<string, string> = {
  INVOICE: 'INV',
  TI: 'INV',
  TI2: 'INV',
  CREDIT_NOTE: 'C/N',
  CN: 'C/N',
  DEBIT_NOTE: 'D/N',
  DN: 'D/N',
  QUOTATION: 'QO',
  QO: 'QO',
  QO1: 'QO',
  QO2: 'QO',
  QT: 'QO',
  SALES_ORDER: 'SO',
  SO: 'SO',
  DELIVERY_ORDER: 'DO',
  DO: 'DO',
  RETURN_DELIVERY_ORDER: 'RDO',
  RDO: 'RDO',
  BILL: 'SIN', // "Supplier Invoice"
  PURCHASE_ORDER: 'PO',
  PO: 'PO',
  PURCHASE_RETURN: 'PR',
  PR: 'PR',
  OFFICIAL_RECEIPT: 'REC',
  STOCK_ADJUSTMENT_IN: 'AJI',
  SAI: 'AJI',
  STOCK_ADJUSTMENT_OUT: 'AJO',
  SAO: 'AJO',
  MSR: 'MSR',
};

// Every prefix that can legitimately open a reference — used to avoid
// double-stamping ("INV INV BI..." must never happen).
const ALL_PREFIXES = new Set<string>([...Object.values(DOC_TYPE_PREFIX), 'REC', 'P/V', 'J/V']);

export function isPrefixed(reference: string | null | undefined): boolean {
  const first = String(reference || '')
    .trim()
    .split(/\s+/)[0];
  return ALL_PREFIXES.has(first);
}

/** "{PREFIX} {number}" by DOCUMENT type; unknown types return the number unchanged. */
export function docRef(type: string | null | undefined, number: string | null | undefined): string {
  const num = String(number || '').trim();
  if (!num) return num;
  const prefix = DOC_TYPE_PREFIX[String(type || '').toUpperCase()];
  if (!prefix || isPrefixed(num)) return num;
  return `${prefix} ${num}`;
}

/** Stamp an explicit prefix (REC / P/V / J/V call sites); no-op when already stamped. */
export function refWith(prefix: string, number: string | null | undefined): string {
  const num = String(number || '').trim();
  if (!num || isPrefixed(num)) return num;
  return `${prefix} ${num}`;
}
