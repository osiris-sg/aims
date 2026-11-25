// node --test scripts/__tests__/abss-reports.test.js  (also run by `npm run test:pushguard`)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../lib/abss-reports');

const HDR = 'WCT Racking Pte Ltd\r\n5 Kaki Bukit Road 2\r\n\r\n';
const crlf = (lines) => lines.join('\r\n') + '\r\n';

test('decode: ascii, cp1252 0x92 -> right quote (reported with its line), utf8 with BOM', () => {
  assert.equal(A.decode(Buffer.from('abc\r\n')).encoding, 'ascii');
  const d = A.decode(Buffer.concat([Buffer.from('a\r\nCaptain'), Buffer.from([0x92]), Buffer.from('s Eye\r\n')]));
  assert.equal(d.encoding, 'cp1252');
  assert.equal(d.text, 'a\r\nCaptain’s Eye\r\n');
  assert.deepEqual(d.oddChars, [{ byte: '0x92', char: '’', line: 2 }]);
  const latin = A.decode(Buffer.from([0x43, 0x61, 0x66, 0xe9]));
  assert.equal(latin.text, 'Café');
  const utf = A.decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Café', 'utf8')]));
  assert.equal(utf.encoding, 'utf8');
  assert.equal(utf.text, 'Café');
});

test('splitLines: CRLF only, stray CR inside a line dropped and counted', () => {
  const l = A.splitLines('SJ\t13/7/2026\tKEMSA (Far East) Pte Ltd\r\r\nx\ty\r\n');
  assert.deepEqual(l.slice(0, 2), ['SJ\t13/7/2026\tKEMSA (Far East) Pte Ltd', 'x\ty']);
  assert.equal(l.strayCr, 1);
});

test('parseMoney / parseDate / nameKey', () => {
  assert.equal(A.parseMoney('$1,234.56'), 1234.56);
  assert.equal(A.parseMoney('-$39,398.46'), -39398.46);
  assert.equal(A.parseMoney('-$112,461.75'), -112461.75);
  assert.equal(A.parseMoney('($5.00)'), -5);
  assert.equal(A.parseMoney(''), null);
  assert.equal(A.parseMoney(undefined), null);
  assert.equal(A.parseMoney('$0.01') + A.parseMoney('$0.02'), 0.03);
  assert.throws(() => A.parseMoney('abc'));
  assert.throws(() => A.parseMoney('$1.2.3'));
  assert.equal(A.parseDate('4/8/2022'), '2022-08-04');
  assert.equal(A.parseDate('23/11/2026'), '2026-11-23');
  assert.equal(A.parseDate('31/2/2025'), null);
  assert.equal(A.parseDate('2024-12-01'), null);
  assert.equal(A.parseDate('Page 1'), null);
  assert.equal(A.nameKey('Captain’s Eye Asia Pte. Ltd.'), A.nameKey("Captain's Eye Asia Pte Ltd"));
  assert.equal(A.nameKey('Springfield Supplies & Services'), A.nameKey('Springfield Supplies and Services'));
});

const SJ = HDR + crlf([
  '\tSales & Receivables Journal',
  '',
  '1/1/2018 To 31/12/2026',
  '25/11/2026\tPage 1',
  '\t\tID#\tAcct#\tAccount Name\tDebit\tCredit\tJob No.',
  '',
  'SJ\t3/11/2022\tSale; GJ Design Enterprise',
  '\t\t22-051\t1-3100\tAccounts Receivable\t$1,500.00',
  '\t\t22-051\t4-1000\tIncome\t\t$1,500.00\tQ22-102',
  '',
  'SJ\t13/7/2026\tSale; KEMSA (Far East) Pte Ltd\r',
  '\t\t26-043\t1-3100\tAccounts Receivable\t$2,700.00',
  '\t\t26-043\t4-1000\tIncome\t\t$2,700.00\tQ26-064',
  '',
  'SJ\t12/4/2025',
  '\t\t00000002\t1-2200\tTrade Debtors\t$1,017.57',
  '\t\t00000002\t4-1000\tFee Income\t\t$1,017.93',
  '\t\t00000002\t5-2700\tTransaction Fee - BHOP\t$0.36',
  '',
  '\t\t\t\tGrand Total:\t$5,217.93\t$5,217.93',
]);

test('parseJournal: entries, lines, memo-less headers, range, grand total tie, stray CR in the memo', () => {
  const j = A.parseJournal(SJ, 'SJ');
  assert.equal(j.entries.length, 3);
  assert.equal(j.headerCount, 3);
  assert.deepEqual(j.flags, []);
  assert.deepEqual(j.range, { from: '2018-01-01', to: '2026-12-31' });
  const [a, b, c] = j.entries;
  assert.equal(a.id, '22-051');
  assert.equal(a.date, '2022-11-03');
  assert.deepEqual(a.lines.map((l) => [l.code, l.dr, l.cr, l.job]), [['1-3100', 1500, 0, null], ['4-1000', 0, 1500, 'Q22-102']]);
  assert.equal(b.memo, 'Sale; KEMSA (Far East) Pte Ltd');
  assert.equal(c.memo, '');
  assert.deepEqual(A.entryTotals(c), { dr: 1017.93, cr: 1017.93, balanced: true, ids: ['00000002'] });
  assert.equal(A.netOn(c, '1-2200'), 1017.57);
  assert.equal(j.strayCr, 1);
  assert.deepEqual(j.grandTotal, { dr: 5217.93, cr: 5217.93 });
});

test('parseJournal: Purchases columns (Linked Customer / Memo / Name / Payee), unbalanced entry and grand-total mismatch flagged', () => {
  const pj = crlf([
    '\t\tID#\tAcct#\tAccount Name\tDebit\tCredit\tJob No.\tLinked Customer\tMemo\tName\tPayee',
    'PJ\t30/9/2022\tPurchase; X',
    '\t\t00000003\t2-2100\tAccounts Payables - SGD\t\t$100.00\t\t\tPurchase; X\tWCT (S) Systems Pte Ltd\tPurchase; X',
    '\t\t00000003\t5-1010\tMaterial Costing\t$90.00\t\t000000\tKEMSA\tMat\tWCT (S) Systems Pte Ltd\tPurchase; X',
    '\t\t\t\tGrand Total:\t$100.00\t$100.00',
  ]);
  const j = A.parseJournal(pj, 'PJ');
  assert.equal(j.entries[0].lines[0].card, 'WCT (S) Systems Pte Ltd');
  assert.equal(j.entries[0].lines[1].linkedCustomer, 'KEMSA');
  assert.equal(j.entries[0].lines[1].memo, 'Mat');
  assert.deepEqual(j.flags.map((f) => f.kind).sort(), ['grand-total-mismatch', 'unbalanced-entry']);
});

test('parseJournal: YMM Purchases columns (Memo / Name) and a line it does not understand is flagged, not dropped', () => {
  const pj = crlf([
    '\t\tID#\tAcct#\tAccount Name\tDebit\tCredit\tJob No.\tMemo\tName',
    'PJ\t1/12/2024\tFood Supply for BHOP (Invoice: JJF24-120043)',
    '\t\t00000018\t2-2200\tTrade Creditors\t\t$101.26\t\tFood Supply\tJIAJIAFU Trading Pte Ltd',
    '\t\t00000018\t5-1200\tFood Supply - BHOP\t$101.26\t\t\tFood Supply\tJIAJIAFU Trading Pte Ltd',
    'garbage line',
    '\t\t\t\tGrand Total:\t$101.26\t$101.26',
  ]);
  const j = A.parseJournal(pj, 'PJ');
  assert.equal(j.entries[0].lines[0].card, 'JIAJIAFU Trading Pte Ltd');
  assert.equal(j.entries[0].lines[0].memo, 'Food Supply');
  assert.deepEqual(j.flags.map((f) => f.kind), ['unparsed-line']);
});

test('parseJournal: a mixed-ID entry and a bad amount are flagged', () => {
  const j = A.parseJournal(crlf(['\t\tID#\tAcct#\tAccount Name\tDebit\tCredit', 'CD\t1/1/2024\tX', '\t\tA1\t1-2110\tDBS\t\t$5.00', '\t\tA2\t9-1000\tBank\t$5.00\t', '\t\tA2\t9-1000\tBank\t$x\t', '\t\t\t\tGrand Total:\t$5.00\t$5.00']), 'CD');
  assert.deepEqual(j.flags.map((f) => f.kind), ['mixed-id-in-entry', 'bad-amount']);
});

test('parseAccountsList + parseChartFile: printed order, negative balances, as-at date', () => {
  const t = HDR + crlf(['Accounts List [Summary]', '25/11/2026\tPage 1', '\tAccount\tCurrent Balance', '', '\tAssets\t$1,044,680.81', '\tPayroll Liabilities\t-$39,398.46']);
  const r = A.parseAccountsList(t);
  assert.equal(r.asAt, '2026-11-25');
  assert.deepEqual(r.rows.map((x) => [x.name, x.balance]), [['Assets', 1044680.81], ['Payroll Liabilities', -39398.46]]);
  const chart = A.parseChartFile('# header\n0|1-0000|Assets|543452.52\n2|1-2100|Cash On Hand|-112461.75\n');
  assert.deepEqual(chart[1], { level: 2, code: '1-2100', name: 'Cash On Hand', balance: -112461.75 });
});

test('parseCustomerLedger: brought-forward balance, transactions, closing check', () => {
  const t = crlf([
    'Date\tSrc\tID#\tMemo\tDebit\tCredit\tBalance',
    '',
    'British Essential\r\t\t*None\t\t\t\t$1,800.00',
    '1/9/2022\tCR\tCR000013\tFT; British Essential\r\t\t$1,800.00\t$0.00',
    '',
    '\t\t\tTotal:\t$0.00\t$1,800.00\t$0.00',
    'Able H&P (S) Pte Ltd\t\t*None\t\t\t\t$0.00',
    '19/8/2025\tSJ\t25-071\tWorks\t$3,400.00\t\t$3,400.00',
    '\t\t\tTotal:\t$3,400.00\t$0.00\t$9.99',
  ]);
  const r = A.parseCustomerLedger(t);
  assert.equal(r.cards.length, 2);
  assert.equal(r.cards[0].name, 'British Essential');
  assert.equal(r.cards[0].opening, 1800);
  assert.equal(r.cards[0].closing, 0);
  assert.equal(r.cards[1].closing, 3400);
  assert.deepEqual(r.flags.map((f) => f.kind), ['card-total-mismatch']);
});

test('parseInvoiceTransactions: charges / payments / open per invoice', () => {
  const t = crlf([
    '\tID#\tSrc\tDate\tMemo\tAccount\tCharges\tPayments',
    '',
    '23-032\tR&C Design Solution Pte Ltd\t*None',
    '\t23-032\tSJ\t16/5/2023\tSale; R&C\t1-3100\t$7,500.00',
    '\tCR000114\tCR\t7/8/2023\tUOB320130; R&C\t1-3100\t\t$3,750.00',
    '',
    '\t\t\t\t\t\t$7,500.00\t$3,750.00',
  ]);
  const r = A.parseInvoiceTransactions(t);
  assert.equal(r.invoices[0].no, '23-032');
  assert.equal(r.invoices[0].open, 3750);
  assert.deepEqual(r.invoices[0].txns.map((x) => x.id), ['23-032', 'CR000114']);
  assert.deepEqual(r.flags, []);
});

test('parseClosedInvoices: cards and their paid invoices', () => {
  const t = crlf(['\tID#\tOrig Date\tSale Amount\tTax\tDays Until Paid', '', 'Able H&P (S) Pte Ltd\t*None', '', '\t25-071\t19/8/2025\t$3,400.00\t\t0', '\t25-072\t27/8/2025\t$3,400.00\t\t0', '', '\t\t\t$6,800.00\t$0.00\t0']);
  const r = A.parseClosedInvoices(t);
  assert.equal(r.cards[0].invoices.length, 2);
  assert.deepEqual(r.flags, []);
});

test('parseSupplierPayments: rows per cheque (cards + flat), no-PO rows (historical purchases), totals checked', () => {
  const t = crlf([
    "\tCheque #\tChq Date\tPO #\tDate\tSupplier's Inv. #\tPurchase Total Amt\t\tAmount Applied",
    '',
    'A&G Equipment Pte Ltd',
    '\t03072605\t3/7/2026\t00000504\t18/5/2026\t26/05-162\t$817.50\t\t$817.50',
    '\t03072605\t3/7/2026\t00000505\t17/6/2026\t26/06-144\t$545.00\t\t$545.00',
    '',
    '\t\t\t\t\t\t\tTotal for Payment 03072605:\t$1,362.50',
    'Chem-Gas Pte Ltd',
    '\t05122601\t5/12/2025\t\t\t\t\t\t$8.72',
    '\t\t\t\t\t\t\tTotal for Payment 05122601:\t$8.72',
  ]);
  const r = A.parseSupplierPayments(t);
  assert.equal(r.cards.length, 2);
  assert.deepEqual(r.cards[0].rows.map((x) => [x.po, x.applied]), [['00000504', 817.5], ['00000505', 545]]);
  assert.equal(r.cards[1].rows[0].po, '');
  assert.equal(r.cards[1].rows[0].date, null);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[2].supplier, 'Chem-Gas Pte Ltd');
  assert.deepEqual(r.paymentTotals, [{ supplier: 'A&G Equipment Pte Ltd', cheque: '03072605', total: 1362.5 }, { supplier: 'Chem-Gas Pte Ltd', cheque: '05122601', total: 8.72 }]);
  assert.deepEqual(r.flags, []);
});

test('parseReconciliation: outstanding items, totals and summary per bank account', () => {
  const t = crlf([
    'ID#\tDate\tMemo/Payee\tDeposit\tWithdrawal',
    'Cheque Account:\t1-2111\tOCBC Bank',
    'Date of Bank Statement:\t25/11/2026',
    'Outstanding Cheques',
    '23052501\t23/5/2025\tJashimuddin\t\t$431.53',
    'GJ000228\t6/1/2026\tHenry Loan\t\t$3,000.00',
    '\t\tTotal:\t$0.00\t$3,431.53',
    'Outstanding Deposits',
    'CR000451\t14/7/2026\tFT; KEMSA (Far East) Pte Ltd\r\t$2,700.00',
    '\t\tTotal:\t$2,700.00\t$0.00',
    'Reconciliation',
    '\t\t\tABSS Balance on 25/11/2026:\t$96,165.13',
    '\t\t\tExpected Balance on Statement:\t$80.50',
  ]);
  const r = A.parseReconciliation(t);
  const a = r.accounts[0];
  assert.equal(a.code, '1-2111');
  assert.equal(a.statementDate, '2026-11-25');
  assert.equal(a.outstandingCheques, 3431.53);
  assert.equal(a.outstandingDeposits, 2700);
  assert.equal(a.deposits[0].memo, 'FT; KEMSA (Far East) Pte Ltd');
  assert.equal(a.summary['ABSS Balance on 25/11/2026'], 96165.13);
  assert.deepEqual(r.flags, []);
});

test('memo helpers: POS number, receipt channel', () => {
  assert.equal(A.posNumber('Sales for BHOP (Invoice: 202412010001)'), '202412010001');
  assert.equal(A.posNumber('Sales for BHOP (202610230008)'), '202610230008');
  assert.equal(A.posNumber('Sales for BHOP'), null);
  assert.equal(A.receiptChannel('FT; GrabCar Pte. Ltd'), 'GrabCar');
  assert.equal(A.receiptChannel('Received by Nets Pte Ltd'), 'NETS');
  assert.equal(A.receiptChannel('Payment; Cash Sales'), 'Cash');
  assert.equal(A.receiptChannel('FT; Paynow'), 'PayNow');
  assert.equal(A.receiptChannel('WCT 2025 Loan tf BHOP'), null);
});
