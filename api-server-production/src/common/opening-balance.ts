/**
 * Opening-balance documents (Elroy 2026-11-21): the supplier bills imported from the ABSS card lists at the
 * cutover (scripts/wct-abss-ap-opening.ts, config.erpImport.source 'abss-opening'; WCT (S) and YMM) carry the
 * cutover date as their due date but have no real one. They stay owed (outstanding, open counts, statements),
 * but are never "overdue" or "due today", and ageing shows them in their own "Opening balance" column.
 */
export const OPENING_BALANCE_SOURCES: readonly string[] = ['abss-opening'];
export const OPENING_BALANCE_LABEL = 'Opening balance';

export function isOpeningBalanceDoc(config: any): boolean {
  const src = config?.erpImport?.source;
  return typeof src === 'string' && OPENING_BALANCE_SOURCES.includes(src);
}

/** The same rule in SQL, on a "Document" row's `config` (a constant: no user input). */
export const OPENING_BALANCE_SQL = `COALESCE(config->'erpImport'->>'source', '') IN (${OPENING_BALANCE_SOURCES.map((s) => `'${s}'`).join(', ')})`;
