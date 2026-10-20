/**
 * Fixes from the first live click-through on prod (2026-10, after round H): the pure parts.
 * The service paths (Invoice #2 from the order for 1 / 2 / a completed shipment) run in scripts/smoke-shipments.ts.
 */
import { autoCompletePlan, paymentRecorded, readyToAutoComplete } from './shipments.rules';
import { invoice1Line, lmeForMonth, unitPriceOf } from './trade-invoice';
import { priceCheck } from './trade-contract';
import { blCore, sameBl } from './trade-customs';
import { containerPlFacts } from './trade-attach';
import { classifyByName, classifySheetText, combineClassification } from './trade-classify';
import { sgjpUnitPrice } from './trade-logistics-docs';
import { TRIAGE_DOC_TYPES } from '../ingestion-email/email-triage.rules';

const defaults = { lmeByMonth: { '2026-06': 3458.64, '2026-07': 3155.98 }, qmjpByQuarter: { '2026-2Q': 351.5, '2026-3Q': 395 } };

describe('prices prefill from the org tables', () => {
  it('Invoice #1 (SUS 6063, premium 230): June LME 3,458.64 + 2QMJP 351.5 + 230 = 4,040.14', () => {
    const l = invoice1Line({ id: 'c', contractNo: '454003422' }, { id: 'l', grade: '6063', product: 'Aluminium Billet', sizeSpec: '203 MM X 5800 MM', quantityMt: 300, tolerancePct: 5, billetPremium: 230 } as any, defaults, '2026-07-10', '2026-06');
    expect(l.lme).toBe(3458.64);
    expect(unitPriceOf(l)).toBe(4040.14);
  });
  it('SG→JP IV (July): 3,155.98 + 3QMJP 395 + 230 = 3,780.98; a month not in the table stays typed', () => {
    expect(sgjpUnitPrice({ lme: lmeForMonth(defaults, '2026-07'), qmjp: 395, premium: 230, upcharge: null, unitPrice: null })).toBe(3780.98);
    expect(lmeForMonth(defaults, '2026-09')).toBeNull();
  });
});

describe('price check: never "Matches" with nothing read', () => {
  it('no document values → read false, ok false; with values → compared', () => {
    const prices = { lmeByMonth: defaults.lmeByMonth, qmjpByQuarter: defaults.qmjpByQuarter };
    const empty = priceCheck({ side: 'supplier', basisMonth: '2026-06', schedule: null, mjpBased: true, fallback: { supplierPremium: 205 }, prices, found: {} });
    expect(empty).toMatchObject({ read: false, ok: false });
    const read = priceCheck({ side: 'supplier', basisMonth: '2026-06', schedule: null, mjpBased: true, fallback: { supplierPremium: 205 }, prices, found: { premium: 556.5 } });
    expect(read).toMatchObject({ read: true, ok: true });
  });
});

describe('paying steps wait for their payment', () => {
  const step = (code: string, payment: unknown = null) => ({ id: code, code, payment, status: 'IN_PROGRESS', isOngoing: false, sortOrder: 10, requiredDocTypes: ['PI', 'DEPOSIT_PROOF'] });
  it('step 1 with PI + deposit proof stays open until the payment is saved', () => {
    const s = step('PI_PAYMENT');
    expect(autoCompletePlan([s], ['PI', 'DEPOSIT_PROOF'], {}, {}, readyToAutoComplete).complete).toEqual([]);
    const paid = step('PI_PAYMENT', { amount: 47867.4, paidAt: '2026-07-02', account: 'WISE' });
    expect(autoCompletePlan([paid], ['PI', 'DEPOSIT_PROOF'], {}, {}, readyToAutoComplete).complete).toEqual([paid]);
    expect(paymentRecorded({})).toBe(false);
  });
  it('other steps are not held', () => {
    expect(readyToAutoComplete({ code: 'SHIPPING_DOCS' })).toBe(true);
    expect(readyToAutoComplete({ code: 'TAX_FUNDS' })).toBe(true);
  });
});

describe('documents', () => {
  it('import permit B/L "BE22AA198GX04630" is B/L 198GX04630', () => {
    expect(blCore('BE22AA198GX04630')).toBe('198GX04630');
    expect(sameBl('BE22AA198GX04630', 'TEST-198GX04630')).toBe(true);
    expect(sameBl('BE22AA198GX04630', '198GX04822')).toBe(false);
    expect(blCore('MEDU-AB123456')).toBe('MEDUAB123456');
  });
  it('container PL page: INVOICE NO. XP2652101334, DATE 22/07/2026', () => {
    expect(containerPlFacts('VEDANTA ... INVOICE NO. : XP2652101334   DATE : 22/07/2026  Container ...')).toEqual({ invoiceNo: 'XP2652101334', date: '2026-07-22' });
    expect(containerPlFacts('no facts here')).toEqual({ invoiceNo: null, date: null });
  });
  it('step 3b: container PL, PL.XLS and COA.XLS get their own types', () => {
    expect(classifyByName('PACKING_LIST_CONTAINER_9000565680.pdf')?.docType).toBe('CONTAINER_PL');
    expect(classifyByName('PL.XLS')?.docType).toBe('PL_XLS');
    expect(classifyByName('COA.XLS')?.docType).toBe('COA_XLS');
    expect(classifyByName('PACKING_LIST_9000565680.pdf')?.docType).toBe('PL');
    expect(classifySheetText('Cast No\tFE\tSI\tMG')?.docType).toBe('COA_XLS');
    expect(TRIAGE_DOC_TYPES.PL_XLS).toBe('PL_XLS');
    // A step snapshotted before these types existed still takes them, as PL / COA.
    expect(combineClassification(['BL', 'CI', 'PL', 'COA', 'OTHER'], classifyByName('PL.XLS'), null, null)).toMatchObject({ docType: 'PL', primary: false });
    expect(TRIAGE_DOC_TYPES.PL_CONTAINER).toBe('CONTAINER_PL');
  });
});
