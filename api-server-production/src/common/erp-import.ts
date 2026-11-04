import { amountPaidOf, outstandingOf } from './document-money';

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

// ── Stored totals (WCT 2026-11-05): an imported document shows, prints and keeps the ERP's own
// subtotal / GST / total (19 ERP documents carry a GST that is not rate × subtotal). They are
// recalculated only when the lines' money actually changes.

/** The lines' money only (count + qty / unit price / amount per line), so a reformatted description is not a change. */
export function moneySignature(items: any): string {
  const list: any[] = Array.isArray(items) ? items : [];
  const n = (v: any) => {
    const x = Number(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(x) ? x.toFixed(2) : '0.00';
  };
  return list
    .filter((it) => it && !it.isGroupHeader && !it.isTagGroup)
    .map((it) => `${n(it.quantity)}x${n(it.unitPrice)}=${n(it.amount)}`)
    .join('|');
}

export interface ErpStoredTotals {
  grossTotal: number;
  discountAmount: number;
  subTotal: number;
  gstAmount: number;
  nettTotal: number;
  gstPercent: number;
  /** moneySignature of the stored lines. */
  sig: string;
  /** Invoices: what is paid / still owed (the live stamps); null when never stamped. */
  paid?: number | null;
  outstanding?: number | null;
}

/** An imported document's stored totals (null for any other document). */
export function erpStoredTotalsOf(config: any): ErpStoredTotals | null {
  if (!isErpImported(config)) return null;
  const pick = (k: string) => {
    const v = config?.[k] ?? config?.documentInfo?.[k];
    const x = Number(v);
    return v === undefined || v === null || v === '' || !Number.isFinite(x) ? null : x;
  };
  const nettTotal = pick('nettTotal');
  const gstAmount = pick('gstAmount');
  const subTotal = pick('subTotal');
  if (nettTotal === null || gstAmount === null || subTotal === null) return null;
  return {
    grossTotal: pick('grossTotal') ?? subTotal,
    discountAmount: pick('discountAmount') ?? 0,
    subTotal,
    gstAmount,
    nettTotal,
    gstPercent: pick('gstPercent') ?? 0,
    sig: moneySignature(config?.items),
    paid: amountPaidOf(config) ?? null,
    outstanding: outstandingOf(config) ?? null,
  };
}
