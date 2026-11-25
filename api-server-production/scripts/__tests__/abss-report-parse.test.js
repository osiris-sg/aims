// node --test scripts/__tests__/abss-report-parse.test.js  (also run by npm run test:pushguard)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/abss-report-parse');
const H = require('../lib/abss-history-plan');

const CRLF = (rows) => rows.join('\r\n');
const SJ = CRLF([
  '',
  'YMM Kitchen Pte Ltd',
  '150 Orchard Road',
  '',
  '\tSales & Receivables Journal',
  '',
  '1/1/2018 To 25/11/2026',
  '25/11/2026\tPage 1',
  '10:08:51 pm',
  '\t\tID#\tAcct#\tAccount Name\tDebit\tCredit\tJob No.',
  '',
  'SJ\t1/12/2024\tSales for BHOP (Invoice: 202412010001)',
  '\t\t00000001\t1-2200\tTrade Debtors\t$69.50',
  '\t\t00000001\t4-3100\tIncome\t\t$69.50',
  '',
  'SJ\t12/4/2025',
  '\t\t00000002\t1-2200\tTrade Debtors\t$1,017.57',
  '\t\t00000002\t4-1000\tFee Income\t\t$1,017.93',
  '\t\t00000002\t5-2700\tTransaction Fee - BHOP\t$0.36',
  '',
  'SJ\t19/3/2025\tGrabCar Pte. Ltd:  Credit from 00000309',
  '\t\tSJ000001\t1-2200\tTrade Debtors\t$2.35',
  '\t\tSJ000001\t1-2200\tTrade Debtors\t\t$2.35',
  '',
  '',
  '\t\t\t\tGrand Total:\t$1,089.78\t$1,089.78',
  '',
]);

test('money: dollars, commas, negatives, brackets, blanks', () => {
  assert.equal(P.money('$1,234.56'), 1234.56);
  assert.equal(P.money('-$112,461.75'), -112461.75);
  assert.equal(P.money('($5.00)'), -5);
  assert.equal(P.money(''), null);
  assert.equal(P.money(undefined), null);
  assert.ok(Number.isNaN(P.money('$1.2.3')));
  assert.equal(P.money('$0.01') + P.money('$0.02'), 0.03);
});

test('dmyToIso: d/m/yyyy only, real dates only', () => {
  assert.equal(P.dmyToIso('1/12/2024'), '2024-12-01');
  assert.equal(P.dmyToIso('23/11/2026'), '2026-11-23');
  assert.equal(P.dmyToIso('31/2/2025'), null);
  assert.equal(P.dmyToIso('2024-12-01'), null);
});

test('decode: ascii, latin1 and utf8 with BOM', () => {
  assert.equal(P.decode(Buffer.from('abc\r\n')).encoding, 'ascii');
  const latin = P.decode(Buffer.from([0x43, 0x61, 0x66, 0xe9])); // "Café" in latin1
  assert.equal(latin.encoding, 'latin1');
  assert.equal(latin.text, 'Café');
  const utf = P.decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Café', 'utf8')]));
  assert.equal(utf.encoding, 'utf8');
  assert.equal(utf.text, 'Café');
});

test('parseJournalReport: entries, lines, memo-less headers, grand total', () => {
  const r = P.parseJournalReport(SJ);
  assert.equal(r.entries.length, 3);
  assert.equal(r.headerCount, 3);
  assert.deepEqual(r.range, { from: '2018-01-01', to: '2026-11-25' });
  assert.deepEqual(r.grandTotal, { debit: 1089.78, credit: 1089.78 });
  assert.equal(r.unparsed.length, 0);
  const [a, b, c] = r.entries;
  assert.equal(a.date, '2024-12-01');
  assert.equal(a.lines[1].credit, 69.5);
  assert.equal(b.memo, '');
  assert.equal(b.date, '2025-04-12');
  assert.deepEqual(P.entryTotals(b), { dr: 1017.93, cr: 1017.93, balanced: true, ids: ['00000002'] });
  assert.equal(P.netOn(b, '1-2200'), 1017.57);
  assert.equal(P.netOn(c, '1-2200'), 0);
  const dr = r.entries.reduce((s, e) => s + P.entryTotals(e).dr, 0);
  assert.equal(Math.round(dr * 100) / 100, r.grandTotal.debit);
});

test('parseJournalReport: memo / card columns (Purchases) and unrecognised lines', () => {
  const pj = CRLF([
    '\t\tID#\tAcct#\tAccount Name\tDebit\tCredit\tJob No.\tMemo\tName',
    'PJ\t1/12/2024\tFood Supply for BHOP (Invoice: JJF24-120043)',
    '\t\t00000018\t2-2200\tTrade Creditors\t\t$101.26\t\tFood Supply\tJIAJIAFU Trading Pte Ltd',
    '\t\t00000018\t5-1200\tFood Supply - BHOP\t$101.26\t\t\tFood Supply\tJIAJIAFU Trading Pte Ltd',
    'garbage line',
  ]);
  const r = P.parseJournalReport(pj);
  assert.equal(r.entries[0].lines[0].card, 'JIAJIAFU Trading Pte Ltd');
  assert.equal(r.entries[0].lines[0].memo, 'Food Supply');
  assert.equal(r.unparsed.length, 1);
  assert.equal(r.unparsed[0].why, 'unrecognised line');
});

test('parseAccountsList + parseChartFile', () => {
  const list = P.parseAccountsList(CRLF(['YMM', '\tAccount\tCurrent Balance', '', '\tAssets\t$570,923.41', '\tCash On Hand\t-$112,461.75', '']));
  assert.deepEqual(list.map((x) => [x.name, x.balance]), [['Assets', 570923.41], ['Cash On Hand', -112461.75]]);
  const chart = P.parseChartFile('# header\n0|1-0000|Assets|543452.52\n2|1-2100|Cash On Hand|-112461.75\n');
  assert.deepEqual(chart[1], { level: 2, code: '1-2100', name: 'Cash On Hand', balance: -112461.75 });
});

test('parseSupplierPaymentHistory: rows and payment totals', () => {
  const t = CRLF([
    '\tCheque #\tChq Date\tPO #\tDate\tSupplier\'s Inv. #\tPurchase Total Amt\t\tAmount Applied',
    '',
    '57 Employment Agency Pte Ltd',
    '\t23012501\t23/1/2025\t00000039\t1/12/2024\t2024103001\t$1,500.00\t\t$1,500.00',
    '',
    '\t\t\t\t\t\t\tTotal for Payment 23012501:\t$1,500.00',
  ]);
  const r = P.parseSupplierPaymentHistory(t);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(
    { s: r.rows[0].supplier, c: r.rows[0].cheque, d: r.rows[0].chqDate, po: r.rows[0].po, a: r.rows[0].applied },
    { s: '57 Employment Agency Pte Ltd', c: '23012501', d: '2025-01-23', po: '00000039', a: 1500 },
  );
  assert.deepEqual(r.paymentTotals, [{ supplier: '57 Employment Agency Pte Ltd', cheque: '23012501', total: 1500 }]);
  assert.equal(r.unparsed.length, 0);
});

test('memo helpers: POS number, receipt channel', () => {
  assert.equal(P.posNumber('Sales for BHOP (Invoice: 202412010001)'), '202412010001');
  assert.equal(P.posNumber('Sales for BHOP (202610230008)'), '202610230008');
  assert.equal(P.posNumber('Sales for BHOP'), null);
  assert.equal(P.receiptChannel('FT; GrabCar Pte. Ltd'), 'GrabCar');
  assert.equal(P.receiptChannel('Received by Nets Pte Ltd'), 'NETS');
  assert.equal(P.receiptChannel('Payment; Cash Sales'), 'Cash');
  assert.equal(P.receiptChannel('FT; Paynow'), 'PayNow');
  assert.equal(P.receiptChannel('WCT 2025 Loan tf BHOP'), null);
});

test('numberEntries: reused ID gets -2 in date order; journalType by AR / AP movement', () => {
  const e = (seq, date, id, ar) => ({ seq, date, memo: '', lines: [{ id, code: '1-2200', debit: ar > 0 ? ar : 0, credit: ar < 0 ? -ar : 0 }, { id, code: '4-3100', debit: ar < 0 ? -ar : 0, credit: ar > 0 ? ar : 0 }] });
  const out = H.numberEntries('SJ', [e(0, '2025-01-10', '00000066', 21.27), e(1, '2024-12-06', '00000066', 159.46), e(2, '2025-01-01', '00000064', -249.8)]);
  assert.deepEqual(out.map((x) => x.journalNumber), ['ABSS-SJ-00000066-2', 'ABSS-SJ-00000066', 'ABSS-SJ-00000064']);
  const ctl = { ar: '1-2200', ap: '2-2200' };
  assert.equal(H.journalType('SJ', out[1].entry, ctl), 'INVOICE');
  assert.equal(H.journalType('SJ', out[2].entry, ctl), 'CREDIT_NOTE');
  assert.equal(H.journalType('SJ', { lines: [{ code: '1-2200', debit: 2.35, credit: 0 }, { code: '1-2200', debit: 0, credit: 2.35 }] }, ctl), 'ADJUSTMENT');
  assert.equal(H.journalType('PJ', { lines: [{ code: '2-2200', debit: 5, credit: 0 }] }, ctl), 'BILL');
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
    { ref: 'R1', date: '2025-01-06', amount: 70 }, // exact -> C (D is later)
    { ref: 'R2', date: '2025-01-06', amount: 40 }, // partial -> A (earliest that covers)
    { ref: 'R3', date: '2025-01-07', amount: 100 }, // spread: A 60 + B 40
    { ref: 'R4', date: '2024-12-31', amount: 5 }, // nothing open before -> unplaced
  ]);
  const by = Object.fromEntries(items.map((i) => [i.key, i.open]));
  assert.deepEqual(by, { A: 0, B: 10, C: 0, D: 70 });
  assert.deepEqual(r.rules, { exact: 1, partial: 1, spread: 1 });
  assert.deepEqual(r.unplaced, [{ ref: 'R4', date: '2024-12-31', amount: 5 }]);
  const paid = r.allocations.reduce((s, a) => s + a.amount, 0);
  assert.equal(Math.round(paid * 100) / 100, 210);
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
});

test('compareTrialBalance: headers sum their accounts, 3-9000 is computed from P&L', () => {
  const chart = [
    { level: 0, code: '1-0000', name: 'Assets' },
    { level: 1, code: '1-2100', name: 'Cash On Hand' },
    { level: 2, code: '1-2110', name: 'Bank' },
    { level: 2, code: '1-2130', name: 'Cash Drawer' },
    { level: 0, code: '3-0000', name: 'Equity' },
    { level: 1, code: '3-9000', name: 'Current Year Earnings' },
    { level: 0, code: '4-0000', name: 'Income' },
    { level: 1, code: '4-3100', name: 'Income' },
    { level: 0, code: '5-0000', name: 'Cost of Sales' },
    { level: 1, code: '5-1200', name: 'Food' },
  ];
  const list = [
    ['Assets', 100], ['Cash On Hand', 100], ['Bank', 120], ['Cash Drawer', -20], ['Equity', 40], ['Current Year Earnings', 40],
    ['Income', 100], ['Income', 100], ['Cost of Sales', 60], ['Food', 60],
  ].map(([name, balance]) => ({ name, balance }));
  const signed = new Map([['1-2110', 120], ['1-2130', -20], ['4-3100', -100], ['5-1200', 60]]);
  const rows = H.compareTrialBalance(chart, list, signed);
  assert.ok(rows.every((r) => r.diff === 0 && r.nameOk), JSON.stringify(rows));
  signed.set('5-1200', 61);
  const off = H.compareTrialBalance(chart, list, signed).filter((r) => r.diff !== 0).map((r) => r.code);
  assert.deepEqual(off, ['3-0000', '3-9000', '5-0000', '5-1200']);
});
