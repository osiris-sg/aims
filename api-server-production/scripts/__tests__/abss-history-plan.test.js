// node --test scripts/__tests__/abss-history-plan.test.js  (also run by `npm run test:pushguard`)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../lib/abss-history-plan');

const e = (seq, date, id, ar, src = 'SJ') => ({ seq, date, memo: '', src, lines: [{ id, code: '1-2200', dr: ar > 0 ? ar : 0, cr: ar < 0 ? -ar : 0 }, { id, code: '4-3100', dr: ar < 0 ? -ar : 0, cr: ar > 0 ? ar : 0 }] });

test('numberEntries: reused ID gets -2 in date order; journalType by AR / AP movement', () => {
  const out = H.numberEntries('SJ', [e(0, '2025-01-10', '00000066', 21.27), e(1, '2024-12-06', '00000066', 159.46), e(2, '2025-01-01', '00000064', -249.8)]);
  assert.deepEqual(out.map((x) => x.journalNumber), ['ABSS-SJ-00000066-2', 'ABSS-SJ-00000066', 'ABSS-SJ-00000064']);
  const ctl = { ar: '1-2200', ap: '2-2200' };
  assert.equal(H.journalType('SJ', out[1].entry, ctl), 'INVOICE');
  assert.equal(H.journalType('SJ', out[2].entry, ctl), 'CREDIT_NOTE');
  assert.equal(H.journalType('SJ', { lines: [{ code: '1-2200', dr: 2.35, cr: 0 }, { code: '1-2200', dr: 0, cr: 2.35 }] }, ctl), 'ADJUSTMENT');
  assert.equal(H.journalType('PJ', { lines: [{ code: '2-2200', dr: 5, cr: 0 }] }, ctl), 'BILL');
  assert.equal(H.journalType('CD', { lines: [] }, ctl), 'PAYMENT');
  assert.equal(H.journalType('GJ', { lines: [] }, ctl), 'MANUAL');
});

test('allocate: exact, partial, spread, never before the sale date, totals conserved', () => {
  const items = [
    { key: 'A', date: '2025-01-01', gross: 100 },
    { key: 'B', date: '2025-01-02', gross: 50 },
    { key: 'C', date: '2025-01-05', gross: 70 },
    { key: 'D', date: '2025-01-09', gross: 70 },
  ];
  const r = H.allocate(items, [
    { ref: 'R1', date: '2025-01-06', amount: 70 },
    { ref: 'R2', date: '2025-01-06', amount: 40 },
    { ref: 'R3', date: '2025-01-07', amount: 100 },
    { ref: 'R4', date: '2024-12-31', amount: 5 },
  ]);
  assert.deepEqual(Object.fromEntries(items.map((i) => [i.key, i.open])), { A: 0, B: 10, C: 0, D: 70 });
  assert.deepEqual(r.rules, { exact: 1, partial: 1, spread: 1 });
  assert.deepEqual(r.unplaced, [{ ref: 'R4', date: '2024-12-31', amount: 5 }]);
  assert.equal(Math.round(r.allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100, 210);
});

test('allocateFromInvoiceTransactions: ABSS pairs (invoice, CR id, date); unknown receipts / invoices unplaced', () => {
  const items = [{ key: 'X1', no: '23-032', date: '2023-05-16', gross: 7500 }, { key: 'X2', no: '23-033', date: '2023-05-20', gross: 100 }];
  const it = [
    { no: '23-032', txns: [{ id: '23-032', src: 'SJ', date: '2023-05-16', payment: 0 }, { id: 'CR000114', src: 'CR', date: '2023-08-07', payment: 3750 }] },
    { no: '23-099', txns: [{ id: 'CR000115', src: 'CR', date: '2023-08-08', payment: 10 }] },
    { no: '23-033', txns: [{ id: 'CR000999', src: 'CR', date: '2023-08-09', payment: 100 }] },
  ];
  const r = H.allocateFromInvoiceTransactions(items, it, [{ ref: 'ABSS-CR-CR000114', id: 'CR000114', date: '2023-08-07' }, { ref: 'ABSS-CR-CR000115', id: 'CR000115', date: '2023-08-08' }]);
  assert.equal(items[0].open, 3750);
  assert.equal(items[1].open, 100);
  assert.deepEqual(r.allocations, [{ ref: 'ABSS-CR-CR000114', key: 'X1', amount: 3750, rule: 'abss' }]);
  assert.deepEqual(r.unplaced.map((u) => u.why), ['invoice not imported', 'receipt not in Cash Receipts']);
});

test('supplier names: truncated card names and phone suffixes match; codes follow the app rule', () => {
  assert.ok(H.sameName('Kingstar (Singapore) International Trade Pte Ltd', 'Kingstar (Singapore) International Tra'));
  assert.ok(H.sameName('Music Rights (Singapore) Public Limited', 'Music Rights (Singapore) Public Limite 64751181'));
  assert.ok(H.sameName('BBQ & Steamboat Product Singapore Pte Ltd', 'BBQ & Steamboat Product Singapore'));
  assert.ok(!H.sameName('Tong Men', 'TANG MEN YIN SHI'));
  assert.ok(!H.sameName('Aiko', 'Aiko Trading'));
  const recs = [{ name: 'Skill & Workforce Development Agenc' }, { name: 'SP Services Ltd' }];
  assert.equal(H.findByName('Skill & Workforce Development Agency', recs), recs[0]);
  assert.equal(H.findByName('SP Services', recs), recs[1]);
  const taken = new Set(['SK001', 'SK002', 'CB009']);
  assert.equal(H.nextCode('S', 'Kudo Plumbing', taken), 'SK003');
  assert.equal(H.nextCode('C', 'BHOP Outlet Sales', taken), 'CB010');
  assert.equal(H.nextCode('C', '(EBT) Ong', taken), 'CE001');
  assert.equal(H.nextCode('C', 'BHOP Outlet Sales', new Set()), 'CB001');
});

const chart = [
  { level: 0, code: '1-0000', name: 'Assets' },
  { level: 1, code: '1-2100', name: 'Cash On Hand' },
  { level: 2, code: '1-2110', name: 'Bank' },
  { level: 2, code: '1-2130', name: 'Cash Drawer' },
  { level: 0, code: '3-0000', name: 'Equity' },
  { level: 1, code: '3-8000', name: 'Retained Earnings' },
  { level: 1, code: '3-9000', name: 'Current Year Earnings' },
  { level: 0, code: '4-0000', name: 'Income' },
  { level: 1, code: '4-3100', name: 'Income' },
  { level: 0, code: '5-0000', name: 'Cost of Sales' },
  { level: 1, code: '5-1200', name: 'Food' },
];

test('compareTrialBalance: headers sum their accounts, 3-9000 is computed from P&L', () => {
  const list = [['Assets', 100], ['Cash On Hand', 100], ['Bank', 120], ['Cash Drawer', -20], ['Equity', 40], ['Retained Earnings', 0], ['Current Year Earnings', 40], ['Income', 100], ['Income', 100], ['Cost of Sales', 60], ['Food', 60]].map(([name, balance]) => ({ name, balance }));
  const signed = new Map([['1-2110', 120], ['1-2130', -20], ['4-3100', -100], ['5-1200', 60]]);
  const rows = H.compareTrialBalance(chart, list, signed);
  assert.ok(rows.every((r) => r.ok && r.nameOk), JSON.stringify(rows));
  signed.set('5-1200', 61);
  assert.deepEqual(H.compareTrialBalance(chart, list, signed).filter((r) => !r.ok).map((r) => r.code), ['3-0000', '3-9000', '5-0000', '5-1200']);
});

test('abssView: P&L from the ABSS year, retained earnings without the AIMS closes of that year, as-at cut', () => {
  const L = (code, dr, cr, date, close = false) => ({ code, dr, cr, date, close });
  const lines = [
    L('1-2110', 100, 0, '2023-03-01'), L('4-3100', 0, 100, '2023-03-01'),
    L('4-3100', 100, 0, '2023-12-31', true), L('3-8000', 0, 100, '2023-12-31', true),
    L('1-2110', 50, 0, '2024-02-01'), L('4-3100', 0, 50, '2024-02-01'),
    L('4-3100', 50, 0, '2024-12-31', true), L('3-8000', 0, 50, '2024-12-31', true),
    L('1-2110', 7, 0, '2027-01-01'), L('4-3100', 0, 7, '2027-01-01'),
  ];
  const v = H.abssView(lines, { fyStart: '2024-01-01', asAt: '2026-11-25' });
  assert.deepEqual(Object.fromEntries(v), { '1-2110': 150, '3-8000': -100, '4-3100': -50 });
  const all = H.abssView(lines.filter((l) => !l.close), {});
  assert.deepEqual(Object.fromEntries(all), { '1-2110': 157, '4-3100': -157 });
});

test('findDuplicates: same reference, same card-day-amount, repeated numbers (identical or not)', () => {
  const x = (jn, src, id, date, amount, memo, card, lines = []) => ({ jn, src, id, date, amount, memo, card, lines });
  const rows = H.findDuplicates(
    [
      x('ABSS-SJ-1', 'SJ', '1', '2025-10-14', 127.82, 'Sales for BHOP (Invoice: 202510140015)', null),
      x('ABSS-SJ-2', 'SJ', '2', '2025-10-14', 127.82, 'Sales for BHOP (Invoice: 202510140015)', null),
      x('ABSS-PJ-7', 'PJ', '7', '2025-07-01', 741.2, 'Purchase', 'Wong Lye Pte Ltd'),
      x('ABSS-PJ-8', 'PJ', '8', '2025-07-01', 741.2, 'Purchase', 'Wong Lye Pte Ltd'),
      x('ABSS-CR-9', 'CR', '9', '2025-01-01', 5, 'r', null, [{ code: '1-2110', dr: 5, cr: 0 }]),
      x('ABSS-CR-9-2', 'CR', '9', '2025-01-01', 5, 'r', null, [{ code: '1-2110', dr: 5, cr: 0 }]),
      x('ABSS-SJ-3', 'SJ', '3', '2025-10-15', 10, 'Sales for BHOP (Invoice: 202510150001)', null),
    ],
    (e) => (e.src === 'SJ' ? (e.memo.match(/Invoice: (\d+)/) || [])[1] : null),
  );
  const groups = [...new Set(rows.map((r) => r.why))];
  assert.equal(rows.length, 6); // SJ pair (caught by reference AND card/day/amount: one row each), PJ pair, CR pair
  assert.equal(rows.find((r) => r.jn === 'ABSS-SJ-1').with, 'ABSS-SJ-2');
  assert.match(rows.find((r) => r.jn === 'ABSS-SJ-1').why, /reference.*; same card/);
  assert.ok(groups.some((g) => /same SJ reference 202510140015/.test(g)));
  assert.ok(groups.some((g) => /identical lines/.test(g)));
  assert.ok(!rows.some((r) => r.jn === 'ABSS-SJ-3'));
});
