/**
 * Reference = order link (round 39, WCT group, enableWctOrders, Elroy 2026-11-20). In the invoice and DO editors the
 * Reference field is a combobox: typing searches the customer's quotations / orders; picking one links the document
 * to that quotation's order (made when missing) and the Reference reads "ORD… · QO…"; free text stays a plain
 * reference. Pure helpers, tested in doc-order-ref.spec.ts; the service is doc-order-ref.service.ts.
 */
import { erpQuotationDisplayStatus } from '../common/erp-import';
import { billedPercent } from './imported-orders';

/** The link as the Reference reads it: "ORDW202611-004 · QO202611-0051". */
export const orderRefLabel = (orderNumber: string | null | undefined, quotationName: string | null | undefined): string =>
  [orderNumber, quotationName].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ');

/** The editor documents that take a link: invoices and DOs. */
export function refDocKind(type: string | null | undefined): 'INVOICE' | 'DELIVERY_ORDER' | null {
  const t = String(type ?? '').toUpperCase();
  if (['INVOICE', 'TAX_INVOICE', 'INV'].includes(t)) return 'INVOICE';
  if (['DELIVERY_ORDER', 'DO'].includes(t)) return 'DELIVERY_ORDER';
  return null;
}

/** A draft the editor still writes (the Reference text and the customer may be filled in). */
export const isDraftDoc = (status: string | null | undefined): boolean => ['draft', 'unconfirmed'].includes(String(status ?? '').toLowerCase());

/**
 * A quotation the customer has accepted: stored confirmed and, for an old ERP one, not still open (or expired /
 * cancelled) in the ERP (the documents list's own reading, common/erp-import.ts).
 */
export function isAcceptedQuotation(q: { type?: string | null; status?: string | null; config?: any }, today?: string): boolean {
  if (String(q.status ?? '').toLowerCase() !== 'confirmed') return false;
  if (q.config?.voided === true || q.config?.cancelled === true) return false;
  return erpQuotationDisplayStatus(q.type, q.config, today ? { today } : {}) === null;
}

export interface RefOptionInput {
  accepted: boolean;
  billedPct: number | null;
  orderCancelled: boolean;
  /** An old ERP quotation with no order while imported orders are on: it cannot get one (IMPORTED_QUOTATION_NO_ORDER). */
  noOrderPossible: boolean;
}

/** The default list: accepted, not fully billed, on an order that can take it. "Show all" lists every one. */
export const isOpenRefOption = (o: RefOptionInput): boolean => o.accepted && !o.orderCancelled && !o.noOrderPossible && !(o.billedPct != null && o.billedPct >= 100);

/** Billed % of a quotation's order: what its counted invoices bill against the quotation total. */
export const refBilledPct = (billed: number, quoteTotal: number | null | undefined): number | null => billedPercent(Math.round(billed * 100) / 100, quoteTotal ?? null);

/** "Fill remaining lines": what is left to bill (priced), else the whole quotation while nothing is billed yet. */
export function fillLinesOf(
  remaining: Array<{ description: string; quantity: number; unitPrice: number; amount: number; priced: boolean }> | null | undefined,
  quoteLines: Array<{ description: string; quantity: number; unitPrice: number; amount: number; priced: boolean }>,
  billed: number,
): Array<{ description: string; quantity: number; unitPrice: number; amount: number }> {
  const strip = (l: { description: string; quantity: number; unitPrice: number; amount: number }) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount });
  const left = (remaining ?? []).filter((l) => l.priced && l.amount > 0);
  if (left.length) return left.map(strip);
  if (billed > 0.005) return [];
  return quoteLines.filter((l) => l.description || l.amount).map(strip);
}
