/**
 * Delete from the ⋮ menu (WCT group, enableSoftDeleteDrafts, owner 2026-11-25): quotations, DOs and invoices, drafts
 * AND confirmed ones, from the lists, the ticked-rows bar and the document's own ⋮ menu. Delete = soft delete (hidden
 * from every list, the number kept as a gap; documents.service softDeleteDraft). Rules:
 *  - an invoice with any payment / allocation (or paid in the old ERP): never ("Paid invoices can't be deleted");
 *  - a document with live documents made from it (QO with DOs / invoices, DO with an invoice, invoice with a credit
 *    note): blocked until those go ("Delete DO202611056 first");
 *  - a DO that took stock out: blocked (its stock would stay out);
 *  - a confirmed unpaid invoice: allowed; its journals are voided the app's way first (rows stay);
 *  - imported (old-ERP) documents: the same rules.
 * Pure rule here; the reads and the delete live in documents.service (wctDeleteCheck / wctDelete).
 */

export const WCT_DELETE_TYPES = new Set(['QUOTATION', 'QO', 'QO1', 'DELIVERY_ORDER', 'DO', 'INVOICE', 'TI', 'TI2', 'TAX_INVOICE', 'INV']);
export const PAID_TIP = "Paid invoices can't be deleted";

export const isInvoiceType = (t: unknown) => ['INVOICE', 'TI', 'TI2', 'TAX_INVOICE', 'INV'].includes(String(t ?? '').toUpperCase());

export interface WctDeleteFacts {
  name: string | null;
  type: string;
  /** Any Payment row (receipt allocations included) or money paid in the old ERP. */
  paid: boolean;
  /** Live documents made from this one, by number. */
  children: string[];
  /** A DO whose stock was taken out. */
  stockDeducted?: boolean;
  /** Already soft-deleted / gone. */
  missing?: boolean;
}

export interface WctDeleteVerdict {
  ok: boolean;
  /** Why not (the greyed item's tooltip). */
  reason: string | null;
}

export function wctDeleteVerdict(f: WctDeleteFacts): WctDeleteVerdict {
  const what = f.name || 'This document';
  if (f.missing) return { ok: false, reason: `${what} is already deleted` };
  if (!WCT_DELETE_TYPES.has(String(f.type).toUpperCase())) return { ok: false, reason: `${what} can't be deleted here` };
  if (isInvoiceType(f.type) && f.paid) return { ok: false, reason: PAID_TIP };
  if (f.children.length) return { ok: false, reason: `Delete ${joinNames(f.children)} first` };
  if (f.stockDeducted) return { ok: false, reason: `${what} took stock out: reverse the stock first` };
  return { ok: true, reason: null };
}

/** "DO202611056", "DO202611056 and INV202611-0042", "A, B and C". */
export function joinNames(names: string[]): string {
  const n = [...new Set(names.filter(Boolean))];
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
