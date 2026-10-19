/**
 * Cash in / cash out (2026-10) — pure rules. One bank movement can pay
 * several things: on Jul 24 a single Wise transfer of USD 1,247,670.64 paid
 * two CIs (944,256.79 + 146,868.33) and two PIs (44,358.72 + 112,186.80).
 * A payment is split into allocations; they should add up to the amount, and
 * anything left is shown as unallocated (never more than the amount).
 */

export type PaymentDirection = 'IN' | 'OUT';
export type PaymentAccount = 'DBS' | 'WISE' | 'CFSB' | 'SMBC_JPY' | 'OTHER';
export type AllocationTarget = 'PI' | 'CI' | 'INVOICE' | 'VENDOR_INVOICE' | 'IMPORT_TAX';

export const ACCOUNTS: PaymentAccount[] = ['DBS', 'WISE', 'CFSB', 'SMBC_JPY', 'OTHER'];
export const TARGETS: AllocationTarget[] = ['PI', 'CI', 'INVOICE', 'VENDOR_INVOICE', 'IMPORT_TAX'];
/** Which side a target is on: customers pay ADH's invoices; ADH pays the rest. */
export const TARGET_DIRECTION: Record<AllocationTarget, PaymentDirection> = { PI: 'OUT', CI: 'OUT', INVOICE: 'IN', VENDOR_INVOICE: 'OUT', IMPORT_TAX: 'OUT' };
/** The ADH company that owns each account: DBS / Wise / CFSB = ADH SG, SMBC JPY = ADH JP. */
export const ACCOUNT_ENTITY: Record<PaymentAccount, 'ADH_SG' | 'ADH_JP' | null> = { DBS: 'ADH_SG', WISE: 'ADH_SG', CFSB: 'ADH_SG', SMBC_JPY: 'ADH_JP', OTHER: null };
/** The step a payment of each kind belongs to (its proof file is filed there). */
export const TARGET_STEP: Record<AllocationTarget, { code: string; proofDocType: string }> = {
  PI: { code: 'PI_PAYMENT', proofDocType: 'DEPOSIT_PROOF' },
  CI: { code: 'CI_PAYMENT', proofDocType: 'CI_PAYMENT_PROOF' },
  IMPORT_TAX: { code: 'TAX_FUNDS', proofDocType: 'PAYMENT_PROOF' },
  VENDOR_INVOICE: { code: 'LOGISTICS_PAYMENT', proofDocType: 'PAYMENT_PROOF' },
  INVOICE: { code: 'XERO_HANDOFF', proofDocType: 'PAYMENT_PROOF' },
};

const cents = (v: number) => Math.round(v * 100);
const fromCents = (c: number) => c / 100;

export interface AllocationInput {
  targetType: string;
  targetId?: string | null;
  amount: number;
  targetLabel?: string | null;
}

export interface CleanPayment {
  direction: PaymentDirection;
  paidAt: Date;
  amount: number;
  currency: string;
  account: PaymentAccount;
  allocations: Array<{ targetType: AllocationTarget; targetId: string | null; amount: number; targetLabel: string | null }>;
}

/** Validate a payment and its allocations; throws via `fail` with a message naming the field. */
export function cleanPayment(
  raw: { direction?: unknown; paidAt?: unknown; amount?: unknown; currency?: unknown; account?: unknown; allocations?: unknown },
  fail: (msg: string) => never,
): CleanPayment {
  const direction = raw.direction === 'IN' || raw.direction === 'OUT' ? raw.direction : fail('direction must be IN or OUT');
  const paidAt = typeof raw.paidAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.paidAt) ? new Date(raw.paidAt) : fail('paidAt must be a date (YYYY-MM-DD)');
  if (isNaN(paidAt.getTime())) fail('paidAt must be a date (YYYY-MM-DD)');
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) fail('amount must be a positive number');
  const currency = typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : fail('currency must be a 3-letter code');
  const account = ACCOUNTS.includes(raw.account as PaymentAccount) ? (raw.account as PaymentAccount) : fail(`account must be one of ${ACCOUNTS.join(', ')}`);
  const list = raw.allocations === undefined || raw.allocations === null ? [] : Array.isArray(raw.allocations) ? raw.allocations : fail('allocations must be a list');
  if (list.length > 50) fail('at most 50 allocations per payment');
  const allocations = list.map((a: Record<string, unknown>, i: number) => {
    const t = TARGETS.includes(a?.targetType as AllocationTarget) ? (a.targetType as AllocationTarget) : fail(`allocation ${i + 1}: targetType must be one of ${TARGETS.join(', ')}`);
    if (TARGET_DIRECTION[t] !== direction) fail(`allocation ${i + 1}: a ${t} is paid ${TARGET_DIRECTION[t] === 'IN' ? 'by the customer (cash in)' : 'by ADH (cash out)'}`);
    const amt = Number(a.amount);
    if (!Number.isFinite(amt) || amt <= 0) fail(`allocation ${i + 1}: amount must be a positive number`);
    const targetId = a.targetId === null || a.targetId === undefined || a.targetId === '' ? null : String(a.targetId);
    if (targetId !== null && !/^[0-9a-f-]{36}$/i.test(targetId)) fail(`allocation ${i + 1}: targetId must be an id`);
    return { targetType: t, targetId, amount: fromCents(cents(amt)), targetLabel: typeof a.targetLabel === 'string' ? a.targetLabel.slice(0, 200) : null };
  });
  const state = allocationState(amount, allocations);
  if (state.over) fail(`The allocations (${state.allocated.toFixed(2)}) are more than the payment (${amount.toFixed(2)})`);
  return { direction, paidAt, amount: fromCents(cents(amount)), currency, account, allocations };
}

/** Allocated / unallocated (in cents, so 1,247,670.64 splits exactly). */
export function allocationState(amount: number, allocations: Array<{ amount: number | string | { toString(): string } }>): { allocated: number; unallocated: number; over: boolean; complete: boolean } {
  const total = cents(Number(amount));
  const used = allocations.reduce((s, a) => s + cents(Number(a.amount)), 0);
  return { allocated: fromCents(used), unallocated: fromCents(total - used), over: used > total, complete: used === total };
}

export interface InvoiceCash {
  total: number;
  paid: number;
  outstanding: number;
  dueDate: string | null;
  overdue: boolean;
  /** Days past due (0 when not overdue). */
  daysOverdue: number;
}

/** One invoice's cash: paid so far, outstanding, overdue (due date before today and something still open). */
export function invoiceCash(total: number, paid: number, dueDate: string | null, today: string): InvoiceCash {
  const outstanding = fromCents(cents(total) - cents(paid));
  const overdue = !!dueDate && outstanding > 0.004 && dueDate < today;
  const daysOverdue = overdue ? Math.round((Date.parse(today) - Date.parse(dueDate!)) / 86_400_000) : 0;
  return { total, paid: fromCents(cents(paid)), outstanding, dueDate, overdue, daysOverdue };
}

/** Sum of allocations per target id (USD). */
export function paidByTarget(rows: Array<{ targetType: string; targetId: string | null; amount: unknown }>, type: AllocationTarget): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.targetType !== type || !r.targetId) continue;
    m.set(r.targetId, fromCents((cents(m.get(r.targetId) ?? 0)) + cents(Number(r.amount))));
  }
  return m;
}
