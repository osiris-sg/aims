/**
 * WCT group sister orgs (2026-11-06): modules, ABSS charts, tracker imports and books for
 * BC Air, WCT Racking and YMM Kitchen. WCT group orgs only; every step is a dry run by default,
 * `--apply` writes (one transaction per step, logged), `--rollback [--apply]` undoes that step.
 *
 *   charts           read the ABSS printouts (_imports/wct/abss) into level|code|name|balance files:
 *                    BC Air, WCT Cleaning, BC Air + WCT Cleaning combined, YMM (codes generated)
 *   modules          BC Air: Sales (quotations / invoices / credit notes) + Customers + Service
 *                    Reports on; Racking: Service Reports on; roles' allowed modules; hold flag
 *                    holdErpImportPaymentGl ON for BC Air + Racking
 *   coa-bcair        BC Air ABSS chart + the WCT Cleaning accounts with no BC Air equivalent,
 *                    control roles, the 26 default accounts deactivated
 *   coa-ymm          YMM chart (generated ABSS-style codes), control roles, defaults deactivated
 *   docs-bcair       customers + invoices from bcair-sales-summary.xlsx and wct-nongst-cn-summary.xlsx
 *   docs-racking     customers + invoices from wctr-sales-summary-cn.xlsx (documents only, no GL)
 *   post-bcair       the trackers' history as journals (invoices, payments, credit notes)
 *   cutover-bcair    year-end closes + one balancing journal at the cutover: every account =
 *                    BC Air ABSS + WCT Cleaning ABSS, offset 3-9999; then the hold flag OFF
 *   cutover-ymm      one balancing journal: every account = the YMM file
 *   recode-ymm       (2026-11-07) YMM's generated codes → the real ABSS codes from
 *                    ymm-accounts-list-2026-11-06.pdf, in place (same rows: journals untouched),
 *                    ABSS's hierarchy, control roles / code ranges follow their accounts. From
 *                    then on the YMM chart file is ymm-abss-coa-2026-11-06.txt
 *   report           everything above simulated in memory, read-only
 *
 *   DBURL=… node scripts/wct-group-books.js report
 *   DBURL=… node scripts/wct-group-books.js <step> [--apply] [--rollback]
 * Dev proof: --search-path org_aimsdemo,platform,public --as <dev org id> runs a step against a dev
 * stand-in org (refused without --search-path, so never on prod).
 *
 * Imported documents carry config.erpImport (src/common/erp-import.ts): history only, no GL from
 * the app, no posting queue / Xero / AI index, an "Imported" tag. No emails / WhatsApp, no Payment
 * rows (paid amounts live on the invoice, as for WCT), counters never touched (no imported name can
 * match a number format's prefix: checked).
 */
const { Client, types } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const gl = require('./wct-abss-gl.js');

types.setTypeParser(1114, (v) => `${v.replace(' ', 'T')}Z`);
types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(20, (v) => Number(v));

const ORG = {
  WCT: '5c700000-0000-4000-8000-5c7000000001',
  RACK: '5c700000-0000-4000-8000-5c7000000002',
  YMM: '5c700000-0000-4000-8000-5c7000000003',
  BCAIR: '5c700000-0000-4000-8000-5c7000000004',
};
const ORG_NAME = { [ORG.WCT]: 'WCT', [ORG.RACK]: 'WCT Racking Pte Ltd', [ORG.YMM]: 'YMM KITCHEN PTE. LTD.', [ORG.BCAIR]: 'BC AIR PTE. LTD.' };

const args = process.argv.slice(2);
const CMD = args[0];
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const APPLY = args.includes('--apply');
const ROLLBACK = args.includes('--rollback');
const SEARCH_PATH = opt('--search-path', null);
const AS = opt('--as', null);
if (AS && !SEARCH_PATH) throw new Error('--as (dev stand-in org) needs --search-path: never on prod');
const DIR = path.resolve(opt('--dir', path.resolve(__dirname, '../../_imports/wct')));
const CUTOVER = '2026-11-06';
const BATCH = { BCAIR: 'bcair-books-2026-11-06', RACK: 'wctr-tracker-2026-11-06' };
const GL_MARK = 'erp-gl:bcair-gl-2026-11-06';
const GL_MARK_RACK = 'erp-gl:wctr-gl-2026-11-06';
const NOTE_MARK = 'wct-ng-note:2026-11-06';
const HOLD_ORGS = ['BCAIR', 'RACK'];
const SLUG = { BCAIR: 'bcair', RACK: 'racking', YMM: 'ymm' };
const CUT_MARK = `abss-cutover:${CUTOVER}`;
const HOLD = 'holdErpImportPaymentGl';
const R2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (n) => R2(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const target = (key) => AS || ORG[key];
const LOG = (step) => path.resolve(__dirname, `wct-group-books.${step}${SEARCH_PATH ? '.dev' : ''}.log.json`);

// ================================================================ charts

const ABSS = path.join(DIR, 'abss');
const CHART = {
  BCAIR: path.join(ABSS, `bcair-coa-${CUTOVER}.txt`),
  WCTC: path.join(ABSS, `wctc-coa-${CUTOVER}.txt`),
  COMBINED: path.join(ABSS, `bcair-combined-coa-${CUTOVER}.txt`),
  YMM: path.join(ABSS, `ymm-coa-${CUTOVER}.txt`),
  RACK: path.join(ABSS, `wctr-coa-${CUTOVER}.txt`),
  YMM_ABSS: path.join(ABSS, `ymm-abss-coa-${CUTOVER}.txt`),
};

/** ABSS "Accounts List [Summary]" PDF → rows (level from the code's indent). */
async function readAbssPdf(file) {
  const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: Math.round(it.transform[4]), s: it.str.trim() });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const r = rows.get(y).sort((a, b) => a.x - b.x);
      const c = r.find((i) => /^\d-\d{4}$/.test(i.s));
      if (!c) continue;
      const rest = r.filter((i) => i !== c);
      const bal = rest.pop();
      items.push({ x: c.x, code: c.s, name: rest.map((i) => i.s).join(' '), balance: R2(Number(bal.s.replace(/S?\$|,/g, ''))) });
    }
  }
  const xs = [...new Set(items.map((i) => i.x))].sort((a, b) => a - b);
  if (xs.length !== 4) throw new Error(`${path.basename(file)}: expected 4 indent levels, got ${xs.join(',')}`);
  return items.map((i) => ({ level: xs.indexOf(i.x), code: i.code, name: i.name, balance: i.balance }));
}

const writeChart = (file, title, rows) =>
  fs.writeFileSync(file, [`# ${title}. level|code|name|balance as printed (negative = brackets)`, ...rows.map((r) => [r.level, r.code, r.name, R2(r.balance).toFixed(2)].join('|'))].join('\n') + '\n');

/** Header balances = the sum of their sub-accounts (rows in print order, with level). */
function rollUp(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!(i + 1 < rows.length && rows[i + 1].level > r.level)) continue;
    let s = 0;
    for (let k = i + 1; k < rows.length && rows[k].level > r.level; k++) if (rows[k].level === r.level + 1) s += rows[k].balance;
    r.balance = R2(s);
  }
  return rows;
}

// WCT Cleaning (combined INTO BC Air): its account → [BC Air code, basis]. 'new' = added to BC Air
// with this code (name + " (WCT Cleaning)"), parent = the BC Air header it sits under.
const WCTC_MAP = {
  '1-2101': ['1-2400', 'new'], '1-2110': ['1-2410', 'new'], '1-2102': ['1-2420', 'new'], '1-2103': ['1-2430', 'new'],
  '1-2120': ['1-2440', 'new'], '1-2130': ['1-2450', 'new'], '1-2190': ['1-2300', 'merged (owner)'], '1-2199': ['1-2300', 'merged (owner)'],
  '1-2300': ['1-9100', 'merged (owner)'],
  '1-3100': ['1-9999', 'debtors control (brief)'], '1-3150': ['1-9400', 'same name'], '1-3200': ['1-3200', 'same name'], '1-3400': ['1-9300', 'same name'],
  '2-0300': ['2-9999', 'same name'], '2-2100': ['2-1100', 'merged (owner)'], '2-2200': ['2-1300', 'merged (owner)'], '2-2430': ['2-3300', 'merged (owner)'], '2-2500': ['2-9998', 'merged (owner)'],
  '3-1100': ['3-1100', 'same name'], '3-1200': ['3-1200', 'same name'], '3-8000': ['3-8000', 'same name'], '3-9000': ['3-9000', 'computed (P&L)'], '3-9999': ['3-9999', 'same name'],
  '4-1000': ['4-1001', 'brief'], '4-2000': ['4-1003', 'brief'], '4-3000': ['4-1002', 'brief'], '4-3500': ['4-1004', 'brief'], '4-4000': ['4-3000', 'new'],
  '5-1010': ['5-1005', 'new'], '5-1020': ['5-1003', 'same use (CD)'], '5-1030': ['5-1001', 'same use (MV)'], '5-1040': ['5-1002', 'same use (AA)'], '5-1050': ['5-1006', 'new'],
  '5-1150': ['5-1007', 'new'], '5-1160': ['5-1008', 'new'], '5-1170': ['5-4004', 'same name'], '5-1180': ['5-1004', 'same name'],
  '5-2900': ['5-3005', 'same name'], '5-3100': ['5-4001', 'same name'], '5-3200': ['5-4003', 'same name'],
  '5-4000': ['5-5000', 'new header'], '5-4100': ['5-5100', 'new'], '5-4200': ['5-5200', 'new'], '5-4400': ['5-5300', 'new'],
  '5-5000': ['5-6000', 'new header'], '5-5100': ['5-6100', 'new'], '5-5200': ['5-6200', 'new'], '5-6000': ['5-7000', 'new'],
  '6-1006': ['6-1002', 'same name'], '6-1010': ['6-1003', 'same name'], '6-1020': ['6-1009', 'new'], '6-1070': ['6-1010', 'new'], '6-1080': ['6-1011', 'new'], '6-1090': ['6-1012', 'new'],
  '6-2000': ['6-2006', 'new'], '6-3000': ['6-2007', 'new'],
  '8-1000': ['8-2000', 'same name'], '8-2000': ['8-3000', 'same name'], '8-3000': ['8-1000', 'same name'],
  '9-1000': ['9-1000', 'same name'], '9-3000': ['9-3000', 'same name'], '9-4000': ['9-4000', 'same name'],
};
// Near-equivalents: the owner chose to merge them into BC Air's accounts (WCT Cleaning's banks stay separate).
const WCTC_NEAR = {};

function combineBcair(bc, wc) {
  const rows = bc.map((r) => ({ level: r.level, code: r.code, name: r.name, balance: r.balance, from: [] }));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const mapping = [];
  for (const [i, w] of wc.entries()) {
    const isHeader = i + 1 < wc.length && wc[i + 1].level > w.level;
    const m = WCTC_MAP[w.code];
    if (!m) {
      if (!isHeader) throw new Error(`WCT Cleaning ${w.code} ${w.name} has no mapping`);
      mapping.push({ wctc: w.code, name: w.name, balance: w.balance, bcair: '', bcairName: '', basis: 'header (not carried; BC Air headers total it)' });
      continue;
    }
    const [code, basis] = m;
    let t = byCode.get(code);
    if (basis.startsWith('new')) {
      if (t) throw new Error(`new code ${code} is already a BC Air account`);
      const parent = basis === 'new header' ? code.slice(0, 2) + '0000' : null;
      t = { level: null, code, name: `${w.name} (WCT Cleaning)`, balance: 0, from: [], isNew: true, newHeader: basis === 'new header', parentHint: parent };
      rows.push(t);
      byCode.set(code, t);
    }
    if (!isHeader) { t.balance = R2(t.balance + w.balance); t.from.push(w.code); }
    mapping.push({ wctc: w.code, name: w.name, balance: w.balance, bcair: code, bcairName: t.name, basis: isHeader ? `${basis} (header)` : basis, near: WCTC_NEAR[code] || '' });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  // A new account's level: one below the nearest BC Air header whose code range holds it.
  for (const r of rows.filter((x) => x.isNew)) {
    const [cls, n] = [r.code[0], Number(r.code.slice(2))];
    if (r.newHeader) { r.level = 1; continue; }
    const under = { '1-24': '1-2000', '4-30': '4-0000', '5-10': '5-1000', '5-51': '5-5000', '5-52': '5-5000', '5-53': '5-5000', '5-61': '5-6000', '5-62': '5-6000', '5-70': '5-0000', '6-10': '6-1000', '6-20': '6-2000' }[r.code.slice(0, 4)];
    if (!under) throw new Error(`no parent for new account ${r.code} (${cls}/${n})`);
    r.level = byCode.get(under).level + 1;
    r.parentCode = under;
  }
  rollUp(rows);
  return { rows, mapping };
}

// YMM: names only (as at 6/11/2026). Levels were read off the subtotals (every header = the sum
// of its sub-accounts; readAbss proves it) and codes generated ABSS-style per section.
const YMM_LEVELS = [
  // Assets
  0, 1, 2, 3, 3, 2, 3, 3, 2, 3, 3, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 1, 2, 2, 2,
  // Liabilities
  0, 1, 2, 2, 2, 1, 2, 3, 3, 3, 3, 2, 2, 2, 3, 3, 2, 2, 2, 3, 3, 2, 2, 1, 2, 2,
  // Equity
  0, 1, 2, 3, 3, 2, 3, 3, 1, 1, 1,
  // Income
  0, 1, 1, 1, 1, 1,
  // Cost of Sales
  0, ...Array(21).fill(1),
  // Expenses
  0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 2, 2, 2, 2, 2, 1,
  // Other Income, Other Expenses
  0, 1, 0, 1, 1, 1,
];
const YMM_SECTIONS = { Assets: '1', Liabilities: '2', Equity: '3', Income: '4', 'Cost of Sales': '5', Expenses: '6', 'Other Income': '8', 'Other Expenses': '9' };

function readYmmXlsx(file) {
  const ws = XLSX.readFile(file).Sheets.Sheet1;
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const start = raw.findIndex((r) => r[2] === 'Account');
  const rows = raw.slice(start + 1).filter((r) => String(r[2]).trim()).map((r) => ({ name: String(r[2]).trim(), balance: R2(Number(String(r[3]).replace(/[$,]/g, ''))) }));
  if (rows.length !== YMM_LEVELS.length) throw new Error(`YMM file has ${rows.length} accounts, the level map ${YMM_LEVELS.length}: re-check the file`);
  rows.forEach((r, i) => (r.level = YMM_LEVELS[i]));
  // codes: section-0000; children of a section step 1000 (100 when there are more than 9),
  // each level below steps a tenth of its parent's step. Equity keeps ABSS's fixed codes.
  let cls = null;
  const stack = [];
  for (const [i, r] of rows.entries()) {
    if (r.level === 0) {
      cls = YMM_SECTIONS[r.name];
      if (!cls) throw new Error(`YMM row ${i}: "${r.name}" at level 0 is not a section`);
      r.code = `${cls}-0000`;
      stack.length = 0;
      stack.push({ r, own: 10000 });
      continue;
    }
    while (stack.length && stack[stack.length - 1].r.level >= r.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent.next == null) {
      let n = 0;
      for (let k = i; k < rows.length && rows[k].level >= r.level; k++) if (rows[k].level === r.level) n++;
      parent.step = parent.r.level === 0 ? (n <= 9 ? 1000 : 100) : parent.own / 10;
      parent.next = parent.r.level === 0 ? 1000 : Number(parent.r.code.slice(2)) + parent.step;
      if (parent.r.level > 0 && n > 9) throw new Error(`YMM "${parent.r.name}" has ${n} sub-accounts: too many for one digit`);
    }
    let n = parent.next;
    parent.next += parent.step;
    if (cls === '3' && r.level === 1) n = { "Partners' Equity": 1000, 'Retained Earnings': 8000, 'Current Year Earnings': 9000, 'Historical Balancing': 9999 }[r.name];
    r.code = `${cls}-${String(n).padStart(4, '0')}`;
    stack.push({ r, own: parent.step });
  }
  const seen = new Set();
  for (const r of rows) { if (seen.has(r.code)) throw new Error(`YMM code ${r.code} generated twice`); seen.add(r.code); }
  return rows;
}

async function stepCharts() {
  const bc = await readAbssPdf(path.join(ABSS, 'bcair-accounts-list-2026-11-06.pdf'));
  const wc = await readAbssPdf(path.join(ABSS, 'wct-cleaning-accounts-list-2026-11-06.pdf'));
  writeChart(CHART.BCAIR, 'ABSS "Accounts List [Summary]" BC Air Pte Ltd, 06/11/2026 19:08:31', bc);
  writeChart(CHART.WCTC, 'ABSS "Accounts List [Summary]" WCT Cleaning Technology, 06/11/2026 19:07:45', wc);
  const { rows, mapping } = combineBcair(bc, wc);
  writeChart(CHART.COMBINED, 'BC Air + WCT Cleaning combined (scripts/wct-group-books.js charts), 06/11/2026', rows);
  const ymm = readYmmXlsx(path.join(ABSS, 'ymm-accounts-list.xlsx'));
  writeChart(CHART.YMM, 'ABSS "Accounts List [Summary]" YMM Kitchen Pte Ltd (names only; codes generated by section), as at 06/11/2026', ymm);
  const wr = await readAbssPdf(path.join(ABSS, 'wctr-accounts-list.pdf'));
  writeChart(CHART.RACK, 'ABSS "Accounts List [Summary]" WCT Racking Pte Ltd, as at 06/11/2026', wr);
  for (const f of Object.values(CHART)) {
    const r = gl.readAbss(f); // header sums + detail Dr = Cr proven here
    console.log(`${path.basename(f)}: ${r.length} accounts, ${r.filter((x) => x.isHeader).length} headers · header sums ✓ · Dr = Cr ✓`);
  }
  fs.writeFileSync(path.join(ABSS, `bcair-wctc-mapping-${CUTOVER}.csv`), ['wctc_code,wctc_name,wctc_balance,bcair_code,bcair_name,basis,near_equivalent', ...mapping.map((m) => [m.wctc, `"${m.name}"`, m.balance, m.bcair, `"${m.bcairName}"`, `"${m.basis}"`, `"${m.near || ''}"`].join(','))].join('\n'));
  return { bc, wc, combined: rows, mapping, ymm, wr };
}

/** A chart file as readAbss rows, with the AIMS account types each org needs. */
function chartOf(key) {
  const rows = gl.readAbss({ YMM: CHART.YMM, RACK: CHART.RACK, BCAIR: CHART.COMBINED }[key]);
  for (const r of rows) {
    if (r.accountType === 'HEADER') continue;
    if (key === 'RACK') {
      if (/^2-3[12]00$/.test(r.code)) r.accountType = 'TAX_LIABILITY';
      else if (r.code.startsWith('2-23')) r.accountType = 'CURRENT_LIABILITY'; // Others Payables
      if (r.code === '4-9999') r.accountType = 'INCOME';
    } else if (key === 'BCAIR') {
      if (/^2-2[12]00$/.test(r.code)) r.accountType = 'TAX_LIABILITY';
      else if (r.code.startsWith('2-23')) r.accountType = 'CURRENT_LIABILITY';
      if (r.code === '4-9999') r.accountType = 'INCOME';
    } else {
      if (/^GST (Collected|Paid)$/.test(r.name)) r.accountType = 'TAX_LIABILITY';
      else if (r.code.startsWith('2-23')) r.accountType = 'CURRENT_LIABILITY';
      if (r.name === 'Income Tax Expense') r.accountType = 'TAX';
      if (r.accountType === 'INTANGIBLE_ASSET') r.accountType = 'FIXED_ASSET';
      else if (r.code === '9-4000') r.accountType = 'EXPENSE';
      if (r.code[0] === '3' && /Capital/.test(r.name)) r.accountType = 'SHARE_CAPITAL';
    }
  }
  return rows;
}

const BCAIR_CONTROLS = {
  debtorControl: '1-9999', creditorControl: '2-1100', taxLiabilities: '2-2100', taxInput: '2-2200', salesAccount: '4-1002',
  retainedProfits: '3-8000', currentYearEarnings: '3-9000', historicalBalancing: '3-9999', shareCapitals: '3-1100', dividends: '3-1200',
  bankAccount: '1-2100', cashAccount: '1-2200', fxGainLoss: '4-9999',
};
const RACK_CONTROLS = {
  debtorControl: '1-3100', creditorControl: '2-2100', taxLiabilities: '2-3100', taxInput: '2-3200', salesAccount: '4-1000',
  retainedProfits: '3-8000', currentYearEarnings: '3-9000', historicalBalancing: '3-9999', shareCapitals: '3-1100', dividends: '3-1200',
  bankAccount: '1-2111', cashAccount: '1-2120', fxGainLoss: '8-4000',
};
const controlsOf = (key, chart) => ({ BCAIR: BCAIR_CONTROLS, RACK: RACK_CONTROLS }[key] || ymmControls(chart));
function ymmControls(chart) {
  const by = (name, lvl) => chart.find((r) => r.name === name && (lvl == null || r.level === lvl))?.code;
  return {
    debtorControl: by('Trade Debtors'), creditorControl: by('Trade Creditors'), taxLiabilities: by('GST Collected'), taxInput: by('GST Paid'),
    salesAccount: by('Income', 1), retainedProfits: '3-8000', currentYearEarnings: '3-9000', historicalBalancing: '3-9999',
    shareCapitals: by('Partner A Capital'), dividends: by('Partner A Drawings'), bankAccount: by('DBS Account - BHOP'), cashAccount: by('Cash Drawer'),
  };
}
const CONTROL_ROLES = new Set(['debtorControl', 'creditorControl', 'taxLiabilities', 'taxInput']);
function codeRanges(key, chart) {
  const sec = (c) => ({ from: `${c}-0000`, to: `${c}-9999` });
  const r = { sales: sec(4), purchase: sec(5), income: sec(8), expenses: { from: '6-0000', to: '9-9999' }, fixedAssets: { from: '1-1000', to: '1-1999' }, currentAssets: { from: '1-2000', to: '1-9999' }, currentLiabilities: sec(2), shareCapitals: { from: '3-1000', to: '3-1999' }, retainedProfits: { from: '3-8000', to: '3-8000' }, capitalReserve: { from: '3-9999', to: '3-9999' } };
  if (key === 'BCAIR') Object.assign(r, { tax: { from: '9-4000', to: '9-4000' }, intangibleAssets: { from: '1-1300', to: '1-1399' }, taxLiabilities: { from: '2-2000', to: '2-2999' } });
  else if (key === 'RACK') Object.assign(r, { tax: { from: '9-4000', to: '9-4000' }, intangibleAssets: { from: '1-1300', to: '1-1399' }, taxLiabilities: { from: '2-3000', to: '2-3999' } });
  else {
    const t = chart.find((x) => x.name === 'Income Tax Expense').code;
    const g = chart.find((x) => x.name === 'GST Liabilities').code;
    Object.assign(r, { tax: { from: t, to: t }, taxLiabilities: { from: g, to: g.slice(0, 4) + '99' } });
  }
  return r;
}

// ================================================================ trackers

const readSheet = (file, styles) => {
  const wb = XLSX.readFile(file, { cellStyles: !!styles });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return { ws, raw: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), txt: XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) };
};
async function fillsOf(file) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const out = new Map(); // 0-based row → Set of argb fills
  ws.eachRow((row, r) => {
    const s = new Set();
    row.eachCell({ includeEmpty: false }, (c, n) => { const f = c.fill; if (f && f.type === 'pattern' && f.fgColor?.argb && f.fgColor.argb !== 'FFFFFFFF') s.add(`${n}:${f.fgColor.argb}`); });
    if (s.size) out.set(r - 1, s);
  });
  return out;
}
const hasFill = (fills, i, argb, col) => [...(fills.get(i) || [])].some((k) => k.endsWith(`:${argb}`) && (col == null || k.startsWith(`${col}:`)));
const fillCount = (fills, i, argb) => [...(fills.get(i) || [])].filter((k) => k.endsWith(`:${argb}`)).length;

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validIso = (s) => { const t = Date.parse(`${s}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s; };
function excelDate(v) {
  if (typeof v === 'number' && v > 20000) { const d = XLSX.SSF.parse_date_code(v); return iso(d.y, d.m, d.d); }
  return null;
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Every date written in a text cell (day first, as Singapore writes them), with what follows it. */
function textDates(s) {
  const out = [];
  const re = /(?<![\d,.$])(\d{1,2})\s?[/-]\s?(\d{1,2}|[A-Za-z]{3})(?:\s?[/-]\s?(\d{4}|\d{2})|(\d{4}))(?!\d)/g;
  let m;
  const str = String(s || '');
  const hits = [];
  while ((m = re.exec(str))) hits.push({ m, at: m.index, end: re.lastIndex });
  hits.forEach((h, k) => {
    const [, a, b, c3, c4] = h.m;
    const c = c3 || c4;
    const mon = /^[A-Za-z]/.test(b) ? MON[b.toLowerCase()] : Number(b);
    let y = Number(c);
    if (c.length === 2) y += 2000;
    if (c === '0206') y = 2026; // "17/9/0206"
    const date = iso(y, mon, Number(a));
    const tail = str.slice(h.end, k + 1 < hits.length ? hits[k + 1].at : undefined);
    out.push({ date: validIso(date) ? date : null, raw: h.m[0], tail });
  });
  return out;
}
function amountIn(tail) {
  const m = /S?\$\s*([\d,]+(?:\.\d+)?)|-\s*([\d,]+(?:\.\d+)?)\s*(k)?(?![-\d])/i.exec(tail || '');
  if (!m) return null;
  const v = Number((m[1] || m[2]).replace(/,/g, ''));
  return m[3] ? v * 1000 : v;
}
const numCell = (v) => (typeof v === 'number' ? v : Number(String(v || '').replace(/[$,\s]/g, '').replace(/^-$/, '0')) || 0);
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Same normalisation as the WCT customer matching (case / punctuation / legal-suffix insensitive).
const n1 = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[’`]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
const LEGAL = new Set(['pte', 'ltd', 'private', 'limited', 'llp', 'co', 'inc', 'the', 's', 'sg', 'plc', 'corp', 'corporation', 'company']);
const n2 = (s) => n1(s).split(' ').filter((w) => w && !LEGAL.has(w)).join(' ');

const BC_REVENUE = { MV: '4-1001', AA: '4-1002', CD: '4-1003', TS: '4-1004' };
/** BC Air invoice subject → revenue bucket (AA when nothing else says otherwise). */
function bcairBucket(subject) {
  const t = String(subject || '').toLowerCase();
  if (/troubleshoot/.test(t)) return { key: 'TS', rule: 'troubleshoot' };
  if (/chemical\s*degreas|degreas|maintenance agreement|cleaning of|servicing|maintenance\b/.test(t)) return { key: 'CD', rule: 'degreasing / maintenance' };
  if (/\bacmv\b|\bkes\b|mechanical\s*ventilation|\bmv\b|fit-?\s*out|new (kitchen )?exhaust system|exhaust ductwork|air-?\s*con(ditioning)?\s*system/.test(t)) return { key: 'MV', rule: 'MV / ACMV / fit-out' };
  if (/\ba\s*&\s*a\b|\bvo\b|variation|supply|install|replace|relocat|rectif|sprinkler|cladding|diversion/.test(t)) return { key: 'AA', rule: 'supply / install / A&A / VO' };
  return { key: 'AA', rule: 'unclear → AA 4-1002', flag: true };
}

// Rows with no invoice number whose number the owner gave (the SIBA-24 series is missing exactly these).
const BCAIR_INFERRED = { 193: ['SIBA-24-00009', /royals/i], 194: ['SIBA-24-00010', /supersonic/i] };

/** bcair-sales-summary.xlsx → invoices (BC Air's own: I-0000xx Aug–Sep 2022 + SIBA-…). wctcRows: the
 *  WCT Cleaning tracker, so a WCT-era row already imported from there is not imported twice. */
async function readBcair(wctDocs, wctcRows = []) {
  const file = path.join(DIR, 'trackers', 'bcair-sales-summary.xlsx');
  const { raw, txt } = readSheet(file);
  const fills = await fillsOf(file);
  const out = [];
  const skipped = [];
  const flags = [];
  const seen = new Map();
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r.some((v) => v !== '')) continue;
    const t = txt[i];
    const flag = (note) => flags.push({ src: 'bcair', row: i + 1, no: oneLine(r[4]), note });
    let number = oneLine(r[4]);
    const refer = /\(Refer to\s*([^)]+)\)/i.exec(number);
    number = number.replace(/\(Refer to[^)]*\)/i, '').trim();
    const amount = R2(numCell(r[5]));
    const customer = oneLine(r[1]);
    const subject = oneLine(r[3]);
    const quotation = oneLine(r[2]);
    let inferred = null;
    let combo = null;
    const numberCell = number;
    if (!/^(I-?\d{6}|SIBA-)/.test(number) && BCAIR_INFERRED[i + 1] && BCAIR_INFERRED[i + 1][1].test(customer)) {
      number = BCAIR_INFERRED[i + 1][0];
      inferred = number;
      flags.push({ src: 'bcair', row: i + 1, no: number, note: `number inferred: ${number} (the tracker's number cell ${numberCell ? `reads "${numberCell.slice(0, 40)}"` : 'is empty'}; the owner gave the number)` });
    }
    // WCT-era invoices (WCT issued them: I-006366 … I-007439, Jan–Jul 2022).
    const nos = number.split(/\s*\/\s*/);
    const wct = nos.map((n) => wctDocs.get(n)).filter(Boolean);
    if (/^I-00[67]\d{3}/.test(number)) {
      const w = wctDocs.get(nos[0]);
      const exact = w && w.date === excelDate(r[0]) && n2(w.cust) === n2(customer) && Math.abs(R2(w.total - w.gst) - amount) < 0.005;
      // Two numbers (WCT ERP / WCT Cleaning): BC Air's real invoice (the WCT copy is an "(NG)" placeholder).
      // The owner: import it, unless wct-nongst-cn-summary already carries it (its number or its ERP number).
      if (!exact && nos.length > 1) {
        const inWctc = wctcRows.filter((x) => nos.includes(x.number) || nos.includes(x.erpNo));
        if (inWctc.length) {
          skipped.push({ src: 'bcair', row: i + 1, no: number, date: excelDate(r[0]), customer, amount, why: `already imported from wct-nongst-cn-summary as ${inWctc.map((x) => `${x.number} (ERP ${x.erpNo}, ${x.date}, ${money(x.amount)})`).join(' + ')}`, combo: true, wctc: inWctc.map((x) => x.number) });
          continue;
        }
        combo = nos.find((x) => /^I\d{6}$/.test(x)) || nos[0];
        flag(`WCT-era row ${number}: BC Air's real invoice, not in wct-nongst-cn-summary: imported as ${combo}`);
      }
    }
    if (/^I-00[67]\d{3}/.test(number) && !combo) {
      const w = wctDocs.get(nos[0]);
      const exact = w && w.date === excelDate(r[0]) && n2(w.cust) === n2(customer) && Math.abs(R2(w.total - w.gst) - amount) < 0.005;
      skipped.push({ src: 'bcair', row: i + 1, no: number, date: excelDate(r[0]), customer, amount, why: exact ? 'issued by WCT: same number, date, customer and amount (ex 7% GST) in the WCT org' : `WCT-era number; in WCT as ${wct.map((x) => `${x.name} ${x.date} $${x.total}${/^\(NG\)/.test(x.subject) ? ' (NG)' : ''}`).join(' + ') || 'not found'}${nos.length > 1 ? ` · second number ${nos.slice(1).join(', ')}` : ''}`, exact });
      continue;
    }
    if (combo) number = combo;
    if (!/^(I-?\d{6}|SIBA-\d\d-\d{5}(-R\d)?)$/.test(number)) {
      skipped.push({ src: 'bcair', row: i + 1, no: number || '(blank)', date: excelDate(r[0]), customer, amount, why: `no usable invoice number ("${(number || '').slice(0, 40)}")`, quotation });
      continue;
    }
    let date = excelDate(r[0]);
    if (!date) {
      const td = textDates(r[0])[0]?.date;
      if (td) { date = td; flag(`date "${t[0]}" read as ${td}`); }
      else {
        date = excelDate(r[7]) || null;
        flag(`no invoice date ("${oneLine(t[0]).slice(0, 40)}"); used the payment date ${date}`);
      }
    }
    const n = (seen.get(number) || 0) + 1;
    seen.set(number, n);
    const name = n === 1 ? number : `${number}-${n}`;
    if (n > 1) flag(`invoice number used twice in the tracker: this one imported as ${name}`);
    // Payments / credit notes
    const payments = [];
    const cns = [];
    const pd = r[7];
    const method = oneLine(r[8]);
    const cnCol = oneLine(r[9]);
    const cnInMethod = /(CNBA-\d\d-\d{4})\s*(?:-\s*\$?\s*([\d,.]+))?/i.exec(method);
    let unknown = false;
    if (typeof pd === 'number') payments.push({ date: excelDate(pd), amount, method });
    else if (pd) {
      const ds = textDates(pd);
      if (/cancel/i.test(pd)) {
        const no = cnInMethod?.[1] || cnCol;
        cns.push({ no: no || '(no CN number)', date: ds[0]?.date || date, amount: null, why: oneLine(pd) });
        if (!no) flag(`"${oneLine(pd)}" with no CN number`);
      } else if (/need check/i.test(pd)) { unknown = true; flag('"NEED CHECK STATEMENT": left unpaid'); }
      else if (ds.length) {
        const withAmt = ds.map((d) => ({ ...d, amt: amountIn(d.tail) }));
        if (withAmt.some((d) => d.amt != null)) {
          for (const d of withAmt) if (d.amt != null) payments.push({ date: d.date, amount: R2(d.amt), method });
          const s = R2(payments.reduce((a, p) => a + p.amount, 0));
          if (Math.abs(s - amount) > 0.005) flag(`payments in the text add up to ${money(s)} of ${money(amount)}`);
        } else {
          payments.push({ date: ds[ds.length - 1].date, amount, method });
          if (ds.length > 1) flag(`${ds.length} payment dates, no amounts: one payment of the full amount on the last date ${ds[ds.length - 1].date}`);
        }
        if (ds.some((d) => !d.date)) flag(`unreadable payment date in "${oneLine(pd)}"`);
      } else { unknown = true; flag(`payment cell "${oneLine(pd)}" not understood: left unpaid`); }
    }
    if (cnInMethod && !cns.some((c) => c.no === cnInMethod[1])) cns.push({ no: cnInMethod[1], date: null, amount: cnInMethod[2] ? R2(Number(cnInMethod[2].replace(/,/g, ''))) : null, why: 'in the Method column' });
    if (cnCol && !cns.some((c) => c.no === cnCol)) cns.push({ no: cnCol, date: null, amount: null, why: 'Credit Note column' });
    const paid = R2(payments.reduce((a, p) => a + p.amount, 0));
    for (const c of cns) {
      if (c.amount == null) c.amount = Math.max(0, R2(amount - paid - cns.filter((x) => x !== c && x.amount != null).reduce((a, x) => a + x.amount, 0)));
      if (!c.date) {
        const yy = /^CNBA-(\d\d)-/.exec(c.no)?.[1];
        const y = yy ? `20${yy}` : date.slice(0, 4);
        c.date = date.slice(0, 4) === y ? date : `${y}-01-01`;
        c.dateRule = date.slice(0, 4) === y ? 'invoice date' : `1 Jan ${y} (from the CN number)`;
      }
    }
    const credited = R2(cns.reduce((a, c) => a + c.amount, 0));
    const owed = R2(amount - paid - credited);
    if (owed < -0.005) flag(`paid ${money(paid)} + credited ${money(credited)} is more than the invoice ${money(amount)}`);
    for (const p of payments) if (!p.date) { p.date = date; flag('payment date unreadable: used the invoice date'); }
    const fill = ['FFB7B7B7', 'FFFFFF00', 'FFB6D7A8', 'FFC9DAF8'].find((c) => hasFill(fills, i, c));
    out.push({
      src: 'bcair', row: i + 1, name, number, date, customer, quotation, subject, amount, payments, cns, paid, credited, owed: Math.max(0, owed), unknown, inferred, combo, numberCell: inferred ? numberCell : undefined,
      wctNumbers: combo ? nos.filter((x) => /^I-\d{6}$/.test(x)) : [],
      method, refer: refer?.[1]?.trim() || null, fill: fill || null, bucket: (({ key, rule, flag }) => ({ code: BC_REVENUE[key], key, rule, flag }))(bcairBucket(subject)),
      extra: { uvLight: oneLine(t[10]) || null, airCleaner: oneLine(t[11]) || null, serialNo: oneLine(t[12]) || null, doNo: oneLine(t[13]) || null },
    });
  }
  return { rows: out, skipped, flags };
}

const WCTC_TYPE = { CD: 'CD', AA: 'AA', VO: 'AA', MV: 'MV', TS: 'TS' };
const WCTC_BANK = { ocbc: '1-2420', chequeNew: '1-2400', wctS: '1-2430', cash: '1-2440', contra: '1-2450' };
function wctcBank(method, remarks) {
  const m = String(method || '').toLowerCase();
  if (/paid to wct \(s\)/i.test(remarks || '')) return { code: WCTC_BANK.wctS, rule: 'paid to WCT (S) → WCT (S) - OCBC Bank' };
  if (/contra/.test(m)) return { code: WCTC_BANK.contra, rule: 'Contra Payment' };
  if (/\bf(t)?\b|transfer|giro/.test(m)) return { code: WCTC_BANK.ocbc, rule: 'FT / transfer / GIRO → OCBC Bank', mixed: /cheque|che\b|cash/.test(m) };
  if (/che(que)?/.test(m)) return { code: WCTC_BANK.chequeNew, rule: 'Cheque → Cheque Account - New', flag: true, mixed: /cash/.test(m) };
  if (/cash/.test(m)) return { code: WCTC_BANK.cash, rule: 'Cash → Petty Cash - Henry', flag: true };
  return { code: WCTC_BANK.ocbc, rule: `"${oneLine(method) || 'no method'}" → OCBC Bank`, flag: true };
}

/** wct-nongst-cn-summary.xlsx (WCT Cleaning Technology = BC Air) → invoices I000xxx. */
async function readWctc(wctDocs) {
  const file = path.join(DIR, 'trackers', 'wct-nongst-cn-summary.xlsx');
  const { raw, txt } = readSheet(file);
  const fills = await fillsOf(file);
  const out = [];
  const skipped = [];
  const flags = [];
  const seen = new Map();
  for (let i = 3; i < raw.length; i++) {
    const r = raw[i];
    if (!oneLine(r[1]) && !oneLine(r[4])) continue;
    const t = txt[i];
    const number = oneLine(r[4]);
    const flag = (note) => flags.push({ src: 'wctc', row: i + 1, no: number, note });
    const amount = R2(numCell(r[6]));
    const customer = oneLine(r[1]);
    const cancelled = fillCount(fills, i, 'FFFFC7CE') >= 3;
    if (!/^I\d{6}$/.test(number)) { skipped.push({ src: 'wctc', row: i + 1, no: number, customer, amount, why: `not an I000000 number ("${number}")` }); continue; }
    const paidCol = R2(numCell(r[8]));
    if (cancelled && amount === 0 && paidCol === 0) { skipped.push({ src: 'wctc', row: i + 1, no: number, customer, amount, why: 'Job Cancelled (red row), nothing billed or paid', cn: oneLine(r[10]) || null }); continue; }
    let date = excelDate(r[0]);
    if (!date) { const d = textDates(String(r[0]).replace(/\*/g, ''))[0]?.date; date = d; flag(`date "${t[0]}" read as ${d}`); }
    if (date && date < '2018-01-01') {
      const near = [raw[i - 1], raw[i + 1]].map((x) => excelDate(x?.[0])).find((d) => d && d >= '2018-01-01');
      flag(`date ${date} is before WCT Cleaning's first invoice: used the neighbouring row's year (${near?.slice(0, 4)})`);
      if (near) date = `${near.slice(0, 4)}${date.slice(4)}`;
    }
    const n = (seen.get(number) || 0) + 1;
    seen.set(number, n);
    if (n > 1) flag(`number used twice: imported as ${number}-${n}`);
    const name = n === 1 ? number : `${number}-${n}`;
    const balance = R2(Math.max(0, numCell(r[9])));
    const cnNo = oneLine(r[10]);
    const erpNo = oneLine(r[3]).replace(/^I-?/, 'I-') || null;
    const typeRaw = oneLine(r[15]);
    const key = typeRaw.split('+').map((x) => WCTC_TYPE[x.trim().toUpperCase()]).find(Boolean);
    const wct = erpNo ? wctDocs.get(erpNo) : null;
    let bucket;
    if (/referral/i.test(typeRaw)) bucket = { code: '8-3000', key: 'REF', rule: 'Referral Fee → 8-3000 Other Income', flag: true };
    else if (key) bucket = { code: BC_REVENUE[key], key, rule: typeRaw.includes('+') ? `Type ${typeRaw} → first part ${key}` : `Type ${typeRaw}` };
    else { const b = bcairBucket(wct?.subject || ''); bucket = { code: BC_REVENUE[b.key], key: b.key, rule: `no Type: ${wct ? 'WCT ERP subject' : 'nothing to go on'} → ${b.key}`, flag: true }; }
    // payments: one per row (the tracker keeps one total); several dates → the last one
    const payments = [];
    const methodTxt = oneLine(t[12]);
    const remarks = oneLine(r[17]);
    if (paidCol) {
      let pdate = excelDate(r[7]);
      const ds = pdate ? [] : textDates(r[7]).filter((d) => d.date);
      if (!pdate && ds.length) {
        pdate = ds.map((d) => d.date).sort().pop();
        if (ds.length > 1) flag(`${ds.length} payment dates, one amount ${money(paidCol)}: posted on the last date ${pdate}`);
      }
      if (!pdate) { pdate = date; flag(`paid ${money(paidCol)} with no readable payment date ("${oneLine(t[7]).slice(0, 30)}"): used the invoice date`); }
      const bank = wctcBank(r[12], remarks);
      payments.push({ date: pdate, amount: paidCol, method: methodTxt, bank });
    }
    let cn = null;
    const gap = R2(amount - paidCol - balance);
    if (cnNo) {
      cn = { no: cnNo, amount: Math.max(0, gap), date: date };
      if (gap < -0.005) flag(`credit note ${cnNo} but paid ${money(paidCol)} + balance ${money(balance)} exceed the invoice ${money(amount)}`);
    } else if (Math.abs(gap) > 0.005) flag(`invoice ${money(amount)} − paid ${money(paidCol)} − balance ${money(balance)} = ${money(gap)} with no credit note`);
    out.push({
      src: 'wctc', row: i + 1, name, number, date, customer, quotation: oneLine(t[2]), erpNo, wct, amount, payments, paid: paidCol, owed: balance, cn, cancelled,
      credited: cn?.amount || 0, gap, type: typeRaw, bucket, method: methodTxt, cheque: oneLine(t[13]) || null, remarks, note: oneLine(r[18]) || null,
      salesperson: oneLine(r[16]) || null, status: oneLine(r[14]) || null, toBeBilled: oneLine(t[5]) || null,
    });
  }
  return { rows: out, skipped, flags };
}

/** Racking payment → bank account by the Payment Method text (owner's rules; anything else flagged). */
function wctrBank(method, toWctCleaning) {
  const m = oneLine(method);
  if (toWctCleaning || /wct/i.test(m)) return { code: '1-2160', rule: 'Payment to WCT Cleaning / WCT (S) → 1-2160 WCT (S) Systems Pte Ltd' };
  if (/contra/i.test(m)) return { code: '1-2180', rule: 'Contra → 1-2180 Contra Payment', flag: /\bft\b/i.test(m) ? `"${m}": contra + FT, posted as contra` : null };
  if (/^dbs/i.test(m)) return { code: '1-2110', rule: 'DBS… → 1-2110 DBS Bank', flag: /^dbs\s?\d{6}$/i.test(m) ? `"${m}" looks like a DBS cheque number: posted to 1-2110 DBS Bank as the rule says` : null };
  if (/^ocbc/i.test(m)) return { code: '1-2111', rule: 'OCBC… → 1-2111 OCBC Bank', flag: /\d{6}/.test(m) ? `"${m}" looks like an OCBC cheque number: posted to 1-2111 OCBC Bank as the rule says` : null };
  if (/che(que)?/i.test(m)) return { code: '1-2199', rule: 'Cheque → 1-2199 Undeposited Funds' };
  if (/\bft\b|transfer|giro/i.test(m)) return { code: '1-2111', rule: 'FT → 1-2111 OCBC Bank' };
  if (/^(uob|cimb)/i.test(m)) return { code: '1-2199', rule: 'UOB… / CIMB… (cheque number) → 1-2199 Undeposited Funds', flag: `"${m}": no rule for ${m.slice(0, 4).replace(/\d.*/, '')}; reads as a cheque number, posted to 1-2199 Undeposited Funds` };
  return { code: '1-2111', rule: `"${m || 'no method'}" → 1-2111 OCBC Bank`, flag: `"${m || 'no method'}": method unclear, posted to 1-2111 OCBC Bank` };
}
const wctrBucket = (text) => (/man\s*-?\s*power/i.test(text || '') ? { code: '4-2000', key: 'MANPOWER', rule: 'says manpower → 4-2000 Manpower' } : { code: '4-1000', key: 'INCOME', rule: '4-1000 Income' });

/** wctr-sales-summary-cn.xlsx → WCT Racking invoices INV22-xxx. */
async function readWctr() {
  const file = path.join(DIR, 'trackers', 'wctr-sales-summary-cn.xlsx');
  const { raw, txt } = readSheet(file);
  const fills = await fillsOf(file);
  const out = [];
  const skipped = [];
  const flags = [];
  for (let i = 4; i < raw.length; i++) {
    const r = raw[i];
    const number = oneLine(r[3]);
    if (!number) continue;
    const flag = (note) => flags.push({ src: 'wctr', row: i + 1, no: number, note });
    const amount = R2(numCell(r[4]));
    const paid = R2(numCell(r[6]));
    const balance = R2(Math.max(0, numCell(r[7])));
    let date = excelDate(r[0]);
    if (!date) { date = textDates(r[0])[0]?.date; flag(`date "${txt[i][0]}" read as ${date}`); }
    let pdate = null;
    if (paid) {
      pdate = excelDate(r[5]);
      if (!pdate) { const ds = textDates(r[5]).filter((d) => d.date); pdate = ds.map((d) => d.date).sort().pop() || date; if (ds.length !== 1) flag(`payment date "${oneLine(txt[i][5])}" → ${pdate}`); }
      if (pdate && pdate < '2018-01-01') { const fixed = `${date.slice(0, 4)}${pdate.slice(4)}`; flag(`payment date "${oneLine(txt[i][5])}" read as ${pdate}: typo, used the invoice's year (${fixed})`); pdate = fixed; }
    }
    const cnNo = oneLine(r[8]);
    const gap = R2(amount - paid - balance);
    if (!cnNo && Math.abs(gap) > 0.005) flag(`invoice ${money(amount)} − paid ${money(paid)} − balance ${money(balance)} = ${money(gap)} with no credit note`);
    out.push({
      src: 'wctr', row: i + 1, name: number, number, date, customer: oneLine(r[1]), quotation: oneLine(txt[i][2]), amount, paid, owed: balance, pdate,
      method: oneLine(txt[i][9]), status: oneLine(r[10]) || null, salesperson: oneLine(r[11]) || null, note: oneLine(r[12]) || null,
      cn: cnNo ? { no: cnNo, amount: Math.max(0, gap) } : null, gap,
      cancelled: hasFill(fills, i, 'FFF4CCCC'), yetToBill: hasFill(fills, i, 'FFFFE598') || hasFill(fills, i, 'FFFFE599'), toWctCleaning: hasFill(fills, i, 'FFDBDBDB'),
      bucket: wctrBucket(txt[i].join(' ')),
    });
    const last = out[out.length - 1];
    if (paid) last.payments = [{ date: pdate, amount: paid, method: last.method, bank: wctrBank(last.method, last.toWctCleaning) }];
  }
  return { rows: out, skipped, flags };
}

/** GST-inclusive test: how many amounts are a round figure before vs after taking GST out. */
function gstLook(rows) {
  const rate = (d) => (d < '2023-01-01' ? 0.07 : d < '2024-01-01' ? 0.08 : 0.09);
  const round = (v) => Math.abs(v - Math.round(v / 10) * 10) < 0.005;
  const withAmt = rows.filter((r) => r.amount > 0);
  const asGiven = withAmt.filter((r) => round(r.amount)).length;
  const exGst = withAmt.filter((r) => round(R2(r.amount / (1 + rate(r.date))))).length;
  const exact = withAmt.filter((r) => { const net = r.amount / (1 + rate(r.date)); return Math.abs(net - Math.round(net)) < 0.005 && !round(r.amount); }).length;
  return { invoices: withAmt.length, roundAsGiven: asGiven, roundAfterRemovingGst: exGst, wholeDollarOnlyAfterGst: exact };
}

// ================================================================ customers + documents

function nextCustomerCode(name, pool) {
  const first = String(name || '').normalize('NFD').toUpperCase().match(/[A-Z0-9]/)?.[0] || 'X';
  const prefix = `C${first}`;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const c of pool) { const m = re.exec(c.customerCode || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** One customer per normalised name (existing ones in the org are reused). */
function planCustomers(rows, existing, batch) {
  const groups = new Map();
  for (const r of rows) {
    const k = n2(r.customer) || n1(r.customer) || '(no name)';
    if (!groups.has(k)) groups.set(k, { key: k, names: new Map(), docs: 0, last: '' });
    const g = groups.get(k);
    g.names.set(r.customer, (g.names.get(r.customer) || 0) + 1);
    g.docs++;
  }
  const byKey = new Map();
  for (const c of existing) { const k = n2(c.name) || n1(c.name); if (!byKey.has(k)) byKey.set(k, c); }
  const pool = [...existing];
  const plan = [];
  for (const g of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const name = [...g.names.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    const have = byKey.get(g.key);
    if (have) { plan.push({ key: g.key, existing: have, name: have.name, code: have.customerCode, docs: g.docs, variants: [...g.names.keys()] }); continue; }
    const code = nextCustomerCode(name, pool);
    pool.push({ customerCode: code });
    plan.push({ key: g.key, id: crypto.randomUUID(), name, code, docs: g.docs, variants: [...g.names.keys()], externalRef: `erp-import:${batch}` });
  }
  return { byKey: new Map(plan.map((p) => [p.key, p])), plan };
}

function buildDoc(r, { orgId, batch, templateId, company, customer, kind }) {
  const total = R2(r.amount);
  const owed = R2(Math.min(total, Math.max(0, r.owed)));
  const paid = R2(r.paid ?? total - owed);
  const serial = Number(String(r.number).replace(/\D/g, '').slice(-6)) || 0;
  const docTime = Date.parse(`${r.date}T09:00:00+08:00`) + (serial % 3600) * 1000;
  const createdAt = new Date(Math.min(docTime, Date.now() - 3600e3));
  const lineText = kind === 'wctc' ? (r.wct?.subject ? oneLine(r.wct.subject).replace(/^\(NG\)\s*/i, '') : `${r.type || 'Service'}${r.note ? ` · ${r.note}` : ''}`) : kind === 'wctr' ? `Invoice ${r.number}${r.note ? ` · ${r.note}` : ''}` : r.subject;
  const erpStatus = r.cancelled ? 'Cancelled' : owed <= 0.005 ? 'Paid' : paid > 0.005 || (r.credited || 0) > 0.005 ? 'Partial' : 'Receivable';
  const erpImport = {
    source: kind === 'wctc' ? 'wctc-tracker' : kind === 'wctr' ? 'wctr-tracker' : 'bcair-tracker',
    batch,
    erpId: `${kind}:${r.name}`,
    originalNumber: r.number,
    status: erpStatus,
    // The ERP balance: payments + credit notes made before import = gross − this (common/erp-import.ts).
    balanceAtImport: owed,
    trackerRow: r.row,
    quotationNo: r.quotation || null,
    erpCustomer: r.customer,
    paidAtImport: paid,
    payments: (r.payments || (r.pdate ? [{ date: r.pdate, amount: r.paid, method: r.method }] : [])).map((p) => ({ date: p.date, amount: p.amount, method: p.method || null })),
    creditNotes: kind === 'bcair' ? r.cns.map((c) => ({ no: c.no, amount: c.amount, date: c.date })) : r.cn ? [{ no: r.cn.no, amount: r.cn.amount }] : [],
    ...(kind === 'wctc' ? { issuedAs: 'WCT Cleaning Technology', erpInvoiceNo: r.erpNo, type: r.type || null, salesperson: r.salesperson, cheque: r.cheque, remarks: r.remarks || null, note: r.note } : {}),
    ...(kind === 'wctr' ? { salesperson: r.salesperson, note: r.note, paymentMethod: r.method || null, yetToBillFinal: r.yetToBill || undefined, paymentToWctCleaning: r.toWctCleaning || undefined } : {}),
    ...(kind === 'bcair' ? { subject: r.subject, ...r.extra, referTo: r.refer, needCheckStatement: r.unknown || undefined, numberInferred: r.inferred ? true : undefined, trackerNumberCell: r.numberCell || undefined, wctErpNumbers: r.wctNumbers?.length ? r.wctNumbers : undefined } : {}),
    importedAt: new Date().toISOString(),
  };
  const config = {
    date: r.date,
    dueDate: r.date,
    documentNumber: r.name,
    currency: 'SGD',
    company,
    gstRegNo: '',
    footerMessage: '',
    customerId: customer.id,
    customerCode: customer.code || customer.customerCode || '',
    customerName: customer.name,
    customerEmail: '',
    customerAddress: '',
    billTo: '',
    location: '',
    deliveryTo: '',
    collectFrom: '',
    attention: { name: '', email: '', phoneNumber: '' },
    contact: '',
    subject: kind === 'bcair' ? r.subject : lineText,
    referenceNo: kind === 'wctc' ? r.erpNo || '' : r.quotation || '',
    salesPerson: r.salesperson || '',
    salesMobile: '',
    paymentTerms: '',
    remarks: kind === 'wctc' ? 'Issued as WCT Cleaning Technology' : '',
    termsAndConditions: '',
    note: '',
    issueBy: '',
    projectName: '',
    items: [{ id: 1, itemCode: '', description: lineText, quantity: 1, unitPrice: total, amount: total, tax: '0', uom: '', isService: true, revenueTag: 'service', accountCode: r.bucket?.code || '', inventoryItemId: '' }],
    grossTotal: total,
    discountAmount: 0,
    subTotal: total,
    gstAmount: 0,
    nettTotal: total,
    gstPercent: 0,
    taxApplicable: 'N',
    absorbTax: 'N',
    showTotals: true,
    confirmedAt: createdAt.toISOString(),
    sourceDocumentId: '',
    sourceDocumentType: '',
    sourceDocumentNumber: '',
    erpImport,
  };
  // Money keys as stampDocumentMoney writes them (canonical + legacy twins).
  Object.assign(config, { totalWithTax: total, xeroGross: total, outstandingBalance: owed, xeroBalance: owed, paidToDate: R2(total - owed), xeroAmountPaid: R2(total - owed) });
  return { id: crypto.randomUUID(), type: 'INVOICE', name: r.name, status: owed > 0.005 ? 'pending_payment' : 'paid', templateId, createdAt, config, orgId, r, total, owed, year: r.date.slice(0, 4), src: kind };
}

// ================================================================ BC Air history journals

function bcairHistory(docs) {
  const journals = [];
  const flags = [];
  const seq = new Map();
  const num = (base) => { const n = (seq.get(base) || 0) + 1; seq.set(base, n); return n === 1 ? base : `${base}-${n}`; };
  const at = (d) => `${d}T00:00:00.000Z`;
  for (const d of docs) {
    const r = d.r;
    if (d.total > 0.005) journals.push({ number: num(`ERP-INV-${r.name}`), type: 'INVOICE', date: at(r.date), docId: d.id, reference: r.name, description: `${r.src === 'wctc' ? 'WCT Cleaning' : 'BC Air'} invoice ${r.name} · ${r.customer}`.slice(0, 250), src: r.src, bucket: r.bucket.code, lines: [{ code: '1-9999', dr: d.total, cr: 0 }, { code: r.bucket.code, dr: 0, cr: d.total }] });
    for (const [k, p] of (r.payments || []).entries()) {
      if (!(p.amount > 0.005)) continue;
      const bank = r.src === 'wctc' ? p.bank : { code: /cash/i.test(p.method || '') ? '1-2200' : '1-2100', rule: /cash/i.test(p.method || '') ? 'Cash → 1-2200 Petty Cash - BC Air' : `${p.method || 'no method'} → 1-2100 UOB (brief: unknown bank → UOB)`, flag: /cash/i.test(p.method || '') || /^I-/.test(r.name) };
      if (bank.flag) flags.push({ src: r.src, no: r.name, note: `payment ${money(p.amount)} ${p.date}: ${bank.rule}` });
      journals.push({ number: num(`ERP-PAY-${r.name}-${k + 1}`), type: 'PAYMENT', date: at(p.date), docId: d.id, reference: r.name, description: `Payment on ${r.name} · ${p.method || 'no method'}${r.cheque ? ` ${r.cheque}` : ''}`.slice(0, 250), src: r.src, bank: bank.code, bankRule: bank.rule, lines: [{ code: bank.code, dr: p.amount, cr: 0 }, { code: '1-9999', dr: 0, cr: p.amount }] });
    }
    const cns = r.src === 'bcair' ? r.cns : r.cn ? [{ ...r.cn, date: r.cn.date || r.date }] : [];
    for (const c of cns) {
      if (!(c.amount > 0.005)) continue;
      journals.push({ number: num(`ERP-CN-${c.no}`), type: 'CREDIT_NOTE', date: at(c.date), docId: null, reference: c.no, description: `Credit note ${c.no} on ${r.name} · ${r.customer}`.slice(0, 250), src: r.src, lines: [{ code: r.bucket.code, dr: c.amount, cr: 0 }, { code: '1-9999', dr: 0, cr: c.amount }] });
    }
  }
  for (const j of journals) {
    const dr = R2(j.lines.reduce((a, l) => a + l.dr, 0));
    if (dr !== R2(j.lines.reduce((a, l) => a + l.cr, 0))) throw new Error(`${j.number} does not balance`);
    j.total = dr;
  }
  return { journals, flags };
}

/** WCT Racking: Dr 1-3100 / Cr 4-1000 (4-2000 manpower) per invoice, payments Dr bank / Cr 1-3100. No GST. */
function rackHistory(docs) {
  const journals = [];
  const flags = [];
  const at = (d) => `${d}T00:00:00.000Z`;
  for (const d of docs) {
    const r = d.r;
    if (d.total > 0.005) journals.push({ number: `ERP-INV-${r.name}`, type: 'INVOICE', date: at(r.date), docId: d.id, reference: r.name, description: `WCT Racking invoice ${r.name} · ${r.customer}`.slice(0, 250), src: 'wctr', bucket: r.bucket.code, lines: [{ code: '1-3100', dr: d.total, cr: 0 }, { code: r.bucket.code, dr: 0, cr: d.total }] });
    for (const [k, p] of (r.payments || []).entries()) {
      if (!(p.amount > 0.005)) continue;
      if (p.bank.flag) flags.push({ src: 'wctr', no: r.name, note: p.bank.flag });
      journals.push({ number: `ERP-PAY-${r.name}-${k + 1}`, type: 'PAYMENT', date: at(p.date), docId: d.id, reference: r.name, description: `Payment on ${r.name} · ${p.method || 'no method'}${r.note ? ` · ${r.note}` : ''}`.slice(0, 250), src: 'wctr', bank: p.bank.code, bankRule: p.bank.rule, lines: [{ code: p.bank.code, dr: p.amount, cr: 0 }, { code: '1-3100', dr: 0, cr: p.amount }] });
    }
    if (r.cn?.amount > 0.005) journals.push({ number: `ERP-CN-${r.cn.no}`, type: 'CREDIT_NOTE', date: at(r.date), docId: null, reference: r.cn.no, description: `Credit note ${r.cn.no} on ${r.name} · ${r.customer}`.slice(0, 250), src: 'wctr', lines: [{ code: r.bucket.code, dr: r.cn.amount, cr: 0 }, { code: '1-3100', dr: 0, cr: r.cn.amount }] });
  }
  for (const j of journals) {
    const dr = R2(j.lines.reduce((a, l) => a + l.dr, 0));
    if (dr !== R2(j.lines.reduce((a, l) => a + l.cr, 0))) throw new Error(`${j.number} does not balance`);
    j.total = dr;
  }
  return { journals, flags };
}

// ================================================================ DB

async function connect() {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  if (SEARCH_PATH) await c.query(`SET search_path TO ${SEARCH_PATH.split(',').map((s) => `"${s.trim()}"`).join(',')}`);
  return { c, q: async (sql, p) => (await c.query(sql, p)).rows };
}
async function guardOrg(q, key) {
  const id = target(key);
  const o = (await q(`SELECT id, name FROM "Organization" WHERE id = $1`, [id]))[0];
  if (!o) throw new Error(`org ${id} not found`);
  if (!AS && o.name !== ORG_NAME[id]) throw new Error(`org ${id} is "${o.name}", expected "${ORG_NAME[id]}"`);
  return o;
}

/** Everything the steps touch for one org, hashed: rollback proof. */
async function fingerprint(q, orgId) {
  const parts = {
    accounts: await q(`SELECT id, code, name, "accountType", "isActive", "parentAccountId", "isControlAccount" FROM "ChartOfAccount" WHERE "organizationId" = $1 ORDER BY id`, [orgId]),
    setting: await q(`SELECT "controlAccounts", "accountCodeRanges" FROM "AccountingSetting" WHERE "organizationId" = $1`, [orgId]),
    journals: await q(`SELECT j.id, j."journalNumber", j.status, (SELECT json_agg(json_build_array(l."accountId", l.debit, l.credit) ORDER BY l.id) FROM "JournalEntryLine" l WHERE l."journalEntryId" = j.id) lines FROM "JournalEntry" j WHERE j."organizationId" = $1 ORDER BY j.id`, [orgId]),
    documents: await q(`SELECT id, name, status, md5(config::text) h FROM "Document" WHERE "organizationId" = $1 ORDER BY id`, [orgId]),
    customers: await q(`SELECT id, name, "customerCode" FROM "Customer" WHERE "organizationId" = $1 ORDER BY id`, [orgId]),
    modules: await q(`SELECT "moduleCode", enabled, config FROM "OrganizationModule" WHERE "organizationId" = $1 ORDER BY "moduleCode"`, [orgId]),
    roles: await q(`SELECT name, "allowedModules" FROM "Role" WHERE "organizationId" = $1 ORDER BY name`, [orgId]),
    features: await q(`SELECT features FROM "OrganizationUIConfig" WHERE "organizationId" = $1`, [orgId]),
    formats: await q(`SELECT "documentType", pattern, "nextSerial", "lastResetKey" FROM "DocumentNumberFormat" WHERE "organizationId" = $1 ORDER BY "documentType", pattern`, [orgId]),
  };
  const h = crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
  return { h, counts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length])) };
}

function writeLog(step, entry) {
  const f = LOG(step);
  const all = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  all.push(entry);
  fs.writeFileSync(f, JSON.stringify(all, null, 1));
  console.log(`logged → ${path.relative(process.cwd(), f)}`);
}
const lastApply = (step, orgId) => (fs.existsSync(LOG(step)) ? JSON.parse(fs.readFileSync(LOG(step), 'utf8')) : []).filter((e) => e.mode === 'APPLY' && e.org === orgId && !e.rolledBack).pop();
function markRolledBack(step, at) {
  const f = LOG(step);
  const all = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const e of all) if (e.at === at) e.rolledBack = new Date().toISOString();
  fs.writeFileSync(f, JSON.stringify(all, null, 1));
}
async function actionLog(c, orgId, action, details) {
  await c.query(
    `INSERT INTO "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status, "createdAt") VALUES ($1,'SYSTEM','system:wct-group-books','System creation',$2,'cron',$3,$4,$5::jsonb,'SUCCESS',now())`,
    [crypto.randomUUID(), orgId, action, details.resource || 'accounting', JSON.stringify(details)],
  );
}
async function insertRows(c, table, cols, rows, casts = {}) {
  for (let i = 0; i < rows.length; i += 400) {
    const part = rows.slice(i, i + 400);
    const params = [];
    const values = part.map((r) => `(${r.map((v, k) => { params.push(v); return `$${params.length}${casts[cols[k]] || ''}`; }).join(',')})`);
    await c.query(`INSERT INTO "${table}" (${cols.map((x) => `"${x}"`).join(',')}) VALUES ${values.join(',')}`, params);
  }
}

// ================================================================ step: modules

const BCAIR_SALES_MENUS = ['quotations', 'invoices', 'credit-notes'];
async function planModules(q) {
  const plan = [];
  for (const key of ['BCAIR', 'RACK']) {
    const orgId = target(key);
    const mods = await q(`SELECT id, "moduleCode", enabled, config FROM "OrganizationModule" WHERE "organizationId" = $1`, [orgId]);
    const roles = await q(`SELECT id, name, "allowedModules" FROM "Role" WHERE "organizationId" = $1`, [orgId]);
    const ui = (await q(`SELECT id, features FROM "OrganizationUIConfig" WHERE "organizationId" = $1`, [orgId]))[0];
    const on = key === 'BCAIR' ? ['SALES', 'CUSTOMERS', 'MAINTENANCE'] : ['MAINTENANCE'];
    for (const code of on) {
      const m = mods.find((x) => x.moduleCode === code);
      if (!m) throw new Error(`${key}: no ${code} module row`);
      let config = m.config;
      if (key === 'BCAIR' && code === 'SALES') config = { ...m.config, subMenus: (m.config?.subMenus || []).filter((s) => BCAIR_SALES_MENUS.includes(typeof s === 'string' ? s : s.key)) };
      if (!m.enabled || JSON.stringify(config) !== JSON.stringify(m.config)) plan.push({ org: key, orgId, kind: 'module', id: m.id, code, before: { enabled: m.enabled, config: m.config }, after: { enabled: true, config } });
    }
    const add = key === 'BCAIR' ? { Accounting: ['SALES', 'CUSTOMERS'], Viewer: ['SALES', 'CUSTOMERS', 'MAINTENANCE'] } : { Operations: ['MAINTENANCE'], Sales: ['MAINTENANCE'], Viewer: ['MAINTENANCE'] };
    for (const [name, mods2] of Object.entries(add)) {
      const r = roles.find((x) => x.name === name);
      if (!r) continue;
      if (!r.allowedModules.length) continue; // [] = every module
      const next = [...r.allowedModules, ...mods2.filter((m) => !r.allowedModules.includes(m))];
      if (next.length !== r.allowedModules.length) plan.push({ org: key, orgId, kind: 'role', id: r.id, code: name, before: r.allowedModules, after: next });
    }
    if (!ui) throw new Error(`${key}: no OrganizationUIConfig row`);
    if ((ui.features || {})[HOLD] !== true) plan.push({ org: key, orgId, kind: 'flag', id: ui.id, code: HOLD, before: (ui.features || {})[HOLD] ?? null, after: true });
  }
  return plan;
}
async function stepModules() {
  const { c, q } = await connect();
  try {
    for (const k of ['BCAIR', 'RACK']) await guardOrg(q, k);
    if (ROLLBACK) {
      const e = (fs.existsSync(LOG('modules')) ? JSON.parse(fs.readFileSync(LOG('modules'), 'utf8')) : []).filter((x) => x.mode === 'APPLY' && !x.rolledBack).pop();
      if (!e) throw new Error('no modules APPLY to roll back');
      console.log(`rollback modules applied ${e.at}: ${e.changes.length} changes`);
      if (!APPLY) return;
      await c.query('BEGIN');
      for (const ch of e.changes) {
        if (ch.kind === 'module') await c.query(`UPDATE "OrganizationModule" SET enabled = $1, config = $2, "updatedAt" = now() WHERE id = $3`, [ch.before.enabled, ch.before.config, ch.id]);
        if (ch.kind === 'role') await c.query(`UPDATE "Role" SET "allowedModules" = $1, "updatedAt" = now() WHERE id = $2`, [ch.before, ch.id]);
        if (ch.kind === 'flag') await c.query(`UPDATE "OrganizationUIConfig" SET features = CASE WHEN $1::jsonb IS NULL THEN features - $2 ELSE jsonb_set(features, ARRAY[$2], $1::jsonb) END WHERE id = $3`, [ch.before === null ? null : JSON.stringify(ch.before), ch.code, ch.id]);
      }
      for (const orgId of [...new Set(e.changes.map((x) => x.orgId))]) await actionLog(c, orgId, 'UPDATE', { resource: 'modules', note: 'Rolled back WCT group modules / flags', changes: e.changes.filter((x) => x.orgId === orgId).length });
      await c.query('COMMIT');
      markRolledBack('modules', e.at);
      console.log('ROLLED BACK');
      return;
    }
    const plan = await planModules(q);
    console.table(plan.map((p) => ({ org: p.org, kind: p.kind, what: p.code, before: JSON.stringify(p.kind === 'module' ? p.before.enabled : p.before).slice(0, 60), after: JSON.stringify(p.kind === 'module' ? (p.code === 'SALES' && p.org === 'BCAIR' ? `on · menus ${BCAIR_SALES_MENUS.join('/')}` : true) : p.after).slice(0, 60) })));
    if (!APPLY || !plan.length) return;
    const before = { BCAIR: await fingerprint(q, target('BCAIR')), RACK: await fingerprint(q, target('RACK')) };
    await c.query('BEGIN');
    for (const p of plan) {
      if (p.kind === 'module') await c.query(`UPDATE "OrganizationModule" SET enabled = true, config = $1, "updatedAt" = now() WHERE id = $2 AND "organizationId" = $3`, [p.after.config, p.id, p.orgId]);
      if (p.kind === 'role') await c.query(`UPDATE "Role" SET "allowedModules" = $1, "updatedAt" = now() WHERE id = $2 AND "organizationId" = $3`, [p.after, p.id, p.orgId]);
      if (p.kind === 'flag') await c.query(`UPDATE "OrganizationUIConfig" SET features = jsonb_set(COALESCE(features,'{}'::jsonb), ARRAY[$1], 'true'::jsonb) WHERE id = $2 AND "organizationId" = $3`, [HOLD, p.id, p.orgId]);
    }
    for (const orgId of [...new Set(plan.map((x) => x.orgId))]) await actionLog(c, orgId, 'UPDATE', { resource: 'modules', note: 'WCT group: modules / roles / hold flag', changes: plan.filter((x) => x.orgId === orgId).map((x) => `${x.kind} ${x.code}`) });
    await c.query('COMMIT');
    writeLog('modules', { at: new Date().toISOString(), mode: 'APPLY', searchPath: SEARCH_PATH, changes: plan, before });
    console.log(`APPLIED ${plan.length} changes`);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

// ================================================================ step: coa (bcair / ymm)

async function stepCoa(key) {
  const chart = chartOf(key);
  const { c, q } = await connect();
  const orgId = target(key);
  const step = `coa-${SLUG[key]}`;
  try {
    await guardOrg(q, key);
    const accounts = await q(`SELECT id, code, name, "isActive", description FROM "ChartOfAccount" WHERE "organizationId" = $1`, [orgId]);
    const setting = (await q(`SELECT "controlAccounts", "accountCodeRanges" FROM "AccountingSetting" WHERE "organizationId" = $1`, [orgId]))[0];
    if (!setting) throw new Error('no AccountingSetting row');
    if (ROLLBACK) {
      const e = lastApply(step, orgId);
      if (!e) throw new Error(`no ${step} APPLY for this org in ${LOG(step)}`);
      const created = e.created.map((x) => x.id);
      const used = (await q(`SELECT count(*)::int n FROM "JournalEntryLine" WHERE "accountId" = ANY($1::text[])`, [created]))[0].n;
      console.log(`rollback ${step} applied ${e.at}: ${created.length} accounts, ${e.deactivated.length} reactivated · journal lines on them now: ${used}`);
      if (used) throw new Error('the chart is in use: roll back cutover / post first');
      if (!APPLY) return;
      await c.query('BEGIN');
      await c.query(`UPDATE "ChartOfAccount" SET "parentAccountId" = NULL WHERE id = ANY($1::text[])`, [created]);
      const d = await c.query(`DELETE FROM "ChartOfAccount" WHERE id = ANY($1::text[]) AND "organizationId" = $2`, [created, orgId]);
      if (d.rowCount !== created.length) throw new Error(`deleted ${d.rowCount} of ${created.length}`);
      if (e.deactivated.length) await c.query(`UPDATE "ChartOfAccount" SET "isActive" = true, "updatedAt" = now() WHERE id = ANY($1::text[]) AND "organizationId" = $2`, [e.deactivated, orgId]);
      await c.query(`UPDATE "AccountingSetting" SET "controlAccounts" = $1, "accountCodeRanges" = $2, "updatedAt" = now() WHERE "organizationId" = $3`, [e.previousControls, e.previousRanges, orgId]);
      await actionLog(c, orgId, 'DELETE', { resource: 'chart-of-accounts', note: `Rolled back ${step}`, accounts: created.length });
      await c.query('COMMIT');
      markRolledBack(step, e.at);
      const fp = await fingerprint(q, orgId);
      console.log(`ROLLED BACK · fingerprint ${fp.h} ${fp.h === e.before ? '= before the apply ✓' : `≠ before (${e.before})`}`);
      return;
    }
    const clash = chart.filter((r) => accounts.some((a) => a.code === r.code));
    const controls = controlsOf(key, chart);
    console.log(`${key} chart: ${chart.length} accounts (${chart.filter((r) => r.isHeader).length} headers + 3-9000 computed, ${chart.filter((r) => r.accountType !== 'HEADER').length} posting) · existing ${accounts.length} (${accounts.filter((a) => a.isActive).length} active) · code clashes ${clash.length}`);
    console.table(Object.entries(controls).map(([k, v]) => ({ role: k, now: setting.controlAccounts?.[k] ?? '', to: `${v} ${chart.find((r) => r.code === v)?.name}` })));
    if (clash.length) throw new Error(`codes already used: ${clash.map((r) => r.code).join(', ')}`);
    const lines = (await q(`SELECT count(*)::int n FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id = l."journalEntryId" WHERE j."organizationId" = $1`, [orgId]))[0].n;
    if (lines) throw new Error(`${key} already has ${lines} journal lines: this step expects an empty ledger`);
    if (!APPLY) return;
    const before = await fingerprint(q, orgId);
    await c.query('BEGIN');
    const ids = new Map(chart.map((r) => [r.code, crypto.randomUUID()]));
    const isNew = (r) => / \(WCT Cleaning\)$/.test(r.name);
    await insertRows(c, 'ChartOfAccount', ['id', 'organizationId', 'code', 'name', 'description', 'accountType', 'category', 'normalBalance', 'isControlAccount', 'isSystem', 'isActive', 'parentAccountId', 'createdAt', 'updatedAt'],
      chart.map((r) => [ids.get(r.code), orgId, r.code, r.name,
        r.code === '3-9000' ? 'ABSS · computed by AIMS from the P&L, never posted to' : r.isHeader ? 'ABSS header · totals its sub-accounts, never posted to' : isNew(r) ? 'ABSS · from WCT Cleaning Technology (combined into BC Air)' : 'ABSS',
        r.accountType, r.category, r.normalBalance, Object.entries(controls).some(([k, v]) => CONTROL_ROLES.has(k) && v === r.code), false, true, r.parentCode ? ids.get(r.parentCode) : null, new Date().toISOString(), new Date().toISOString()]),
      { createdAt: '::timestamp', updatedAt: '::timestamp' });
    const deact = accounts.filter((a) => a.isActive).map((a) => a.id);
    if (deact.length) await c.query(`UPDATE "ChartOfAccount" SET "isActive" = false, "updatedAt" = now() WHERE id = ANY($1::text[]) AND "organizationId" = $2`, [deact, orgId]);
    const nextControls = { ...(setting.controlAccounts || {}) };
    for (const k of ['provisionForDepreciation', 'capitalReserve', 'mediumTermLiabilities', 'longTermLiabilities', 'foreignBankAccount', 'workInProgress']) delete nextControls[k];
    Object.assign(nextControls, controls);
    await c.query(`UPDATE "AccountingSetting" SET "controlAccounts" = $1, "accountCodeRanges" = $2, "updatedAt" = now() WHERE "organizationId" = $3`, [nextControls, codeRanges(key, chart), orgId]);
    await actionLog(c, orgId, 'IMPORT', { resource: 'chart-of-accounts', note: `ABSS chart of accounts (${step})`, accounts: chart.length, deactivated: deact.length });
    await c.query('COMMIT');
    const after = await fingerprint(q, orgId);
    writeLog(step, { at: new Date().toISOString(), mode: 'APPLY', org: orgId, searchPath: SEARCH_PATH, before: before.h, after: after.h, created: [...ids].map(([code, id]) => ({ code, id })), deactivated: deact, previousControls: setting.controlAccounts, previousRanges: setting.accountCodeRanges });
    console.log(`APPLIED ${chart.length} accounts, ${deact.length} default accounts deactivated · fingerprint ${before.h} → ${after.h}`);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

// ================================================================ step: docs (bcair / racking)

async function loadWctDocs(q) {
  const rows = await q(`SELECT id, name, config->>'date' date, config->>'customerName' cust, config->>'subject' subject, COALESCE((config->>'totalWithTax')::numeric, 0) total, COALESCE((config->>'gstAmount')::numeric, 0) gst, (config->>'outstandingBalance')::numeric owed, config->'erpImport'->>'status' st FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE' AND config ? 'erpImport'`, [ORG.WCT]);
  return new Map(rows.map((r) => [r.name, r]));
}

async function planDocs(q, key, wctDocs) {
  const orgId = target(key);
  const batch = BATCH[key];
  const parsed = key === 'BCAIR' ? await (async () => { const wc = await readWctc(wctDocs); return [await readBcair(wctDocs, wc.rows), wc]; })() : [await readWctr()];
  const rows = parsed.flatMap((p) => p.rows);
  const org = (await q(`SELECT name, address, "phoneNumber" FROM "Organization" WHERE id = $1`, [orgId]))[0];
  const company = { name: AS ? org.name : ORG_NAME[ORG[key]], address: org.address || '', phoneNumber: org.phoneNumber || '' };
  const tpls = await q(`SELECT t.id, t.name, t."isDefault" FROM "DocumentTemplate" t WHERE t."organizationId" = $1 AND t.type = 'INVOICE' ORDER BY t."isDefault" DESC, t."createdAt"`, [orgId]);
  const tpl = (key === 'RACK' && tpls.find((t) => t.name === 'WCT Racking Tax Invoice')) || tpls[0];
  if (!tpl) throw new Error(`${key}: no INVOICE template`);
  const existing = await q(`SELECT id, name, "customerCode" FROM "Customer" WHERE "organizationId" = $1`, [orgId]);
  const cust = planCustomers(rows, existing, batch);
  const have = new Set((await q(`SELECT config->'erpImport'->>'erpId' e FROM "Document" WHERE "organizationId" = $1 AND config->'erpImport'->>'batch' = $2`, [orgId, batch])).map((r) => r.e));
  const taken = new Set((await q(`SELECT name FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE' AND name IS NOT NULL`, [orgId])).map((r) => r.name));
  const docs = [];
  let already = 0;
  for (const r of rows) {
    const kind = r.src;
    if (have.has(`${kind}:${r.name}`)) { already++; continue; }
    if (taken.has(r.name)) throw new Error(`${key}: invoice ${r.name} already exists in the org`);
    taken.add(r.name);
    const cp = cust.byKey.get(n2(r.customer) || n1(r.customer) || '(no name)');
    const customer = cp.existing ? { id: cp.existing.id, name: cp.existing.name, code: cp.existing.customerCode } : { id: cp.id, name: cp.name, code: cp.code };
    docs.push(buildDoc(r, { orgId, batch, templateId: tpl.id, company, customer, kind }));
  }
  const formats = await q(`SELECT "documentType", pattern, "nextSerial", "lastResetKey" FROM "DocumentNumberFormat" WHERE "organizationId" = $1`, [orgId]);
  // A number format's fixed prefix never matches an imported name (else maxExistingSerial would move it).
  const prefixHits = formats.filter((f) => { const p = f.pattern.split('{#')[0].replace(/\{DOC\}/g, 'INV').replace(/\{YYYY\}/g, '2026').replace(/\{YY\}/g, '26').replace(/\{MM\}/g, '11').replace(/\{[A-Z]+\}/g, ''); return p && docs.some((d) => d.name.startsWith(p)); });
  return { orgId, batch, parsed, rows, docs, already, cust, tpl, formats, prefixHits };
}

async function stepDocs(key) {
  const { c, q } = await connect();
  const orgId = target(key);
  const step = `docs-${key === 'BCAIR' ? 'bcair' : 'racking'}`;
  try {
    await guardOrg(q, key);
    if (ROLLBACK) {
      const batch = BATCH[key];
      const docs = await q(`SELECT id FROM "Document" WHERE "organizationId" = $1 AND config->'erpImport'->>'batch' = $2`, [orgId, batch]);
      const ids = docs.map((d) => d.id);
      const custs = await q(`SELECT id FROM "Customer" WHERE "organizationId" = $1 AND "externalRef" = $2`, [orgId, `erp-import:${batch}`]);
      const blockers = {
        journals: (await q(`SELECT count(*)::int n FROM "JournalEntry" WHERE "organizationId" = $1 AND "sourceDocumentId" = ANY($2::text[])`, [orgId, ids]))[0].n,
        payments: (await q(`SELECT count(*)::int n FROM "Payment" WHERE "documentId" = ANY($1::uuid[])`, [ids]))[0].n,
        otherDocsOnNewCustomers: custs.length ? (await q(`SELECT count(*)::int n FROM "Document" WHERE "organizationId" = $1 AND (config->>'customerId') = ANY($2) AND COALESCE(config->'erpImport'->>'batch','') <> $3`, [orgId, custs.map((x) => x.id), batch]))[0].n : 0,
      };
      console.log(`rollback ${step}: ${ids.length} documents, ${custs.length} customers · blockers ${JSON.stringify(blockers)}`);
      if (Object.values(blockers).some(Boolean)) throw new Error('rollback refused: something depends on the imported rows (roll back post-bcair first)');
      if (!APPLY) return;
      await c.query('BEGIN');
      await c.query(`DELETE FROM "DocumentEmbedding" WHERE "documentId" = ANY($1::uuid[])`, [ids]).catch(() => {});
      const d = await c.query(`DELETE FROM "Document" WHERE id = ANY($1::uuid[]) AND "organizationId" = $2 AND config->'erpImport'->>'batch' = $3`, [ids, orgId, batch]);
      if (d.rowCount !== ids.length) throw new Error(`deleted ${d.rowCount} of ${ids.length}`);
      const dc = await c.query(`DELETE FROM "Customer" WHERE "organizationId" = $1 AND "externalRef" = $2`, [orgId, `erp-import:${batch}`]);
      await actionLog(c, orgId, 'DELETE', { resource: 'documents', note: `Rolled back ${step}`, batch, documents: d.rowCount, customers: dc.rowCount });
      await c.query('COMMIT');
      const e = lastApply(step, orgId);
      if (e) markRolledBack(step, e.at);
      const fp = await fingerprint(q, orgId);
      console.log(`ROLLED BACK ${d.rowCount} documents, ${dc.rowCount} customers · fingerprint ${fp.h}${e ? ` ${fp.h === e.before ? '= before the apply ✓' : `≠ before (${e.before})`}` : ''}`);
      return;
    }
    const wctDocs = await loadWctDocs(q);
    const p = await planDocs(q, key, wctDocs);
    printDocsPlan(key, p);
    if (p.prefixHits.length) throw new Error(`number format prefix matches imported names: ${JSON.stringify(p.prefixHits)}`);
    if (!APPLY || !p.docs.length) return;
    const before = await fingerprint(q, orgId);
    await c.query('BEGIN');
    const now = new Date().toISOString();
    const newCusts = p.cust.plan.filter((x) => !x.existing && p.docs.some((d) => d.config.customerId === x.id));
    await insertRows(c, 'Customer', ['id', 'name', 'customerCode', 'organizationId', 'externalRef', 'currency', 'createdAt', 'updatedAt'], newCusts.map((x) => [x.id, x.name, x.code, orgId, x.externalRef, 'SGD', now, now]), { createdAt: '::timestamp', updatedAt: '::timestamp' });
    await insertRows(c, 'Document', ['id', 'createdAt', 'updatedAt', 'config', 'documentTemplateId', 'type', 'organizationId', 'name', 'status', 'revisionNumber', 'version'],
      p.docs.map((d) => [d.id, d.createdAt.toISOString(), d.createdAt.toISOString(), JSON.stringify(d.config), d.templateId, 'INVOICE', orgId, d.name, d.status, 0, 0]),
      { createdAt: '::timestamp', updatedAt: '::timestamp', config: '::jsonb', status: '::"DocumentStatus"', id: '::uuid' });
    const fBefore = JSON.stringify(p.formats);
    const fAfter = JSON.stringify(await q(`SELECT "documentType", pattern, "nextSerial", "lastResetKey" FROM "DocumentNumberFormat" WHERE "organizationId" = $1`, [orgId]));
    if (fBefore !== fAfter) throw new Error('number formats changed');
    await actionLog(c, orgId, 'IMPORT', { resource: 'documents', note: `Imported tracker invoices, batch ${p.batch}`, batch: p.batch, documents: p.docs.length, customersCreated: newCusts.length });
    await c.query('COMMIT');
    const after = await fingerprint(q, orgId);
    writeLog(step, { at: now, mode: 'APPLY', org: orgId, searchPath: SEARCH_PATH, batch: p.batch, before: before.h, after: after.h, documents: p.docs.map((d) => d.id), customers: newCusts.map((x) => x.id) });
    console.log(`APPLIED ${p.docs.length} documents, ${newCusts.length} customers · fingerprint ${before.h} → ${after.h} · number formats unchanged ✓`);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

function printDocsPlan(key, p) {
  const by = (f, list = p.docs) => list.reduce((m, d) => { const k = f(d); m[k] = m[k] || { n: 0, total: 0, owed: 0 }; m[k].n++; m[k].total = R2(m[k].total + d.total); m[k].owed = R2(m[k].owed + d.owed); return m; }, {});
  console.log(`\n${key}: ${p.docs.length} invoices to import (already imported ${p.already}) · template "${p.tpl.name}" · customers: ${p.cust.plan.filter((x) => !x.existing).length} new, ${p.cust.plan.filter((x) => x.existing).length} existing`);
  console.table(Object.entries(by((d) => `${d.src} ${d.year}`)).map(([k, v]) => ({ source_year: k, invoices: v.n, total: money(v.total), open: money(v.owed) })));
}

// ================================================================ step: post-bcair / cutover

async function ledger(q, orgId) {
  const accounts = await q(`SELECT id, code, name, "accountType", category, "isActive" FROM "ChartOfAccount" WHERE "organizationId" = $1`, [orgId]);
  const lines = await q(`SELECT l.debit, l.credit, j."entryDate", j.status, a.code, a.category FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id = l."journalEntryId" JOIN "ChartOfAccount" a ON a.id = l."accountId" WHERE j."organizationId" = $1`, [orgId]);
  const setting = (await q(`SELECT "controlAccounts", "fiscalYearEndMonth" m, "fiscalYearEndDay" d FROM "AccountingSetting" WHERE "organizationId" = $1`, [orgId]))[0];
  return { accounts, setting, postings: lines.filter((l) => l.status === 'POSTED').map((l) => ({ code: l.code, category: l.category, date: l.entryDate, dr: l.debit, cr: l.credit })) };
}

async function stepPost(key = 'BCAIR') {
  const { c, q } = await connect();
  const orgId = target(key);
  const step = `post-${key === 'BCAIR' ? 'bcair' : 'racking'}`;
  const MARK = key === 'BCAIR' ? GL_MARK : GL_MARK_RACK;
  try {
    await guardOrg(q, key);
    if (ROLLBACK) return await rollbackMarked(c, q, orgId, MARK, step);
    const docs = await q(`SELECT id, name, config FROM "Document" WHERE "organizationId" = $1 AND config->'erpImport'->>'batch' = $2`, [orgId, BATCH[key]]);
    if (!docs.length) throw new Error(`no imported ${key} documents: run docs-${key === 'BCAIR' ? 'bcair' : 'racking'} first`);
    // The trackers again, matched to the imported documents by erpId.
    let parsed;
    if (key === 'BCAIR') {
      const wctDocs = await loadWctDocs(q);
      const wc = await readWctc(wctDocs);
      parsed = [await readBcair(wctDocs, wc.rows), wc].flatMap((x) => x.rows);
    } else parsed = (await readWctr()).rows;
    const byErp = new Map(docs.map((d) => [d.config.erpImport.erpId, d]));
    const list = parsed.map((r) => { const d = byErp.get(`${r.src}:${r.name}`); return d ? { id: d.id, total: R2(d.config.totalWithTax), r } : null; }).filter(Boolean);
    const hist = key === 'BCAIR' ? bcairHistory(list) : rackHistory(list);
    const acc = new Map((await q(`SELECT id, code, "accountType", "isActive" FROM "ChartOfAccount" WHERE "organizationId" = $1`, [orgId])).map((a) => [a.code, a]));
    const missing = [...new Set(hist.journals.flatMap((j) => j.lines.map((l) => l.code)))].filter((k) => !acc.get(k)?.isActive || acc.get(k).accountType === 'HEADER');
    if (missing.length) throw new Error(`accounts missing / not postable: ${missing.join(', ')} (coa-${key === 'BCAIR' ? 'bcair' : 'racking'} first)`);
    const existing = new Set((await q(`SELECT "journalNumber" FROM "JournalEntry" WHERE "organizationId" = $1 AND "createdBy" = $2`, [orgId, MARK])).map((r) => r.journalNumber));
    const todo = hist.journals.filter((j) => !existing.has(j.number));
    console.log(`documents ${docs.length} · journals planned ${hist.journals.length} · already posted ${hist.journals.length - todo.length} · to post ${todo.length}`);
    if (list.length !== docs.length) throw new Error(`${docs.length} imported documents but ${list.length} matched a tracker row`);
    if (!APPLY) return;
    const now = new Date().toISOString();
    await c.query('BEGIN');
    const je = [];
    const jl = [];
    for (const j of todo) {
      const id = crypto.randomUUID();
      je.push([id, orgId, j.number, j.date, j.type, 'POSTED', false, j.reference, j.description, j.total, j.total, 'SGD', j.docId, now, 'erp-gl', now, now, MARK]);
      j.lines.forEach((l, n) => jl.push([crypto.randomUUID(), id, acc.get(l.code).id, n + 1, null, l.dr, l.cr]));
    }
    const T = { entryDate: '::timestamp', postedAt: '::timestamp', createdAt: '::timestamp', updatedAt: '::timestamp' };
    await insertRows(c, 'JournalEntry', ['id', 'organizationId', 'journalNumber', 'entryDate', 'type', 'status', 'isUnconfirmed', 'reference', 'description', 'totalDebit', 'totalCredit', 'currency', 'sourceDocumentId', 'postedAt', 'postedBy', 'createdAt', 'updatedAt', 'createdBy'], je, T);
    await insertRows(c, 'JournalEntryLine', ['id', 'journalEntryId', 'accountId', 'lineNumber', 'description', 'debit', 'credit'], jl);
    await actionLog(c, orgId, 'IMPORT', { resource: 'journal', note: key === 'BCAIR' ? 'Posted BC Air + WCT Cleaning tracker history' : 'Posted WCT Racking tracker history', marker: MARK, journals: todo.length });
    await c.query('COMMIT');
    writeLog(step, { at: now, mode: 'APPLY', org: orgId, searchPath: SEARCH_PATH, marker: MARK, posted: todo.length });
    console.log(`APPLIED ${todo.length} journals · marker ${MARK}`);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

async function rollbackMarked(c, q, orgId, marker, step, after) {
  const n = (await q(`SELECT count(*)::int n, COALESCE(round(sum("totalDebit")::numeric, 2), 0) amount FROM "JournalEntry" WHERE "organizationId" = $1 AND "createdBy" = $2`, [orgId, marker]))[0];
  console.log(`rollback ${step}: ${n.n} journals with marker ${marker} (Dr ${money(n.amount)})`);
  if (!APPLY) return;
  await c.query('BEGIN');
  const d = await c.query(`DELETE FROM "JournalEntry" WHERE "organizationId" = $1 AND "createdBy" = $2`, [orgId, marker]);
  if (d.rowCount !== n.n) throw new Error(`deleted ${d.rowCount}, expected ${n.n}`);
  if (after) await after(c);
  await actionLog(c, orgId, 'DELETE', { resource: 'journal', note: `Rolled back ${step}`, marker, journals: d.rowCount });
  await c.query('COMMIT');
  const e = lastApply(step, orgId);
  if (e) markRolledBack(step, e.at);
  console.log(`ROLLED BACK ${d.rowCount} journals (lines cascade)`);
}

/** Closes + balancing journal against a ledger (postings), to the chart's balances. */
function cutoverPlan(chart, led) {
  const fy = { month: led.setting.m || 12, day: led.setting.d || 31 };
  const catOf = new Map(chart.map((r) => [r.code, r.category]));
  const closes = gl.planCloses(led.postings, CUTOVER, fy, '3-8000');
  const withCloses = led.postings.concat(closes.flatMap((j) => j.lines.map((l) => ({ code: l.code, category: catOf.get(l.code), date: j.date, dr: l.dr, cr: l.cr }))));
  const tb = gl.trialBalance(withCloses, CUTOVER, fy, '3-8000');
  const codes = new Set(chart.map((r) => r.code));
  const outside = new Map([...tb.keys()].filter((k) => !codes.has(k) && Math.abs(tb.get(k)) >= 0.005).map((k) => [k, k]));
  return { fy, closes, tb, plan: gl.planCutover(chart, tb, outside) };
}

async function stepCutover(key) {
  const chart = chartOf(key);
  const step = `cutover-${SLUG[key]}`;
  const { c, q } = await connect();
  const orgId = target(key);
  try {
    await guardOrg(q, key);
    if (ROLLBACK) {
      const e = lastApply(step, orgId);
      return await rollbackMarked(c, q, orgId, CUT_MARK, step, e?.holdBefore !== undefined ? async (cc) => {
        await cc.query(`UPDATE "OrganizationUIConfig" SET features = jsonb_set(COALESCE(features,'{}'::jsonb), ARRAY[$1], $2::jsonb) WHERE "organizationId" = $3`, [HOLD, JSON.stringify(e.holdBefore), orgId]);
      } : null);
    }
    if ((await q(`SELECT count(*)::int n FROM "JournalEntry" WHERE "organizationId" = $1 AND "createdBy" = $2`, [orgId, CUT_MARK]))[0].n) throw new Error('cutover journals already exist: roll back first');
    const led = await ledger(q, orgId);
    const { closes, plan } = cutoverPlan(chart, led);
    console.log(`${key}: ${led.postings.length} posted lines · year-end closes ${closes.map((j) => j.year).join(', ') || 'none'}`);
    printCutover(plan);
    const hold = HOLD_ORGS.includes(key);
    const held = hold ? (await q(`SELECT count(*)::int n FROM "Payment" p JOIN "Document" d ON d.id = p."documentId" WHERE p."organizationId" = $1 AND d.config ? 'erpImport'`, [orgId]))[0].n : 0;
    if (hold) console.log(`payments recorded on imported invoices since the import (held): ${held}`);
    if (!APPLY) return;
    if (held) throw new Error(`${held} payments recorded on imported invoices: post or review the held journals before the hold flag goes off`);
    const acc = new Map(led.accounts.filter((a) => a.isActive).map((a) => [a.code, a.id]));
    const missing = [...new Set([...closes.flatMap((j) => j.lines), ...plan.lines].map((l) => l.code))].filter((k) => !acc.has(k));
    if (missing.length) throw new Error(`inactive / missing accounts: ${missing.join(', ')}`);
    const now = new Date().toISOString();
    const JE = ['id', 'organizationId', 'journalNumber', 'entryDate', 'type', 'status', 'isUnconfirmed', 'reference', 'description', 'totalDebit', 'totalCredit', 'currency', 'postedAt', 'postedBy', 'createdAt', 'updatedAt', 'createdBy'];
    const JL = ['id', 'journalEntryId', 'accountId', 'lineNumber', 'description', 'debit', 'credit'];
    const T = { entryDate: '::timestamp', postedAt: '::timestamp', createdAt: '::timestamp', updatedAt: '::timestamp' };
    const total = R2(plan.lines.reduce((a, l) => a + l.dr, 0));
    const ui = (await q(`SELECT features FROM "OrganizationUIConfig" WHERE "organizationId" = $1`, [orgId]))[0];
    await c.query('BEGIN');
    for (const j of closes) {
      const id = crypto.randomUUID();
      await insertRows(c, 'JournalEntry', JE, [[id, orgId, `ABSS-YE-${j.year}`, j.date, 'ADJUSTMENT', 'POSTED', false, `YE-${j.year}`, `Year-end close ${j.year} (tracker history): roll P&L into retained earnings`, j.total, j.total, 'SGD', now, 'abss-cutover', now, now, CUT_MARK]], T);
      await insertRows(c, 'JournalEntryLine', JL, j.lines.map((l, n) => [crypto.randomUUID(), id, acc.get(l.code), n + 1, `Year-end close ${j.year}`, l.dr, l.cr]));
    }
    const id = crypto.randomUUID();
    const src = { BCAIR: 'BC Air + WCT Cleaning ABSS', RACK: 'WCT Racking ABSS', YMM: 'YMM ABSS accounts list' }[key];
    await insertRows(c, 'JournalEntry', JE, [[id, orgId, `ABSS-CUTOVER-${CUTOVER}`, `${CUTOVER}T00:00:00.000Z`, 'OPENING_BALANCE', 'POSTED', false, `ABSS ${CUTOVER}`, `Cutover from ABSS: every account brought to its ${src} balance at ${CUTOVER}, offset to 3-9999`, total, total, 'SGD', now, 'abss-cutover', now, now, CUT_MARK]], T);
    await insertRows(c, 'JournalEntryLine', JL, plan.lines.map((l, n) => [crypto.randomUUID(), id, acc.get(l.code), n + 1, `ABSS ${money(l.abss)} · AIMS ${money(l.aims)}`.slice(0, 250), l.dr, l.cr]));
    const holdBefore = hold ? (ui?.features || {})[HOLD] ?? null : undefined;
    if (hold) await c.query(`UPDATE "OrganizationUIConfig" SET features = jsonb_set(COALESCE(features,'{}'::jsonb), ARRAY[$1], 'false'::jsonb) WHERE "organizationId" = $2`, [HOLD, orgId]);
    await actionLog(c, orgId, 'IMPORT', { resource: 'journal', note: `ABSS cutover at ${CUTOVER}`, closes: closes.map((j) => j.year), lines: plan.lines.length, total, ...(hold ? { holdErpImportPaymentGl: false } : {}) });
    await c.query('COMMIT');
    writeLog(step, { at: now, mode: 'APPLY', org: orgId, searchPath: SEARCH_PATH, marker: CUT_MARK, closes: closes.map((j) => j.year), lines: plan.lines.length, total, ...(holdBefore !== undefined ? { holdBefore } : {}) });
    console.log(`APPLIED ${closes.length} closes + cutover (${plan.lines.length} lines, ${money(total)})${hold ? ' · hold flag OFF' : ''}`);
    await verify(q, key, chart, orgId);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

function printCutover(plan) {
  console.log(`balancing journal: ${plan.lines.length} lines · Dr ${money(plan.lines.reduce((a, l) => a + l.dr, 0))} = Cr ${money(plan.lines.reduce((a, l) => a + l.cr, 0))} · 3-9999 after ${money(plan.hbAfter)} vs target ${money(plan.hbAbss)} ${Math.abs(plan.hbAfter - plan.hbAbss) < 0.005 ? '✓' : '✗'}`);
}

async function verify(q, key, chart, orgId) {
  const led = await ledger(q, orgId);
  const fy = { month: led.setting.m || 12, day: led.setting.d || 31 };
  const tb = gl.trialBalance(led.postings, CUTOVER, fy, '3-8000');
  const diffs = chart.filter((r) => r.accountType !== 'HEADER').map((r) => ({ code: r.code, name: r.name, target: r.debitBalance, aims: R2(tb.get(r.code) || 0) })).filter((r) => Math.abs(r.target - r.aims) >= 0.005);
  const dr = R2([...tb.values()].reduce((a, v) => a + (v > 0 ? v : 0), 0));
  const cr = R2([...tb.values()].reduce((a, v) => a + (v < 0 ? -v : 0), 0));
  console.log(`VERIFY ${key} at ${CUTOVER}: ${chart.filter((r) => r.accountType !== 'HEADER').length} accounts · differences ${diffs.length} · trial balance Dr ${money(dr)} Cr ${money(cr)} ${dr === cr ? '✓' : '✗'}`);
  if (diffs.length) console.table(diffs);
  return { diffs, dr, cr };
}

// ================================================================ step: wct-notes (WCT (S) Systems)

/** WCT "(NG)" invoice → the BC Air invoice(s) that carry its real amount (from the trackers). */
async function planWctNotes(q) {
  const wctDocs = await loadWctDocs(q);
  const ids = new Map((await q(`SELECT id, name FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE' AND config ? 'erpImport'`, [ORG.WCT])).map((r) => [r.name, r.id]));
  const wc = await readWctc(wctDocs);
  const bc = await readBcair(wctDocs, wc.rows);
  const pairs = [
    ...wc.rows.filter((r) => r.wct).map((r) => ({ wct: r.wct.name, bcair: r.name })),
    ...bc.rows.flatMap((r) => (r.wctNumbers || []).filter((n) => wctDocs.get(n)).map((n) => ({ wct: n, bcair: r.name }))),
  ];
  const byWct = new Map();
  for (const p of pairs) { if (!byWct.has(p.wct)) byWct.set(p.wct, []); if (!byWct.get(p.wct).includes(p.bcair)) byWct.get(p.wct).push(p.bcair); }
  const notes = [];
  const notNg = [];
  for (const [name, list] of byWct) {
    const d = wctDocs.get(name);
    if (!/^\s*\(NG\)/i.test(d.subject || '')) { notNg.push({ wct: name, bcair: list.join(', '), subject: oneLine(d.subject).slice(0, 50), total: d.total }); continue; }
    notes.push({ docId: ids.get(name), wct: name, bcair: list, text: `Real invoice in BC Air: ${list.join(', ')}` });
  }
  const have = new Set((await q(`SELECT "resourceId" FROM "AuditLog" WHERE "organizationId" = $1 AND resource = 'document' AND action = 'NOTE' AND details->>'marker' = $2`, [ORG.WCT, NOTE_MARK])).map((r) => r.resourceId));
  return { notes, todo: notes.filter((n) => !have.has(n.docId)), notNg, multi: notes.filter((n) => n.bcair.length > 1) };
}

async function stepWctNotes() {
  if (AS) throw new Error('wct-notes runs on the WCT org only (dev proof: --search-path with the dev WCT org, no --as)');
  const { c, q } = await connect();
  try {
    await guardOrg(q, 'WCT');
    if (ROLLBACK) {
      const n = (await q(`SELECT count(*)::int n FROM "AuditLog" WHERE "organizationId" = $1 AND details->>'marker' = $2`, [ORG.WCT, NOTE_MARK]))[0].n;
      console.log(`rollback wct-notes: ${n} notes with marker ${NOTE_MARK}`);
      if (!APPLY) return;
      await c.query('BEGIN');
      const d = await c.query(`DELETE FROM "AuditLog" WHERE "organizationId" = $1 AND resource = 'document' AND action = 'NOTE' AND details->>'marker' = $2`, [ORG.WCT, NOTE_MARK]);
      if (d.rowCount !== n) throw new Error(`deleted ${d.rowCount}, expected ${n}`);
      await actionLog(c, ORG.WCT, 'DELETE', { resource: 'documents', note: 'Rolled back the "Real invoice in BC Air" notes', marker: NOTE_MARK, notes: n });
      await c.query('COMMIT');
      const e = lastApply('wct-notes', ORG.WCT);
      if (e) markRolledBack('wct-notes', e.at);
      console.log(`ROLLED BACK ${d.rowCount} notes`);
      return;
    }
    const p = await planWctNotes(q);
    console.log(`WCT "(NG)" invoices that map to a BC Air invoice: ${p.notes.length} (already noted ${p.notes.length - p.todo.length}, to add ${p.todo.length}) · mapped to more than one BC Air invoice: ${p.multi.length} · mapped but not "(NG)" (no note): ${p.notNg.length}`);
    console.table(p.todo.slice(0, 5).map((n) => ({ wct: n.wct, note: n.text })));
    if (p.notes.some((n) => !n.docId)) throw new Error('a WCT invoice has no document id');
    if (!APPLY || !p.todo.length) return;
    // BC Air must hold every invoice the notes name (dev proof: no BC Air org on dev, check skipped).
    if (SEARCH_PATH) console.log('dev: BC Air presence check skipped (no BC Air org on dev)');
    else {
    const bcNames = new Set((await q(`SELECT name FROM "Document" WHERE "organizationId" = $1 AND config->'erpImport'->>'batch' = $2`, [ORG.BCAIR, BATCH.BCAIR])).map((r) => r.name));
    const absent = [...new Set(p.todo.flatMap((n) => n.bcair))].filter((x) => !bcNames.has(x));
    if (absent.length) throw new Error(`${absent.length} BC Air invoices named in the notes are not imported yet (docs-bcair first): ${absent.slice(0, 5).join(', ')}`);
    }
    const docsBefore = (await q(`SELECT md5(string_agg(id::text || md5(config::text) || status::text, ',' ORDER BY id)) h FROM "Document" WHERE "organizationId" = $1`, [ORG.WCT]))[0].h;
    const now = new Date().toISOString();
    await c.query('BEGIN');
    // A document note as the app's "History & notes" writes it (documents.service addDocumentNote).
    await insertRows(c, 'AuditLog', ['id', 'userId', 'userName', 'action', 'resource', 'resourceId', 'resourceName', 'organizationId', 'details', 'ipAddress', 'userAgent', 'status', 'createdAt'],
      p.todo.map((n) => [crypto.randomUUID(), 'system:wct-group-books', 'System creation', 'NOTE', 'document', n.docId, n.wct, ORG.WCT, JSON.stringify({ detail: n.text, marker: NOTE_MARK }), 'script', 'scripts/wct-group-books.js', 'SUCCESS', now]),
      { details: '::jsonb', status: '::"AuditStatus"', createdAt: '::timestamp' });
    await actionLog(c, ORG.WCT, 'UPDATE', { resource: 'documents', note: 'Added "Real invoice in BC Air" notes to the (NG) invoices', marker: NOTE_MARK, notes: p.todo.length });
    await c.query('COMMIT');
    const docsAfter = (await q(`SELECT md5(string_agg(id::text || md5(config::text) || status::text, ',' ORDER BY id)) h FROM "Document" WHERE "organizationId" = $1`, [ORG.WCT]))[0].h;
    writeLog('wct-notes', { at: now, mode: 'APPLY', org: ORG.WCT, searchPath: SEARCH_PATH, marker: NOTE_MARK, notes: p.todo.length, docsBefore, docsAfter });
    console.log(`APPLIED ${p.todo.length} notes · WCT documents ${docsBefore === docsAfter ? 'unchanged ✓' : 'CHANGED ✗'}`);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

// ================================================================ step: recode-ymm

// The YMM accounts were created with generated codes (only the Excel, names only, was to hand);
// ABSS's printout with the real codes came on 2026-11-07. Same 132 accounts in the same print
// order with the same balances, so each row pairs with its ABSS line by position, name and
// balance. Codes (and the parent where ABSS differs) change in place; journal lines point at
// account ids, so no posting moves.
async function planRecode(q, orgId) {
  const abss = await readAbssPdf(path.join(ABSS, 'ymm-accounts-list-2026-11-06.pdf'));
  writeChart(CHART.YMM_ABSS, 'ABSS "Accounts List [Summary]" YMM Kitchen Pte Ltd, 06/11/2026 20:47:39 (real codes)', abss);
  const neu = gl.readAbss(CHART.YMM_ABSS); // header sums + Dr = Cr proven here
  const old = gl.readAbss(CHART.YMM);
  if (neu.length !== old.length) throw new Error(`ABSS has ${neu.length} accounts, the generated chart ${old.length}`);
  const accounts = await q(`SELECT id, code, name, "accountType", "isActive", "parentAccountId" FROM "ChartOfAccount" WHERE "organizationId" = $1`, [orgId]);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const pairs = old.map((o, i) => {
    const n = neu[i];
    const a = byCode.get(o.code);
    const why = [];
    if (o.name !== n.name) why.push(`name "${o.name}" vs ABSS "${n.name}"`);
    if (Math.abs(o.balance - n.balance) >= 0.005) why.push(`balance ${o.balance} vs ABSS ${n.balance}`);
    if (o.code[0] !== n.code[0]) why.push('section');
    if (!a) why.push('not in AIMS');
    else if (a.name !== n.name || !a.isActive) why.push(`AIMS row "${a.name}" ${a.isActive ? '' : '(inactive)'}`);
    if (why.length) throw new Error(`row ${i + 1} ${o.code} → ${n.code}: ${why.join(', ')}`);
    return { id: a.id, name: n.name, from: o.code, to: n.code, level: n.level, isHeader: n.isHeader, accountType: a.accountType, parentFrom: a.parentAccountId, parentFromCode: byId.get(a.parentAccountId)?.code ?? null, parentToCode: n.parentCode, oldParentCode: o.parentCode, abss: n };
  });
  const idOfNew = new Map(pairs.map((p) => [p.to, p.id]));
  for (const p of pairs) p.parentTo = p.parentToCode ? idOfNew.get(p.parentToCode) : null;
  const paired = new Set(pairs.map((p) => p.id));
  const unmatched = accounts.filter((a) => !paired.has(a.id));
  // the new codes may only collide with rows that are themselves being re-coded
  const clash = pairs.filter((p) => byCode.has(p.to) && !paired.has(byCode.get(p.to).id));
  if (clash.length) throw new Error(`new codes held by other accounts: ${clash.map((p) => p.to).join(', ')}`);
  const headerBad = pairs.filter((p) => (p.isHeader || p.to === '3-9000') !== (p.accountType === 'HEADER'));
  if (headerBad.length) throw new Error(`header / posting mismatch: ${headerBad.map((p) => `${p.from}→${p.to}`).join(', ')}`);
  const setting = (await q(`SELECT "controlAccounts", "accountCodeRanges" FROM "AccountingSetting" WHERE "organizationId" = $1`, [orgId]))[0];
  const map = new Map(pairs.map((p) => [p.from, p.to]));
  const controls = Object.fromEntries(Object.entries(setting.controlAccounts || {}).map(([k, v]) => [k, map.get(v) ?? v]));
  const strayControls = Object.entries(setting.controlAccounts || {}).filter(([, v]) => !map.has(v));
  // code ranges: the GST range keeps the same three accounts (GST Liabilities, Collected, Paid);
  // every other YMM range is a whole section or a fixed code that does not move.
  const g = pairs.find((p) => p.name === 'GST Liabilities');
  const kids = pairs.filter((p) => p.parentToCode === g.to).map((p) => p.to).sort();
  const ranges = { ...(setting.accountCodeRanges || {}), taxLiabilities: { from: g.to, to: kids[kids.length - 1] } };
  for (const [k, r] of Object.entries(ranges)) for (const e of ['from', 'to']) if (k !== 'taxLiabilities' && map.has(r[e]) && map.get(r[e]) !== r[e]) throw new Error(`code range ${k}.${e} ${r[e]} moves: review`);
  return { pairs, unmatched, setting, controls, strayControls, ranges, neu, old, map };
}

/** Each account's balance by account id, at the cutover (per-account ledger, no P&L roll). */
async function balancesById(q, orgId) {
  const rows = await q(`SELECT l."accountId" id, sum(l.debit) - sum(l.credit) b FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id = l."journalEntryId" WHERE j."organizationId" = $1 AND j.status = 'POSTED' GROUP BY 1`, [orgId]);
  return new Map(rows.map((r) => [r.id, R2(r.b)]));
}

async function stepRecodeYmm() {
  const { c, q } = await connect();
  const orgId = target('YMM');
  const step = 'recode-ymm';
  try {
    await guardOrg(q, 'YMM');
    if (ROLLBACK) {
      const e = lastApply(step, orgId);
      if (!e) throw new Error(`no ${step} APPLY for this org in ${LOG(step)}`);
      const now = new Map((await q(`SELECT id, code FROM "ChartOfAccount" WHERE "organizationId" = $1`, [orgId])).map((a) => [a.id, a.code]));
      const off = e.changes.filter((x) => now.get(x.id) !== x.to);
      console.log(`rollback ${step} applied ${e.at}: ${e.changes.length} accounts back to their generated codes · not at the applied code now: ${off.length}`);
      if (off.length) throw new Error(`accounts changed since the apply: ${off.map((x) => x.to).join(', ')}`);
      if (!APPLY) return;
      await c.query('BEGIN');
      await recode(c, orgId, e.changes.map((x) => ({ id: x.id, code: x.from, parent: x.parentFrom })));
      await c.query(`UPDATE "AccountingSetting" SET "controlAccounts" = $1, "accountCodeRanges" = $2, "updatedAt" = now() WHERE "organizationId" = $3`, [e.previousControls, e.previousRanges, orgId]);
      await actionLog(c, orgId, 'UPDATE', { resource: 'chart-of-accounts', note: `Rolled back ${step}: generated codes restored`, accounts: e.changes.length });
      await c.query('COMMIT');
      markRolledBack(step, e.at);
      const fp = await fingerprint(q, orgId);
      console.log(`ROLLED BACK · fingerprint ${fp.h} ${fp.h === e.before ? '= before the apply ✓' : `≠ before (${e.before})`}`);
      return;
    }
    const done = lastApply(step, orgId);
    if (done) throw new Error(`already applied ${done.at} (roll back first to run it again)`);
    const p = await planRecode(q, orgId);
    const bal = await balancesById(q, orgId);
    const headerLines = p.pairs.filter((x) => x.accountType === 'HEADER' && bal.has(x.id));
    if (headerLines.length) throw new Error(`journal lines on header accounts: ${headerLines.map((x) => x.from).join(', ')}`);
    // proof: per account, before (old code) = after (new code, same row) = ABSS (new code)
    const proof = p.pairs.filter((x) => x.accountType !== 'HEADER').map((x) => ({ ...x, before: bal.get(x.id) || 0, oldTarget: p.old.find((o) => o.code === x.from).debitBalance, abssTarget: x.abss.debitBalance }));
    const bad = proof.filter((x) => Math.abs(x.before - x.abssTarget) >= 0.005 || Math.abs(x.before - x.oldTarget) >= 0.005);
    const changed = p.pairs.filter((x) => x.from !== x.to || x.parentFrom !== x.parentTo);
    const reparent = p.pairs.filter((x) => x.parentFrom !== x.parentTo);
    const led = await ledger(q, orgId);
    const fy = { month: led.setting.m || 12, day: led.setting.d || 31 };
    const tbAfter = gl.trialBalance(led.postings.map((l) => ({ ...l, code: p.map.get(l.code) ?? l.code })), CUTOVER, fy, '3-8000');
    const tbDiffs = p.neu.filter((r) => r.accountType !== 'HEADER').filter((r) => Math.abs(r.debitBalance - R2(tbAfter.get(r.code) || 0)) >= 0.005);
    const dr = R2([...tbAfter.values()].reduce((a, v) => a + (v > 0 ? v : 0), 0));
    const cr = R2([...tbAfter.values()].reduce((a, v) => a + (v < 0 ? -v : 0), 0));
    console.log(`YMM: ${p.pairs.length} accounts paired with ABSS (position + name + balance) · code changes ${p.pairs.filter((x) => x.from !== x.to).length} · parent changes ${reparent.length} · unchanged ${p.pairs.length - changed.length}`);
    console.log(`ABSS accounts missing in AIMS: 0 · AIMS YMM accounts not in ABSS: ${p.unmatched.length} (${p.unmatched.filter((a) => a.isActive).length} active)`);
    console.log(`balances: ${proof.length} posting accounts · before = ABSS = after ${bad.length ? `✗ ${bad.length} differ` : '✓ all, to the cent'} · trial balance after (codes remapped) diffs ${tbDiffs.length}, Dr ${money(dr)} Cr ${money(cr)} ${dr === cr ? '✓' : '✗'}`);
    if (bad.length) console.table(bad.map((x) => ({ from: x.from, to: x.to, name: x.name, before: x.before, abss: x.abssTarget })));
    if (p.strayControls.length) console.log('control roles not on a paired account:', p.strayControls);
    console.table(Object.keys(p.setting.controlAccounts || {}).map((k) => ({ role: k, from: p.setting.controlAccounts[k], to: p.controls[k], account: p.pairs.find((x) => x.to === p.controls[k])?.name ?? '?' })));
    console.log(`code range taxLiabilities: ${JSON.stringify(p.setting.accountCodeRanges?.taxLiabilities)} → ${JSON.stringify(p.ranges.taxLiabilities)}`);
    fs.writeFileSync(path.resolve(__dirname, `wct-group-books.${step}${SEARCH_PATH ? '.dev' : ''}.plan.json`), JSON.stringify({ pairs: p.pairs.map(({ abss, ...x }) => ({ ...x, balance: x.isHeader ? abss.balance : bal.get(x.id) || 0, abss: abss.balance })), unmatched: p.unmatched, controls: { from: p.setting.controlAccounts, to: p.controls }, ranges: { from: p.setting.accountCodeRanges, to: p.ranges }, tb: { dr, cr, diffs: tbDiffs.length } }, null, 1));
    if (bad.length || tbDiffs.length || dr !== cr) throw new Error('balances do not prove out: not applying');
    if (!APPLY) return;
    const before = await fingerprint(q, orgId);
    const jBefore = await journalsHash(q, orgId);
    await c.query('BEGIN');
    await recode(c, orgId, changed.map((x) => ({ id: x.id, code: x.to, parent: x.parentTo })));
    await c.query(`UPDATE "AccountingSetting" SET "controlAccounts" = $1, "accountCodeRanges" = $2, "updatedAt" = now() WHERE "organizationId" = $3`, [p.controls, p.ranges, orgId]);
    await actionLog(c, orgId, 'UPDATE', { resource: 'chart-of-accounts', note: 'Chart of accounts re-coded to the ABSS codes (ymm-accounts-list-2026-11-06.pdf); same accounts, no journals', accounts: changed.length });
    await c.query('COMMIT');
    const after = await fingerprint(q, orgId);
    const jAfter = await journalsHash(q, orgId);
    writeLog(step, { at: new Date().toISOString(), mode: 'APPLY', org: orgId, searchPath: SEARCH_PATH, before: before.h, after: after.h, journals: jBefore, changes: changed.map((x) => ({ id: x.id, name: x.name, from: x.from, to: x.to, parentFrom: x.parentFrom, parentTo: x.parentTo })), previousControls: p.setting.controlAccounts, previousRanges: p.setting.accountCodeRanges });
    console.log(`APPLIED ${changed.length} accounts re-coded · fingerprint ${before.h} → ${after.h} · journals + lines ${jBefore === jAfter ? 'unchanged ✓' : `CHANGED ✗ (${jBefore} → ${jAfter})`}`);
    await verify(q, 'YMM', gl.readAbss(CHART.YMM_ABSS), orgId);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

/** Codes through a temporary "~<id>" (the (org, code) unique index), then code + parent. */
async function recode(c, orgId, rows) {
  const ids = rows.map((r) => r.id);
  const t = await c.query(`UPDATE "ChartOfAccount" SET code = '~' || id, "updatedAt" = now() WHERE id = ANY($1::text[]) AND "organizationId" = $2`, [ids, orgId]);
  if (t.rowCount !== rows.length) throw new Error(`staged ${t.rowCount} of ${rows.length}`);
  for (const r of rows) {
    const u = await c.query(`UPDATE "ChartOfAccount" SET code = $1, "parentAccountId" = $2, "updatedAt" = now() WHERE id = $3 AND "organizationId" = $4`, [r.code, r.parent, r.id, orgId]);
    if (u.rowCount !== 1) throw new Error(`account ${r.id} not updated`);
  }
}

const journalsHash = async (q, orgId) => crypto.createHash('sha1').update(JSON.stringify(await q(`SELECT j.id, j."journalNumber", j.status, j."entryDate", j."totalDebit", j."totalCredit", (SELECT json_agg(json_build_array(l.id, l."accountId", l.debit, l.credit, l.description) ORDER BY l.id) FROM "JournalEntryLine" l WHERE l."journalEntryId" = j.id) lines FROM "JournalEntry" j WHERE j."organizationId" = $1 ORDER BY j.id`, [orgId]))).digest('hex').slice(0, 12);

// ================================================================ step: ymm-delete-shell

// The empty invoice the page check left in YMM (2026-11-06). Deleted as the app's delete does
// (documents.service deleteDocument: void its journal if any, delete the row, a DELETED history row),
// except the serial release: counters are not touched.
const YMM_SHELL = { id: 'f876d71d-e31c-4e0c-804f-e76a0ad16a2b', name: 'TI2202611-001' };
const SHELL_MARK = 'ymm-shell-delete:2026-11-06';
const DOC_REFS = [['Payment', 'documentId'], ['PriceHistory', 'documentId'], ['DocumentItem', 'documentId'], ['DocumentEmbedding', 'documentId'], ['DocumentShareLink', 'documentId'], ['DocumentSignLink', 'documentId'], ['DeliveryShareLink', 'documentId'], ['TimelineItem', 'documentId'], ['Transaction', 'documentId'], ['Delivery', 'documentId'], ['DeliveryItem', 'documentId'], ['Assignment', 'documentId'], ['MaintenanceServiceReport', 'documentId'], ['MaintenanceServiceReport', 'invoiceDocumentId'], ['ProjectDeployment', 'sourceDocumentId'], ['Order', 'sourceQuotationId'], ['Document', 'baseDocumentId'], ['JournalEntry', 'sourceDocumentId']];

async function stepYmmShell() {
  const orgId = target('YMM');
  const docId = AS ? opt('--doc', null) : YMM_SHELL.id;
  if (!docId) throw new Error('--doc <id> (dev stand-in shell)');
  const { c, q } = await connect();
  try {
    await guardOrg(q, 'YMM');
    if (ROLLBACK) {
      const e = lastApply('ymm-delete-shell', orgId);
      if (!e) throw new Error('no ymm-delete-shell APPLY to roll back');
      console.log(`rollback ymm-delete-shell applied ${e.at}: re-insert ${e.row.name}`);
      if (!APPLY) return;
      await c.query('BEGIN');
      await c.query(`INSERT INTO "Document" SELECT * FROM json_populate_record(NULL::"Document", $1::json)`, [JSON.stringify(e.row)]);
      await c.query(`DELETE FROM "AuditLog" WHERE "organizationId" = $1 AND "resourceId" = $2 AND action = 'DELETED' AND details->>'marker' = $3`, [orgId, docId, SHELL_MARK]);
      await actionLog(c, orgId, 'CREATE', { resource: 'documents', note: `Rolled back the delete of ${e.row.name}`, documentId: docId });
      await c.query('COMMIT');
      markRolledBack('ymm-delete-shell', e.at);
      const fp = await fingerprint(q, orgId);
      console.log(`ROLLED BACK · fingerprint ${fp.h} ${fp.h === e.before ? '= before the delete ✓' : `≠ before (${e.before})`}`);
      return;
    }
    const row = (await q(`SELECT row_to_json(d) j FROM "Document" d WHERE id = $1 AND "organizationId" = $2`, [docId, orgId]))[0]?.j;
    if (!row) { console.log(`${YMM_SHELL.name}: not in the org (already deleted?)`); return; }
    const cfg = row.config || {};
    const items = (cfg.items || []).filter((i) => oneLine(i.description) || Number(i.amount) || Number(i.unitPrice));
    const total = Number(cfg.totalWithTax ?? cfg.nettTotal ?? 0) || 0;
    const refs = [];
    for (const [t, col] of DOC_REFS) {
      const n = (await q(`SELECT count(*)::int n FROM "${t}" WHERE "${col}"::text = $1`, [docId]).catch(() => [{ n: 0 }]))[0].n;
      if (n) refs.push(`${t}.${col} ${n}`);
    }
    const history = await q(`SELECT action, "userEmail", "createdAt" FROM "AuditLog" WHERE "resourceId" = $1 ORDER BY "createdAt"`, [docId]);
    const formats = await q(`SELECT "documentType", pattern, "nextSerial", "lastResetKey" FROM "DocumentNumberFormat" WHERE "organizationId" = $1 ORDER BY 1, 2`, [orgId]);
    console.log(`${row.name} (${row.type}, ${row.status}, created ${row.createdAt}) · config ${JSON.stringify(cfg).length} chars · real line items ${items.length} · total ${money(total)} · references ${refs.join(', ') || 'none'} · history ${history.map((h) => `${h.action} ${h.userEmail || ''}`).join(', ')} · number formats ${formats.length ? JSON.stringify(formats) : 'none (legacy numbering)'}`);
    if (row.type !== 'INVOICE' || (!AS && row.name !== YMM_SHELL.name)) throw new Error('not the expected shell');
    if (items.length || total || refs.length) throw new Error('not an empty shell: refusing');
    if (!APPLY) { console.log('would: delete the document row (cascades: none present), add a DELETED history row, leave counters as they are'); return; }
    const before = await fingerprint(q, orgId);
    const now = new Date().toISOString();
    await c.query('BEGIN');
    const d = await c.query(`DELETE FROM "Document" WHERE id = $1 AND "organizationId" = $2 AND type = 'INVOICE'`, [docId, orgId]);
    if (d.rowCount !== 1) throw new Error(`deleted ${d.rowCount}`);
    await insertRows(c, 'AuditLog', ['id', 'userId', 'userName', 'action', 'resource', 'resourceId', 'resourceName', 'organizationId', 'details', 'ipAddress', 'userAgent', 'status', 'createdAt'],
      [[crypto.randomUUID(), 'system:wct-group-books', 'System creation', 'DELETED', 'document', docId, row.name, orgId, JSON.stringify({ detail: `${row.name} deleted`, marker: SHELL_MARK }), 'script', 'scripts/wct-group-books.js', 'SUCCESS', now]],
      { details: '::jsonb', status: '::"AuditStatus"', createdAt: '::timestamp' });
    await actionLog(c, orgId, 'DELETE', { resource: 'documents', note: `Deleted the empty invoice ${row.name} (page-check leftover)`, documentId: docId });
    const fAfter = await q(`SELECT "documentType", pattern, "nextSerial", "lastResetKey" FROM "DocumentNumberFormat" WHERE "organizationId" = $1 ORDER BY 1, 2`, [orgId]);
    if (JSON.stringify(fAfter) !== JSON.stringify(formats)) throw new Error('number formats changed');
    await c.query('COMMIT');
    writeLog('ymm-delete-shell', { at: now, mode: 'APPLY', org: orgId, searchPath: SEARCH_PATH, before: before.h, row });
    console.log(`APPLIED: deleted ${row.name} · number formats unchanged ✓`);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

// ================================================================ report

async function report() {
  const out = [];
  const say = (...x) => { const s = x.join(' '); out.push(s); console.log(s); };
  const table = (rows) => { out.push(...asText(rows)); console.log(asText(rows).join('\n')); };
  const charts = await stepCharts();
  const { c, q } = await connect();
  await c.query('BEGIN READ ONLY');
  try {
    say(`# WCT group sister orgs: dry run ${new Date().toISOString()} (read-only, nothing written)`);
    // ---- orgs + modules
    say('\n## 0. Orgs');
    const orgs = await q(`SELECT o.id, o.name, o."registrationNumber" uen, (SELECT count(*) FROM "Document" d WHERE d."organizationId" = o.id)::int docs, (SELECT count(*) FROM "Customer" x WHERE x."organizationId" = o.id)::int customers, (SELECT count(*) FROM "JournalEntry" j WHERE j."organizationId" = o.id)::int journals, (SELECT count(*) FROM "ChartOfAccount" a WHERE a."organizationId" = o.id)::int accounts FROM "Organization" o WHERE o.id = ANY($1::text[]) ORDER BY o.id`, [Object.values(ORG)]);
    table(orgs.map((o) => ({ org: o.name, uen: o.uen, docs: o.docs, customers: o.customers, journals: o.journals, accounts: o.accounts })));
    // finance@ has no Clerk-mirrored user row: her id is the one ActionLog records for her email.
    const finId = (await q(`SELECT DISTINCT "actorId" id FROM "ActionLog" WHERE lower("actorEmail") = 'finance@wct.com.sg' AND "actorType" = 'USER'`))[0]?.id;
    const fin = await q(`SELECT o.name org, string_agg(r.name, ',') role FROM "UserOrganization" uo JOIN "Organization" o ON o.id = uo."organizationId" LEFT JOIN "UserRole" ur ON ur."userId" = uo."userId" AND ur."organizationId" = uo."organizationId" AND ur."isActive" LEFT JOIN "Role" r ON r.id = ur."roleId" WHERE uo."userId" = $1 AND uo."isActive" AND o.id = ANY($2::text[]) GROUP BY o.name ORDER BY o.name`, [finId, Object.values(ORG)]);
    say(`finance@wct.com.sg: ${fin.map((f) => `${f.org} = ${f.role}`).join(' · ')}`);
    say('\n## 1. Modules');
    const mods = await q(`SELECT "organizationId" o, string_agg("moduleCode", ', ' ORDER BY "moduleCode") FILTER (WHERE enabled) m FROM "OrganizationModule" WHERE "organizationId" = ANY($1::text[]) GROUP BY 1`, [Object.values(ORG)]);
    for (const m of mods) say(`  now ${ORG_NAME[m.o]}: ${m.m}`);
    const mp = await planModules(q);
    table(mp.map((p) => ({ org: p.org, change: p.kind, what: p.code, before: JSON.stringify(p.kind === 'module' ? p.before.enabled : p.before), after: p.kind === 'module' ? (p.org === 'BCAIR' && p.code === 'SALES' ? `on, menus: ${BCAIR_SALES_MENUS.join(' / ')}` : 'on') : JSON.stringify(p.after) })));
    say(`  WCT (S) Systems: Service Reports (MAINTENANCE) ${mods.find((m) => m.o === ORG.WCT).m.includes('MAINTENANCE') ? 'is ON ✓' : 'is OFF ✗'} · YMM: unchanged (Accounting + User Management)`);

    // ---- charts
    say('\n## 2. BC Air chart = BC Air ABSS + WCT Cleaning');
    const combined = chartOf('BCAIR');
    say(`BC Air ABSS ${charts.bc.length} accounts + ${charts.combined.length - charts.bc.length} new from WCT Cleaning = ${combined.length} (${combined.filter((r) => r.isHeader).length} headers + 3-9000 computed, non-posting) · every header = sum of its sub-accounts · Dr = Cr ✓`);
    say('WCT Cleaning → BC Air mapping (all accounts):');
    table(charts.mapping.map((m) => ({ wctc: m.wctc, name: m.name, balance: money(m.balance), 'bc air': m.bcair, 'bc air name': m.bcairName, basis: m.basis, 'near equivalent': m.near || '' })));
    say('Debtors control: 1-9999 Trade Debtors (BC Air $130,170.50 + WCT Cleaning 1-3100 $365,130.00 = $495,300.50). BC Air 1-3100 "Account Receivables" is $0.00 in ABSS, so 1-9999 is the account that holds the debtors.');
    say('Control roles BC Air:');
    table(Object.entries(BCAIR_CONTROLS).map(([k, v]) => ({ role: k, account: `${v} ${combined.find((r) => r.code === v)?.name}` })));
    const ymm = chartOf('YMM');
    say(`\n## 3. YMM chart: ${ymm.length} accounts from ymm-accounts-list.xlsx, codes generated (${ymm.filter((r) => r.isHeader).length} headers + 3-9000 computed) · header sums ✓ · Dr = Cr ✓`);
    table(ymm.map((r) => ({ code: r.code, name: `${'  '.repeat(r.level)}${r.name}`, type: r.accountType === 'HEADER' ? 'header' : r.accountType, balance: money(r.balance) })));
    say('Control roles YMM:');
    table(Object.entries(ymmControls(ymm)).map(([k, v]) => ({ role: k, account: `${v} ${ymm.find((r) => r.code === v)?.name}` })));

    // ---- docs
    const wctDocs = await loadWctDocs(q);
    const pb = await planDocs(q, 'BCAIR', wctDocs);
    const [pbc, pwc] = pb.parsed;
    say('\n## 4. BC Air documents (batch bcair-books-2026-11-06)');
    docsSection(say, table, pb, [['bcair-sales-summary.xlsx', pbc], ['wct-nongst-cn-summary.xlsx', pwc]]);
    // WCT Cleaning vs WCT (NG)
    say('\n### wct-nongst-cn-summary vs the "(NG)" invoices in WCT (S) Systems (report only; nothing in WCT changes)');
    const ngAll = [...wctDocs.values()].filter((d) => /^\s*\(NG\)/i.test(d.subject || ''));
    const withErp = pwc.rows.filter((r) => r.erpNo);
    const matched = withErp.filter((r) => r.wct);
    const ng = matched.filter((r) => /^\s*\(NG\)/i.test(r.wct.subject || ''));
    const sameDate = matched.filter((r) => r.wct.date === r.date);
    const sameCust = matched.filter((r) => n2(r.wct.cust) === n2(r.customer));
    const amt = matched.reduce((m, r) => { const k = Math.abs(r.wct.total - r.amount) < 0.005 ? 'same amount' : Math.abs(r.wct.total - 1) < 0.005 ? 'WCT shows $1 (nominal)' : Math.abs(r.wct.total) < 0.005 ? 'WCT shows $0' : 'different amount'; m[k] = (m[k] || 0) + 1; return m; }, {});
    const refd = new Set(matched.map((r) => r.wct.name));
    table([
      { what: 'WCT Cleaning invoices (imported rows)', n: pwc.rows.length },
      { what: '… with an "INV Number(ERP)"', n: withErp.length },
      { what: '… that number found in WCT', n: matched.length },
      { what: '… of which the WCT invoice is "(NG)"', n: ng.length },
      { what: '… same date', n: sameDate.length },
      { what: '… same customer', n: sameCust.length },
      ...Object.entries(amt).map(([k, v]) => ({ what: `… amount: ${k}`, n: v })),
      { what: 'ERP numbers not found in WCT', n: withErp.length - matched.length },
      { what: 'WCT "(NG)" invoices in total', n: ngAll.length },
      { what: 'WCT "(NG)" invoices no WCT Cleaning row points at', n: ngAll.filter((d) => !refd.has(d.name)).length },
    ]);
    const ngUn = ngAll.filter((d) => !refd.has(d.name));
    say(`WCT "(NG)" not referenced, by year: ${JSON.stringify(ngUn.reduce((m, d) => { const y = (d.date || '').slice(0, 4); m[y] = (m[y] || 0) + 1; return m; }, {}))} · their WCT totals: ${JSON.stringify(ngUn.reduce((m, d) => { const k = d.total === 1 ? '$1' : d.total === 0 ? '$0' : 'other'; m[k] = (m[k] || 0) + 1; return m; }, {}))}`);
    say(`Same invoice? ${matched.length} WCT Cleaning rows point at a WCT ERP number; ${sameDate.length} share the date and ${sameCust.length} the customer. The WCT copies are "(NG)" ${ng.length}/${matched.length}, priced ${JSON.stringify(amt)}: WCT's ERP kept a nominal placeholder; the real amount is on the WCT Cleaning (= BC Air) side.`);
    const diffs = matched.filter((r) => r.wct.date !== r.date || n2(r.wct.cust) !== n2(r.customer)).slice(0, 12);
    if (diffs.length) { say('Examples where date or customer differ:'); table(diffs.map((r) => ({ wctc: r.number, erp: r.erpNo, 'wctc date': r.date, 'wct date': r.wct.date, 'wctc customer': r.customer.slice(0, 32), 'wct customer': (r.wct.cust || '').slice(0, 32), 'wctc $': money(r.amount), 'wct $': money(r.wct.total) }))); }

    const wn = await planWctNotes(q);
    say(`\n### WCT (S) Systems: notes "Real invoice in BC Air: <no>" (History & notes; no money, nothing else in WCT changes)`);
    say(`"(NG)" invoices that map to a BC Air invoice: ${wn.notes.length} notes (already added ${wn.notes.length - wn.todo.length}) · of which naming more than one BC Air invoice: ${wn.multi.length} · WCT invoices a BC Air invoice points at that are NOT "(NG)" (no note): ${wn.notNg.length}`);
    table(wn.notes.slice(0, 5).map((n) => ({ wct: n.wct, note: n.text })));
    if (wn.multi.length) { say('Notes naming more than one BC Air invoice:'); table(wn.multi.slice(0, 20).map((n) => ({ wct: n.wct, note: n.text }))); }
    if (wn.notNg.length) { say('Mapped but not "(NG)" (left alone):'); table(wn.notNg.map((x) => ({ wct: x.wct, 'bc air': x.bcair, 'wct subject': x.subject, 'wct total': money(x.total) }))); }

    // ---- racking
    const pr = await planDocs(q, 'RACK', wctDocs);
    say('\n## 5. WCT Racking documents (batch wctr-tracker-2026-11-06, documents only, hold flag ON, no GL)');
    docsSection(say, table, pr, [['wctr-sales-summary-cn.xlsx', pr.parsed[0]]]);
    const g = gstLook(pr.parsed[0].rows);
    say(`(Owner: Racking does not charge GST; ABSS GST Collected is $0.00. Invoices stay as imported, GST 0.) GST-inclusive? of ${g.invoices} invoices with an amount: ${g.roundAsGiven} are a round $10 as given, ${g.roundAfterRemovingGst} become round after taking GST out (7% 2022, 8% 2023, 9% 2024+), ${g.wholeDollarOnlyAfterGst} are whole dollars only after removing GST. ${g.roundAsGiven >= g.roundAfterRemovingGst ? '→ they read as amounts BEFORE GST (or Racking did not charge GST); imported as given, GST 0.' : '→ they read as GST-INCLUSIVE; imported as given.'}`);

    // ---- history + cutover (simulated)
    say('\n## 6. BC Air books (simulated)');
    const docsAll = pb.docs;
    const hist = bcairHistory(docsAll.map((d) => ({ id: d.id, total: d.total, r: d.r })));
    const sumBy = (f) => Object.values(hist.journals.reduce((m, j) => { const k = f(j); m[k] = m[k] || { k, journals: 0, amount: 0 }; m[k].journals++; m[k].amount = R2(m[k].amount + j.total); return m; }, {})).sort((a, b) => a.k.localeCompare(b.k));
    say(`history journals: ${hist.journals.length} · marker ${GL_MARK} · numbers ERP-INV-/ERP-PAY-/ERP-CN-<no>`);
    table(sumBy((j) => `${j.type} ${j.src} ${j.date.slice(0, 4)}`).map((x) => ({ 'type source year': x.k, journals: x.journals, amount: money(x.amount) })));
    say('Revenue buckets (invoices):');
    table(Object.values(docsAll.reduce((m, d) => { const k = `${d.r.bucket.code} ${d.src} · ${d.r.bucket.rule}`; m[k] = m[k] || { account: d.r.bucket.code, source: d.src, rule: d.r.bucket.rule, invoices: 0, amount: 0 }; m[k].invoices++; m[k].amount = R2(m[k].amount + d.total); return m; }, {})).sort((a, b) => a.account.localeCompare(b.account) || b.amount - a.amount).map((x) => ({ ...x, amount: money(x.amount) })));
    say('Bank accounts used by payments:');
    table(sumBy((j) => (j.type === 'PAYMENT' ? `${j.bank} ${j.bankRule}` : '~')).filter((x) => x.k !== '~').map((x) => ({ 'account · rule': x.k, payments: x.journals, amount: money(x.amount) })));
    const flagsH = hist.flags.reduce((m, f) => { const k = `${f.src}: ${f.note.replace(/[\d,.]+ \d{4}-\d\d-\d\d/, '#')}`; m[k] = (m[k] || 0) + 1; return m; }, {});
    say(`payment flags: ${JSON.stringify(flagsH)}`);
    const tbChart = combined;
    const acc = new Map(tbChart.map((r) => [r.code, r]));
    const posts = hist.journals.flatMap((j) => j.lines.map((l) => ({ code: l.code, category: acc.get(l.code).category, date: j.date, dr: l.dr, cr: l.cr })));
    const led = { setting: { m: 12, d: 31 }, postings: posts };
    const { closes, tb, plan } = cutoverPlan(tbChart, led);
    const after = new Map(tb);
    for (const l of plan.lines) after.set(l.code, R2((after.get(l.code) || 0) + l.dr - l.cr));
    const detail = tbChart.filter((r) => r.accountType !== 'HEADER');
    const offBy = detail.filter((r) => Math.abs((after.get(r.code) || 0) - r.debitBalance) >= 0.005);
    const dr = R2([...after.values()].reduce((a, v) => a + (v > 0 ? v : 0), 0));
    const cr = R2([...after.values()].reduce((a, v) => a + (v < 0 ? -v : 0), 0));
    say(`Year-end closes into 3-8000: ${closes.map((j) => `ABSS-YE-${j.year} (${money(j.total)})`).join(', ')}`);
    say(`Balancing journal ABSS-CUTOVER-${CUTOVER}: ${plan.lines.length} lines · Dr ${money(plan.lines.reduce((a, l) => a + l.dr, 0))} = Cr ${money(plan.lines.reduce((a, l) => a + l.cr, 0))} · offset 3-9999 → ${money(plan.hbAfter)} (target ${money(plan.hbAbss)})`);
    say(`TRIAL BALANCE after, at ${CUTOVER}: Dr ${money(dr)} · Cr ${money(cr)} ${dr === cr ? '✓ balanced' : '✗'} · per-account difference vs (BC Air ABSS + WCT Cleaning ABSS): ${offBy.length} accounts ${offBy.length ? '✗ ' + offBy.map((r) => r.code).join(', ') : '= 0 for every account ✓'}`);
    table(detail.filter((r) => Math.abs(r.debitBalance) >= 0.005 || Math.abs(tb.get(r.code) || 0) >= 0.005).map((r) => ({ code: r.code, name: r.name, target: money(r.debitBalance), history: money(tb.get(r.code) || 0), cutover: money((after.get(r.code) || 0) - (tb.get(r.code) || 0)), after: money(after.get(r.code) || 0), diff: money((after.get(r.code) || 0) - r.debitBalance) })));
    const open = R2(docsAll.reduce((a, d) => a + d.owed, 0));
    say(`\nReceivables: GL 1-9999 at ${CUTOVER} = ${money(after.get('1-9999'))} (history alone ${money(tb.get('1-9999') || 0)}) · open imported invoices ${money(open)} on ${docsAll.filter((d) => d.owed > 0.005).length} invoices (BC Air ${money(docsAll.filter((d) => d.src === 'bcair').reduce((a, d) => a + d.owed, 0))}, WCT Cleaning ${money(docsAll.filter((d) => d.src === 'wctc').reduce((a, d) => a + d.owed, 0))}) · gap ${money(after.get('1-9999') - open)}`);
    say('Hold flag: ON from the modules step (payments on imported invoices hold their GL), OFF in cutover-bcair after checking 0 held.');

    // ---- racking books
    say('\n## 6b. WCT Racking books (simulated)');
    const wrChart = chartOf('RACK');
    say(`Chart: ${wrChart.length} accounts from wctr-accounts-list.pdf (${wrChart.filter((r) => r.isHeader).length} headers + 3-9000 computed, non-posting) · every header = sum of its sub-accounts · Dr = Cr ✓`);
    table(wrChart.map((r) => ({ code: r.code, name: `${'  '.repeat(r.level)}${r.name}`, type: r.accountType === 'HEADER' ? 'header' : r.accountType, balance: money(r.balance) })));
    say('Control roles Racking:');
    table(Object.entries(RACK_CONTROLS).map(([k, v]) => ({ role: k, account: `${v} ${wrChart.find((r) => r.code === v)?.name}` })));
    const rh = rackHistory(pr.docs.map((d) => ({ id: d.id, total: d.total, r: d.r })));
    const rSum = (f) => Object.values(rh.journals.reduce((m, j) => { const k = f(j); m[k] = m[k] || { k, journals: 0, amount: 0 }; m[k].journals++; m[k].amount = R2(m[k].amount + j.total); return m; }, {})).sort((a, b) => a.k.localeCompare(b.k));
    say(`history journals: ${rh.journals.length} · marker ${GL_MARK_RACK}`);
    table(rSum((j) => `${j.type} ${j.date.slice(0, 4)}`).map((x) => ({ 'type year': x.k, journals: x.journals, amount: money(x.amount) })));
    const rb = pr.docs.reduce((m, d) => { const k = d.r.bucket.rule; m[k] = m[k] || { rule: k, invoices: 0, amount: 0 }; m[k].invoices++; m[k].amount = R2(m[k].amount + d.total); return m; }, {});
    say('Revenue (the tracker has no subject column; no row mentions manpower):');
    table(Object.values(rb).map((x) => ({ ...x, amount: money(x.amount) })));
    say('Payments by bank account:');
    table(rSum((j) => (j.type === 'PAYMENT' ? `${j.bank} ${j.bankRule}` : '~')).filter((x) => x.k !== '~').map((x) => ({ 'account · rule': x.k, payments: x.journals, amount: money(x.amount) })));
    say(`Unclear payment methods (flagged, ${rh.flags.length}):`);
    table(Object.values(rh.flags.reduce((m, f) => { const k = f.note.replace(/"[^"]*"/, '"…"'); m[k] = m[k] || { flag: k, payments: 0, e: [] }; m[k].payments++; if (m[k].e.length < 8) m[k].e.push(`${f.no} ${(/"([^"]*)"/.exec(f.note) || [])[1] || ''}`); return m; }, {})).map((x) => ({ ...x, e: x.e.join(', ') })));
    const rs = simulate(wrChart, rh.journals);
    say(`Year-end closes into 3-8000: ${rs.closes.map((j) => `ABSS-YE-${j.year} (${money(j.total)})`).join(', ')}`);
    say(`Balancing journal ABSS-CUTOVER-${CUTOVER}: ${rs.plan.lines.length} lines · Dr ${money(rs.plan.lines.reduce((a, l) => a + l.dr, 0))} = Cr ${money(rs.plan.lines.reduce((a, l) => a + l.cr, 0))} · offset 3-9999 → ${money(rs.plan.hbAfter)} (target ${money(rs.plan.hbAbss)})`);
    say(`TRIAL BALANCE after, at ${CUTOVER}: Dr ${money(rs.dr)} · Cr ${money(rs.cr)} ${rs.dr === rs.cr ? '✓ balanced' : '✗'} · per-account difference vs Racking ABSS: ${rs.offBy.length ? `${rs.offBy.length} ✗ ${rs.offBy.map((r) => r.code).join(', ')}` : '0 for every account ✓'}`);
    table(rs.detail.filter((r) => Math.abs(r.debitBalance) >= 0.005 || Math.abs(rs.tb.get(r.code) || 0) >= 0.005).map((r) => ({ code: r.code, name: r.name, target: money(r.debitBalance), history: money(rs.tb.get(r.code) || 0), cutover: money((rs.after.get(r.code) || 0) - (rs.tb.get(r.code) || 0)), after: money(rs.after.get(r.code) || 0), diff: money((rs.after.get(r.code) || 0) - r.debitBalance) })));
    const ropen = pr.docs.filter((d) => d.owed > 0.005);
    const rOpenSum = R2(ropen.reduce((a, d) => a + d.owed, 0));
    const rGap = R2(rOpenSum - wrChart.find((r) => r.code === '1-3100').debitBalance);
    say(`\nReceivables: GL 1-3100 at ${CUTOVER} = ${money(rs.after.get('1-3100'))} (= ABSS; history alone ${money(rs.tb.get('1-3100') || 0)}) · open imported invoices ${money(rOpenSum)} on ${ropen.length} invoices · invoices exceed the GL by ${money(rGap)}`);
    say('Open invoices (newest first; marks: Y = yellow "yet to bill final", G = grey "payment to WCT Cleaning", P = part paid):');
    table(ropen.sort((a, b) => b.r.date.localeCompare(a.r.date)).map((d) => ({ invoice: d.name, date: d.r.date, customer: d.r.customer.slice(0, 34), amount: money(d.total), paid: money(d.r.paid), open: money(d.owed), mark: [d.r.yetToBill ? 'Y' : '', d.r.toWctCleaning ? 'G' : '', d.r.paid > 0.005 ? 'P' : ''].join(''), note: (d.r.note || '').slice(0, 30), status: (d.r.status || '').slice(0, 20) })));
    const combos = subsetsTo(ropen.map((d) => ({ k: d.name, v: d.owed })), rGap, 3);
    say(`Open invoices (or sets of up to 3) whose open amounts add up to exactly the ${money(rGap)} gap: ${combos.length ? combos.slice(0, 12).map((x) => x.join(' + ')).join(' · ') : 'none'}${combos.length > 12 ? ` · (${combos.length} sets in all)` : ''}`);
    const yt = ropen.filter((d) => d.r.yetToBill);
    say(`Yellow "yet to bill final" open: ${yt.length} invoices ${money(yt.reduce((a, d) => a + d.owed, 0))} · open invoices dated after 31 Oct 2026: ${money(ropen.filter((d) => d.r.date > '2026-10-31').reduce((a, d) => a + d.owed, 0))}`);

    say('\n## 7. YMM cutover (simulated)');
    const ym = cutoverPlan(ymm, { setting: { m: 12, d: 31 }, postings: [] });
    const ya = new Map(ym.tb);
    for (const l of ym.plan.lines) ya.set(l.code, R2((ya.get(l.code) || 0) + l.dr - l.cr));
    const yoff = ymm.filter((r) => r.accountType !== 'HEADER' && Math.abs((ya.get(r.code) || 0) - r.debitBalance) >= 0.005);
    const ydr = R2([...ya.values()].reduce((a, v) => a + (v > 0 ? v : 0), 0));
    say(`ABSS-CUTOVER-${CUTOVER}: ${ym.plan.lines.length} lines · Dr ${money(ym.plan.lines.reduce((a, l) => a + l.dr, 0))} = Cr ${money(ym.plan.lines.reduce((a, l) => a + l.cr, 0))} · 3-9999 offset ${money(ym.plan.hbAfter)} · trial balance Dr ${money(ydr)} = Cr ${money(R2([...ya.values()].reduce((a, v) => a + (v < 0 ? -v : 0), 0)))} · accounts ≠ file: ${yoff.length || '0 ✓'}`);
    say(`P&L: income ${money(ymm.find((r) => r.code === '4-0000').balance)} − cost of sales ${money(ymm.find((r) => r.code === '5-0000').balance)} − expenses ${money(ymm.find((r) => r.code === '6-0000').balance)} − other ${money(ymm.find((r) => r.code === '9-0000').balance)} = ${money(ymm.find((r) => r.code === '3-9000').balance)} Current Year Earnings (computed, never posted)`);

    // counters
    say('\n## 8. Counters');
    for (const [k, p] of [['BCAIR', pb], ['RACK', pr]]) say(`  ${k}: number formats ${p.formats.length ? p.formats.filter((f) => ['INVOICE', 'CREDIT_NOTE'].includes(f.documentType)).map((f) => `${f.documentType} ${f.pattern} next=${f.nextSerial}`).join(', ') : 'none (legacy default numbering, prefix TI2<yyyymm>-)'} · prefixes matching an imported name: ${p.prefixHits.length}`);
    say('\n## 9. YMM empty invoice (page-check leftover)');
    const sh = (await q(`SELECT name, type, status, "createdAt", config FROM "Document" WHERE id = $1 AND "organizationId" = $2`, [YMM_SHELL.id, ORG.YMM]))[0];
    if (!sh) say(`  ${YMM_SHELL.name}: not found (already deleted)`);
    else {
      const refs = [];
      for (const [t, col] of DOC_REFS) { const n = (await q(`SELECT count(*)::int n FROM "${t}" WHERE "${col}"::text = $1`, [YMM_SHELL.id]))[0].n; if (n) refs.push(`${t} ${n}`); }
      const yf = await q(`SELECT count(*)::int n FROM "DocumentNumberFormat" WHERE "organizationId" = $1`, [ORG.YMM]);
      say(`  ${sh.name} ${sh.type} ${sh.status}, created ${sh.createdAt} by admin@osiris.sg · line items ${(sh.config?.items || []).length} · total ${money(sh.config?.totalWithTax || 0)} · journals / payments / links: ${refs.join(', ') || 'none'} · YMM number formats: ${yf[0].n} (legacy numbering)`);
      say('  ymm-delete-shell --apply: deletes the row as the app\'s delete does (no journal to void, no cascades present), adds the "deleted" history row, does NOT release the serial (counters untouched). Rollback re-inserts the saved row.');
    }
    fs.writeFileSync(path.join(DIR, `wct-group-books-dryrun-${CUTOVER}.txt`), out.join('\n'));
    console.log(`\nreport → ${path.join(DIR, `wct-group-books-dryrun-${CUTOVER}.txt`)}`);
  } finally { await c.query('ROLLBACK'); await c.end(); }
}

/** History journals + year-end closes + the cutover against a chart, in memory. */
function simulate(chart, journals) {
  const acc = new Map(chart.map((r) => [r.code, r]));
  const posts = journals.flatMap((j) => j.lines.map((l) => ({ code: l.code, category: acc.get(l.code).category, date: j.date, dr: l.dr, cr: l.cr })));
  const { closes, tb, plan } = cutoverPlan(chart, { setting: { m: 12, d: 31 }, postings: posts });
  const after = new Map(tb);
  for (const l of plan.lines) after.set(l.code, R2((after.get(l.code) || 0) + l.dr - l.cr));
  const detail = chart.filter((r) => r.accountType !== 'HEADER');
  const offBy = detail.filter((r) => Math.abs((after.get(r.code) || 0) - r.debitBalance) >= 0.005);
  const dr = R2([...after.values()].reduce((a, v) => a + (v > 0 ? v : 0), 0));
  const cr = R2([...after.values()].reduce((a, v) => a + (v < 0 ? -v : 0), 0));
  return { closes, tb, plan, after, detail, offBy, dr, cr };
}
/** Sets of up to `max` items whose values add up to `target` (to the cent). */
function subsetsTo(items, target, max) {
  const out = [];
  const t = Math.round(target * 100);
  const v = items.map((x) => Math.round(x.v * 100));
  const walk = (start, left, picked) => {
    if (left === 0 && picked.length) { out.push(picked.map((i) => `${items[i].k} ${money(items[i].v)}`)); return; }
    if (picked.length === max || out.length > 200) return;
    for (let i = start; i < items.length; i++) if (v[i] <= left) walk(i + 1, left - v[i], [...picked, i]);
  };
  if (t > 0) walk(0, t, []);
  return out;
}

function docsSection(say, table, p, sources) {
  const by = (list, f) => Object.entries(list.reduce((m, d) => { const k = f(d); m[k] = m[k] || { n: 0, total: 0, owed: 0, paid: 0, credited: 0 }; m[k].n++; m[k].total = R2(m[k].total + d.total); m[k].owed = R2(m[k].owed + d.owed); m[k].paid = R2(m[k].paid + (d.r.paid || 0)); m[k].credited = R2(m[k].credited + (d.r.credited || (d.r.cn?.amount ?? 0))); return m; }, {})).sort(([a], [b]) => a.localeCompare(b));
  say(`${p.docs.length} invoices to import · template "${p.tpl.name}" · customers ${p.cust.plan.filter((x) => !x.existing).length} new, ${p.cust.plan.filter((x) => x.existing).length} existing (merged by name: ${p.cust.plan.filter((x) => x.variants.length > 1).length} customers had spelling variants)`);
  table(by(p.docs, (d) => `${d.src} ${d.year}`).map(([k, v]) => ({ 'source year': k, invoices: v.n, total: money(v.total), paid: money(v.paid), credited: money(v.credited), open: money(v.owed) })));
  const t = by(p.docs, () => 'all')[0]?.[1];
  if (t) say(`TOTAL ${t.n} invoices ${money(t.total)} · paid ${money(t.paid)} · credited ${money(t.credited)} · open ${money(t.owed)} on ${p.docs.filter((d) => d.owed > 0.005).length} invoices`);
  table(by(p.docs, (d) => `${d.src} ${d.status}`).map(([k, v]) => ({ 'source status': k, invoices: v.n, total: money(v.total), open: money(v.owed) })));
  const variants = p.cust.plan.filter((x) => x.variants.length > 1).slice(0, 15);
  if (variants.length) { say('Customer spelling variants merged (first 15):'); table(variants.map((x) => ({ customer: x.name, code: x.code, variants: x.variants.join(' | ').slice(0, 120) }))); }
  for (const [file, s] of sources) {
    say(`${file}: ${s.rows.length} rows imported · ${s.skipped.length} skipped · ${s.flags.length} flags`);
    const sk = Object.values(s.skipped.reduce((m, x) => { const k = x.why.replace(/".*"/, '"…"').replace(/in WCT as .*/, 'in WCT as …'); m[k] = m[k] || { reason: k, rows: 0, amount: 0, e: [] }; m[k].rows++; m[k].amount = R2(m[k].amount + (x.amount || 0)); if (m[k].e.length < 30) m[k].e.push(x.no); return m; }, {}));
    if (sk.length) { say('  skipped:'); table(sk.map((x) => ({ reason: x.reason, rows: x.rows, amount: money(x.amount), numbers: x.e.join(' ').slice(0, 160) }))); }
    const odd = s.skipped.filter((x) => !x.exact && /WCT-era/.test(x.why));
    if (odd.length) { say('  WCT-era rows that are NOT an exact WCT match (skipped too, please confirm):'); table(odd.map((x) => ({ row: x.row, no: x.no, date: x.date, customer: x.customer, amount: money(x.amount), why: x.why.slice(0, 150) }))); }
    const cmb = s.skipped.filter((x) => x.combo);
    if (cmb.length) { say('  WCT-era two-number rows (owner: BC Air\'s real invoices) already imported from wct-nongst-cn-summary, so skipped:'); table(cmb.map((x) => ({ row: x.row, no: x.no, date: x.date, customer: x.customer, amount: money(x.amount), 'imported as': x.why.replace(/^already imported from wct-nongst-cn-summary as /, '') }))); }
    const inf = s.rows.filter((x) => x.inferred || x.combo);
    if (inf.length) { say('  numbers inferred / taken from a two-number row:'); table(inf.map((x) => ({ row: x.row, invoice: x.name, date: x.date, customer: x.customer, amount: money(x.amount), open: money(x.owed), basis: x.inferred ? 'number inferred (owner)' : `two-number row ${x.wctNumbers.join('/')}` }))); }
    const nonum = s.skipped.filter((x) => /no usable invoice number/.test(x.why));
    if (nonum.length) { say('  rows with no invoice number (skipped, please give the numbers):'); table(nonum.map((x) => ({ row: x.row, date: x.date, customer: x.customer, quotation: x.quotation, amount: money(x.amount), cell: x.no }))); }
    const fl = Object.values(s.flags.reduce((m, f) => { const k = f.note.replace(/\d[\d,.]*/g, '#').replace(/"[^"]*"/g, '"…"').slice(0, 90); m[k] = m[k] || { flag: k, rows: 0, e: [] }; m[k].rows++; if (m[k].e.length < 4) m[k].e.push(`${f.no} (${f.note.slice(0, 70)})`); return m; }, {}));
    if (fl.length) { say('  flags:'); table(fl.map((f) => ({ flag: f.flag, rows: f.rows, e: f.e.join(' | ').slice(0, 200) }))); }
    const dup = new Map();
    for (const r of s.rows) dup.set(r.number, (dup.get(r.number) || 0) + 1);
    const dups = [...dup].filter(([, n]) => n > 1);
    say(`  duplicate invoice numbers: ${dups.length ? dups.map(([k, n]) => `${k} ×${n}`).join(', ') : 'none'}`);
    const cnRows = s.rows.flatMap((r) => (r.cns || (r.cn ? [r.cn] : [])).map((x) => ({ ...x, inv: r.name })));
    say(`  credit notes: ${cnRows.length} (${cnRows.filter((x) => x.amount > 0.005).length} with an amount, ${money(cnRows.reduce((a, x) => a + x.amount, 0))}; ${cnRows.filter((x) => !(x.amount > 0.005)).length} on invoices already at $0, number kept on the invoice)`);
    if (s.rows[0]?.src === 'bcair') table(cnRows.map((x) => ({ cn: x.no, invoice: x.inv, amount: money(x.amount), date: x.date, 'date from': x.dateRule || x.why || '' })));
    if (s.rows[0]?.src === 'wctr') {
      const st = s.rows.reduce((m, r) => { const k = r.cancelled ? 'cancelled (red)' : r.yetToBill ? 'yet to bill final (yellow)' : r.owed > 0.005 ? 'open' : 'paid'; m[k] = (m[k] || 0) + 1; return m; }, {});
      say(`  status: ${JSON.stringify(st)} · "Payment to WCT Cleaning" (grey) rows: ${s.rows.filter((r) => r.toWctCleaning).map((r) => r.number).join(', ') || 'none'}`);
      table(cnRows.map((x) => ({ cn: x.no, invoice: x.inv, amount: money(x.amount) })));
    }
  }
}

function asText(rows) {
  if (!rows.length) return ['  (none)'];
  const cols = Object.keys(rows[0]);
  const w = cols.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)));
  const line = (vals) => `  ${vals.map((v, i) => String(v ?? '').padEnd(w[i])).join(' | ')}`;
  return [line(cols), `  ${w.map((n) => '-'.repeat(n)).join('-+-')}`, ...rows.map((r) => line(cols.map((k) => r[k])))];
}

// ================================================================

const steps = {
  charts: () => stepCharts().then(() => {}), modules: stepModules, 'coa-bcair': () => stepCoa('BCAIR'), 'coa-ymm': () => stepCoa('YMM'),
  'docs-bcair': () => stepDocs('BCAIR'), 'docs-racking': () => stepDocs('RACK'), 'post-bcair': () => stepPost('BCAIR'),
  'cutover-bcair': () => stepCutover('BCAIR'), 'cutover-ymm': () => stepCutover('YMM'), report,
  'coa-racking': () => stepCoa('RACK'), 'post-racking': () => stepPost('RACK'), 'cutover-racking': () => stepCutover('RACK'),
  'wct-notes': stepWctNotes, 'ymm-delete-shell': stepYmmShell, 'recode-ymm': stepRecodeYmm,
  // read-only: the rollback proof's before / after hash of everything the steps touch
  fingerprint: async () => { const { c, q } = await connect(); try { for (const k of AS ? ['BCAIR'] : ['BCAIR', 'RACK', 'YMM']) { const f = await fingerprint(q, target(k)); console.log(`${AS ? 'stand-in' : k} ${f.h} ${JSON.stringify(f.counts)}`); } } finally { await c.end(); } },
};
if (module === require.main) {
  if (!steps[CMD]) { console.error(`usage: node scripts/wct-group-books.js ${Object.keys(steps).join('|')} [--apply] [--rollback]`); process.exit(1); }
  steps[CMD]().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
}
module.exports = { textDates, amountIn, bcairBucket, wctcBank, combineBcair, rollUp, readYmmXlsx, gstLook, readAbssPdf, readWctr, readBcair, readWctc, wctrBank, subsetsTo };
