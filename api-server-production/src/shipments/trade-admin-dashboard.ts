/**
 * Round T (2026-10-22) — the ADH Admin dashboard, pure: money in / out by month (last 6 + this one),
 * expected vs received, the per-order table and the last-3-months summary. Currencies are kept apart
 * (USD: deposits, CIs, invoices; JPY: import tax, transport & storage) — no FX mixing until the FX
 * table exists. Imported history without payment data is "not tracked", never "outstanding".
 * Round W: profit is a plain number everywhere — $0 until the profit formula exists (no "formula pending"
 * label, no "until ADH…" text); `profit.pending` stays a boolean for callers that care.
 */
import { addMonths } from './orders.service';

export type Cur = 'USD' | 'JPY';
export type OutKind = 'DEPOSIT' | 'CI' | 'IMPORT_TAX' | 'LOGISTICS' | 'OTHER';
export const OUT_KIND_LABEL: Record<OutKind, string> = { DEPOSIT: 'Vedanta deposit', CI: 'CI balance', IMPORT_TAX: 'Import tax', LOGISTICS: 'Courier / trucking / storage / DET / DEM', OTHER: 'Other costs (step 12)' };

export interface CashFact {
  direction: 'IN' | 'OUT';
  paidAt: Date;
  currency: string;
  amount: number;
  kind: OutKind | 'RECEIPT';
}
export interface InvoiceFact {
  id: string;
  number: string;
  customerName: string | null;
  orderLabel: string | null;
  issueDate: Date | null;
  dueDate: Date | null;
  total: number;
  paid: number;
  currency: string;
  /** Imported history: the receipt was never going to be recorded in AIMS. */
  imported: boolean;
}
export interface SupplierDueFact {
  kind: 'DEPOSIT' | 'CI';
  label: string;
  amount: number | null;
  currency: string;
  dueDate: Date | null;
  paid: boolean;
}
export interface OrderFact {
  id: string;
  label: string;
  customerName: string | null;
  product: string | null;
  qtyMt: number | null;
  status: string;
  deliveryMonth: string | null;
  sellUsd: number | null;
  buyUsd: number | null;
  costsJpy: number | null;
  costsUsd: number | null;
  margin: number | null;
  profit: number | null;
  profitStatus: 'MANUAL' | 'FORMULA_PENDING';
}
export interface TonnageFact {
  month: string;
  netMt: number;
}
export interface AdminFacts {
  today: string; // YYYY-MM-DD
  cash: CashFact[];
  invoices: InvoiceFact[];
  supplierDue: SupplierDueFact[];
  orders: OrderFact[];
  tonnage: TonnageFact[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const curOf = (c: string): Cur => (c === 'JPY' ? 'JPY' : 'USD');
const zero = (): Record<Cur, number> => ({ USD: 0, JPY: 0 });

export interface MonthRow {
  month: string;
  in: Record<Cur, number>;
  out: Record<Cur, number>;
  outBy: Record<OutKind, Record<Cur, number>>;
  net: Record<Cur, number>;
}

/** The 7 months shown: the last 6 and this one, oldest first. */
export function monthWindow(today: string, back = 6): string[] {
  const cur = today.slice(0, 7);
  return Array.from({ length: back + 1 }, (_, i) => addMonths(cur, i - back));
}

export function adminDashboard(f: AdminFacts) {
  const months = monthWindow(f.today);
  const rows = new Map<string, MonthRow>(months.map((m) => [m, { month: m, in: zero(), out: zero(), outBy: { DEPOSIT: zero(), CI: zero(), IMPORT_TAX: zero(), LOGISTICS: zero(), OTHER: zero() }, net: zero() }]));
  for (const c of f.cash) {
    const m = c.paidAt.toISOString().slice(0, 7);
    const row = rows.get(m);
    if (!row) continue;
    const cur = curOf(c.currency);
    if (c.direction === 'IN') row.in[cur] = r2(row.in[cur] + c.amount);
    else {
      row.out[cur] = r2(row.out[cur] + c.amount);
      const k = (c.kind === 'RECEIPT' ? 'OTHER' : c.kind) as OutKind;
      row.outBy[k][cur] = r2(row.outBy[k][cur] + c.amount);
    }
  }
  for (const row of rows.values()) for (const cur of ['USD', 'JPY'] as Cur[]) row.net[cur] = r2(row.in[cur] - row.out[cur]);

  const outstanding = f.invoices
    .filter((i) => !i.imported && r2(i.total - i.paid) > 0.004)
    .map((i) => ({ id: i.id, number: i.number, customerName: i.customerName, orderLabel: i.orderLabel, amount: r2(i.total - i.paid), total: r2(i.total), currency: i.currency, issueDate: ymd(i.issueDate), dueDate: ymd(i.dueDate), overdue: !!i.dueDate && ymd(i.dueDate)! < f.today }))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const notTracked = f.invoices.filter((i) => i.imported).map((i) => ({ id: i.id, number: i.number, customerName: i.customerName, orderLabel: i.orderLabel, total: r2(i.total), currency: i.currency, issueDate: ymd(i.issueDate) }));
  const supplierDue = f.supplierDue
    .filter((d) => !d.paid)
    .map((d) => ({ kind: d.kind, label: d.label, amount: d.amount === null ? null : r2(d.amount), currency: d.currency, dueDate: ymd(d.dueDate), overdue: !!d.dueDate && ymd(d.dueDate)! < f.today }))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const sum = <T>(xs: T[], pick: (x: T) => number | null | undefined) => r2(xs.reduce((a, x) => a + (pick(x) ?? 0), 0));

  // Last 3 months (this one and the two before), by the month a thing happened.
  const last3 = monthWindow(f.today, 2);
  const inLast3 = (d: Date | null | undefined) => !!d && last3.includes(new Date(d).toISOString().slice(0, 7));
  const cash3 = f.cash.filter((c) => inLast3(c.paidAt));
  const orders3 = f.orders.filter((o) => o.deliveryMonth && last3.includes(o.deliveryMonth) && o.status !== 'CANCELLED');
  const pendingProfit = orders3.some((o) => o.profitStatus !== 'MANUAL');
  const summary = {
    months: last3,
    revenueInvoiced: { USD: sum(f.invoices.filter((i) => inLast3(i.issueDate) && i.total > 0), (i) => i.total) },
    received: { USD: sum(cash3.filter((c) => c.direction === 'IN' && curOf(c.currency) === 'USD'), (c) => c.amount), JPY: sum(cash3.filter((c) => c.direction === 'IN' && curOf(c.currency) === 'JPY'), (c) => c.amount) },
    costs: { USD: sum(cash3.filter((c) => c.direction === 'OUT' && curOf(c.currency) === 'USD'), (c) => c.amount), JPY: sum(cash3.filter((c) => c.direction === 'OUT' && curOf(c.currency) === 'JPY'), (c) => c.amount) },
    margin: { USD: sum(orders3, (o) => o.margin) },
    profit: { USD: sum(orders3.filter((o) => o.profitStatus === 'MANUAL'), (o) => o.profit), pending: pendingProfit },
    tonnageMt: r2(f.tonnage.filter((t) => last3.includes(t.month)).reduce((a, t) => a + t.netMt, 0)),
    orders: orders3.length,
  };
  const orders = [...f.orders]
    .sort((a, b) => (b.deliveryMonth ?? '').localeCompare(a.deliveryMonth ?? '') || b.label.localeCompare(a.label, undefined, { numeric: true }))
    .map((o) => ({ ...o, sellUsd: o.sellUsd === null ? null : r2(o.sellUsd), buyUsd: o.buyUsd === null ? null : r2(o.buyUsd), costsJpy: o.costsJpy === null ? null : r2(o.costsJpy), costsUsd: o.costsUsd === null ? null : r2(o.costsUsd), margin: o.margin === null ? null : r2(o.margin), profit: o.profitStatus === 'MANUAL' && o.profit !== null ? r2(o.profit) : 0 }));
  return {
    today: f.today,
    months: [...rows.values()],
    outKinds: OUT_KIND_LABEL,
    expected: { outstandingInvoices: outstanding, outstandingTotal: { USD: sum(outstanding.filter((o) => curOf(o.currency) === 'USD'), (o) => o.amount) }, notTrackedInvoices: notTracked, supplierDue, supplierDueTotal: { USD: sum(supplierDue.filter((d) => curOf(d.currency) === 'USD'), (d) => d.amount) } },
    orders,
    summary,
    note: 'USD and JPY are shown separately (no FX conversion). Imported invoices without payment data are "not tracked".',
  };
}

export type AdminDashboard = ReturnType<typeof adminDashboard>;
