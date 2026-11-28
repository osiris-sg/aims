/**
 * Commission report (guru 2026-11-28). The figures in these tests are rows of the office's own
 * July 2026 sheets, so the calculation is held to what they actually paid.
 */
import { cleanSettings, computeCommission, personOfLogin, salespeopleOf, splitByType, STANDARD_RATES, UNTYPED } from './commission';

const typeOfAccount = (code: string) => ({ '4-1000': 'MV', '4-2000': 'CD', '4-3000': 'AA', '4-3500': 'TS' } as Record<string, string>)[code] || null;
const settings = cleanSettings({
  people: [
    { name: 'Henry', aliases: ['henry hoo'] },
    { name: 'Rave' },
    { name: 'Isadora', aliases: ['Isa'], allJobs: true, rates: { CD: 1, AA: 1, MV: 1, VO: 1, TS: 0.5 } },
  ],
});
const invoice = (over: any = {}) => ({
  id: 'i1', number: 'I-014728', customer: '546 Brew Coffee', salesPerson: 'Henry', subject: 'Chemical Degreasing', net: 1500, gross: 1635,
  lines: [{ amount: 0, accountCode: '4-2000', description: 'G- Provide tools' }, { amount: 1500, accountCode: '4-2000', description: 'Service package' }],
  quotation: { id: 'q1', number: 'Q-014272', net: 1500 }, ...over,
});
const run = (inv: any, pay: any = {}, extra: any = {}) =>
  computeCommission({
    payments: [{ key: 'r1', number: 'OR-1', date: '2026-07-17', chequeNo: 'FT', invoiceId: inv.id, amount: inv.gross, ...pay }],
    invoices: new Map([[inv.id, inv]]), costs: new Map(), settings, typeOfAccount, ...extra,
  });
const row = (r: any, person: string, type?: string) => r.people.find((p: any) => p.name === person)?.rows.find((x: any) => !type || x.type === type);

describe('commission report', () => {
  it('the sheet row: 1,635 received = 1,500 before GST; Henry 8% of a CD job, Isadora 1% on top', () => {
    const r = run(invoice());
    expect(row(r, 'Henry')).toMatchObject({ amount: 1500, type: 'CD', rate: 8, commission: 120, quotation: 'Q-014272', invoice: 'I-014728' });
    expect(row(r, 'Isadora')).toMatchObject({ amount: 1500, rate: 1, commission: 15, note: "On Henry's job" });
    expect(r.totals.commission).toBe(135);
  });

  it('one payment over two job types splits as the invoice lines do, and the parts add up', () => {
    // 22 Sin Ming Cafe: 19,000 before GST = MV 18,181.03 + CD 818.97
    const inv = invoice({ net: 19000, gross: 20710, lines: [{ amount: 18181.03, accountCode: '4-1000' }, { amount: 818.97, accountCode: '4-2000' }] });
    const r = run(inv);
    expect(row(r, 'Henry', 'MV')).toMatchObject({ amount: 18181.03, rate: 5, commission: 909.05 });
    expect(row(r, 'Henry', 'CD')).toMatchObject({ amount: 818.97, rate: 8, commission: 65.52 });
  });

  it('a part payment earns on the part', () => {
    expect(row(run(invoice(), { amount: 817.5 }), 'Henry')).toMatchObject({ amount: 750, commission: 60 });
  });

  it('lines with no account follow the office wording: a heading line starts a section', () => {
    // Active SG I-014586: "CD+AA - …", 2,000 package then "AA- Dismantle…" (0) and 300 supply & install
    const s = splitByType(
      [{ amount: 0, description: 'G- Provide tools' }, { amount: 2000, description: 'Service package with scope of work' }, { amount: 0, description: 'AA- Dismantle 01 no. of existing' }, { amount: 300, description: 'Supply and Installation 01 no.' }],
      'CD+AA - Y2026 Chemical Degreasing', typeOfAccount,
    );
    expect(s.shares).toEqual([{ type: 'CD', amount: 2000 }, { type: 'AA', amount: 300 }]);
    expect([...s.guessed].sort()).toEqual(['AA', 'CD']);
    expect(splitByType([{ amount: 500, description: 'Repair works' }], 'Repair works', typeOfAccount).shares).toEqual([{ type: UNTYPED, amount: 500 }]);
  });

  it('a job with no type, or no salesperson, earns nothing until someone decides', () => {
    const untyped = run(invoice({ lines: [{ amount: 1500, description: 'Works' }], subject: 'Works' }));
    expect(row(untyped, 'Henry')).toMatchObject({ type: UNTYPED, rate: 0, commission: 0 });
    const nobody = run(invoice({ salesPerson: '' }));
    expect(row(nobody, '(No salesperson)')).toMatchObject({ rate: 0, commission: 0 });
    expect(row(nobody, 'Isadora')).toMatchObject({ commission: 15, note: 'On every job' });
  });

  it('the 30% margin rule applies only where a supplier cost is on record', () => {
    const low = run(invoice(), {}, { costs: new Map([['q1', 1200]]) }); // margin 20%
    expect(row(low, 'Henry')).toMatchObject({ commission: 0 });
    expect(row(low, 'Henry').note).toContain('Margin 20% is under 30%');
    expect(row(run(invoice(), {}, { costs: new Map([['q1', 900]]) }), 'Henry').commission).toBe(120); // margin 40%
    expect(row(run(invoice()), 'Henry').note).toBe(''); // no cost on record: no test
  });

  it('a shared job lists both people; the office sets the split per row, and a row can be left out', () => {
    const inv = invoice({ salesPerson: 'Henry & Rave', net: 30380, gross: 33114.2, lines: [{ amount: 30380, accountCode: '4-1000' }] });
    const first = run(inv);
    expect(row(first, 'Henry').note).toBe('Shared job: Rave');
    const key = (n: string) => row(first, n).key;
    const r = run(inv, {}, { overrides: { [key('Henry')]: { rate: 3.75 }, [key('Rave')]: { rate: 1.25 }, [key('Isadora')]: { exclude: true } } });
    expect(row(r, 'Henry')).toMatchObject({ rate: 3.75, commission: 1139.25 }); // the sheet's 16TW Cafe row
    expect(row(r, 'Rave')).toMatchObject({ rate: 1.25, commission: 379.75 });
    expect(r.people.find((p: any) => p.name === 'Isadora')).toMatchObject({ totalSales: 0, totalCommission: 0 });
  });

  it('a job type picked for a payment serves every person who earns on it', () => {
    const inv = invoice({ lines: [{ amount: 1500, description: 'Works' }], subject: 'Works' });
    const r = run(inv, {}, { overrides: { 'r1|i1|UNTYPED|*': { type: 'AA' } } });
    expect(row(r, 'Henry')).toMatchObject({ type: 'AA', rate: 5, commission: 75 });
    expect(row(r, 'Isadora')).toMatchObject({ type: 'AA', rate: 1, commission: 15 });
  });

  it('a group report: one person, two companies, a commission figure for each', () => {
    const a = invoice({ company: 'WCT (S) Systems' });
    const b = invoice({ id: 'i2', number: 'I003081', company: 'BC Air', net: 1000, gross: 1090, lines: [{ amount: 1000, accountCode: '4-1000' }] });
    const r = computeCommission({
      payments: [{ key: 'r1', number: 'OR-1', date: '2026-07-17', invoiceId: 'i1', amount: 1635 }, { key: 'r2', number: 'OR-2', date: '2026-07-18', invoiceId: 'i2', amount: 1090 }],
      invoices: new Map([['i1', a], ['i2', b]]), costs: new Map(), settings, typeOfAccount,
    });
    const henry: any = r.people.find((p) => p.name === 'Henry');
    expect(henry.byCompany).toEqual({ 'WCT (S) Systems': 120, 'BC Air': 50 });
    expect(henry.totalCommission).toBe(170);
    expect(henry.rows.map((x: any) => x.company)).toEqual(['BC Air', 'WCT (S) Systems']);
  });

  describe('CD is paid as it comes in; other jobs when the whole quotation is fully paid', () => {
    // Marhaba Food Industries, quotation -13896: 4,000 received in March, 7,000 in July (the office's July sheet lists both).
    const quo = { id: 'q9', number: 'Q-013896', net: 11000 };
    const aa = (id: string, number: string, net: number) => invoice({ id, number, customer: 'Marhaba', net, gross: net * 1.09, quotation: quo, lines: [{ amount: net, accountCode: '4-3000' }] });
    const invs = new Map([['m1', aa('m1', 'I003002', 4000)], ['m2', aa('m2', 'I003128', 7000)]]);
    const march = { key: 'r1', number: 'CR1', date: '2026-03-12', invoiceId: 'm1', amount: 4360 };
    const july = { key: 'r2', number: 'CR2', date: '2026-07-20', invoiceId: 'm2', amount: 7630 };
    const calc = (from: string, to: string, payments: any[], extra: any = {}) => computeCommission({ payments, from, to, invoices: invs, costs: new Map(), settings, typeOfAccount, ...extra });

    it('March: the first payment is shown as waiting and earns nothing yet', () => {
      const r = calc('2026-03-01', '2026-03-31', [march]);
      expect(row(r, 'Henry')).toMatchObject({ amount: 4000, commission: 0, held: true });
      expect(row(r, 'Henry').note).toContain('Waiting: job not fully paid (4,000 of 11,000 received)');
      expect(r.people.find((p: any) => p.name === 'Henry')).toMatchObject({ totalSales: 0, totalCommission: 0, heldSales: 4000 });
    });
    it('July: the job is fully paid, so BOTH payments are paid now', () => {
      const r = calc('2026-07-01', '2026-07-31', [march, july]);
      const henry: any = r.people.find((p: any) => p.name === 'Henry');
      expect(henry.rows.map((x: any) => [x.invoice, x.amount, x.commission, x.held])).toEqual([['I003002', 4000, 200, false], ['I003128', 7000, 350, false]]);
      expect(henry.rows[0].note).toContain('Received 12/03/2026; job fully paid 20/07/2026');
      expect(henry.totalCommission).toBe(550);
      expect(r.jobs['q:q9']).toMatchObject({ received: 11000, target: 11000, paidOn: '2026-07-20' });
    });
    it('August: nothing of that job is paid a second time', () => {
      expect(calc('2026-08-01', '2026-08-31', [march, july]).people).toEqual([]);
    });
    it('a CD payment is paid in its own month whether or not the job is finished', () => {
      const cd = invoice({ id: 'c1', quotation: { id: 'q8', number: 'Q-1', net: 5000 } }); // 1,500 of a 5,000 job
      const r = computeCommission({ payments: [{ key: 'r3', number: 'CR3', date: '2026-07-05', invoiceId: 'c1', amount: 1635 }], from: '2026-07-01', to: '2026-07-31', invoices: new Map([['c1', cd]]), costs: new Map(), settings, typeOfAccount });
      expect(row(r, 'Henry')).toMatchObject({ type: 'CD', commission: 120, held: false });
    });
    it('the office can still choose which types wait', () => {
      const r = calc('2026-03-01', '2026-03-31', [march], { settings: { ...settings, holdTypes: [] } });
      expect(row(r, 'Henry')).toMatchObject({ commission: 200, held: false });
    });
  });

  it('invoice numbers the office lists earn nothing (another business\'s series)', () => {
    const r = run(invoice({ number: 'SIBA-26-00079' }), {}, { settings: cleanSettings({ ...settings, skipNumbers: 'siba' }) });
    expect(r.people).toEqual([]);
  });

  it('a big job in a named company is paid on the payment less its cost', () => {
    const s = cleanSettings({ ...settings, deductCost: [{ company: 'Racking', above: 200000 }] });
    const big = invoice({ company: 'WCT Racking Pte Ltd', net: 250000, gross: 272500, quotation: { id: 'qr', number: 'Q-R1', net: 250000 }, lines: [{ amount: 250000, accountCode: '4-2000' }] });
    const r = run(big, {}, { settings: s, costs: new Map([['qr', 200000]]) }); // 20% left after cost
    expect(row(r, 'Henry')).toMatchObject({ amount: 250000, basis: 50000, rate: 8, commission: 4000 });
    expect(row(r, 'Henry').note).toContain('cost 200,000 deducted');
    // the same job at 150,000 is under the line: paid on the whole payment
    const small = invoice({ company: 'WCT Racking Pte Ltd', net: 150000, gross: 163500, quotation: { id: 'qs', number: 'Q-R2', net: 150000 }, lines: [{ amount: 150000, accountCode: '4-2000' }] });
    expect(row(run(small, {}, { settings: s, costs: new Map([['qs', 100000]]) }), 'Henry')).toMatchObject({ basis: 150000, commission: 12000 });
    // no cost on record: said so, nothing deducted
    expect(row(run(big, {}, { settings: s }), 'Henry').note).toContain('no supplier cost on record');
  });

  it('names: aliases, first names, shared names, and names nobody is set up for', () => {
    expect(salespeopleOf('Henry Hoo', settings.people)).toEqual(['Henry']);
    expect(salespeopleOf('henry', settings.people)).toEqual(['Henry']);
    expect(salespeopleOf('Henry & Nee Meng', settings.people)).toEqual(['Henry', 'Nee Meng']);
    expect(run(invoice({ salesPerson: 'Joyna' })).unknownNames).toEqual(['Joyna']);
  });

  it('an old-ERP login names a salesperson only when it is their name or alias', () => {
    const people = cleanSettings({ people: [{ name: 'Rave', aliases: ['ravewct'] }, { name: 'Joyna', aliases: ['joy'] }] }).people;
    expect(personOfLogin('ravewct', people)).toBe('Rave');
    expect(personOfLogin('JOYNA', people)).toBe('Joyna');
    expect(personOfLogin('kherrywct', people)).toBe(''); // an office login: nobody's
    expect(personOfLogin('', people)).toBe('');
  });

  it('settings are cleaned: standard rates, 30%, numbers kept in range', () => {
    const s = cleanSettings({ rates: { CD: '9', AA: -3, MV: 500 }, minMarginPct: 'x', people: [{ name: ' A ' }, { name: 'a' }, { name: '' }] });
    expect(s.rates).toMatchObject({ CD: 9, AA: 0, MV: 100, VO: STANDARD_RATES.VO, TS: 1 });
    expect(s.minMarginPct).toBe(30);
    expect(s.people.map((p) => p.name)).toEqual(['A']);
  });
});
