import { lotPreview, patternFor, toSgd, LotInput } from './lot-accounting';

// Round BW — the FRS example lot #15-1 (SUS 6063, 305.949 t). AIMS data as on prod (CI read, permit CIF, import tax)
// plus the FRS's own figures for the rules ADH hasn't answered yet.
const base: LotInput = {
  orderRef: '#15',
  customerName: 'SUS Co., Ltd.',
  pattern: 'SUS',
  deliveryMonth: '2026-10',
  usdRate: 0.780622,
  shipments: [
    {
      ref: '#15-1',
      netMt: 305.949,
      ci: { ciNumber: 'XP2652101843', subTotal: 1177790.45, advance: 112186.8, total: 1065603.65 },
      sgjpTotal: 1185439.17,
      importTaxJpy: 18423000,
      customsRate: 155.39,
    },
  ],
  aimsDeposit: null,
  directInvoiceTotal: null,
  invoice1: { principal: 1134294.0, tax: 113429.4, number: 'INV-0586', source: 'aims' },
  done: { piPayment: true, ciPayment: true, invoice1: true, taxFunds: true },
};
const frsRules = { gstActualUsd: 121430.25, logisticsUsd: 16830.08, deliveryCompleted: true };

const usd = (p: ReturnType<typeof lotPreview>, key: string) => p.postings.find((x) => x.key === key)!.lines.map((l) => [l.account, l.side, l.usd]);
const check = (p: ReturnType<typeof lotPreview>, key: string) => p.checks.find((c) => c.key === key)!;

describe('lot accounting preview — FRS #15-1', () => {
  const p = lotPreview({ ...base, rules: frsRules });

  it('reproduces every FRS line amount', () => {
    expect(usd(p, 'PI_DEPOSIT_BILL')).toEqual([['620', 'Dr', 112186.8], ['800', 'Cr', 112186.8]]);
    expect(usd(p, 'CI_BALANCE_BILL')).toEqual([['620', 'Dr', 1065603.65], ['800', 'Cr', 1065603.65]]);
    expect(usd(p, 'COGS_RECLASS')).toEqual([['620', 'Cr', 112186.8], ['620', 'Cr', 1065603.65], ['310', 'Dr', 112186.8], ['310', 'Dr', 1065603.65]]);
    expect(usd(p, 'SUS_ADVANCE_INVOICE')).toEqual([['610', 'Dr', 1247723.4], ['810', 'Cr', 113429.4], ['810', 'Cr', 1134294.0]]);
    expect(usd(p, 'GST_ADVANCE_BILL')).toEqual([['810', 'Dr', 118559.75], ['800', 'Cr', 118559.75]]);
    expect(usd(p, 'SUS_REVENUE_RECOGNITION')).toEqual([['810', 'Dr', 1134294.0], ['200', 'Cr', 1134294.0]]);
    expect(usd(p, 'SETTLEMENT_A')).toEqual([['610', 'Dr', 77811.79], ['200', 'Cr', 51145.17], ['810', 'Cr', 16830.08], ['810', 'Cr', 8000.85], ['810', 'Cr', 1835.69]]);
    expect(usd(p, 'SETTLEMENT_B')).toEqual([['810', 'Dr', 16830.08], ['810', 'Dr', 2870.5], ['810', 'Dr', 1835.69], ['800', 'Cr', 21536.27]]);
    expect(usd(p, 'SETTLEMENT_C')).toEqual([['610', 'Dr', 10402.27], ['200', 'Cr', 10402.27]]);
  });

  it('every posting balances', () => {
    for (const x of p.postings) {
      const dr = x.lines.filter((l) => l.side === 'Dr').reduce((s, l) => s + (l.usd ?? 0), 0);
      const cr = x.lines.filter((l) => l.side === 'Cr').reduce((s, l) => s + (l.usd ?? 0), 0);
      expect(Math.abs(Math.round((dr - cr) * 100))).toBe(0);
    }
  });

  it('passes the three FRS invariants and the COGS rule', () => {
    expect(check(p, 'cogs').ok).toBe(true);
    expect(check(p, 'prepayments').ok).toBe(true);
    expect(check(p, 'advance').ok).toBe(true);
    expect(check(p, 'pnl').ok).toBe(true);
    expect(check(p, 'pnl').detail).toContain('18,050.99');
    expect(p.postings.every((x) => x.status === 'ready')).toBe(true);
  });

  it('converts at 1 SGD = 0.780622 USD (the 1 Oct 2026 rate in the FRS)', () => {
    expect(toSgd(1177790.45, 0.780622)).toBe(1508784.6);
    expect(check(p, 'prepayments').detail).toContain('SGD 0.00');
  });
});

describe('lot accounting preview — as AIMS has #15-1 today (no answered rules)', () => {
  const p = lotPreview({ ...base, usdRate: null, invoice1: null });

  it('computes the purchase side; Invoice #1 missing; the rest "rule needed"', () => {
    expect(usd(p, 'PI_DEPOSIT_BILL')[0][2]).toBe(112186.8);
    expect(usd(p, 'GST_ADVANCE_BILL')[0][2]).toBe(118559.75);
    expect(usd(p, 'SETTLEMENT_C')[1][2]).toBe(10402.27);
    expect(p.postings.find((x) => x.key === 'SUS_ADVANCE_INVOICE')!.status).toBe('missing data');
    expect(p.missing).toContain('#15: Invoice #1 not in AIMS');
    expect(p.invoice1).toBeNull();
    expect(p.postings.find((x) => x.key === 'COGS_RECLASS')!.status).toBe('rule needed');
    expect(p.postings.find((x) => x.key === 'CI_BALANCE_BILL')!.status).toBe('rate needed');
    expect(check(p, 'cogs').ok).toBe(true);
    expect(check(p, 'prepayments').ok).toBeNull();
    expect(check(p, 'prepayments').detail).toContain('USD 0.00');
    expect(check(p, 'advance').ok).toBeNull();
    expect(p.missing).toContain('FX rate for 2026-10 (1 SGD = ? USD)');
    // Answered 18 Nov: product sales (= SG→JP total) and the advance invoice (= Invoice #1) are no longer rules.
    expect(p.rulesNeeded).toHaveLength(3);
    expect(p.rulesNeeded.join(' ')).not.toMatch(/Product sales|Advance invoice/);
  });

  it('never invents Invoice #1: no amounts, no 10% guess', () => {
    expect(usd(p, 'SUS_ADVANCE_INVOICE').map((l) => l[2])).toEqual([null, null, null]);
    expect(usd(p, 'SUS_REVENUE_RECOGNITION').map((l) => l[2])).toEqual([null, null]);
    expect(p.postings.find((x) => x.key === 'SETTLEMENT_A')!.lines[1].problem).toBe('missing');
  });
  it('typed Invoice #1 amounts are used as typed (tax not recomputed)', () => {
    const q = lotPreview({ ...base, rules: frsRules, invoice1: { principal: 1000, tax: 99.99, number: null, source: 'typed', by: 'Take' } });
    expect(usd(q, 'SUS_ADVANCE_INVOICE')).toEqual([['610', 'Dr', 1099.99], ['810', 'Cr', 99.99], ['810', 'Cr', 1000]]);
    expect(q.postings.find((x) => x.key === 'SUS_ADVANCE_INVOICE')!.lines[0].note).toBe('Invoice #1 typed by Take');
    expect(q.invoice1?.source).toBe('typed');
  });
  it('product sales = the SG→JP invoice total; missing when a shipment has none', () => {
    const q = lotPreview({ ...base, rules: frsRules, shipments: [{ ...base.shipments[0], sgjpTotal: null }] });
    expect(q.missing).toContain('#15: SG→JP invoice total (permit CIF) of every shipment');
    expect(q.postings.find((x) => x.key === 'SETTLEMENT_A')!.status).toBe('missing data');
  });
});

describe('lot accounting preview — Kato and Hoei patterns', () => {
  it('Kato: no advance invoice / revenue journal; 810 nets to 0', () => {
    const p = lotPreview({ ...base, customerName: 'Kato', pattern: 'KATO', rules: frsRules });
    expect(p.postings.map((x) => x.key)).toEqual(['PI_DEPOSIT_BILL', 'CI_BALANCE_BILL', 'COGS_RECLASS', 'GST_ADVANCE_BILL', 'SETTLEMENT_A', 'SETTLEMENT_B', 'SETTLEMENT_C']);
    expect(usd(p, 'SETTLEMENT_A')[1]).toEqual(['200', 'Cr', 1185439.17]);
    expect(check(p, 'advance').ok).toBe(true);
    expect(check(p, 'pnl').ok).toBe(true);
  });
  it('Hoei: one sales invoice to HOEI, no 810, no profit share', () => {
    const p = lotPreview({ ...base, customerName: 'Houei', pattern: 'HOEI', directInvoiceTotal: 1200000 });
    expect(p.postings.map((x) => x.key)).toEqual(['PI_DEPOSIT_BILL', 'CI_BALANCE_BILL', 'COGS_RECLASS', 'HOEI_INVOICE']);
    expect(p.checks.map((c) => c.key)).toEqual(['cogs', 'prepayments', 'pnl']);
    expect(p.postings.some((x) => x.lines.some((l) => l.account === '810'))).toBe(false);
  });
  it('picks the pattern from the customer profile', () => {
    expect(patternFor({ billingMode: 'TWO_STAGE' })).toBe('SUS');
    expect(patternFor({ billingMode: 'SINGLE', country: 'JP' })).toBe('KATO');
    expect(patternFor({ billingMode: 'SINGLE', country: 'TH' })).toBe('HOEI');
    expect(patternFor({ billingMode: 'SINGLE' })).toBeNull();
  });
  it('a COGS mismatch (deposit + TOTAL ≠ Sub Total) fails the check', () => {
    const p = lotPreview({ ...base, shipments: [{ ...base.shipments[0], ci: { ciNumber: 'X', subTotal: 1177790.45, advance: 112186.8, total: 1177790.45 } }] });
    expect(check(p, 'cogs').ok).toBe(false);
  });
});
