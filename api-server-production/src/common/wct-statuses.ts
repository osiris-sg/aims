import { erpQuotationDisplayStatus } from './erp-import';

/**
 * WCT group status set (features.enableWctStatuses, Elroy 2026-11-19). Display and list filters only: the stored
 * Document.status is never changed, so no data is lost and every other org keeps its statuses.
 *
 *   Quotations  Unconfirmed (draft / unconfirmed, or an imported one the old ERP has as Draft / Sent, dated within
 *               the last 6 months), Expired (an imported ERP Draft / Sent dated more than 6 months ago, round 35;
 *               common/erp-import.ts erpDraftState), Confirmed (incl. one the owner confirmed in AIMS while the ERP
 *               still has it open), Cancelled (cancelled / voided, or ERP Cancelled), Declined (ERP Declined / Rejected / Lost).
 *   DOs         Draft (draft, unconfirmed, confirmed, Pending Delivery, anything not delivered), Completed
 *               (Delivered (Not Installed), Delivered & Installed, Returned; imported ERP DOs), Cancelled.
 *   Invoices    Draft (draft / unconfirmed), Voided (voided, or ERP Cancelled), Credited (credit notes cover the total), Paid,
 *               Overdue (still owed past its due date, nothing paid), Overdue · part paid (overdue_part_paid: past its due
 *               date with some paid, Elroy 2026-11-19), Part paid (part paid, not yet due), Unpaid.
 *   Filter      ONE "Overdue" option, matching both overdue values (wctStatusMatches); "overdue_part_paid" is also
 *               taken on its own (e.g. a link), it is just not a separate option in the list.
 */

export type WctFamily = 'QUOTATION' | 'DO' | 'INVOICE';

export const WCT_STATUS_OPTIONS: Record<WctFamily, Array<{ value: string; label: string }>> = {
  QUOTATION: [
    { value: 'unconfirmed', label: 'Unconfirmed' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'expired', label: 'Expired' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'declined', label: 'Declined' },
  ],
  DO: [
    { value: 'draft', label: 'Draft' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  INVOICE: [
    { value: 'draft', label: 'Draft' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'part_paid', label: 'Part paid' },
    { value: 'paid', label: 'Paid' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'credited', label: 'Credited' },
    { value: 'voided', label: 'Voided' },
  ],
};

const FAMILY: Record<string, WctFamily> = {
  QUOTATION: 'QUOTATION',
  QO: 'QUOTATION',
  QT: 'QUOTATION',
  QO1: 'QUOTATION',
  DELIVERY_ORDER: 'DO',
  DO: 'DO',
  INVOICE: 'INVOICE',
  TI: 'INVOICE',
  TI2: 'INVOICE',
};
export const wctFamilyOf = (type: unknown): WctFamily | null => FAMILY[String(type ?? '').toUpperCase()] ?? null;
/** The family of a list's type set, when every type is in one family. */
export function wctFamilyOfTypes(types: unknown[] | null | undefined): WctFamily | null {
  if (!types?.length) return null;
  const fams = new Set(types.map((t) => wctFamilyOf(t)));
  return fams.size === 1 && !fams.has(null) ? ([...fams][0] as WctFamily) : null;
}
/** Values a row can carry that are not their own filter option: overdue and part paid is under Overdue. */
const EXTRA_VALUES: Record<WctFamily, string[]> = { QUOTATION: [], DO: [], INVOICE: ['overdue_part_paid'] };
export const isWctStatusValue = (family: WctFamily, v: unknown): boolean => WCT_STATUS_OPTIONS[family].some((o) => o.value === v) || EXTRA_VALUES[family].includes(String(v));
/** Does a row's WCT status match the wanted filter values? "Overdue" takes both overdue values. */
export const wctStatusMatches = (wanted: string[], cls: string): boolean => wanted.includes(cls) || (cls === 'overdue_part_paid' && wanted.includes('overdue'));

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const ERP_OPEN = ['draft', 'sent'];
const ERP_DECLINED = ['declined', 'rejected', 'lost'];
const ERP_CANCELLED = ['cancelled', 'canceled', 'void', 'voided'];
const DO_DONE = ['delivered_installed', 'delivered_not_installed', 'returned', 'paid'];

export interface WctStatusInput {
  type: unknown;
  status: string | null | undefined;
  config: any;
  /** Invoices: credit notes on it (gross), from confirmed credit notes whose source is this invoice. */
  creditFromNotes?: number;
  /** YYYY-MM-DD, Singapore. */
  today: string;
  /** Round 35: a quotation's list date / created date, used for the 6-month rule only when it carries no date. */
  listIssueDate?: string | null;
  createdAt?: Date | string | null;
}

/** The WCT display status of one document (null when its type is not a quotation, DO or invoice). */
export function wctStatusOf(d: WctStatusInput): string | null {
  const fam = wctFamilyOf(d.type);
  if (!fam) return null;
  const s = String(d.status ?? '').toLowerCase();
  const c = d.config || {};
  const cancelledFlag = c.cancelled === true || c.voided === true || s === 'cancelled' || s === 'voided';
  if (fam === 'DO') {
    if (cancelledFlag) return 'cancelled';
    return DO_DONE.includes(s) ? 'completed' : 'draft';
  }
  if (fam === 'QUOTATION') {
    const erp = c.erpImport?.source === 'wct-erp' ? String(c.erpImport?.status ?? '').trim().toLowerCase() : '';
    if (cancelledFlag || ERP_CANCELLED.includes(erp)) return 'cancelled';
    if (ERP_DECLINED.includes(erp)) return 'declined';
    // Open in the ERP (Draft / Sent): Unconfirmed, Expired after 6 months, Confirmed when the owner confirmed it (erp-import.ts).
    if (ERP_OPEN.includes(erp)) return erpQuotationDisplayStatus(d.type, c, { today: d.today, listIssueDate: d.listIssueDate, createdAt: d.createdAt }) ?? 'confirmed';
    if (s === 'draft' || s === 'unconfirmed' || !s) return 'unconfirmed';
    return 'confirmed';
  }
  // INVOICE (an imported one the old ERP cancelled reads Voided)
  const erpInv = c.erpImport?.source === 'wct-erp' ? String(c.erpImport?.status ?? '').trim().toLowerCase() : '';
  if (s === 'voided' || c.voided === true || ERP_CANCELLED.includes(erpInv)) return 'voided';
  if (s === 'draft' || s === 'unconfirmed' || !s) return 'draft';
  const gross = n(c.totalWithTax) ?? n(c.xeroGross) ?? n(c.nettTotal) ?? 0;
  const trackerCredit = Array.isArray(c.erpImport?.creditNotes) ? c.erpImport.creditNotes.reduce((t: number, x: any) => t + (n(x?.amount) ?? 0), 0) : 0;
  const credit = trackerCredit > 0 ? trackerCredit : d.creditFromNotes ?? 0;
  if (gross > 0.005 && credit >= gross - 0.005) return 'credited';
  const outstanding = n(c.outstandingBalance) ?? n(c.xeroBalance); // null = never stamped = owed in full
  const paid = n(c.paidToDate) ?? n(c.xeroAmountPaid) ?? 0;
  if (s === 'paid' || (outstanding !== null && outstanding <= 0.005)) return 'paid';
  const due = String(c.dueDate ?? c.documentInfo?.dueDate ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(due) && due < d.today) return paid > 0.005 ? 'overdue_part_paid' : 'overdue';
  return paid > 0.005 ? 'part_paid' : 'unpaid';
}

/** Today in Singapore (YYYY-MM-DD). */
export const sgToday = (now = new Date()): string => new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
