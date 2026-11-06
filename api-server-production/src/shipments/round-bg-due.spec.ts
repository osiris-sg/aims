import { cleanDueRules, describeRule, dueChanges, dueOf, monthDay, ruleFor } from './trade-due';
import { TradeDueService } from './trade-due.service';
import { mergeProfiles } from './trade-profile';
import { processStep } from './trade-process';

const bad = (m: string): never => {
  throw new Error(m);
};
const SUS = { INVOICE_1: { anchor: 'SHIP_MONTH_DAY' as const, days: 0, day: 9 } };
const KATO = { INVOICE_2: { anchor: 'SHIPPING_DOCS_DONE' as const, days: 2, daysText: '1–2' } };

describe('round BG — due-date rules per customer', () => {
  it('a customer rule wins over the default (and over the single-invoice rule)', () => {
    expect(ruleFor('INVOICE_1', 'TWO_STAGE', 14, SUS)).toMatchObject({ anchor: 'SHIP_MONTH_DAY', origin: 'customer', why: 'the 9th of the ship month', whyJa: '出荷月の9日' });
    expect(ruleFor('INVOICE_2', 'SINGLE', 14, KATO)).toMatchObject({ anchor: 'SHIPPING_DOCS_DONE', origin: 'customer' });
    expect(ruleFor('INVOICE_2', 'SINGLE', 14, SUS)!.anchor).toBe('FIRST_ETD');
    expect(ruleFor('INVOICE_1', 'TWO_STAGE', 14, null)!.origin).toBeUndefined();
  });
  it('SUS: Invoice #1 due the 9th of the ship month (Oct shipment → 9 Oct)', () => {
    expect(dueOf('INVOICE_1', { shipMonth: '2026-10', firstEtd: '2026-10-28', customRules: SUS }).due).toBe('2026-10-09');
    expect(dueOf('INVOICE_1', { shipMonth: null, firstEtd: '2026-10-28', customRules: SUS }).due).toBeNull();
    expect(monthDay('2026-02', 31)).toBe('2026-02-28');
  });
  it('Kato: invoice 2 days after the shipping documents; shown as "1–2 days"', () => {
    expect(dueOf('INVOICE_2', { shippingDocsDone: '2026-11-05', customRules: KATO, billingMode: 'SINGLE' }).due).toBe('2026-11-07');
    expect(dueOf('INVOICE_2', { shippingDocsDone: null, customRules: KATO, billingMode: 'SINGLE' }).due).toBeNull();
    expect(describeRule(KATO.INVOICE_2, 'en')).toBe('1–2 days after the shipping documents are received (step 3b; the latest shipment) (due date: 2 days)');
    expect(describeRule(KATO.INVOICE_2, 'ja')).toBe('船積書類の受領（ステップ3b・最後の出荷）の1–2日後');
    expect(describeRule({ anchor: 'ETA', days: -3, business: false }, 'en')).toBe('3 days before ETA');
  });
  it('validates rules', () => {
    const isStep = (c: string) => !!processStep(c);
    expect(cleanDueRules({ INVOICE_1: { anchor: 'SHIP_MONTH_DAY', day: 9 }, CI_PAYMENT: null }, isStep, bad)).toEqual({ INVOICE_1: { anchor: 'SHIP_MONTH_DAY', days: 0, day: 9 } });
    expect(() => cleanDueRules({ NOPE: { anchor: 'ETA', days: 1 } }, isStep, bad)).toThrow('Unknown step');
    expect(() => cleanDueRules({ INVOICE_1: { anchor: 'SHIP_MONTH_DAY', day: 40 } }, isStep, bad)).toThrow('day must be');
    expect(() => cleanDueRules({ INVOICE_1: { anchor: 'DEPOSIT_TERM', days: 0 } }, isStep, bad)).toThrow('anchor');
    expect(() => cleanDueRules({ DELIVERY_CHANGES: { anchor: 'ETA', days: 1 } }, isStep, bad)).toThrow('alongside');
  });
  it('a settings save without dueRules keeps the stored ones', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const cur = { [id]: { customerId: id, billingMode: 'TWO_STAGE', truckCapacityT: 20, docVariants: {}, sendImportPermit: true, dueRules: SUS } };
    const out: any = mergeProfiles(cur, { [id]: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docVariants: {} } }, bad);
    expect(out[id].dueRules).toEqual(SUS);
    const cleared: any = mergeProfiles(cur, { [id]: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docVariants: {}, dueRules: {} } }, bad);
    expect(cleared[id].dueRules).toBeUndefined();
  });

  const st = (code: string, no: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({ id: `${code}-${no}-${sortOrder}`, code, title: code, displayNo: no, sortOrder, status: 'NOT_STARTED', isOngoing: false, notApplicable: false, skipReason: null, completedAt: null, dueAt: null, dueSetByName: null, dueSetAt: null, ...extra });
  const order = (ships: Array<{ docsDone: string | null }>) => ({
    id: 'o25',
    orderNo: 25,
    shipMonth: '2026-10',
    status: 'OPEN',
    createdAt: '2026-09-20T00:00:00.000Z',
    customerId: 'c1',
    piDate: null,
    depositDueDays: 3,
    depositDueUnit: 'BUSINESS',
    steps: [st('CHECK_CONTRACT', '0', 0, { status: 'DONE', completedAt: '2026-09-21T00:00:00.000Z' }), st('INVOICE_1', '2', 20, { status: 'IN_PROGRESS' }), st('INVOICE_2', '11', 110)],
    shipments: ships.map((s, i) => ({ id: `s${i + 1}`, seqNo: i + 1, status: 'OPEN', etd: '2026-10-28T00:00:00.000Z', eta: '2026-11-20T00:00:00.000Z', steps: [st('SHIPPING_DOCS', '3b', 31, s.docsDone ? { status: 'DONE', completedAt: `${s.docsDone}T05:00:00.000Z` } : {})] })),
  });
  const svc = new TradeDueService({} as any);
  it('#25 step 2: due 2 Nov, 4d overdue → with the SUS rule 9 Oct, no badge (before 1 Nov)', () => {
    const base = { profiles: { c1: { billingMode: 'TWO_STAGE' } }, taxDays: 14 };
    const sus = { profiles: { c1: { billingMode: 'TWO_STAGE', dueRules: SUS } }, taxDays: 14 };
    const before = svc.itemsOf([order([{ docsDone: null }])], base, '2026-11-06', true, '2026-11-01');
    const after = svc.itemsOf([order([{ docsDone: null }])], sus, '2026-11-06', true, '2026-11-01');
    const b = before.find((i) => i.code === 'INVOICE_1')!;
    expect([b.due, b.state, b.daysLate, b.dueOrigin]).toEqual(['2026-11-02', 'overdue', 4, 'default']);
    const a = after.find((i) => i.code === 'INVOICE_1')!;
    expect([a.due, a.state, a.flagged, a.dueOrigin, a.dueRule, a.dueWhyJa]).toEqual(['2026-10-09', 'current', false, 'customer', 'CUSTOM', '出荷月の9日']);
    expect(dueChanges(before, after)).toEqual([expect.objectContaining({ ref: '#25', no: '2', before: expect.objectContaining({ due: '2026-11-02', badge: '4d overdue' }), after: expect.objectContaining({ due: '2026-10-09', badge: null }) })]);
  });
  it('Kato: the latest 3b once every shipment has it; unknown while one is still open', () => {
    const kato = { profiles: { c1: { billingMode: 'SINGLE', dueRules: KATO } }, taxDays: 14 };
    const due = (ships: Array<{ docsDone: string | null }>) => svc.itemsOf([order(ships)], kato, '2026-11-06').find((i) => i.code === 'INVOICE_2')!.due;
    expect(due([{ docsDone: '2026-11-02' }, { docsDone: '2026-11-04' }])).toBe('2026-11-06');
    expect(due([{ docsDone: '2026-11-02' }, { docsDone: null }])).toBeNull();
  });
});
