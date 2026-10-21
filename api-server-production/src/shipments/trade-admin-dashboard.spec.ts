/**
 * Round T — the Admin dashboard numbers against a seeded order (pure facts → figures), and the API gate
 * (shipments:money on the route; the WhatsApp money tools call the same service).
 */
import 'reflect-metadata';
import { adminDashboard, AdminFacts, monthWindow } from './trade-admin-dashboard';
import { TradeDashboardController } from './trade-dashboard.controller';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** One seeded order: #19 SUS 6063 300 MT, delivered Oct 2026. */
const FACTS: AdminFacts = {
  today: '2026-10-22',
  cash: [
    { direction: 'OUT', paidAt: d('2026-08-05'), currency: 'USD', amount: 90000, kind: 'DEPOSIT' },
    { direction: 'OUT', paidAt: d('2026-09-20'), currency: 'USD', amount: 810000, kind: 'CI' },
    { direction: 'OUT', paidAt: d('2026-10-03'), currency: 'JPY', amount: 12500000, kind: 'IMPORT_TAX' },
    { direction: 'OUT', paidAt: d('2026-10-15'), currency: 'JPY', amount: 980000, kind: 'LOGISTICS' },
    { direction: 'IN', paidAt: d('2026-09-28'), currency: 'USD', amount: 500000, kind: 'RECEIPT' },
    { direction: 'IN', paidAt: d('2026-10-20'), currency: 'USD', amount: 300000, kind: 'RECEIPT' },
    { direction: 'IN', paidAt: d('2026-03-01'), currency: 'USD', amount: 999999, kind: 'RECEIPT' }, // outside the window
  ],
  invoices: [
    { id: 'i1', number: 'ADH-INV-2026-0019', customerName: 'SUS', orderLabel: '#19', issueDate: d('2026-09-15'), dueDate: d('2026-09-30'), total: 500000, paid: 500000, currency: 'USD', imported: false },
    { id: 'i2', number: 'ADH-INV-2026-0020', customerName: 'SUS', orderLabel: '#19', issueDate: d('2026-10-18'), dueDate: d('2026-11-17'), total: 430000, paid: 300000, currency: 'USD', imported: false },
    { id: 'i3', number: 'OLD-0001', customerName: 'Kato', orderLabel: '#14', issueDate: d('2026-07-01'), dueDate: d('2026-07-31'), total: 123456, paid: 0, currency: 'USD', imported: true },
  ],
  supplierDue: [
    { kind: 'DEPOSIT', label: '#19 PI 9331004128 deposit', amount: 90000, currency: 'USD', dueDate: d('2026-08-05'), paid: true },
    { kind: 'DEPOSIT', label: '#23 PI 9331004200 deposit', amount: 40000, currency: 'USD', dueDate: d('2026-10-20'), paid: false },
    { kind: 'CI', label: '#23-1 CI balance', amount: 360000, currency: 'USD', dueDate: d('2026-11-28'), paid: false },
  ],
  orders: [
    { id: 'o19', label: '#19', customerName: 'SUS', product: '6063 Aluminium Billet 203 MM', qtyMt: 300, status: 'OPEN', deliveryMonth: '2026-10', sellUsd: 930000, buyUsd: 900000, costsJpy: 13480000, costsUsd: null, margin: 7500, profit: null, profitStatus: 'FORMULA_PENDING' },
    { id: 'o14', label: '#14', customerName: 'Kato', product: '6005 Aluminium Billet', qtyMt: 40, status: 'COMPLETED', deliveryMonth: '2026-06', sellUsd: 123456, buyUsd: 120000, costsJpy: 1800000, costsUsd: null, margin: 1120, profit: 2000, profitStatus: 'MANUAL' },
  ],
  tonnage: [
    { month: '2026-10', netMt: 300.4 },
    { month: '2026-06', netMt: 40.1 },
  ],
};

describe('Admin dashboard — the figures', () => {
  const out = adminDashboard(FACTS);

  it('shows the last 6 months + this one, oldest first', () => {
    expect(monthWindow('2026-10-22')).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(out.months.map((m) => m.month)).toEqual(monthWindow('2026-10-22'));
  });

  it('money in / out by month, USD and JPY apart, with the out breakdown and the net', () => {
    const oct = out.months.find((m) => m.month === '2026-10')!;
    expect(oct.in).toEqual({ USD: 300000, JPY: 0 });
    expect(oct.out).toEqual({ USD: 0, JPY: 13480000 });
    expect(oct.outBy.IMPORT_TAX.JPY).toBe(12500000);
    expect(oct.outBy.LOGISTICS.JPY).toBe(980000);
    expect(oct.net).toEqual({ USD: 300000, JPY: -13480000 });
    const sep = out.months.find((m) => m.month === '2026-09')!;
    expect(sep.out.USD).toBe(810000);
    expect(sep.outBy.CI.USD).toBe(810000);
    expect(sep.net.USD).toBe(500000 - 810000);
    expect(out.months.some((m) => m.in.USD === 999999)).toBe(false);
  });

  it('expected vs received: outstanding invoices with due dates; imported history is "not tracked", not outstanding', () => {
    expect(out.expected.outstandingInvoices).toEqual([expect.objectContaining({ number: 'ADH-INV-2026-0020', amount: 130000, dueDate: '2026-11-17', overdue: false })]);
    expect(out.expected.outstandingTotal.USD).toBe(130000);
    expect(out.expected.notTrackedInvoices.map((i) => i.number)).toEqual(['OLD-0001']);
  });

  it('due to Vedanta: unpaid deposits and CI balances with due dates, overdue flagged', () => {
    expect(out.expected.supplierDue).toEqual([
      expect.objectContaining({ kind: 'DEPOSIT', amount: 40000, dueDate: '2026-10-20', overdue: true }),
      expect.objectContaining({ kind: 'CI', amount: 360000, dueDate: '2026-11-28', overdue: false }),
    ]);
    expect(out.expected.supplierDueTotal.USD).toBe(400000);
  });

  it('per order: sell / buy / costs / margin / profit, "formula pending" kept', () => {
    const o19 = out.orders.find((o) => o.label === '#19')!;
    expect(o19).toMatchObject({ sellUsd: 930000, buyUsd: 900000, costsJpy: 13480000, margin: 7500, profit: null, profitLabel: 'formula pending' });
    expect(out.orders.find((o) => o.label === '#14')).toMatchObject({ profit: 2000, profitLabel: null });
    expect(out.orders[0].label).toBe('#19'); // newest delivery month first
  });

  it('last 3 months summary: invoiced, received, costs per currency, margin, profit pending, tonnage, order count', () => {
    expect(out.summary.months).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(out.summary.revenueInvoiced.USD).toBe(930000);
    expect(out.summary.received).toEqual({ USD: 800000, JPY: 0 });
    expect(out.summary.costs).toEqual({ USD: 900000, JPY: 13480000 });
    expect(out.summary.margin.USD).toBe(7500);
    expect(out.summary.profit).toEqual({ USD: 0, pending: true, label: 'formula pending' });
    expect(out.summary.tonnageMt).toBe(300.4);
    expect(out.summary.orders).toBe(1);
  });
});

describe('Admin dashboard — the API gate', () => {
  it('GET /trade-dashboard/admin requires shipments:money (ADH Manager / Admin), like /money', () => {
    const perms = (name: string) => Reflect.getMetadata('permissions', (TradeDashboardController.prototype as any)[name]);
    expect(perms('admin')).toEqual(['shipments:money']);
    expect(perms('money')).toEqual(['shipments:money']);
    expect(perms('pipeline')).toEqual(['shipments:read']);
  });
});
