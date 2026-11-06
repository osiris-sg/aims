// WCT group sister orgs (2026-11-06): the tracker readers in scripts/wct-group-books.js.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const books = require('../../scripts/wct-group-books.js');

describe('wct-group-books tracker text', () => {
  const read = (s: string) => books.textDates(s).map((d: any) => [d.date, books.amountIn(d.tail)]);

  it.each([
    ['01/06/2023 - S$300 & 18/02/2024 - S$2,700', [['2023-06-01', 300], ['2024-02-18', 2700]]],
    ['11/04/2026 - $6,300.00\n10/04/2026 - $4,200.00', [['2026-04-11', 6300], ['2026-04-10', 4200]]],
    ['11/12/2023 - 10K', [['2023-12-11', 10000]]],
    ['16-11-2018\n16-12-2018', [['2018-11-16', null], ['2018-12-16', null]]],
    ['8-Jan-20', [['2020-01-08', null]]],
    ['29/102025', [['2025-10-29', null]]],
    ['17/9/0206', [['2026-09-17', null]]],
  ])('%j', (s, want) => {
    expect(read(s)).toEqual(want);
  });

  it('never reads an amount as a date', () => {
    expect(read('18/11/2024-$10,000 24/12/2024-$2,000 20/02/2025- $2,025')).toEqual([['2024-11-18', 10000], ['2024-12-24', 2000], ['2025-02-20', 2025]]);
  });
});

describe('wct-group-books buckets and banks', () => {
  it.each([
    ['Troubleshooting of Kitchen Exhaust System & Replacement of VSD', 'TS'],
    ['Maintenance Agreement - Chemical Degreasing of Air Cleaners', 'CD'],
    ['Kitchen Exhaust System Fit-Out @ 740 Bedok Reservoir Road', 'MV'],
    ['Supply only BC Air Ducted UVC Emitter', 'AA'],
  ])('%s → %s', (subject, key) => {
    expect(books.bcairBucket(subject).key).toBe(key);
  });

  it.each([
    ['FT', 'ERP', '1-2420'],
    ['Cheque', 'ERP', '1-2400'],
    ['Cash', 'ERP', '1-2440'],
    ['Contra Payment\nFT', 'ERP', '1-2450'],
    ['FT', 'ERP (paid to WCT (S))', '1-2430'],
  ])('WCT Cleaning %j / %j → %s', (method, remarks, code) => {
    expect(books.wctcBank(method, remarks).code).toBe(code);
  });
});

describe('wct-group-books WCT Racking', () => {
  it.each([
    ['DBS000141', false, '1-2110'],
    ['OCBC396523', false, '1-2111'],
    ['Cheque', false, '1-2199'],
    ['FT', false, '1-2111'],
    ['Contra Payment', false, '1-2180'],
    ['FT', true, '1-2160'],
    ['UOB000072', false, '1-2199'],
    ['', false, '1-2111'],
  ])('payment %j (to WCT Cleaning: %j) → %s', (method, toWct, code) => {
    expect(books.wctrBank(method, toWct).code).toBe(code);
  });

  it('flags every method the rules do not cover', () => {
    expect(books.wctrBank('FT', false).flag).toBeFalsy();
    expect(books.wctrBank('Cheque', false).flag).toBeFalsy();
    expect(books.wctrBank('UOB000072', false).flag).toBeTruthy();
    expect(books.wctrBank('', false).flag).toBeTruthy();
  });

  it('finds the open invoices that add up to a gap', () => {
    const sets = books.subsetsTo([{ k: 'A', v: 4040 }, { k: 'B', v: 2000 }, { k: 'C', v: 10000 }, { k: 'D', v: 500 }], 16040, 3);
    expect(sets).toEqual([['A 4,040.00', 'B 2,000.00', 'C 10,000.00']]);
  });
});
