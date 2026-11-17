/**
 * Sales report (WCT group, 2026-11-18; features.enableSalesReport): one
 * salesperson's quotations (or everyone's) for a date range, with totals by
 * category split Signed vs Pending. Pure helpers, tested by sales-report.spec.ts.
 *
 * STATUS (first match wins):
 *   Cancelled  config.cancelled / config.voided, the order made from it was
 *              cancelled, or an imported quotation the ERP marked Declined /
 *              Cancelled / Rejected / Lost / Void.
 *   Signed     the customer e-signed it (config.clientSignature), an order was
 *              made from it, it was confirmed in AIMS (status past draft /
 *              unconfirmed), or an imported one the ERP marked Accepted /
 *              Signed / Confirmed / Approved / Won.
 *   Pending    sent and not signed: a sign link was made for it, it was
 *              emailed (document history "SENT"), or an imported one with any
 *              other ERP status (e.g. Sent).
 *   Draft      everything else (never sent).
 *
 * SALESPERSON = the quotation's Sales Person field (config.salesPerson, or
 * documentInfo.salesPerson): a salesman code (S004) or the user's id from the
 * editor's picker; imported Q-0xxxxx quotations carry the old ERP's free text
 * ("Henry", "Henry & Joyna"). Free text belongs to a user when one of its
 * names (split on & / , and +) is the user's full name or first name.
 *
 * ACCESS: Admin / Accounting (or superadmin / osirisadmin) see everyone; a
 * user with Sales and none of those sees only their own; anyone else is
 * refused. Multi-role users: any admin-type role wins.
 */

export type SalesStatus = 'Draft' | 'Pending' | 'Signed' | 'Cancelled';
export const SALES_STATUSES: SalesStatus[] = ['Signed', 'Pending', 'Draft', 'Cancelled'];

const ERP_CANCELLED = new Set(['declined', 'cancelled', 'canceled', 'rejected', 'lost', 'void', 'voided']);
const ERP_SIGNED = new Set(['accepted', 'signed', 'confirmed', 'approved', 'won']);

export interface StatusInput {
  status: string | null | undefined; // Document.status
  cancelled?: boolean; // config.cancelled / config.voided
  signed?: boolean; // config.clientSignature present
  erpStatus?: string | null; // config.erpImport.status (imported only)
  imported?: boolean;
  orderStatus?: string | null; // Order made from this quotation (latest)
  hasSignLink?: boolean;
  emailed?: boolean;
}

export function quotationStatus(q: StatusInput): SalesStatus {
  const erp = String(q.erpStatus ?? '').trim().toLowerCase();
  const order = String(q.orderStatus ?? '').trim().toUpperCase();
  if (q.cancelled || order === 'CANCELLED' || (q.imported && ERP_CANCELLED.has(erp))) return 'Cancelled';
  if (q.imported) {
    if (ERP_SIGNED.has(erp)) return 'Signed';
    if (erp) return 'Pending';
  }
  if (q.signed || order) return 'Signed';
  // An imported quotation without an ERP status falls through to the document status like a native one.
  const st = String(q.status ?? '').toLowerCase();
  if (!q.imported && st && st !== 'draft' && st !== 'unconfirmed') return 'Signed';
  if (q.hasSignLink || q.emailed) return 'Pending';
  if (q.imported && st && st !== 'draft' && st !== 'unconfirmed') return 'Pending';
  return 'Draft';
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The quotation's amount before GST: nett - GST, else sub-total - discount, else the lines - discount. */
export function amountExclGst(c: { nettTotal?: unknown; gstAmount?: unknown; subTotal?: unknown; discountAmount?: unknown; itemsTotal?: unknown }): number {
  const nett = num(c.nettTotal);
  const gst = num(c.gstAmount);
  if (nett !== null && gst !== null) return r2(nett - gst);
  const disc = num(c.discountAmount) ?? 0;
  const sub = num(c.subTotal);
  if (sub !== null) return r2(sub - disc);
  return r2((num(c.itemsTotal) ?? 0) - disc);
}

// ── salespeople ───────────────────────────────────────────────────────────

export interface Salesman {
  userId: string;
  code: string; // '' when none
  name: string;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** "Henry & Joyna", "Henry / Avery", "Isadora (Follow Up)" -> ["henry", "joyna"], ["henry", "avery"], ["isadora"]. */
export function nameTokens(text: string): string[] {
  return String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*(?:&|\/|,|\+|\band\b)\s*/i)
    .map(norm)
    .filter(Boolean);
}

/** Does this free-text salesperson name the user (one of its names is the user's full name or first name)? */
export function textNamesUser(text: string, user: Pick<Salesman, 'name'>): boolean {
  const full = norm(user.name || '');
  if (!full || full === 'unknown') return false;
  const firstName = full.split(' ')[0];
  return nameTokens(text).some((t) => t === full || t === firstName || (t.split(' ')[0] === firstName && full.startsWith(t)));
}

export interface SalespersonRef {
  key: string; // 'u:<userId>' | 't:<text>' | ''
  label: string;
}

/**
 * Who a quotation belongs to. A code or user id resolves to that user; free
 * text resolves to every user it names (keys), else stays its own entry.
 */
export function salespeopleOf(raw: unknown, salesmen: Salesman[]): SalespersonRef[] {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return [{ key: '', label: 'No salesperson' }];
  const byCode = salesmen.find((m) => (m.code && m.code.toLowerCase() === s.toLowerCase()) || m.userId === s);
  if (byCode) return [{ key: `u:${byCode.userId}`, label: byCode.name }];
  const named = salesmen.filter((m) => textNamesUser(s, m));
  if (named.length) return named.map((m) => ({ key: `u:${m.userId}`, label: m.name }));
  return [{ key: `t:${norm(s)}`, label: s.replace(/\s+/g, ' ') }];
}

// ── access ────────────────────────────────────────────────────────────────

export type ReportScope = 'all' | 'own' | 'none';
const ALL_ROLES = new Set(['admin', 'superadmin', 'osirisadmin', 'accounting']);

/** All for Admin / Accounting (any of the user's roles); own for Sales only; none otherwise. */
export function reportScope(roleNames: string[], isOsirisAdmin = false): ReportScope {
  if (isOsirisAdmin) return 'all';
  const names = roleNames.map((r) => norm(String(r || '')));
  if (names.some((n) => ALL_ROLES.has(n))) return 'all';
  if (names.includes('sales')) return 'own';
  return 'none';
}

// ── summary ───────────────────────────────────────────────────────────────

export interface ReportRow {
  id: string;
  number: string;
  date: string;
  customer: string;
  subject: string;
  category: string;
  amount: number;
  status: SalesStatus;
}

export interface CategoryTotal {
  category: string;
  signedCount: number;
  signedAmount: number;
  pendingCount: number;
  pendingAmount: number;
}

/** Totals by category, Signed vs Pending (Draft and Cancelled are listed, not totalled); categories A-Z, Uncategorised last. */
export function summarise(rows: ReportRow[], uncategorised = 'Uncategorised'): { byCategory: CategoryTotal[]; total: CategoryTotal } {
  const map = new Map<string, CategoryTotal>();
  for (const r of rows) {
    if (r.status !== 'Signed' && r.status !== 'Pending') continue;
    const t = map.get(r.category) ?? { category: r.category, signedCount: 0, signedAmount: 0, pendingCount: 0, pendingAmount: 0 };
    if (r.status === 'Signed') {
      t.signedCount += 1;
      t.signedAmount = r2(t.signedAmount + r.amount);
    } else {
      t.pendingCount += 1;
      t.pendingAmount = r2(t.pendingAmount + r.amount);
    }
    map.set(r.category, t);
  }
  const byCategory = [...map.values()].sort((a, b) =>
    a.category === uncategorised ? 1 : b.category === uncategorised ? -1 : a.category.localeCompare(b.category),
  );
  const total = byCategory.reduce(
    (s, t) => ({
      category: 'Total',
      signedCount: s.signedCount + t.signedCount,
      signedAmount: r2(s.signedAmount + t.signedAmount),
      pendingCount: s.pendingCount + t.pendingCount,
      pendingAmount: r2(s.pendingAmount + t.pendingAmount),
    }),
    { category: 'Total', signedCount: 0, signedAmount: 0, pendingCount: 0, pendingAmount: 0 },
  );
  return { byCategory, total };
}

/** yyyy-mm-dd or null. */
export function isoDateOrNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
