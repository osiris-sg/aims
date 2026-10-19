/**
 * Round F (2026-10): banks — any entity's account on an invoice, default per
 * customer; premiums — stored as the fixed part, QMJP added by quarter.
 */
import { fixedPremiumFromPi, priceCheck } from './trade-contract';
import { banksOf, defaultBank, DocDefaults, invoiceTotals, InvoiceLine, unitPriceOf } from './trade-invoice';
import { mergeProfiles } from './trade-profile';
import { entityProblem } from './trade-entity';

const fail = (m: string): never => {
  throw new Error(m);
};
const QMJP = { '2026-2Q': 351.5, '2026-3Q': 395 };
const LME = { '2026-06': 3458.64, '2026-07': 3155.98 };

describe('banks: every account, default per customer', () => {
  const d: DocDefaults = {
    banks: [
      { id: 'dbs', label: 'DBS Bank Ltd', block: 'DBS', entity: 'ADH_SG' },
      { id: 'cfsb', label: 'Community Federal Savings Bank', block: 'CFSB', entity: 'ADH_SG' },
    ],
    defaultBankId: 'dbs',
  } as DocDefaults;
  it('Kato → CFSB, SUS → DBS, unknown / unset → the org default', () => {
    expect(defaultBank(d, 'cfsb')?.id).toBe('cfsb');
    expect(defaultBank(d, 'dbs')?.id).toBe('dbs');
    expect(defaultBank(d, 'gone')?.id).toBe('dbs');
    expect(defaultBank(d)?.id).toBe('dbs');
    expect(banksOf(d)).toHaveLength(2);
  });
  it('the profile keeps its default bank and the "check" flag (Hoei)', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const out = mergeProfiles({}, { [id]: { billingMode: 'SINGLE', truckCapacityT: 10, defaultBankId: 'dbs', defaultBankCheck: true } }, fail);
    expect(out[id]).toMatchObject({ defaultBankId: 'dbs', defaultBankCheck: true });
    expect(mergeProfiles({}, { [id]: { billingMode: 'SINGLE', truckCapacityT: 10, defaultBankId: '' } }, fail)[id].defaultBankId).toBeUndefined();
  });
  it('the ADH SG block on customer invoices stays', () => {
    expect(entityProblem('INVOICE_SINGLE', 'ADH_SG')).toMatch('not by Asia Deal Hub Pte. Ltd.');
    expect(entityProblem('INVOICE_1', 'ADH_JP')).toBeNull();
  });
});

describe('premiums = fixed part + QMJP by quarter', () => {
  it('a PI prints QMJP + fixed on the month before shipment: 556.50 → 205, 513.50 → 162', () => {
    expect(fixedPremiumFromPi(556.5, '2026-07', QMJP)).toBe(205);
    expect(fixedPremiumFromPi(513.5, '2026-07', QMJP)).toBe(162);
    // Shipment in October → priced on September → 3Q.
    expect(fixedPremiumFromPi(600, '2026-10', QMJP)).toBe(205);
    expect(fixedPremiumFromPi(556.5, '2027-01', QMJP)).toBeNull(); // 2026-4Q not stored
    expect(fixedPremiumFromPi(5, '2026-08', QMJP)).toBeNull(); // already a fixed premium (Hoei +5)
    expect(fixedPremiumFromPi(null, '2026-07', QMJP)).toBeNull();
  });
  it('454003422 price check — client: LME Jul + QMJP 3Q + 230 = 3,780.98; supplier PI: 351.5 + 205 = 556.50 ✓', () => {
    const schedule = [{ from: '2026-06', to: null, supplierPremium: 205, clientPremium: 230, upcharge: null }];
    const prices = { lmeByMonth: LME, qmjpByQuarter: QMJP };
    const client = priceCheck({ side: 'client', basisMonth: '2026-07', schedule, prices, found: { lme: 3155.98, qmjp: 395, premium: 230, unit: 3780.98 } });
    expect(client.ok).toBe(true);
    const supplier = priceCheck({ side: 'supplier', mjpBased: true, basisMonth: '2026-06', schedule, prices, found: { premium: 556.5 } });
    expect(supplier.lines.find((l) => l.key === 'premium')).toMatchObject({ expected: 556.5, mark: 'ok' });
  });
  it('454003255 (6005): PI 513.50 = 351.5 + 162 ✓; client 190 + 10 upcharge (= 200) + QMJP + LME = 3,750.98 ✓', () => {
    const schedule = [{ from: '2026-06', to: null, supplierPremium: 162, clientPremium: 190, upcharge: 10 }];
    const prices = { lmeByMonth: LME, qmjpByQuarter: QMJP };
    expect(priceCheck({ side: 'supplier', mjpBased: true, basisMonth: '2026-06', schedule, prices, found: { premium: 513.5 } }).ok).toBe(true);
    expect(priceCheck({ side: 'client', basisMonth: '2026-07', schedule, prices, found: { premium: 190, unit: 3750.98 } }).ok).toBe(true);
  });
  it('totals unchanged: the migrated fixed premiums give Invoice #1 1,862,584.68 (6005 551.50 → 190 + 10, 6063 581.50 → 230)', () => {
    // The 10g mapping: 551.50 → 200 total client fixed, kept as 190 + the row's own 10 upcharge.
    const clientFixed = (v: number, upcharge: number) => ({ 581.5: 230, 551.5: 200 - upcharge })[v as 581.5 | 551.5];
    const line = (o: Partial<InvoiceLine>): InvoiceLine => ({ description: '', quantity: null, unit: 'トン', unitPrice: null, amountOverride: null, remarks: '', dueDate: null, ...o });
    const l6005 = line({ grade: '6005', quantity: 120, lme: 3458.64, qmjp: 351.5, premium: clientFixed(551.5, 10), upcharge: 10 });
    const l6063 = line({ grade: '6063', quantity: 300, lme: 3458.64, qmjp: 351.5, premium: clientFixed(581.5, 0) });
    expect(unitPriceOf(l6005)).toBe(4010.14);
    expect(invoiceTotals([l6005, l6063], 10, 161.67)).toMatchObject({ subtotal: 1693258.8, tax: 169325.88, total: 1862584.68 });
  });
});
