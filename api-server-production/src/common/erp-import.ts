// Documents imported from a customer's previous ERP (WCT 2026-11, scripts/wct-erp-import.ts).
// History only: they carry their own numbers, totals and paid / owed amounts, and never post
// to the GL, never enter the posting queue, the Xero confirm or the AI index. Payments
// recorded on an OPEN imported invoice still reduce its balance (payments.service).
//
// Marker: config.erpImport = { source, batch, erpId, originalNumber, status, balanceAtImport, … }.

export interface ErpImportMeta {
  source: string; // e.g. "wct-erp"
  batch: string; // e.g. "wct-erp-2026-11-05"
  erpId: string;
  originalNumber?: string;
  status?: string; // the ERP status (Paid, Overdue, Accepted, Declined…)
  /** What the ERP still had owing at import (invoices); payments made in the ERP = gross − this. */
  balanceAtImport?: number;
  [key: string]: unknown;
}

export function erpImportOf(config: any): ErpImportMeta | null {
  const m = config?.erpImport;
  return m && typeof m === 'object' && typeof m.source === 'string' && m.source ? (m as ErpImportMeta) : null;
}

export const isErpImported = (config: any): boolean => erpImportOf(config) !== null;

/** The part of an imported invoice that was already paid in the ERP (0 for any other document). */
export function erpPaidAtImport(config: any, gross: number): number {
  const m = erpImportOf(config);
  if (!m) return 0;
  const bal = Number(m.balanceAtImport);
  if (!Number.isFinite(bal)) return 0;
  return Math.max(0, Math.round((gross - Math.max(0, bal)) * 100) / 100);
}
