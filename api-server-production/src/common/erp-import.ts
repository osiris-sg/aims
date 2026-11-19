import { HttpException, HttpStatus } from '@nestjs/common';
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

// ── Imported delivery orders (WCT 2026-11-19, scripts/wct-erp-dos.js) ──────
// The old ERP's DOs are imported as history: DELIVERY_ORDER rows with config.erpImport and no
// DocumentItem rows (so no stock can move). They are READ-ONLY: no save, confirm, complete, sign
// link, job, revision, project link or delete. Every DO entry point calls assertNotErpImportedDo.

const DO_DOC_TYPES = new Set(['DELIVERY_ORDER', 'DO']);
export const IMPORTED_DO_READ_ONLY = 'This DO was imported from the old ERP. It is read-only: it cannot be edited, confirmed, completed, signed, deleted or given a job.';

/** An imported (old-ERP) delivery order. */
export const isErpImportedDo = (doc: { type?: string | null; config?: unknown } | null | undefined): boolean =>
  !!doc && DO_DOC_TYPES.has(String(doc.type ?? '').toUpperCase()) && isErpImported(doc.config);

/** Refuse any change to an imported DO (400 with IMPORTED_DO_READ_ONLY). Other documents pass. */
export function assertNotErpImportedDo(doc: { type?: string | null; config?: unknown } | null | undefined): void {
  if (isErpImportedDo(doc)) throw new HttpException(IMPORTED_DO_READ_ONLY, HttpStatus.BAD_REQUEST);
}

/** Same, by id (a missing document is left to the caller's own not-found handling). */
export async function assertDocNotErpImportedDo(
  prisma: { document: { findFirst: (args: any) => Promise<any> } },
  organizationId: string,
  documentId: string | null | undefined,
): Promise<void> {
  if (!documentId) return;
  const doc = await prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { type: true, config: true } });
  assertNotErpImportedDo(doc);
}

/** Does confirming this document post its GL journal (CN / DN / PO / PR)? Never for imported history,
 *  even when its status is set back and confirmed again (BC Air credit notes, 2026-11-12). */
export const confirmPostsToGl = (becomingConfirmed: boolean, glType: string | undefined, config: any): boolean =>
  !!(becomingConfirmed && glType && !isErpImported(config));

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

/**
 * An imported document's stored totals (null for any other document). Also a
 * Split payment part (config.invoiceSplit, 2026-11-17): the last part carries
 * the original's leftover GST cent, which the editor's formula would re-round,
 * so its stored totals stand while its line's money is unchanged.
 */
export function erpStoredTotalsOf(config: any): ErpStoredTotals | null {
  const splitPart = !!config?.invoiceSplit && typeof config.invoiceSplit === 'object' && typeof config.invoiceSplit.groupId === 'string';
  if (!isErpImported(config) && !splitPart) return null;
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

/**
 * Imported invoices that carry no money (zero total in the ERP): their ERP history has nothing to
 * post, so "confirmed invoice without a GL entry" checks must not count them. Empty for any org
 * without imported documents.
 */
export async function erpImportedZeroInvoiceIds(prisma: { $queryRawUnsafe: (sql: string, ...p: any[]) => Promise<any> }, organizationId: string): Promise<string[]> {
  const rows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
    `SELECT id FROM "Document"
      WHERE "organizationId" = $1 AND type IN ('INVOICE', 'TI') AND config ? 'erpImport'
        AND COALESCE((config->>'totalWithTax')::numeric, (config->>'xeroGross')::numeric, 0) = 0`,
    organizationId,
  );
  return rows.map((r) => r.id);
}

// WCT group (Elroy 2026-11-19): an imported quotation the ERP still has open (Draft / Sent) reads as Unconfirmed
// in the lists, the status filter and the Unconfirmed card; one that was open at import and the ERP later
// cancelled reads as Cancelled (Accepted reads as Confirmed, the stored status). Display only: the stored status
// stays `confirmed`, so the document stays locked (no edit, no confirm). Only wct-erp imports (WCT group).
const QUOTE_DOC_TYPES = new Set(['QUOTATION', 'QO', 'QT', 'QO1']);
const ERP_QUOTE_OPEN = new Set(['draft', 'sent']);
const ERP_QUOTE_CANCELLED = ['cancelled', 'canceled', 'declined', 'rejected', 'lost', 'void', 'voided'];
export const isQuotationDocType = (t: unknown): boolean => QUOTE_DOC_TYPES.has(String(t ?? '').toUpperCase());
export function erpQuotationDisplayStatus(type: unknown, config: any): 'unconfirmed' | 'cancelled' | null {
  const m = erpImportOf(config);
  if (!m || m.source !== 'wct-erp' || !isQuotationDocType(type)) return null;
  const st = String(m.status ?? '').trim().toLowerCase();
  // Confirmed by the owner in AIMS while the ERP still has it open (Q-013548 / Q-013557, Elroy 19 Nov): reads as
  // the stored Confirmed. A later ERP cancel still reads Cancelled.
  if (ERP_QUOTE_OPEN.has(st)) return (m as any).ownerConfirmed ? null : 'unconfirmed';
  const first = String((m as any).statusAtFirstImport ?? '').trim().toLowerCase();
  if (ERP_QUOTE_CANCELLED.includes(st) && ERP_QUOTE_OPEN.has(first)) return 'cancelled';
  return null;
}
/** The small tag beside the status: "ERP draft" / "ERP sent" while the ERP has it open. */
export function erpQuotationTag(type: unknown, config: any): string | null {
  if (erpQuotationDisplayStatus(type, config) !== 'unconfirmed') return null;
  return `ERP ${String(erpImportOf(config)?.status ?? '').trim().toLowerCase()}`;
}
export const ERP_QUOTE_CANCELLED_STATUSES = ERP_QUOTE_CANCELLED;
