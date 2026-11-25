// node --test scripts/__tests__/abss-reports.test.js  (also run by `npm run test:pushguard`)
const test = require('node:test');
const assert = require('node:assert');
const A = require('../lib/abss-reports');

const HDR = 'WCT Racking Pte Ltd\r\n5 Kaki Bukit Road 2\r\n\r\n';
const crlf = (lines) => lines.join('\r\n') + '\r\n';

test('decode: cp1252 0x92 -> right quote, reported with its line', () => {
  const buf = Buffer.concat([Buffer.from('a\r\nCaptain'), Buffer.from([0x92]), Buffer.from('s Eye\r\n')]);
  const d = A.decode(buf);
  assert.strictEqual(d.text, 'a\r\nCaptain’s Eye\r\n');
  assert.deepStrictEqual(d.oddChars, [{ byte: '0x92', char: '’', line: 2 }]);
});

test('splitLines: CRLF only, stray CR inside a line dropped and counted', () => {
  const l = A.splitLines('SJ\t13/7/2026\tKEMSA (Far East) Pte Ltd\r\r\nx\ty\r\n');
  assert.deepStrictEqual(l.slice(0, 2), ['SJ\t13/7/2026\tKEMSA (Far East) Pte Ltd', 'x\ty']);
  assert.strictEqual(l.strayCr, 1);
});

test('parseMoney / parseDate / nameKey', () => {
  assert.strictEqual(A.parseMoney('$1,234.56'), 1234.56);
  assert.strictEqual(A.parseMoney('-$39,398.46'), -39398.46);
  assert.strictEqual(A.parseMoney('($5.00)'), -5);
  assert.strictEqual(A.parseMoney(''), null);
  assert.throws(() => A.parseMoney('abc'));
  assert.strictEqual(A.parseDate('4/8/2022'), '2022-08-04');
  assert.strictEqual(A.parseDate('Page 1'), null);
  assert.strictEqual(A.nameKey("Captain’s Eye Asia Pte. Ltd."), A.nameKey("Captain's Eye Asia Pte Ltd"));
  assert.strictEqual(A.nameKey('Springfield Supplies & Services'), A.nameKey('Springfield Supplies and Services'));
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
  '\t\t\t\tGrand Total:\t$4,200.00\t$4,200.00',
]);

test('parseJournal: entries, lines, grand total tie, stray CR in the memo', () => {
  const j = A.parseJournal(SJ, 'SJ');
  assert.strictEqual(j.entries.length, 2);
  assert.deepStrictEqual(j.flags, []);
  const [a, b] = j.entries;
  assert.strictEqual(a.id, '22-051');
  assert.strictEqual(a.date, '2022-11-03');
  assert.deepStrictEqual(a.lines.map((l) => [l.code, l.dr, l.cr, l.job]), [['1-3100', 1500, 0, null], ['4-1000', 0, 1500, 'Q22-102']]);
  assert.strictEqual(b.memo, 'Sale; KEMSA (Far East) Pte Ltd');
  assert.strictEqual(j.strayCr, 1);
  assert.deepStrictEqual(j.grandTotal, { dr: 4200, cr: 4200 });
});

test('parseJournal: PJ extra columns, unbalanced entry and grand-total mismatch are flagged', () => {
  const pj = crlf([
    '\t\tID#\tAcct#\tAccount Name\tDebit\tCredit\tJob No.\tLinked Customer\tMemo\tName\tPayee',
    'PJ\t30/9/2022\tPurchase; X',
    '\t\t00000003\t2-2100\tAccounts Payables - SGD\t\t$100.00\t\t\tPurchase; X\tWCT (S) Systems Pte Ltd\tPurchase; X',
    '\t\t00000003\t5-1010\tMaterial Costing\t$90.00\t\t000000\tKEMSA\tMat\tWCT (S) Systems Pte Ltd\tPurchase; X',
    '\t\t\t\tGrand Total:\t$100.00\t$100.00',
  ]);
  const j = A.parseJournal(pj, 'PJ');
  assert.strictEqual(j.entries[0].lines[0].cardName, 'WCT (S) Systems Pte Ltd');
  assert.strictEqual(j.entries[0].lines[1].linkedCustomer, 'KEMSA');
  assert.deepStrictEqual(j.flags.map((f) => f.kind).sort(), ['grand-total-mismatch', 'unbalanced-entry']);
});

test('parseJournal: a line it does not understand is flagged, not dropped silently', () => {
  const j = A.parseJournal(crlf(['\t\tID#\tAcct#', 'CD\t1/1/2024\tX', '\t\tA1\t1-2110\tDBS\t\t$5.00', '\t\tA1\t9-1000\tBank\t$5.00\t', 'garbage line', '\t\t\t\tGrand Total:\t$5.00\t$5.00']), 'CD');
  assert.deepStrictEqual(j.flags.map((f) => f.kind), ['unparsed-line']);
});

test('parseAccountsList: printed order, negative balances, as-at date', () => {
  const t = HDR + crlf(['Accounts List [Summary]', '25/11/2026\tPage 1', '\tAccount\tCurrent Balance', '', '\tAssets\t$1,044,680.81', '\tPayroll Liabilities\t-$39,398.46']);
  const r = A.parseAccountsList(t);
  assert.strictEqual(r.asAt, '2026-11-25');
  assert.deepStrictEqual(r.rows.map((x) => [x.name, x.balance]), [['Assets', 1044680.81], ['Payroll Liabilities', -39398.46]]);
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
  assert.strictEqual(r.cards.length, 2);
  assert.strictEqual(r.cards[0].name, 'British Essential');
  assert.strictEqual(r.cards[0].opening, 1800);
  assert.strictEqual(r.cards[0].closing, 0);
  assert.strictEqual(r.cards[1].closing, 3400);
  assert.deepStrictEqual(r.flags.map((f) => f.kind), ['card-total-mismatch']);
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
  assert.strictEqual(r.invoices[0].no, '23-032');
  assert.strictEqual(r.invoices[0].open, 3750);
  assert.deepStrictEqual(r.invoices[0].txns.map((x) => x.id), ['23-032', 'CR000114']);
  assert.deepStrictEqual(r.flags, []);
});

test('parseClosedInvoices: cards and their paid invoices', () => {
  const t = crlf(['\tID#\tOrig Date\tSale Amount\tTax\tDays Until Paid', '', 'Able H&P (S) Pte Ltd\t*None', '', '\t25-071\t19/8/2025\t$3,400.00\t\t0', '\t25-072\t27/8/2025\t$3,400.00\t\t0', '', '\t\t\t$6,800.00\t$0.00\t0']);
  const r = A.parseClosedInvoices(t);
  assert.strictEqual(r.cards[0].invoices.length, 2);
  assert.deepStrictEqual(r.flags, []);
});

test('parseSupplierPayments: rows per cheque, no-PO rows (historical purchases), totals checked', () => {
  const t = crlf([
    '\tCheque #\tChq Date\tPO #\tDate\tSupplier\'s Inv. #\tPurchase Total Amt\t\tAmount Applied',
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
  assert.strictEqual(r.cards.length, 2);
  assert.deepStrictEqual(r.cards[0].rows.map((x) => [x.po, x.applied]), [['00000504', 817.5], ['00000505', 545]]);
  assert.strictEqual(r.cards[1].rows[0].po, '');
  assert.strictEqual(r.cards[1].rows[0].date, null);
  assert.deepStrictEqual(r.flags, []);
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
  assert.strictEqual(a.code, '1-2111');
  assert.strictEqual(a.statementDate, '2026-11-25');
  assert.strictEqual(a.outstandingCheques, 3431.53);
  assert.strictEqual(a.outstandingDeposits, 2700);
  assert.strictEqual(a.deposits[0].memo, 'FT; KEMSA (Far East) Pte Ltd');
  assert.strictEqual(a.summary['ABSS Balance on 25/11/2026'], 96165.13);
  assert.deepStrictEqual(r.flags, []);
});
