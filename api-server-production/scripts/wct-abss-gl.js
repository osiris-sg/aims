/**
 * WCT GL on its real ABSS chart of accounts (2026-11-06). WCT org only. Three steps, each a dry
 * run by default, `--apply` to write (logged), `--rollback [--apply]` to undo:
 *
 *   coa      import the ABSS "Accounts List [Summary]" as WCT's chart (same codes / names /
 *            hierarchy; headers become non-posting HEADER accounts), point the control roles at
 *            the ABSS accounts, move WCT's existing journal lines + revenue items onto them and
 *            deactivate the old generic accounts that are left without a balance.
 *   post     post the ERP history (scripts/wct-erp-import.js documents + the ERP payment and
 *            credit-note exports) as journals at their document dates. One batch marker
 *            (createdBy), idempotent by journal number, never touches a document, a counter or
 *            the JV-nnnnnn sequence.
 *   cutover  one OPENING_BALANCE journal at the cutover date: every ABSS detail account gets
 *            (ABSS balance − AIMS balance, as AIMS's trial balance shows it at that date), the
 *            offset goes to 3-9999 Historical Balancing.
 *   report   the whole thing simulated in memory against the live data, read-only.
 *
 *   DBURL=… node scripts/wct-abss-gl.js report [--date 2026-11-05]
 *   DBURL=… node scripts/wct-abss-gl.js coa|post|cutover [--apply] [--rollback] [--search-path org_wct,platform,public]
 *
 * Inputs (gitignored, --dir, default ../_imports/wct/erp): abss-coa-<date>.txt (level|code|name|
 * balance as printed, brackets = negative), wct-invoices-full.csv, wct-payments.csv,
 * wct-credit-notes.csv. --balances <file> takes the final ABSS trial balance (same format) for the
 * cutover; --keep 1-3100,… leaves accounts out of the balancing journal.
 */
const { Client, types } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

types.setTypeParser(1114, (v) => `${v.replace(' ', 'T')}Z`); // timestamps stay UTC text
types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(20, (v) => Number(v));

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const args = process.argv.slice(2);
const CMD = args[0];
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const APPLY = args.includes('--apply');
const ROLLBACK = args.includes('--rollback');
const SEARCH_PATH = opt('--search-path', null);
const DIR = path.resolve(opt('--dir', path.resolve(__dirname, '../../_imports/wct/erp')));
const COA_FILE = path.resolve(DIR, opt('--coa', 'abss-coa-2026-11-05.txt'));
const BAL_FILE = path.resolve(DIR, opt('--balances', 'abss-coa-2026-11-05.txt'));
const CUTOVER = opt('--date', '2026-11-05');
const DOC_BATCH = opt('--batch', 'wct-erp-2026-11-05');
const GL_MARK = `erp-gl:${opt('--gl-batch', 'wct-erp-gl-2026-11-06')}`;
const CUT_MARK = `abss-cutover:${CUTOVER}`;
const KEEP = new Set((opt('--keep', '') || '').split(',').filter(Boolean));
const LOG = path.resolve(__dirname, `wct-abss-gl.${CMD}.log.json`);
const R2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/,/g, '')));
const money = (n) => R2(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- ABSS chart

/** Debit-positive class: assets, cost of sales, expenses, other expenses. */
const DEBIT_CLASS = new Set(['1', '5', '6', '9']);
const COMPUTED = '3-9000'; // ABSS Current Year Earnings = the P&L. AIMS computes it; never posted.

function readAbss(file) {
  const rows = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [level, code, name, bal] = l.split('|');
      return { level: Number(level), code: code.trim(), name: name.trim(), balance: R2(num(bal)) };
    });
  const stack = [];
  for (const [i, r] of rows.entries()) {
    while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
    r.parentCode = stack.length ? stack[stack.length - 1].code : null;
    r.isHeader = i + 1 < rows.length && rows[i + 1].level > r.level;
    stack.push(r);
    const cls = r.code[0];
    r.debitBalance = DEBIT_CLASS.has(cls) ? r.balance : -r.balance; // Dr positive, Cr negative
    Object.assign(r, aimsTypeOf(r));
  }
  // Proof the hierarchy was read right: every header prints the sum of its children.
  for (const h of rows.filter((r) => r.isHeader)) {
    const s = R2(rows.filter((r) => r.parentCode === h.code).reduce((a, r) => a + r.balance, 0));
    if (Math.abs(s - h.balance) > 0.005) throw new Error(`ABSS header ${h.code} prints ${h.balance} but its sub-accounts sum to ${s}`);
  }
  const tb = R2(rows.filter((r) => !r.isHeader && r.code !== COMPUTED).reduce((a, r) => a + r.debitBalance, 0));
  if (Math.abs(tb) > 0.005) throw new Error(`ABSS detail accounts do not balance (Dr − Cr = ${tb})`);
  return rows;
}

function aimsTypeOf(r) {
  const c = r.code;
  const cls = c[0];
  const category = ['1', '2', '3'].includes(cls) ? 'BALANCE_SHEET' : 'PNL';
  const normalBalance = DEBIT_CLASS.has(cls) ? 'DEBIT' : 'CREDIT';
  let accountType;
  if (r.isHeader || c === COMPUTED) accountType = 'HEADER';
  else if (c.startsWith('1-13')) accountType = 'INTANGIBLE_ASSET';
  else if (c.startsWith('1-1')) accountType = 'FIXED_ASSET';
  else if (cls === '1') accountType = 'CURRENT_ASSET';
  else if (c.startsWith('2-23')) accountType = 'TAX_LIABILITY';
  else if (cls === '2') accountType = 'CURRENT_LIABILITY';
  else if (c === '3-1100' || c === '3-1200') accountType = 'SHARE_CAPITAL';
  else if (c === '3-8000') accountType = 'RETAINED_PROFIT';
  else if (cls === '3') accountType = 'CAPITAL_RESERVE';
  else if (cls === '4') accountType = 'SALES';
  else if (cls === '5') accountType = 'PURCHASE';
  else if (cls === '6') accountType = 'EXPENSE';
  else if (cls === '8') accountType = 'INCOME';
  else if (c === '9-4000') accountType = 'TAX';
  else accountType = 'EXPENSE';
  return { accountType, category, normalBalance };
}

const CONTROL_FLAGGED = ['debtorControl', 'cashAccount'];
const CONTROLS = {
  debtorControl: '1-3100', // flagged: ABSS names it "Customer Payment"
  creditorControl: '2-2100',
  taxLiabilities: '2-2310', // GST output
  taxInput: '2-2320', // GST input (purchases)
  salesAccount: '4-2000',
  retainedProfits: '3-8000',
  currentYearEarnings: '3-9000',
  historicalBalancing: '3-9999',
  shareCapitals: '3-1100',
  dividends: '3-1200',
  bankAccount: '1-2101',
  cashAccount: '1-2102', // flagged
  fxGainLoss: '8-4000',
};
const CONTROL_ACCOUNT_CODES = new Set(['1-3100', '2-2100', '2-2310', '2-2320']);
const CODE_RANGES = {
  sales: { from: '4-0000', to: '4-9999' },
  purchase: { from: '5-0000', to: '5-9999' },
  income: { from: '8-0000', to: '8-9999' },
  expenses: { from: '6-0000', to: '9-9999' },
  tax: { from: '9-4000', to: '9-4000' },
  fixedAssets: { from: '1-1000', to: '1-1999' },
  intangibleAssets: { from: '1-1300', to: '1-1399' },
  currentAssets: { from: '1-2000', to: '1-4999' },
  currentLiabilities: { from: '2-0000', to: '2-9999' },
  taxLiabilities: { from: '2-2300', to: '2-2399' },
  shareCapitals: { from: '3-1000', to: '3-1999' },
  retainedProfits: { from: '3-8000', to: '3-8000' },
  capitalReserve: { from: '3-9999', to: '3-9999' },
};

// WCT's existing generic accounts → their ABSS equivalent (control roles from the brief, the rest
// by name). Used to move existing journal lines / revenue items, and shown in the mapping table.
const OLD_TO_ABSS = {
  CA001: ['1-3100', 'control'], CL001: ['2-2100', 'control'], CL900: ['2-2310', 'control (2-2320 on purchase-side journals)'],
  SS001: ['4-2000', 'control (default sales)'], RTPL: ['3-8000', 'control'],
  SS002: ['4-1000', 'name'], SS003: ['4-3000', 'name'], SS004: ['4-2000', 'name'], SS005: ['4-3500', 'name'],
  CS002: ['5-1030', 'name'], CS003: ['5-1040', 'name'], CS004: ['5-1020', 'name'], CS005: ['5-1050', 'name'],
  CA100: ['1-2107', 'name'], CA101: ['1-2140', 'name'], CA102: ['1-2145', 'name'], CA103: ['1-2146', 'name'],
  CA104: ['1-2160', 'name'], CA105: ['1-2192', 'name'], CL101: ['2-2450', 'name'], CL102: ['2-2440', 'name'],
  CL103: ['2-2460', 'name'], IC001: ['8-2000', 'name'], IC002: ['8-1000', 'name'], TX001: ['9-4000', 'name'],
  EX070: ['8-4000', 'name'], EX221: ['6-2920', 'name'], EX222: ['6-1200', 'name'], EX325: ['6-1005', 'name'],
  EX326: ['6-1070', 'name'], EX327: ['6-6020', 'name'], EX321: ['6-6010', 'name'], EX322: ['6-6090', 'name'],
  EX324: ['6-6030', 'name'], EX311: ['5-5100', 'name'], EX312: ['5-5200', 'name'], EX301: ['5-4100', 'name'],
  EX101: ['5-2100', 'name'], EX102: ['5-2110', 'name'], EX103: ['5-2120', 'name'], EX104: ['6-2100', 'name'],
  EX105: ['6-2120', 'name'], EX106: ['6-2130', 'name'], EX006: ['5-2200', 'name'], EX206: ['6-2400', 'name'],
  EX003: ['5-2500', 'name'], EX203: ['6-2500', 'name'], EX002: ['5-2400', 'name'], EX202: ['6-2700', 'name'],
  EX005: ['5-2700', 'name'], EX004: ['5-2610', 'name'], SC001: ['3-1100', 'name'], DV001: ['3-1200', 'name'],
};
const PURCHASE_SIDE = new Set(['BILL', 'PURCHASE', 'PURCHASE_ORDER', 'PURCHASE_RETURN', 'DEBIT_NOTE', 'PAYMENT_VOUCHER']);
const abssFor = (oldCode, journalType) =>
  oldCode === 'CL900' && PURCHASE_SIDE.has(journalType) ? '2-2320' : OLD_TO_ABSS[oldCode]?.[0] || null;

// ---------------------------------------------------------------- ERP history

const BANKS = { 'DBS 1079030866': '1-2101', 'DBS 0299029037': '1-2110', 'UOB 3923073157': '1-2111', 'OCBC 604566752001': '1-2107' };
function bankFor(p) {
  if (p.method === 'Contra') return { code: '1-2198', rule: 'Contra' };
  if (p.method === 'Cash') return { code: '1-2102', rule: 'Cash (flag)', flag: true };
  if (!p.bank_account) return { code: '1-2101', rule: `${p.method}, no bank → 1-2101`, flag: p.method !== 'Cheque' };
  const code = BANKS[p.bank_account];
  if (!code) return { code: '1-2101', rule: `unknown bank ${p.bank_account} → 1-2101`, flag: true };
  return { code, rule: p.bank_account };
}

const REVENUE = { CD: '4-2000', AA: '4-3000', MV: '4-1000', TS: '4-3500' };
const TAG_CODE = { cd: 'CD', macd: 'CD', 'a&a': 'AA', aa: 'AA', vo: 'AA', mv: 'MV', acmv: 'MV', ts: 'TS' };
const KEYWORDS = [
  ['CD', /chemical\s*degreas|\bmacd\b|\bcd\b|degreas/],
  ['AA', /\ba\s*&\s*a\b|\baa\b|\bvo\b|variation|addition(s)?\s*(and|&)\s*alteration/],
  ['MV', /\bacmv\b|\bmv\s*system|\bnew\s+system|\bmv\b|mechanical\s*ventilation/],
  ['TS', /air\s*-?\s*con(ditioner|ditioning)?\b|aircon|\bts\b/],
];
const CD_INFERRED = /kitchen\s*exhaust|exhaust\s*(hood|system|duct|fan)|air\s*cleaner|\besp\b|hood|duct/;

/** Revenue bucket of an invoice from its subject: { key, code, rule }. Prefix tags like "(NG)" are ignored. */
function revenueBucket(subject) {
  let s = String(subject || '').trim();
  const tags = [];
  let m;
  while ((m = s.match(/^\(([^)]*)\)\s*/))) {
    tags.push(m[1].trim().toLowerCase());
    s = s.slice(m[0].length);
  }
  const lead = s.match(/^([A-Za-z&+/ ]{1,12}?)\s*[-:]\s/);
  if (lead) {
    const key = lead[1].split(/[+/]/).map((t) => TAG_CODE[t.trim().toLowerCase()]).find(Boolean);
    if (key) return { key, code: REVENUE[key], rule: 'leading code' };
  }
  const t = s.toLowerCase();
  let best = null;
  for (const [key, re] of KEYWORDS) {
    const i = t.search(re);
    if (i >= 0 && (!best || i < best.i)) best = { key, i };
  }
  if (best) return { key: best.key, code: REVENUE[best.key], rule: 'keyword' };
  if (CD_INFERRED.test(t)) return { key: 'CD', code: REVENUE.CD, rule: 'inferred (kitchen exhaust / hood / duct / air cleaner)' };
  const tag = tags.map((x) => TAG_CODE[x]).find(Boolean);
  if (tag) return { key: tag, code: REVENUE[tag], rule: 'prefix tag only' };
  return { key: 'UNCLEAR', code: REVENUE.CD, rule: 'unclear → 4-2000', flag: true };
}

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** The ERP history as journals (ABSS codes). Pure: needs the imported invoices' ids by number. */
function buildHistory(docs) {
  const inv = readCsv(path.join(DIR, 'wct-invoices-full.csv'));
  const pay = readCsv(path.join(DIR, 'wct-payments.csv'));
  const cns = readCsv(path.join(DIR, 'wct-credit-notes.csv'));
  const journals = [];
  const skipped = [];
  const flags = [];
  const buckets = {};
  const invBucket = new Map();
  const gross = new Map();
  const at = (d) => `${d}T00:00:00.000Z`;

  for (const r of inv) {
    const doc = docs.get(r.invoice_no);
    if (!doc) { skipped.push({ kind: 'invoice', no: r.invoice_no, why: `not imported (ERP status ${r.status})`, amount: num(r.total) }); continue; }
    const total = R2(num(r.total));
    const gst = R2(num(r.gst_amount));
    const net = R2(num(r.subtotal) - num(r.discount));
    const b = revenueBucket(r.subject);
    invBucket.set(r.invoice_no, b);
    gross.set(r.invoice_no, total);
    if (Math.abs(doc.total - total) > 0.005) flags.push({ kind: 'invoice', no: r.invoice_no, note: `AIMS total ${doc.total} ≠ ERP ${total}` });
    if (total === 0) { skipped.push({ kind: 'invoice', no: r.invoice_no, why: 'zero total', amount: 0 }); continue; }
    const revenue = R2(total - gst);
    if (Math.abs(revenue - net) > 0.005) flags.push({ kind: 'invoice', no: r.invoice_no, note: `subtotal − discount ${net} + GST ${gst} ≠ total ${total}; revenue posted as total − GST ${revenue}` });
    const k = `${b.code} ${b.key} · ${b.rule}`;
    buckets[k] = buckets[k] || { code: b.code, key: b.key, rule: b.rule, n: 0, amount: 0, samples: [] };
    buckets[k].n++;
    buckets[k].amount = R2(buckets[k].amount + revenue);
    if (buckets[k].samples.length < (b.flag ? 25 : 3)) buckets[k].samples.push(`${r.invoice_no} ${r.subject.replace(/\s+/g, ' ').slice(0, 90)}`);
    journals.push({
      number: `ERP-INV-${r.invoice_no}`, type: 'INVOICE', date: at(r.date), docId: doc.id, reference: r.invoice_no,
      description: `ERP invoice ${r.invoice_no} · ${r.customer}`.slice(0, 250), bucket: b.key,
      lines: [
        { code: '1-3100', dr: total, cr: 0 },
        { code: b.code, dr: 0, cr: revenue },
        ...(gst ? [{ code: '2-2310', dr: gst < 0 ? -gst : 0, cr: gst > 0 ? gst : 0 }] : []),
      ],
    });
  }

  const cnByReceipt = new Set(cns.map((c) => c.refund_receipt).filter(Boolean));
  const seq = new Map();
  for (const p of pay) {
    const amount = R2(num(p.amount));
    if (p.method === 'Other' && !p.bank_account && cnByReceipt.has(p.receipt_no)) continue; // an applied credit note: posted below
    const doc = docs.get(p.invoice_no);
    if (!doc) { skipped.push({ kind: 'payment', no: `${p.invoice_no} #${p.payment_no_on_invoice}`, why: 'its invoice was not imported (ERP Draft / Cancelled)', amount }); continue; }
    if (!amount) { skipped.push({ kind: 'payment', no: `${p.invoice_no} #${p.payment_no_on_invoice}`, why: 'zero amount', amount }); continue; }
    const bank = p.method === 'Other' ? { code: BANKS[p.bank_account] || '1-2101', rule: `Other with bank ${p.bank_account} (not a credit note)`, flag: true } : bankFor(p);
    if (bank.flag) flags.push({ kind: 'payment', no: `${p.invoice_no} ${p.receipt_no}`, note: `${p.method} ${amount} → ${bank.code} (${bank.rule})` });
    const key = `${p.invoice_no}-${p.payment_no_on_invoice}`;
    const n = (seq.get(key) || 0) + 1;
    seq.set(key, n);
    journals.push({
      number: `ERP-PAY-${key}${n > 1 ? `-${n}` : ''}`, type: 'PAYMENT', date: at(p.date), docId: doc.id, reference: p.receipt_no || p.invoice_no,
      description: `ERP receipt ${p.receipt_no} · ${p.invoice_no} · ${p.method}${p.cheque_no ? ` ${p.cheque_no}` : ''}`.slice(0, 250), bank: bank.code,
      lines: amount > 0
        ? [{ code: bank.code, dr: amount, cr: 0 }, { code: '1-3100', dr: 0, cr: amount }]
        : [{ code: '1-3100', dr: -amount, cr: 0 }, { code: bank.code, dr: 0, cr: -amount }],
    });
  }

  for (const c of cns) {
    const total = R2(num(c.total));
    const gst = R2(num(c.gst_amount));
    if (!docs.get(c.invoice_no) || !gross.has(c.invoice_no)) { skipped.push({ kind: 'credit note', no: c.credit_note_no, why: `invoice "${c.invoice_no || '—'}" not posted (${c.invoice_status}, ${c.status})`, amount: total }); continue; }
    if (!total) { skipped.push({ kind: 'credit note', no: c.credit_note_no, why: 'zero total', amount: 0 }); continue; }
    const reason = (c.reason || '').trim();
    let lines;
    let rule;
    if (/^discount$/i.test(reason)) {
      rule = 'Discount → 5-9999';
      lines = [{ code: '5-9999', dr: R2(total - gst), cr: 0 }, ...(gst ? [{ code: '2-2310', dr: gst, cr: 0 }] : []), { code: '1-3100', dr: 0, cr: total }];
    } else if (/^bad debt$/i.test(reason)) {
      rule = 'Bad Debt → 1-3150 (flag)';
      lines = [{ code: '1-3150', dr: total, cr: 0 }, { code: '1-3100', dr: 0, cr: total }];
      flags.push({ kind: 'credit note', no: c.credit_note_no, note: `Bad Debt ${total} → Dr 1-3150 (GST ${gst} not reversed)` });
    } else {
      const b = invBucket.get(c.invoice_no);
      rule = `${reason || '(no reason)'} → invoice revenue ${b.code}`;
      lines = [{ code: b.code, dr: R2(total - gst), cr: 0 }, ...(gst ? [{ code: '2-2310', dr: gst, cr: 0 }] : []), { code: '1-3100', dr: 0, cr: total }];
    }
    journals.push({
      number: `ERP-CN-${c.credit_note_no}`, type: 'CREDIT_NOTE', date: at(c.date), docId: null, reference: c.credit_note_no,
      description: `ERP credit note ${c.credit_note_no} on ${c.invoice_no} · ${reason || 'no reason'} · ${c.customer}`.slice(0, 250), cnRule: rule,
      lines,
    });
  }
  for (const j of journals) {
    j.lines = j.lines.filter((l) => l.dr || l.cr);
    const dr = R2(j.lines.reduce((a, l) => a + l.dr, 0));
    const cr = R2(j.lines.reduce((a, l) => a + l.cr, 0));
    if (dr !== cr) throw new Error(`${j.number} does not balance (${dr} / ${cr})`);
    j.total = dr;
  }
  return { journals, skipped, flags, buckets };
}

// ---------------------------------------------------------------- AIMS trial balance

function fyStartOf(asOf, endMonth, endDay) {
  const d = new Date(asOf);
  const y = d.getUTCFullYear();
  let start = new Date(Date.UTC(y - 1, endMonth - 1, endDay + 1));
  const next = new Date(Date.UTC(y, endMonth - 1, endDay + 1));
  if (d >= next) start = next;
  return start.toISOString();
}

/**
 * Balances (Dr positive) the way AIMS's trial balance shows them at `asOf` (journal.service
 * trialBalance): balance-sheet accounts cumulative, P&L accounts the current financial year only,
 * earlier years' P&L rolled into the retained-earnings account.
 */
function trialBalance(postings, asOf, fy, reCode) {
  const end = Date.parse(`${asOf}T23:59:59.999Z`);
  const start = Date.parse(fyStartOf(`${asOf}T00:00:00Z`, fy.month, fy.day));
  const bal = new Map();
  let prior = 0;
  for (const p of postings) {
    const t = Date.parse(p.date);
    if (t > end) continue;
    const v = R2(p.dr - p.cr);
    if (p.category === 'PNL' && t < start) { prior = R2(prior + v); continue; }
    bal.set(p.code, R2((bal.get(p.code) || 0) + v));
  }
  if (prior) bal.set(reCode, R2((bal.get(reCode) || 0) + prior));
  return bal;
}

// ---------------------------------------------------------------- DB

async function connect() {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  if (SEARCH_PATH) await c.query(`SET search_path TO ${SEARCH_PATH.split(',').map((s) => `"${s.trim()}"`).join(',')}`);
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  return { c, q };
}

async function loadState(q) {
  const accounts = await q(`SELECT id, code, name, "accountType", category, "normalBalance", "isActive", "isSystem", "isControlAccount", "parentAccountId", description FROM "ChartOfAccount" WHERE "organizationId" = $1 ORDER BY code`, [WCT]);
  const setting = (await q(`SELECT "controlAccounts", "accountCodeRanges", "fiscalYearEndDay" d, "fiscalYearEndMonth" m, "lockedThroughDate", "nextNumbers" FROM "AccountingSetting" WHERE "organizationId" = $1`, [WCT]))[0];
  const lines = await q(
    `SELECT l.id, l."accountId", l.debit, l.credit, j.id jid, j."journalNumber", j.type, j.status, j."entryDate", j."createdBy", a.code, a.category
       FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id = l."journalEntryId" JOIN "ChartOfAccount" a ON a.id = l."accountId"
      WHERE j."organizationId" = $1`, [WCT]);
  const docs = new Map(
    (await q(
      `SELECT id, name, COALESCE((config->>'totalWithTax')::numeric, (config->>'xeroGross')::numeric, 0) total
         FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE' AND config->'erpImport'->>'batch' = $2`, [WCT, DOC_BATCH]))
      .map((d) => [d.name, { id: d.id, total: R2(d.total) }]),
  );
  const open = (await q(
    `SELECT count(*)::int n, COALESCE(sum(COALESCE((config->>'outstandingBalance')::numeric, (config->>'xeroBalance')::numeric)), 0) owed
       FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE' AND config ? 'erpImport' AND status = 'pending_payment'`, [WCT]))[0];
  const jvMax = (await q(`SELECT MAX(CAST(SUBSTRING("journalNumber" FROM 4) AS BIGINT)) m FROM "JournalEntry" WHERE "organizationId" = $1 AND "journalNumber" ~ '^JV-[0-9]+$'`, [WCT]))[0].m;
  return { accounts, setting, lines, docs, open: { n: open.n, owed: R2(open.owed) }, jvMax };
}

const fingerprint = (s) =>
  crypto.createHash('sha1').update(JSON.stringify({
    accounts: s.accounts.map((a) => [a.id, a.code, a.name, a.accountType, a.isActive, a.parentAccountId]),
    controls: s.setting?.controlAccounts, ranges: s.setting?.accountCodeRanges,
    lines: s.lines.map((l) => [l.id, l.accountId, l.debit, l.credit]).sort(),
  })).digest('hex').slice(0, 12);

function writeLog(entry) {
  const all = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
  all.push(entry);
  fs.writeFileSync(LOG, JSON.stringify(all, null, 1));
  console.log(`logged → ${path.relative(process.cwd(), LOG)}`);
}

// ---------------------------------------------------------------- step: coa

function planCoa(abss, state) {
  const byCode = new Map(state.accounts.map((a) => [a.code, a]));
  const clash = abss.filter((r) => byCode.has(r.code) && !byCode.get(r.code).description?.startsWith('ABSS'));
  if (clash.length) throw new Error(`ABSS codes already used by other accounts: ${clash.map((r) => r.code).join(', ')}`);
  const already = abss.every((r) => byCode.has(r.code));
  const posted = new Map();
  for (const l of state.lines) if (l.status === 'POSTED') posted.set(l.code, R2((posted.get(l.code) || 0) + l.debit - l.credit));
  const moves = [];
  const unmapped = [];
  for (const l of state.lines) {
    if (abss.some((r) => r.code === l.code)) continue;
    const to = abssFor(l.code, l.type);
    if (to) moves.push({ lineId: l.id, journal: l.journalNumber, status: l.status, from: l.code, fromId: l.accountId, to, dr: l.debit, cr: l.credit });
    else unmapped.push({ journal: l.journalNumber, status: l.status, type: l.type, code: l.code, dr: l.debit, cr: l.credit });
  }
  const stuck = new Set(unmapped.map((u) => u.code));
  const old = state.accounts
    .filter((a) => !abss.some((r) => r.code === a.code))
    .map((a) => {
      const to = OLD_TO_ABSS[a.code];
      const bal = R2(posted.get(a.code) || 0);
      return {
        code: a.code, name: a.name, active: a.isActive, balance: bal, to: to?.[0] || '', basis: to?.[1] || '',
        action: stuck.has(a.code) ? 'KEEP: has journal lines with no ABSS equivalent' : a.isActive ? 'deactivate' : 'already inactive',
      };
    });
  return { already, moves, unmapped, old };
}

async function stepCoa() {
  const abss = readAbss(COA_FILE);
  const { c, q } = await connect();
  const state = await loadState(q);
  if (!state.setting) throw new Error('WCT has no AccountingSetting row');
  if (ROLLBACK) return rollbackCoa(c, q, state);
  const plan = planCoa(abss, state);
  console.log(`ABSS chart: ${abss.length} accounts (${abss.filter((r) => r.isHeader).length} headers, ${abss.filter((r) => !r.isHeader).length} detail) · header sums and Dr = Cr verified`);
  console.log(`WCT now: ${state.accounts.length} accounts, ${state.lines.length} journal lines, fingerprint ${fingerprint(state)}`);
  if (plan.already) console.log('ABSS accounts already present: nothing to create');
  console.log('\nControl roles →'); console.table(Object.entries(CONTROLS).map(([k, v]) => ({ role: k, from: state.setting.controlAccounts?.[k] ?? '', to: v, flag: CONTROL_FLAGGED.includes(k) ? 'confirm' : '' })));
  console.log('Journal lines moved:'); console.table(plan.moves.map(({ lineId, fromId, ...m }) => m));
  if (plan.unmapped.length) { console.log('NOT mappable (left on their old account):'); console.table(plan.unmapped); }
  console.log('Old accounts:'); console.table(plan.old);
  const revItems = await q(`SELECT id, name, "accountCode", "accountId" FROM "RevenueItem" WHERE "organizationId" = $1`, [WCT]);
  const memories = await q(`SELECT id, "accountCode", "accountId" FROM "AccountMemory" WHERE "organizationId" = $1`, [WCT]);
  const remap = (code) => OLD_TO_ABSS[code]?.[0] || null;
  console.log(`Revenue items: ${revItems.length} (${revItems.filter((r) => remap(r.accountCode)).length} remapped) · account memories: ${memories.length} (${memories.filter((m) => remap(m.accountCode)).length} remapped)`);
  if (!APPLY) { await c.end(); return; }
  if (plan.already) throw new Error('ABSS accounts already exist: roll back first');

  await c.query('BEGIN');
  try {
    const ids = new Map(abss.map((r) => [r.code, crypto.randomUUID()]));
    for (const r of abss) {
      await c.query(
        `INSERT INTO "ChartOfAccount" (id, "organizationId", code, name, description, "accountType", category, "normalBalance", "isControlAccount", "isSystem", "isActive", "parentAccountId", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,true,$10,now(),now())`,
        [ids.get(r.code), WCT, r.code, r.name, r.code === COMPUTED ? 'ABSS · computed by AIMS from the P&L, never posted to' : r.isHeader ? 'ABSS header · totals its sub-accounts, never posted to' : 'ABSS', r.accountType, r.category, r.normalBalance, CONTROL_ACCOUNT_CODES.has(r.code), r.parentCode ? ids.get(r.parentCode) : null],
      );
    }
    for (const m of plan.moves) {
      const u = await c.query(`UPDATE "JournalEntryLine" SET "accountId" = $1 WHERE id = $2 AND "accountId" = $3`, [ids.get(m.to), m.lineId, m.fromId]);
      if (u.rowCount !== 1) throw new Error(`line ${m.lineId} not moved`);
    }
    const revMoves = [];
    for (const r of revItems) {
      const to = remap(r.accountCode);
      if (!to) continue;
      await c.query(`UPDATE "RevenueItem" SET "accountCode" = $1, "accountId" = $2, "updatedAt" = now() WHERE id = $3`, [to, ids.get(to), r.id]);
      revMoves.push(r);
    }
    const memMoves = [];
    for (const m of memories) {
      const to = remap(m.accountCode);
      if (!to) continue;
      await c.query(`UPDATE "AccountMemory" SET "accountCode" = $1, "accountId" = $2 WHERE id = $3`, [to, ids.get(to), m.id]);
      memMoves.push(m);
    }
    const deact = state.accounts.filter((a) => a.isActive && plan.old.find((o) => o.code === a.code)?.action === 'deactivate');
    if (deact.length) await c.query(`UPDATE "ChartOfAccount" SET "isActive" = false, "updatedAt" = now() WHERE id = ANY($1::text[]) AND "organizationId" = $2`, [deact.map((a) => a.id), WCT]);
    const controls = { ...(state.setting.controlAccounts || {}) };
    for (const k of ['provisionForDepreciation', 'capitalReserve', 'mediumTermLiabilities', 'longTermLiabilities', 'foreignBankAccount', 'workInProgress']) delete controls[k];
    Object.assign(controls, CONTROLS);
    await c.query(`UPDATE "AccountingSetting" SET "controlAccounts" = $1, "accountCodeRanges" = $2, "updatedAt" = now() WHERE "organizationId" = $3`, [controls, CODE_RANGES, WCT]);
    const after = await loadState(q);
    if (after.jvMax !== state.jvMax) throw new Error('journal counter moved');
    await c.query('COMMIT');
    writeLog({
      at: new Date().toISOString(), step: 'coa', mode: 'APPLY', searchPath: SEARCH_PATH, before: fingerprint(state), after: fingerprint(after),
      created: [...ids.entries()].map(([code, id]) => ({ code, id })),
      lineMoves: plan.moves.map((m) => ({ lineId: m.lineId, fromId: m.fromId, to: m.to })),
      revenueItems: revMoves.map((r) => ({ id: r.id, accountCode: r.accountCode, accountId: r.accountId })),
      accountMemories: memMoves.map((m) => ({ id: m.id, accountCode: m.accountCode, accountId: m.accountId })),
      deactivated: deact.map((a) => a.id),
      previousControls: state.setting.controlAccounts, previousRanges: state.setting.accountCodeRanges,
    });
    console.log(`APPLIED: ${ids.size} ABSS accounts, ${plan.moves.length} lines moved, ${revMoves.length} revenue items, ${memMoves.length} memories, ${deact.length} old accounts deactivated · fingerprint ${fingerprint(state)} → ${fingerprint(after)}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

async function rollbackCoa(c, q, state) {
  const log = (fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : []).filter((e) => e.step === 'coa' && e.mode === 'APPLY' && (e.searchPath || null) === SEARCH_PATH).pop();
  if (!log) throw new Error(`no coa APPLY entry in ${LOG} for this database`);
  const created = log.created.map((x) => x.id);
  const moved = new Set(log.lineMoves.map((m) => m.lineId));
  const other = (await q(`SELECT count(*)::int n FROM "JournalEntryLine" WHERE "accountId" = ANY($1::text[]) AND NOT (id = ANY($2::text[]))`, [created, [...moved]]))[0].n;
  const refs = (await q(
    `SELECT (SELECT count(*) FROM "BankStatementImport" WHERE "bankAccountId" = ANY($1::text[]))::int imports,
            (SELECT count(*) FROM "Budget" WHERE "accountId" = ANY($1::text[]))::int budgets,
            (SELECT count(*) FROM "RevenueItem" WHERE "accountId" = ANY($1::text[]) AND NOT (id = ANY($2::text[])))::int items`,
    [created, log.revenueItems.map((r) => r.id)]))[0];
  console.log(`rollback of coa applied ${log.at}: ${created.length} ABSS accounts, ${moved.size} lines back, ${log.revenueItems.length} revenue items, ${log.accountMemories.length} memories, ${log.deactivated.length} reactivated`);
  console.log(`other journal lines on ABSS accounts: ${other} · bank imports ${refs.imports} · budgets ${refs.budgets} · other revenue items ${refs.items}`);
  if (other || refs.imports || refs.budgets || refs.items) throw new Error('the ABSS accounts are in use (roll back cutover / post first, or move these by hand)');
  if (!APPLY) { await c.end(); return; }
  await c.query('BEGIN');
  try {
    for (const m of log.lineMoves) {
      const u = await c.query(`UPDATE "JournalEntryLine" SET "accountId" = $1 WHERE id = $2`, [m.fromId, m.lineId]);
      if (u.rowCount !== 1) throw new Error(`line ${m.lineId} not restored`);
    }
    for (const r of log.revenueItems) await c.query(`UPDATE "RevenueItem" SET "accountCode" = $1, "accountId" = $2, "updatedAt" = now() WHERE id = $3`, [r.accountCode, r.accountId, r.id]);
    for (const m of log.accountMemories) await c.query(`UPDATE "AccountMemory" SET "accountCode" = $1, "accountId" = $2 WHERE id = $3`, [m.accountCode, m.accountId, m.id]);
    if (log.deactivated.length) await c.query(`UPDATE "ChartOfAccount" SET "isActive" = true, "updatedAt" = now() WHERE id = ANY($1::text[]) AND "organizationId" = $2`, [log.deactivated, WCT]);
    await c.query(`UPDATE "AccountingSetting" SET "controlAccounts" = $1, "accountCodeRanges" = $2, "updatedAt" = now() WHERE "organizationId" = $3`, [log.previousControls, log.previousRanges, WCT]);
    await c.query(`UPDATE "ChartOfAccount" SET "parentAccountId" = NULL WHERE id = ANY($1::text[])`, [created]);
    const d = await c.query(`DELETE FROM "ChartOfAccount" WHERE id = ANY($1::text[]) AND "organizationId" = $2`, [created, WCT]);
    if (d.rowCount !== created.length) throw new Error(`deleted ${d.rowCount} of ${created.length} ABSS accounts`);
    const after = await loadState(q);
    await c.query('COMMIT');
    const ok = fingerprint(after) === log.before;
    writeLog({ at: new Date().toISOString(), step: 'coa', mode: 'ROLLBACK', searchPath: SEARCH_PATH, of: log.at, fingerprint: fingerprint(after), restoredToBefore: ok });
    console.log(`ROLLED BACK · fingerprint ${fingerprint(after)} ${ok ? '= before the apply' : `≠ before (${log.before})`}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------- step: post

function summarise(journals) {
  const byTypeYear = {};
  for (const j of journals) {
    const k = `${j.type} ${j.date.slice(0, 4)}`;
    byTypeYear[k] = byTypeYear[k] || { type: j.type, year: j.date.slice(0, 4), journals: 0, amount: 0 };
    byTypeYear[k].journals++;
    byTypeYear[k].amount = R2(byTypeYear[k].amount + j.total);
  }
  return Object.values(byTypeYear).sort((a, b) => a.type.localeCompare(b.type) || a.year.localeCompare(b.year));
}

async function stepPost() {
  const { c, q } = await connect();
  const state = await loadState(q);
  if (ROLLBACK) return rollbackMarked(c, q, state, GL_MARK, 'post');
  const ids = new Map(state.accounts.filter((a) => a.isActive).map((a) => [a.code, a]));
  const hist = buildHistory(state.docs);
  const missing = [...new Set(hist.journals.flatMap((j) => j.lines.map((l) => l.code)))].filter((code) => !ids.has(code) || ids.get(code).accountType === 'HEADER');
  console.log(`imported invoices found: ${state.docs.size} · journals planned ${hist.journals.length} · skipped ${hist.skipped.length} · flags ${hist.flags.length}`);
  console.table(summarise(hist.journals));
  if (missing.length) throw new Error(`accounts missing or not postable: ${missing.join(', ')} (run coa --apply first)`);
  const existing = new Set((await q(`SELECT "journalNumber" FROM "JournalEntry" WHERE "organizationId" = $1 AND "journalNumber" LIKE 'ERP-%'`, [WCT])).map((r) => r.journalNumber));
  const todo = hist.journals.filter((j) => !existing.has(j.number));
  console.log(`already posted ${hist.journals.length - todo.length} · to post ${todo.length} · open imported invoices ${state.open.n}, owed ${money(state.open.owed)}`);
  if (!APPLY) { await c.end(); return; }
  const now = new Date().toISOString();
  let done = 0;
  for (let i = 0; i < todo.length; i += 500) {
    const chunk = todo.slice(i, i + 500);
    await c.query('BEGIN');
    try {
      const je = [];
      const jl = [];
      for (const j of chunk) {
        const id = crypto.randomUUID();
        je.push([id, WCT, j.number, j.date, j.type, 'POSTED', false, j.reference, j.description, j.total, j.total, 'SGD', j.docId, now, 'erp-gl', now, now, GL_MARK]);
        j.lines.forEach((l, n) => jl.push([crypto.randomUUID(), id, ids.get(l.code).id, n + 1, null, l.dr, l.cr]));
      }
      await insertRows(c, 'JournalEntry', ['id', 'organizationId', 'journalNumber', 'entryDate', 'type', 'status', 'isUnconfirmed', 'reference', 'description', 'totalDebit', 'totalCredit', 'currency', 'sourceDocumentId', 'postedAt', 'postedBy', 'createdAt', 'updatedAt', 'createdBy'], je);
      await insertRows(c, 'JournalEntryLine', ['id', 'journalEntryId', 'accountId', 'lineNumber', 'description', 'debit', 'credit'], jl);
      await c.query('COMMIT');
      done += chunk.length;
      process.stdout.write(`\r  posted ${done}/${todo.length}`);
    } catch (e) {
      await c.query('ROLLBACK');
      console.log(`\nbatch at ${i} rolled back; ${done} journals stay posted (re-run continues)`);
      await c.end();
      throw e;
    }
  }
  console.log('');
  const after = await loadState(q);
  const tb = await q(`SELECT round(sum(l.debit)::numeric,2) dr, round(sum(l.credit)::numeric,2) cr, count(DISTINCT j.id)::int n FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id = l."journalEntryId" WHERE j."organizationId" = $1 AND j."createdBy" = $2`, [WCT, GL_MARK]);
  writeLog({ at: now, step: 'post', mode: 'APPLY', searchPath: SEARCH_PATH, marker: GL_MARK, posted: done, total: tb[0], openBefore: state.open, openAfter: after.open, jvMax: [state.jvMax, after.jvMax] });
  console.log(`APPLIED ${done} journals · marker ${GL_MARK} · Dr ${money(tb[0].dr)} Cr ${money(tb[0].cr)} · open invoices ${after.open.n} owed ${money(after.open.owed)} (before ${money(state.open.owed)}) · JV counter ${state.jvMax} → ${after.jvMax}`);
  await c.end();
}

async function insertRows(c, table, cols, rows) {
  if (!rows.length) return;
  const casts = { entryDate: '::timestamp', postedAt: '::timestamp', createdAt: '::timestamp', updatedAt: '::timestamp' };
  const params = [];
  const values = rows.map((r) => `(${r.map((v, k) => { params.push(v); return `$${params.length}${casts[cols[k]] || ''}`; }).join(',')})`);
  await c.query(`INSERT INTO "${table}" (${cols.map((x) => `"${x}"`).join(',')}) VALUES ${values.join(',')}`, params);
}

async function rollbackMarked(c, q, state, marker, step) {
  const n = (await q(`SELECT count(*)::int n, COALESCE(round(sum("totalDebit")::numeric,2),0) amount FROM "JournalEntry" WHERE "organizationId" = $1 AND "createdBy" = $2`, [WCT, marker]))[0];
  console.log(`rollback ${step}: ${n.n} journals with marker ${marker} (Dr ${money(n.amount)})`);
  if (!APPLY) { await c.end(); return; }
  await c.query('BEGIN');
  try {
    const d = await c.query(`DELETE FROM "JournalEntry" WHERE "organizationId" = $1 AND "createdBy" = $2`, [WCT, marker]);
    if (d.rowCount !== n.n) throw new Error(`deleted ${d.rowCount}, expected ${n.n}`);
    const after = await loadState(q);
    await c.query('COMMIT');
    writeLog({ at: new Date().toISOString(), step, mode: 'ROLLBACK', searchPath: SEARCH_PATH, marker, deleted: d.rowCount, open: after.open, jvMax: after.jvMax });
    console.log(`ROLLED BACK ${d.rowCount} journals (lines cascade) · open invoices ${after.open.n} owed ${money(after.open.owed)}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------- step: cutover

/** The balancing journal's lines for AIMS balances `aims` (Dr positive, by code). */
function planCutover(abssTb, aims, extraCodes = []) {
  const lines = [];
  const kept = [];
  for (const r of abssTb) {
    if (r.isHeader || r.code === COMPUTED || r.code === '3-9999') continue;
    const diff = R2(r.debitBalance - (aims.get(r.code) || 0));
    if (!diff) continue;
    if (KEEP.has(r.code)) { kept.push({ code: r.code, name: r.name, abss: r.debitBalance, aims: aims.get(r.code) || 0, diff }); continue; }
    lines.push({ code: r.code, name: r.name, abss: r.debitBalance, aims: R2(aims.get(r.code) || 0), dr: diff > 0 ? diff : 0, cr: diff < 0 ? -diff : 0 });
  }
  const off = R2(lines.reduce((a, l) => a + l.dr - l.cr, 0));
  const hb = abssTb.find((r) => r.code === '3-9999');
  const hbAfter = R2((aims.get('3-9999') || 0) - off);
  if (off) lines.push({ code: '3-9999', name: hb.name, abss: hb.debitBalance, aims: R2(aims.get('3-9999') || 0), dr: off < 0 ? -off : 0, cr: off > 0 ? off : 0 });
  const outside = extraCodes.filter((c) => Math.abs(aims.get(c) || 0) > 0.005).map((c) => ({ code: c, balance: aims.get(c) }));
  return { lines, kept, hbAfter, hbAbss: hb.debitBalance, outside };
}

async function stepCutover() {
  const abssTb = readAbss(BAL_FILE);
  const { c, q } = await connect();
  const state = await loadState(q);
  if (ROLLBACK) return rollbackMarked(c, q, state, CUT_MARK, 'cutover');
  const fy = { month: state.setting.m || 12, day: state.setting.d || 31 };
  const reCode = state.setting.controlAccounts?.retainedProfits || 'RTPL';
  const posted = state.lines.filter((l) => l.status === 'POSTED').map((l) => ({ code: l.code, category: l.category, date: l.entryDate, dr: l.debit, cr: l.credit }));
  const aims = trialBalance(posted, CUTOVER, fy, reCode);
  if (Math.abs(aims.get(COMPUTED) || 0) > 0.005) throw new Error(`${COMPUTED} carries postings`);
  const nonAbss = [...aims.keys()].filter((k) => !abssTb.some((r) => r.code === k));
  const plan = planCutover(abssTb, aims, nonAbss);
  printCutover(plan);
  const exists = (await q(`SELECT count(*)::int n FROM "JournalEntry" WHERE "organizationId" = $1 AND "createdBy" = $2`, [WCT, CUT_MARK]))[0].n;
  if (exists) throw new Error(`a cutover journal for ${CUTOVER} already exists: roll it back first`);
  if (!APPLY) { await c.end(); return; }
  const ids = new Map(state.accounts.filter((a) => a.isActive).map((a) => [a.code, a.id]));
  const total = R2(plan.lines.reduce((a, l) => a + l.dr, 0));
  const now = new Date().toISOString();
  await c.query('BEGIN');
  try {
    const id = crypto.randomUUID();
    await insertRows(c, 'JournalEntry', ['id', 'organizationId', 'journalNumber', 'entryDate', 'type', 'status', 'isUnconfirmed', 'reference', 'description', 'totalDebit', 'totalCredit', 'currency', 'postedAt', 'postedBy', 'createdAt', 'updatedAt', 'createdBy'],
      [[id, WCT, `ABSS-CUTOVER-${CUTOVER}`, `${CUTOVER}T00:00:00.000Z`, 'OPENING_BALANCE', 'POSTED', false, `ABSS ${path.basename(BAL_FILE)}`, `Cutover from ABSS: every account brought to its ABSS balance at ${CUTOVER}, offset to 3-9999`, total, total, 'SGD', now, 'abss-cutover', now, now, CUT_MARK]]);
    await insertRows(c, 'JournalEntryLine', ['id', 'journalEntryId', 'accountId', 'lineNumber', 'description', 'debit', 'credit'],
      plan.lines.map((l, n) => [crypto.randomUUID(), id, ids.get(l.code), n + 1, `ABSS ${money(l.abss)} · AIMS ${money(l.aims)}`, l.dr, l.cr]));
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  const after = await loadState(q);
  const tb = trialBalance(after.lines.filter((l) => l.status === 'POSTED').map((l) => ({ code: l.code, category: l.category, date: l.entryDate, dr: l.debit, cr: l.credit })), CUTOVER, fy, reCode);
  const off = abssTb.filter((r) => !r.isHeader && r.code !== COMPUTED && !KEEP.has(r.code) && Math.abs((tb.get(r.code) || 0) - r.debitBalance) > 0.005);
  writeLog({ at: now, step: 'cutover', mode: 'APPLY', searchPath: SEARCH_PATH, marker: CUT_MARK, lines: plan.lines.length, total, accountsNotEqualAbss: off.map((r) => r.code) });
  console.log(`APPLIED cutover journal: ${plan.lines.length} lines, ${money(total)} · accounts ≠ ABSS afterwards: ${off.length ? off.map((r) => r.code).join(', ') : 'none'}`);
  await c.end();
}

function printCutover(plan, top = 0) {
  const rows = [...plan.lines].sort((a, b) => Math.max(b.dr, b.cr) - Math.max(a.dr, a.cr));
  console.log(`\nBalancing journal: ${plan.lines.length} lines · Dr ${money(plan.lines.reduce((a, l) => a + l.dr, 0))} = Cr ${money(plan.lines.reduce((a, l) => a + l.cr, 0))}`);
  console.table((top ? rows.slice(0, top) : rows).map((l) => ({ code: l.code, name: l.name, 'ABSS (Dr+)': money(l.abss), 'AIMS (Dr+)': money(l.aims), Dr: l.dr ? money(l.dr) : '', Cr: l.cr ? money(l.cr) : '' })));
  console.log(`3-9999 after: ${money(plan.hbAfter)} vs ABSS ${money(plan.hbAbss)} → ${Math.abs(plan.hbAfter - plan.hbAbss) < 0.005 ? 'equal: every ABSS account matches' : `differs by ${money(plan.hbAfter - plan.hbAbss)}`}`);
  if (plan.kept.length) { console.log('Left out (--keep):'); console.table(plan.kept); }
  if (plan.outside.length) { console.log('AIMS balances on accounts outside the ABSS chart:'); console.table(plan.outside); }
}

// ---------------------------------------------------------------- report (read-only simulation)

async function report() {
  const abss = readAbss(COA_FILE);
  const abssTb = readAbss(BAL_FILE);
  const { c, q } = await connect();
  await c.query('BEGIN READ ONLY');
  const state = await loadState(q);
  await c.query('ROLLBACK');
  await c.end();
  const out = [];
  const say = (...x) => { out.push(x.join(' ')); console.log(...x); };
  const table = (rows) => { console.table(rows); out.push(...asText(rows)); };

  say(`# WCT GL on the ABSS chart: dry run ${new Date().toISOString()} (read-only)`);
  say(`ABSS file ${path.basename(COA_FILE)}: ${abss.length} accounts, ${abss.filter((r) => r.isHeader).length} headers + ${COMPUTED} computed (non-posting), ${abss.filter((r) => !r.isHeader && r.code !== COMPUTED).length} posting · every header = sum of its sub-accounts · detail Dr = Cr`);
  say(`WCT today: ${state.accounts.length} accounts, ${new Set(state.lines.map((l) => l.journalNumber)).size} journals, imported invoices ${state.docs.size}, open ${state.open.n} owed ${money(state.open.owed)}, JV counter ${state.jvMax}`);

  // 1. COA
  const plan = planCoa(abss, state);
  say('\n## 1. Chart of accounts');
  say('Control roles:');
  table(Object.entries(CONTROLS).map(([k, v]) => ({ role: k, now: state.setting.controlAccounts?.[k] ?? '', abss: `${v} ${abss.find((r) => r.code === v)?.name}`, flag: CONTROL_FLAGGED.includes(k) ? 'confirm' : '' })));
  say('ABSS accounts by AIMS type:');
  const byType = {};
  for (const r of abss) byType[r.accountType] = (byType[r.accountType] || 0) + 1;
  table(Object.entries(byType).map(([t, n]) => ({ type: t, accounts: n })));
  fs.writeFileSync(path.join(DIR, 'abss-coa-mapping.csv'), ['code,name,level,parent,header,aimsType,category,normalBalance,abssBalance', ...abss.map((r) => [r.code, `"${r.name}"`, r.level, r.parentCode || '', r.isHeader || r.code === COMPUTED ? 'non-posting' : '', r.accountType, r.category, r.normalBalance, r.balance].join(','))].join('\n'));
  say(`(all ${abss.length} rows: _imports/wct/erp/abss-coa-mapping.csv)`);
  say('Existing journal lines moved:');
  table(plan.moves.map((m) => ({ journal: m.journal, status: m.status, from: m.from, to: m.to, dr: m.dr, cr: m.cr })));
  if (plan.unmapped.length) { say('NOT mappable:'); table(plan.unmapped); }
  say('Old accounts:');
  table(plan.old.map((o) => ({ code: o.code, name: o.name, 'posted now': o.balance, abss: o.to, basis: o.basis, action: o.action })));

  // Simulated ledger after the COA move.
  const posted = state.lines.filter((l) => l.status === 'POSTED').map((l) => {
    const to = plan.moves.find((m) => m.lineId === l.id)?.to || l.code;
    const a = abss.find((r) => r.code === to);
    return { code: to, category: a ? a.category : l.category, date: l.entryDate, dr: l.debit, cr: l.credit };
  });

  // 2. History
  const hist = buildHistory(state.docs);
  say('\n## 2. ERP history journals');
  say(`planned ${hist.journals.length} journals · skipped ${hist.skipped.length} · flags ${hist.flags.length}`);
  table(summarise(hist.journals).map((r) => ({ ...r, amount: money(r.amount) })));
  say('Revenue buckets (invoice revenue ex GST):');
  const bk = Object.values(hist.buckets).sort((a, b) => a.code.localeCompare(b.code) || b.amount - a.amount);
  table(bk.map((b) => ({ account: b.code, bucket: b.key, rule: b.rule, invoices: b.n, revenue: money(b.amount) })));
  say('Unclear subjects (sample):');
  for (const s of (hist.buckets[Object.keys(hist.buckets).find((k) => k.includes('UNCLEAR'))]?.samples || [])) say('  ', s);
  say('Bank accounts used by payments:');
  const banks = {};
  for (const j of hist.journals.filter((x) => x.type === 'PAYMENT')) { banks[j.bank] = banks[j.bank] || { account: j.bank, payments: 0, amount: 0 }; banks[j.bank].payments++; banks[j.bank].amount = R2(banks[j.bank].amount + j.total); }
  table(Object.values(banks).map((b) => ({ ...b, amount: money(b.amount) })));
  say('Credit notes by rule:');
  const cnr = {};
  for (const j of hist.journals.filter((x) => x.type === 'CREDIT_NOTE')) { const k = j.cnRule.replace(/→ invoice revenue .*/, '→ invoice revenue'); cnr[k] = cnr[k] || { rule: k, notes: 0, amount: 0 }; cnr[k].notes++; cnr[k].amount = R2(cnr[k].amount + j.total); }
  table(Object.values(cnr).map((b) => ({ ...b, amount: money(b.amount) })));
  say('Skipped:');
  const sk = {};
  for (const s of hist.skipped) { const k = `${s.kind}: ${s.why.replace(/".*"/, '').replace(/\(.*\)/, '')}`; sk[k] = sk[k] || { reason: k, n: 0, amount: 0, e: [] }; sk[k].n++; sk[k].amount = R2(sk[k].amount + s.amount); if (sk[k].e.length < 4) sk[k].e.push(s.no); }
  table(Object.values(sk).map((s) => ({ reason: s.reason, n: s.n, amount: money(s.amount), e: s.e.join(' ') })));
  say('Flags:');
  const fl = {};
  for (const f of hist.flags) { const k = `${f.kind}: ${f.note.replace(/[0-9.,-]+/g, '#').slice(0, 70)}`; fl[k] = fl[k] || { flag: k, n: 0, e: [] }; fl[k].n++; if (fl[k].e.length < 3) fl[k].e.push(`${f.no} ${f.note}`); }
  table(Object.values(fl).map((f) => ({ flag: f.flag, n: f.n, e: f.e.join(' | ').slice(0, 160) })));

  const erp = hist.journals.flatMap((j) => j.lines.map((l) => ({ code: l.code, category: abss.find((r) => r.code === l.code).category, date: j.date, dr: l.dr, cr: l.cr })));
  const all = [...posted, ...erp];
  const dr = R2(all.reduce((a, p) => a + p.dr, 0));
  const cr = R2(all.reduce((a, p) => a + p.cr, 0));
  say(`\n## 3. Trial balance after the history (all dates): Dr ${money(dr)} · Cr ${money(cr)} · ${dr === cr ? 'balanced' : 'NOT BALANCED'}`);
  const fy = { month: state.setting.m || 12, day: state.setting.d || 31 };
  const tbNow = trialBalance(all, CUTOVER, fy, '3-8000');
  const tbRows = [...tbNow.entries()].filter(([, v]) => Math.abs(v) > 0.005).sort(([a], [b]) => a.localeCompare(b));
  table(tbRows.map(([code, v]) => ({ code, name: abss.find((r) => r.code === code)?.name || state.accounts.find((a) => a.code === code)?.name, Dr: v > 0 ? money(v) : '', Cr: v < 0 ? money(-v) : '' })));
  const tdr = R2(tbRows.reduce((a, [, v]) => a + (v > 0 ? v : 0), 0));
  const tcr = R2(tbRows.reduce((a, [, v]) => a + (v < 0 ? -v : 0), 0));
  say(`AIMS trial balance at ${CUTOVER} (FY ${fyStartOf(`${CUTOVER}T00:00:00Z`, fy.month, fy.day).slice(0, 10)} on; earlier P&L rolled into 3-8000): Dr ${money(tdr)} = Cr ${money(tcr)} ${tdr === tcr ? '✓' : '✗'}`);

  // 4. AR
  const arAll = R2(erp.filter((p) => p.code === '1-3100').reduce((a, p) => a + p.dr - p.cr, 0));
  const arAt = tbNow.get('1-3100') || 0;
  say('\n## 4. 1-3100 Customer Payment');
  say(`open imported invoices (documents, unchanged): ${money(state.open.owed)} on ${state.open.n} invoices`);
  say(`AIMS 1-3100 from the ERP journals, all dates: ${money(arAll)} · at ${CUTOVER}: ${money(arAt)} · ABSS 1-3100: ${money(abss.find((r) => r.code === '1-3100').balance)}`);

  // 5. Revenue by year
  say('\n## 5. Revenue by year (ex GST, after credit notes)');
  const rev = {};
  for (const j of hist.journals) for (const l of j.lines) {
    if (!l.code.startsWith('4-')) continue;
    const y = j.date.slice(0, 4);
    rev[y] = rev[y] || { year: y, '4-1000 MV': 0, '4-2000 CD': 0, '4-3000 AA/VO': 0, '4-3500 TS': 0, total: 0 };
    const k = Object.keys(rev[y]).find((x) => x.startsWith(l.code));
    rev[y][k] = R2(rev[y][k] + l.cr - l.dr);
    rev[y].total = R2(rev[y].total + l.cr - l.dr);
  }
  table(Object.values(rev).sort((a, b) => a.year.localeCompare(b.year)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'year' ? v : money(v)]))));
  const since = (d) => { const s = {}; for (const j of hist.journals) if (j.date >= d && j.date.slice(0, 10) <= CUTOVER) for (const l of j.lines) if (l.code.startsWith('4-')) s[l.code] = R2((s[l.code] || 0) + l.cr - l.dr); return s; };
  for (const d of ['2026-01-01', '2024-01-01']) {
    const s = since(d);
    say(`ERP revenue ${d} → ${CUTOVER} vs ABSS "current year":`);
    table(['4-1000', '4-2000', '4-3000', '4-3500'].map((code) => ({ code, erp: money(s[code] || 0), abss: money(abss.find((r) => r.code === code).balance), diff: money((s[code] || 0) - abss.find((r) => r.code === code).balance) })));
  }

  // 6. Cutover preview
  say(`\n## 6. Balancing journal preview at ${CUTOVER} (balances: ${path.basename(BAL_FILE)})`);
  const nonAbss = [...tbNow.keys()].filter((k) => !abssTb.some((r) => r.code === k));
  const cut = planCutover(abssTb, tbNow, nonAbss);
  const rows = [...cut.lines].sort((a, b) => Math.max(b.dr, b.cr) - Math.max(a.dr, a.cr));
  say(`${cut.lines.length} lines · Dr ${money(cut.lines.reduce((a, l) => a + l.dr, 0))} = Cr ${money(cut.lines.reduce((a, l) => a + l.cr, 0))} · top 20:`);
  table(rows.slice(0, 20).map((l) => ({ code: l.code, name: l.name, 'ABSS (Dr+)': money(l.abss), 'AIMS (Dr+)': money(l.aims), Dr: l.dr ? money(l.dr) : '', Cr: l.cr ? money(l.cr) : '' })));
  say(`3-9999 after: ${money(cut.hbAfter)} vs ABSS ${money(cut.hbAbss)} → ${Math.abs(cut.hbAfter - cut.hbAbss) < 0.005 ? 'equal: every ABSS account = ABSS' : `differs by ${money(cut.hbAfter - cut.hbAbss)}`}`);
  if (cut.outside.length) { say('Balances outside the ABSS chart (not balanced):'); table(cut.outside); }
  const after = new Map(tbNow);
  for (const l of cut.lines) after.set(l.code, R2((after.get(l.code) || 0) + l.dr - l.cr));
  const off = abssTb.filter((r) => !r.isHeader && r.code !== COMPUTED && Math.abs((after.get(r.code) || 0) - r.debitBalance) > 0.005);
  say(`after the balancing journal: ${off.length ? `${off.length} accounts ≠ ABSS: ${off.map((r) => r.code).join(', ')}` : 'every ABSS detail account = ABSS'} · counters untouched (journals are numbered ERP-* / ABSS-CUTOVER-*, the JV sequence stays at ${state.jvMax})`);
  fs.writeFileSync(path.join(DIR, `wct-abss-gl-dryrun-${CUTOVER}.txt`), out.join('\n'));
  fs.writeFileSync(path.join(DIR, `wct-abss-gl-cutover-preview-${CUTOVER}.csv`), ['code,name,abss_dr_positive,aims_dr_positive,dr,cr', ...rows.map((l) => [l.code, `"${l.name}"`, l.abss, l.aims, l.dr, l.cr].join(','))].join('\n'));
  console.log(`\nreport → _imports/wct/erp/wct-abss-gl-dryrun-${CUTOVER}.txt`);
}

function asText(rows) {
  if (!rows.length) return ['  (none)'];
  const cols = Object.keys(rows[0]);
  const w = cols.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)));
  const line = (vals) => `  ${vals.map((v, i) => String(v ?? '').padEnd(w[i])).join(' | ')}`;
  return [line(cols), `  ${w.map((n) => '-'.repeat(n)).join('-+-')}`, ...rows.map((r) => line(cols.map((k) => r[k])))];
}

// ----------------------------------------------------------------

const steps = { coa: stepCoa, post: stepPost, cutover: stepCutover, report };
if (module === require.main) {
  if (!steps[CMD]) {
    console.error('usage: node scripts/wct-abss-gl.js report|coa|post|cutover [--apply] [--rollback] [--search-path …] [--date YYYY-MM-DD] [--balances file] [--keep codes]');
    process.exit(1);
  }
  steps[CMD]().catch((e) => {
    console.error('ERROR', e.message);
    process.exit(1);
  });
}
module.exports = { readAbss, revenueBucket, bankFor, trialBalance, planCutover, fyStartOf };
