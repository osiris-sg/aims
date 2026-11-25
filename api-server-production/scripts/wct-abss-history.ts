/**
 * WCT group: full ABSS history import, DRY RUN (2026-11-25). First org: WCT Racking (`--org racking`).
 *
 * Owner decision (25 Nov): clear the 6 Nov opening import (ABSS-CUTOVER journal, ABSS-YE closes, tracker-history
 * journals that ABSS now covers, any opening-balance bills / docs) and replace it with the full ABSS history from the
 * ABSS .txt exports, keeping the existing customers (and suppliers). This script parses the exports, reads the org
 * READ-ONLY, simulates clear-out + import in memory and writes the plan, a trial balance vs the ABSS Accounts List,
 * and flags. It NEVER writes to a database (SET default_transaction_read_only = on; --apply refuses, see below).
 *
 * Conventions mirrored from WCT (S) (batch abss-gl:wct-abss-2026-11-23, applied 23 Nov; importer not in git, read back
 * from prod rows):
 *   journals      createdBy abss-gl:<batch>; one journal per ABSS entry; number ABSS-<SRC>-<ABSS ID#>, a later entry
 *                 reusing the number gets -2, -3 … (date order); reference = ABSS ID#; description
 *                 "ABSS <SRC> <ID#> · <memo>"; types SJ INVOICE (AR credited = CREDIT_NOTE, AR net 0 = ADJUSTMENT),
 *                 PJ BILL, CR / CD PAYMENT, GJ MANUAL; postedBy "abss-gl".
 *   opening       ABSS-OPENING-<first day> (OPENING_BALANCE) dated the day before; per account line = ABSS opening
 *                 balance minus the AIMS history kept before that day ("ABSS x · AIMS history y"); 3-9999 balances.
 *   year ends     ABSS-YE-<year> (ADJUSTMENT, reference YE-<year>) roll each year's P&L into 3-8000, in the batch.
 *   replaced      the ERP-built / cutover journals inside the ABSS window were DELETED (backup json), not voided;
 *                 older ERP history stays POSTED. 39 opening-balance bills (abss-opening) were deleted.
 *   documents     sale journals tie (sourceDocumentId, first part of a number only: journal guard) to the existing
 *                 invoice of the same number; invoice money restamped from ABSS (stampDocumentMoney);
 *                 PJ -> BILL "ABSS-PJ-<no>", CR -> OFFICIAL_RECEIPT "ABSS-CR-<no>", CD -> PAYMENT_VOUCHER
 *                 "ABSS-CD-<no>", each config.erpImport { source 'abss-ledger', batch, erpId, originalNumber, status },
 *                 recordLocked "ABSS import", glSource 'abss-import', bills erpImport.paidBy [{date, amount, voucher}].
 *                 The PJ / CR / CD journals tie to their own new document.
 *   house rules   imported-ledger tie (scripts/lib/imported-ledger-tie.js, invariants check 5c): all entries under a
 *                 number together = the document.
 *
 * Racking-specific inputs (Customer Ledger, Invoice Transactions, Closed Invoices, Supplier Payment History,
 * Reconciliation Report; history from Aug 2022; cp1252 bytes) are parsed by scripts/lib/abss-reports.js.
 *
 *   cd api-server-production
 *   DATABASE_URL=… TZ=UTC NODE_PATH=$PWD/node_modules npx ts-node --transpile-only scripts/wct-abss-history.ts \
 *     --org racking [--env prod] [--dir <reports>] [--out <dir>] [--chart <level|code|name file>]
 *
 * Writes into --out: summary.txt, trial-balance.csv, clearout.csv, customers.csv, suppliers.csv, invoices.csv,
 * bills.csv, payments.csv, flags.csv, plan.json (log).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { Client, types } from 'pg';
import { grossOf, outstandingOf } from '../src/common/document-money';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const A = require('./lib/abss-reports');

types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(20, (v) => Number(v));

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const HOME = os.homedir();
const ORGS: Record<string, { id: string; suffix: string; label: string; chart: string; ledgerTag: string }> = {
  racking: {
    id: '5c700000-0000-4000-8000-5c7000000002',
    suffix: 'WCTR',
    label: 'WCT Racking',
    chart: path.join(HOME, 'Desktop/aims/_imports/wct/abss/wctr-coa-2026-11-06.txt'),
    ledgerTag: 'wctr',
  },
};
const ORG_KEY = one('--org', '')!;
const ORG = ORGS[ORG_KEY];
const ENV = one('--env', 'prod')!;
const DIR = one('--dir', path.join(HOME, 'Desktop/aims-agents/imports/abss-racking-ymm'))!;
const OUT = one('--out', path.join(HOME, `Desktop/aims-agents/logs/wct/abss-history-2026-11-25/${ORG ? ORG.ledgerTag : 'x'}`))!;
const AS_AT = one('--as-at', '2026-11-25')!;
const BATCH_DAY = one('--batch-day', '2026-11-25')!;
const ABSS_FY_START = one('--abss-fy-start', '2024-01-01')!; // ABSS current year (Current Earnings) starts here
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => R(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DEBIT_NORMAL = (code: string) => /^[1569]/.test(code);
const IS_PNL = (code: string) => /^[4-9]/.test(code);

type JLine = { code: string; dr: number; cr: number; desc?: string | null };
type SimJe = { key: string; jn: string; date: string; type: string; createdBy: string; lines: JLine[]; origin: 'aims' | 'new'; ref?: string | null };

(async () => {
  if (!ORG) throw new Error(`--org must be one of: ${Object.keys(ORGS).join(', ')}`);
  if (argv.includes('--apply')) {
    // The writer is deliberately not run in this round (owner: PREP + DRY-RUN only). It stays refused until the dry
    // run shows 0 trial-balance mismatches, i.e. the General Journal export + ABSS opening balances are in hand.
    throw new Error('--apply is gated: the dry run must first show every account = ABSS (see summary.txt "Blockers"). Not run in this round.');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const batch = `wct-abss-${ORG.ledgerTag}-${BATCH_DAY}`;
  const MARK = `abss-gl:${batch}`;
  fs.mkdirSync(OUT, { recursive: true });
  const flags: Array<Record<string, any>> = [];
  const flag = (kind: string, detail: Record<string, any>) => flags.push({ kind, ...detail });

  // ------------------------------------------------------------------ 1. reports
  const file = (name: string) => path.join(DIR, `${name} ${ORG.suffix}.txt`);
  const read = (name: string) => {
    const p = file(name);
    if (!fs.existsSync(p)) return null;
    const d = A.decode(fs.readFileSync(p));
    for (const o of d.oddChars) flag('encoding', { file: path.basename(p), line: o.line, byte: o.byte, decodedAs: o.char });
    return d.text as string;
  };
  const J: Record<string, any> = {};
  const jfiles: Record<string, string> = { SJ: 'Sales & Receivables Journal', PJ: 'Purchases & Payables Journal', CR: 'Cash Receipts', CD: 'Cash Disbursements', GJ: 'General Journal' };
  for (const [src, name] of Object.entries(jfiles)) {
    const t = read(name);
    if (t === null) { flag('missing-report', { file: `${name} ${ORG.suffix}.txt`, impact: src === 'GJ' ? 'General Journal entries (GJ######) are not in the export set' : 'journal missing' }); continue; }
    J[src] = A.parseJournal(t, src);
    if (J[src].strayCr) flag('stray-cr', { file: `${name} ${ORG.suffix}.txt`, count: J[src].strayCr, note: 'CR glued to card names (e.g. "KEMSA (Far East) Pte Ltd\\r"), stripped' });
    for (const f of J[src].flags) flag(`parse:${f.kind}`, { file: `${name} ${ORG.suffix}.txt`, ...f });
  }
  const parseOther = (name: string, fn: string) => {
    const t = read(name);
    if (t === null) { flag('missing-report', { file: `${name} ${ORG.suffix}.txt` }); return null; }
    const r = A[fn](t);
    if (r.strayCr) flag('stray-cr', { file: `${name} ${ORG.suffix}.txt`, count: r.strayCr, note: 'stripped' });
    for (const f of r.flags) flag(`parse:${f.kind}`, { file: `${name} ${ORG.suffix}.txt`, ...f });
    return r;
  };
  const AL = parseOther('Accounts List Summary', 'parseAccountsList');
  const CL = parseOther('Customer Ledger', 'parseCustomerLedger');
  const IT = parseOther('Invoice Transactions', 'parseInvoiceTransactions');
  const CI = parseOther('Payments [Closed Invoices]', 'parseClosedInvoices');
  const SPH = parseOther('Supplier Payment History', 'parseSupplierPayments');
  const REC = parseOther('Reconciliation Report', 'parseReconciliation');
  // GJ numbers referenced elsewhere (proves the GJ exists in ABSS even though it was not exported)
  const gjSeen = new Set<string>();
  for (const a of REC?.accounts || []) for (const x of [...a.cheques, ...a.deposits]) if (/^GJ\d+/.test(x.id)) gjSeen.add(x.id);
  for (const c of CL?.cards || []) for (const t of c.txns) if (t.src === 'GJ') gjSeen.add(t.id);

  // chart (codes for the Accounts List, which prints names only)
  const chartRows = fs.readFileSync(ORG.chart, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const [lv, code, name] = l.split('|');
    return { lv: Number(lv), code, name };
  });
  if (!AL || AL.rows.length !== chartRows.length) throw new Error(`Accounts List rows ${AL?.rows.length} <> chart file rows ${chartRows.length}`);
  const target = new Map<string, { name: string; abss: number; header: boolean; lv: number }>();
  chartRows.forEach((c, i) => {
    const a = AL.rows[i];
    if (A.nameKey(a.name) !== A.nameKey(c.name)) throw new Error(`Accounts List row ${i + 1} "${a.name}" <> chart ${c.code} "${c.name}"`);
    target.set(c.code, { name: a.name, abss: a.balance, header: i + 1 < chartRows.length && chartRows[i + 1].lv > c.lv, lv: c.lv });
  });

  // ------------------------------------------------------------------ 2. AIMS (read-only)
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const q = async <T = any>(sql: string, p: any[] = []) => (await c.query(sql, p)).rows as T[];
  const counts = async () =>
    (await q(`select 'JournalEntry' t, count(*)::int n, max("updatedAt")::text mx from "JournalEntry" where "organizationId" = $1
      union all select 'JournalEntryLine', count(*)::int, null from "JournalEntryLine" l join "JournalEntry" j on j.id = l."journalEntryId" where j."organizationId" = $1
      union all select 'Document', count(*)::int, max("updatedAt")::text from "Document" where "organizationId" = $1
      union all select 'Customer', count(*)::int, max("updatedAt")::text from "Customer" where "organizationId" = $1
      union all select 'Supplier', count(*)::int, max("updatedAt")::text from "Supplier" where "organizationId" = $1
      union all select 'Payment', count(*)::int, max("updatedAt")::text from "Payment" where "organizationId" = $1
      union all select 'Order', count(*)::int, max("updatedAt")::text from "Order" where "organizationId" = $1`, [ORG.id]));
  const before = await counts();
  const [org] = await q(`select id, name from "Organization" where id = $1`, [ORG.id]);
  const chart = await q(`select id, code, name, "accountType", category, "isActive", "isControlAccount" from "ChartOfAccount" where "organizationId" = $1 order by code`, [ORG.id]);
  const [setting] = await q(`select "controlAccounts", "lockedThroughDate"::text, "fiscalYearEndDay", "fiscalYearEndMonth" from "AccountingSetting" where "organizationId" = $1`, [ORG.id]);
  const jes = await q(`select id, "journalNumber" jn, "entryDate"::date::text dt, type, status, "createdBy", reference, "sourceDocumentId" sdid, "sourcePaymentId" spid, "totalDebit"::float td
                         from "JournalEntry" where "organizationId" = $1 order by "entryDate", "journalNumber"`, [ORG.id]);
  const jls = await q(`select l."journalEntryId" jid, a.code, l.debit::float dr, l.credit::float cr from "JournalEntryLine" l join "JournalEntry" j on j.id = l."journalEntryId"
                         join "ChartOfAccount" a on a.id = l."accountId" where j."organizationId" = $1`, [ORG.id]);
  const customers = await q(`select id::text, "customerCode" code, name from "Customer" where "organizationId" = $1`, [ORG.id]);
  const suppliers = await q(`select id::text, "supplierCode" code, name from "Supplier" where "organizationId" = $1`, [ORG.id]);
  const docs = await q(`select id::text, name, type, status::text, "createdAt"::text ca, config from "Document" where "organizationId" = $1`, [ORG.id]);
  const orders = await q(`select "orderNumber", status from "Order" where "organizationId" = $1`, [ORG.id]);
  const payments = await q(`select count(*)::int n from "Payment" where "organizationId" = $1`, [ORG.id]);

  const linesOf = new Map<string, JLine[]>();
  for (const l of jls) {
    if (!linesOf.has(l.jid)) linesOf.set(l.jid, []);
    linesOf.get(l.jid)!.push({ code: l.code, dr: l.dr, cr: l.cr });
  }
  const chartByCode = new Map(chart.map((a) => [a.code, a]));
  const ctl = setting?.controlAccounts || {};
  const AR = ctl.debtorControl || '1-3100';
  const AP = ctl.creditorControl || '2-2100';
  const RE = ctl.retainedProfits || '3-8000';
  const HB = '3-9999';
  const CE = '3-9000';

  const srcOf = (j: any) => {
    const cb = String(j.createdBy || '');
    if (cb.startsWith('abss-gl:')) return 'ABSS ledger';
    if (cb.startsWith('abss-cutover:')) return 'ABSS cutover (6 Nov)';
    if (cb.startsWith('erp-gl:')) return 'tracker history (erp-gl)';
    if (cb.startsWith('system')) return 'system script';
    return 'app-native';
  };

  // ------------------------------------------------------------------ 3. ABSS entries -> journals
  // first ABSS day (opening = the day before; first of that month, like WCT's ABSS-OPENING-2024-01-01)
  const allEntries: any[] = [];
  for (const src of ['SJ', 'PJ', 'CR', 'CD', 'GJ']) if (J[src]) for (const e of J[src].entries) allEntries.push(e);
  const firstDay = allEntries.map((e) => e.date).sort()[0];
  const OPEN_DAY = `${firstDay.slice(0, 7)}-01`; // ABSS-OPENING-<OPEN_DAY>, dated the day before
  const openDate = new Date(Date.parse(`${OPEN_DAY}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

  const numbered = new Map<string, number>();
  const newJes: SimJe[] = [];
  const entryInfo: any[] = [];
  const unknownCodes = new Map<string, number>();
  for (const src of ['SJ', 'PJ', 'CR', 'CD', 'GJ']) {
    if (!J[src]) continue;
    const es = [...J[src].entries].sort((a: any, b: any) => a.date.localeCompare(b.date) || a.seq - b.seq);
    for (const e of es) {
      const base = `ABSS-${src}-${e.id}`;
      const n = (numbered.get(base) || 0) + 1;
      numbered.set(base, n);
      const jn = n === 1 ? base : `${base}-${n}`;
      const arNet = R(e.lines.filter((l: any) => l.code === AR).reduce((a: number, l: any) => a + l.dr - l.cr, 0));
      const apNet = R(e.lines.filter((l: any) => l.code === AP).reduce((a: number, l: any) => a + l.cr - l.dr, 0));
      let type = { SJ: 'INVOICE', PJ: 'BILL', CR: 'PAYMENT', CD: 'PAYMENT', GJ: 'MANUAL' }[src]!;
      if (src === 'SJ' && arNet < 0) type = 'CREDIT_NOTE';
      if (src === 'SJ' && Math.abs(arNet) < 0.005) type = 'ADJUSTMENT';
      for (const l of e.lines) {
        const a = chartByCode.get(l.code);
        if (!a || a.accountType === 'HEADER') unknownCodes.set(l.code, (unknownCodes.get(l.code) || 0) + 1);
        else if (!a.isActive) flag('inactive-account', { code: l.code, journal: jn });
      }
      newJes.push({ key: jn, jn, date: e.date, type, createdBy: MARK, origin: 'new', ref: e.id, lines: e.lines.map((l: any) => ({ code: l.code, dr: l.dr, cr: l.cr, desc: l.lineMemo || e.memo })) });
      entryInfo.push({ src, jn, part: n, id: e.id, date: e.date, memo: e.memo, type, dr: e.dr, arNet, apNet, card: e.lines.find((l: any) => l.cardName)?.cardName || null, lines: e.lines });
    }
  }
  for (const [code, n] of unknownCodes) flag('account-not-in-aims-chart', { code, lines: n });
  const reused = [...numbered.entries()].filter(([, n]) => n > 1);
  for (const [base, n] of reused) {
    const parts = entryInfo.filter((x) => `ABSS-${x.src}-${x.id}` === base);
    const sig = parts.map((p) => `${p.date}|${p.dr}|${p.lines.map((l: any) => `${l.code}:${l.dr}:${l.cr}`).sort().join(',')}`);
    const exact = sig.length !== new Set(sig).size;
    flag(exact ? 'duplicate-entry' : 'number-reused', { number: base, entries: n, detail: parts.map((p) => `${p.date} ${money(p.dr)} ${p.memo.slice(0, 30)}`).join(' | ') });
  }
  // same card + date + amount twice under DIFFERENT numbers (possible double entry)
  const sameKey = new Map<string, any[]>();
  for (const x of entryInfo) {
    if (!['SJ', 'PJ'].includes(x.src)) continue;
    const k = `${x.src}|${x.date}|${x.dr}|${A.nameKey(x.card || x.memo)}`;
    if (!sameKey.has(k)) sameKey.set(k, []);
    sameKey.get(k)!.push(x);
  }
  for (const [, v] of sameKey) if (v.length > 1) flag('possible-double-entry', { entries: v.map((x) => x.jn).join(', '), date: v[0].date, amount: v[0].dr, card: v[0].card || v[0].memo });

  // ------------------------------------------------------------------ 4. clear-out (mirror WCT (S): delete what ABSS replaces)
  const cutover = jes.filter((j) => String(j.createdBy || '').startsWith('abss-cutover:') && j.status !== 'VOID');
  const erpInWindow = jes.filter((j) => String(j.createdBy || '').startsWith('erp-gl:') && j.status !== 'VOID' && j.dt >= OPEN_DAY);
  const erpKept = jes.filter((j) => String(j.createdBy || '').startsWith('erp-gl:') && j.status !== 'VOID' && j.dt < OPEN_DAY);
  const otherLive = jes.filter((j) => j.status !== 'VOID' && !cutover.includes(j) && !erpInWindow.includes(j) && !erpKept.includes(j));
  const removeIds = new Set([...cutover, ...erpInWindow].map((j) => j.id));
  const openingDocs = docs.filter((d) => ['abss-opening'].includes(d.config?.erpImport?.source) || /^OB-/.test(d.name || ''));
  const priorAbss = jes.filter((j) => String(j.createdBy || '').startsWith('abss-gl:'));
  if (priorAbss.length) flag('abss-ledger-already-present', { journals: priorAbss.length, note: 'a previous ABSS history import exists; roll it back first' });

  // ------------------------------------------------------------------ 5. opening
  const sumBy = (list: SimJe[], pred: (j: SimJe, l: JLine) => boolean = () => true) => {
    const m = new Map<string, number>();
    for (const j of list) for (const l of j.lines) if (pred(j, l)) m.set(l.code, R((m.get(l.code) || 0) + l.dr - l.cr));
    return m;
  };
  const asSim = (j: any): SimJe => ({ key: j.id, jn: j.jn, date: j.dt, type: j.type, createdBy: j.createdBy, origin: 'aims', ref: j.reference, lines: linesOf.get(j.id) || [] });
  const keptHistory = sumBy(erpKept.map(asSim));
  // ABSS opening balances known from the exports: AR = customers' balances brought forward in the Customer Ledger.
  const abssOpening = new Map<string, number>();
  const clOpen = R((CL?.cards || []).reduce((a: number, x: any) => a + x.opening, 0));
  abssOpening.set(AR, clOpen);
  // AP: Supplier Payment History rows with no PO# / purchase date pay purchases that are not in the PJ export (ABSS
  // historical purchases entered at conversion). Their total is the AP brought forward (flagged per row below).
  const sphNoPo = (SPH?.cards || []).flatMap((x: any) => x.rows.filter((r: any) => !r.po).map((r: any) => ({ ...r, card: x.name })));
  const apOpen = R(sphNoPo.reduce((a: number, r: any) => a + r.applied, 0));
  if (sphNoPo.length) abssOpening.set(AP, -apOpen); // Dr-positive
  for (const r of sphNoPo.filter((x: any) => x.chqDate >= '2025-01-01')) flag('ap-payment-without-purchase', { card: r.card, cheque: r.cheque, date: r.chqDate, applied: r.applied, note: 'no PO#: counted as AP brought forward, but paid long after conversion' });
  const openLines: JLine[] = [];
  const codes = new Set([...keptHistory.keys(), ...abssOpening.keys()]);
  for (const code of [...codes].sort()) {
    const want = abssOpening.get(code) || 0; // Dr-positive
    const have = keptHistory.get(code) || 0;
    const d = R(want - have);
    if (Math.abs(d) < 0.005) continue;
    openLines.push({ code, dr: d > 0 ? d : 0, cr: d < 0 ? -d : 0, desc: `ABSS ${money(want)} · AIMS history ${money(have)}` });
  }
  const openNet = R(openLines.reduce((a, l) => a + l.dr - l.cr, 0));
  if (Math.abs(openNet) >= 0.005) openLines.push({ code: HB, dr: openNet < 0 ? -openNet : 0, cr: openNet > 0 ? openNet : 0, desc: 'Historical balancing (ABSS opening balances not in the exports; see Blockers)' });
  const openingJe: SimJe = { key: 'opening', jn: `ABSS-OPENING-${OPEN_DAY}`, date: openDate, type: 'OPENING_BALANCE', createdBy: MARK, origin: 'new', lines: openLines };

  // ------------------------------------------------------------------ 6. simulate ledger + year-end closes
  const kept = jes.filter((j) => j.status !== 'VOID' && !removeIds.has(j.id)).map(asSim);
  const sim: SimJe[] = [...kept, openingJe, ...newJes];
  const fyEnd = (y: number) => `${y}-12-31`;
  const years: number[] = [];
  const minYear = Number(sim.map((j) => j.date).sort()[0].slice(0, 4));
  for (let y = minYear; y < Number(AS_AT.slice(0, 4)); y++) years.push(y);
  const closes: SimJe[] = [];
  for (const y of years) {
    const pnl = sumBy(sim.filter((j) => j.date >= `${y}-01-01` && j.date <= fyEnd(y) && !/^ABSS-YE-/.test(j.jn)), (_j, l) => IS_PNL(l.code));
    const lines: JLine[] = [];
    let net = 0;
    for (const [code, v] of [...pnl.entries()].sort()) {
      if (Math.abs(v) < 0.005) continue;
      lines.push({ code, dr: v < 0 ? -v : 0, cr: v > 0 ? v : 0 });
      net = R(net + v);
    }
    if (!lines.length) continue;
    lines.push({ code: RE, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0 });
    closes.push({ key: `ye${y}`, jn: `ABSS-YE-${y}`, date: fyEnd(y), type: 'ADJUSTMENT', createdBy: MARK, origin: 'new', ref: `YE-${y}`, lines });
  }
  const simAll = [...sim, ...closes].filter((j) => j.date <= AS_AT);
  const late = [...sim].filter((j) => j.date > AS_AT);
  for (const j of late) flag('dated-after-as-at', { journal: j.jn, date: j.date });

  // ------------------------------------------------------------------ 7. trial balance vs ABSS Accounts List
  const bal = sumBy(simAll);
  // ABSS view: P&L since ABSS_FY_START (unclosed in ABSS), Retained Earnings without the AIMS closes of those years
  const pnlAbss = sumBy(simAll.filter((j) => j.date >= ABSS_FY_START && !/^ABSS-YE-/.test(j.jn)), (_j, l) => IS_PNL(l.code));
  const closesInAbssYear = sumBy(closes.filter((j) => j.date >= ABSS_FY_START && j.date <= AS_AT));
  const tbRows: any[] = [];
  const nat = (code: string, drPos: number) => R(DEBIT_NORMAL(code) ? drPos : -drPos);
  // residual per account under the strict model; used to explain mismatches
  for (const ch of chartRows) {
    const t = target.get(ch.code)!;
    if (t.header) continue;
    let aims: number;
    let basis: string;
    if (ch.code === CE) {
      aims = R(-[...pnlAbss.values()].reduce((a, v) => a + v, 0));
      basis = `computed: P&L ${ABSS_FY_START}..${AS_AT}`;
    } else if (ch.code === RE) {
      aims = nat(RE, R((bal.get(RE) || 0) - (closesInAbssYear.get(RE) || 0)));
      basis = `3-8000 without AIMS closes from ${ABSS_FY_START}`;
    } else if (IS_PNL(ch.code)) {
      aims = nat(ch.code, pnlAbss.get(ch.code) || 0);
      basis = `entries ${ABSS_FY_START}..${AS_AT}`;
    } else {
      aims = nat(ch.code, bal.get(ch.code) || 0);
      basis = `balance at ${AS_AT}`;
    }
    const diff = R(t.abss - aims);
    tbRows.push({ code: ch.code, name: t.name, abss: t.abss, aims, diff, ok: Math.abs(diff) < 0.005, basis, reason: '' });
  }
  // header accounts: printed total vs its leaf accounts (ABSS internal check only)
  const headerChecks: any[] = [];
  chartRows.forEach((ch, i) => {
    const t = target.get(ch.code)!;
    if (!t.header) return;
    let s = 0;
    for (let k = i + 1; k < chartRows.length && chartRows[k].lv > ch.lv; k++) if (!target.get(chartRows[k].code)!.header) s = R(s + target.get(chartRows[k].code)!.abss);
    headerChecks.push({ code: ch.code, name: t.name, printed: t.abss, leaves: s, ok: Math.abs(s - t.abss) < 0.005 || ch.lv === 0 });
  });

  // explain mismatches
  const gjTouches = new Map<string, number>(); // accounts that the GJ demonstrably hits (from Reconciliation Report / ledgers)
  for (const a of REC?.accounts || []) for (const x of [...a.cheques, ...a.deposits]) if (/^GJ/.test(x.id)) gjTouches.set(a.code, (gjTouches.get(a.code) || 0) + 1);
  const recByCode = new Map((REC?.accounts || []).map((a: any) => [a.code, a]));
  const closeTotals = new Map<string, number>(); // ABSS balance on the Reconciliation Report
  for (const a of REC?.accounts || []) closeTotals.set(a.code, a.summary[`ABSS Balance on ${AS_AT.split('-').reverse().map((x, i) => (i < 2 ? String(Number(x)) : x)).join('/')}`]);
  for (const r of tbRows) {
    if (r.ok) continue;
    const why: string[] = [];
    if (r.code === HB) why.push('opening balancing line: ABSS opening balances other than AR / AP are not in the exports');
    else if (r.code === RE) why.push('opening equity + P&L to 2023 incl. GJ (not exported)');
    else if (r.code === CE) why.push('= sum of the P&L differences (GJ on P&L accounts since 2024)');
    else if (r.code === AP && Math.abs(r.diff + sphNoPo.filter((x: any) => x.chqDate >= '2025-01-01').reduce((a: number, x: any) => a + x.applied, 0)) < 0.005)
      why.push(`no-PO payment(s) ${sphNoPo.filter((x: any) => x.chqDate >= '2025-01-01').map((x: any) => `${x.card} ${x.cheque} ${money(x.applied)}`).join(', ')} counted in the AP brought forward but ABSS shows them as an unapplied debit`);
    else {
      if (!J.GJ) why.push('GJ not exported');
      if (gjTouches.get(r.code)) why.push(`${gjTouches.get(r.code)} GJ items on this bank in the Reconciliation Report`);
      if (!IS_PNL(r.code) && r.code !== AR && r.code !== AP) why.push('ABSS opening balance unknown');
    }
    r.reason = why.join('; ');
  }
  const leafCount = tbRows.length;
  const matched = tbRows.filter((r) => r.ok).length;
  // what the missing GJ + unknown openings must supply, Dr-positive per account (a balanced set if nothing else is missing)
  const residual = tbRows.filter((r) => !r.ok && r.code !== CE).map((r) => ({ code: r.code, name: r.name, missingDr: DEBIT_NORMAL(r.code) ? r.diff : R(-r.diff) }));
  const residualNet = R(residual.reduce((a, x) => a + x.missingDr, 0));
  const tbHash = crypto.createHash('sha1').update(JSON.stringify(tbRows.map((r) => [r.code, r.abss, r.aims]))).digest('hex').slice(0, 12);

  // ------------------------------------------------------------------ 8. customers
  const custByKey = new Map<string, any>();
  for (const cu of customers) custByKey.set(A.nameKey(cu.name), cu);
  const invByName = new Map(docs.filter((d) => d.type === 'INVOICE').map((d) => [d.name, d]));
  const toks = (s: string) => new Set(A.nameKey(s).split(' ').filter((w: string) => w && !['pte', 'ltd', 'and', 's', 'the', 'private', 'limited', 'sg', 'singapore'].includes(w)));
  const sim2 = (a: string, b: string) => {
    const x = toks(a);
    const y = toks(b);
    if (!x.size || !y.size) return 0;
    let i = 0;
    for (const w of x) if (y.has(w)) i++;
    return i / Math.max(x.size, y.size);
  };
  const bigrams = (t: string) => {
    const k = A.nameKey(t).replace(/^(mr|ms|mrs|dr) /, '').replace(/ pte ltd$/, '').replace(/ /g, '').slice(0, 30);
    const m = new Map<string, number>();
    for (let i = 0; i < k.length - 1; i++) m.set(k.slice(i, i + 2), (m.get(k.slice(i, i + 2)) || 0) + 1);
    return { m, n: Math.max(k.length - 1, 0) };
  };
  const dice = (a: string, b: string) => {
    const x = bigrams(a);
    const y = bigrams(b);
    if (!x.n || !y.n) return 0;
    let i = 0;
    for (const [g, c] of x.m) i += Math.min(c, y.m.get(g) || 0);
    return (2 * i) / (x.n + y.n);
  };
  const custRows: any[] = [];
  for (const card of CL?.cards || []) {
    const k = A.nameKey(card.name);
    let m = custByKey.get(k);
    let how = m ? 'exact' : '';
    if (!m) {
      // evidence: the card's ABSS invoices exist in AIMS (INV<no>) under one customer
      const ids = new Set<string>();
      for (const t of card.txns) if (t.src === 'SJ') { const d = invByName.get(`INV${t.id}`); if (d?.config?.customerId) ids.add(d.config.customerId); }
      if (ids.size === 1) { m = customers.find((cu) => cu.id === [...ids][0]); how = 'fuzzy: same invoices'; }
    }
    if (!m) {
      // ABSS truncates card names (~30 chars): prefix, then token overlap
      const pre = customers.filter((cu) => A.nameKey(cu.name).startsWith(k) || k.startsWith(A.nameKey(cu.name)));
      if (pre.length === 1) { m = pre[0]; how = 'fuzzy: truncated name'; }
    }
    if (!m) {
      const best = customers.map((cu) => ({ cu, s: sim2(card.name, cu.name) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.75) { m = best.cu; how = `fuzzy: words ${best.s.toFixed(2)}`; }
    }
    if (!m) {
      // spelling (Equipement / Equipment, BreakTalk / BreadTalk, "Mr Kevin Ng"): letter-pair similarity on the first 30 chars
      const best = customers.map((cu) => ({ cu, s: dice(card.name, cu.name) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.8) { m = best.cu; how = `fuzzy: spelling ${best.s.toFixed(2)} (check)`; }
      else if (best) card.nearest = `${best.cu.code} ${best.cu.name} (${best.s.toFixed(2)})`;
    }
    custRows.push({ abssCard: card.name, match: m ? how : 'new', customerCode: m?.code || '', aimsName: m?.name || '', nearestAims: m ? '' : card.nearest || '', opening: card.opening, closing: card.closing, txns: card.txns.length });
  }
  const matchedCustIds = new Set(custRows.filter((r) => r.customerCode).map((r) => r.customerCode));
  const aimsOnlyCust = customers.filter((cu) => !matchedCustIds.has(cu.code));
  const dupMatches = [...custRows.reduce((m, r) => (r.customerCode ? m.set(r.customerCode, [...(m.get(r.customerCode) || []), r.abssCard]) : m), new Map<string, string[]>())].filter(([, v]) => v.length > 1);
  for (const [code, v] of dupMatches) flag('two-abss-cards-one-customer', { customerCode: code, abssCards: v.join(' | ') });

  // ------------------------------------------------------------------ 9. suppliers
  const supNames = new Map<string, { name: string; pj: number; sph: number; cd: number }>();
  const addSup = (n: string | null, k: 'pj' | 'sph' | 'cd') => {
    if (!n) return;
    const key = A.nameKey(n);
    const s = supNames.get(key) || { name: n, pj: 0, sph: 0, cd: 0 };
    s[k]++;
    supNames.set(key, s);
  };
  for (const x of entryInfo) if (x.src === 'PJ') addSup(x.card, 'pj');
  for (const card of SPH?.cards || []) addSup(card.name, 'sph');
  const supKeys = new Set(supNames.keys());
  for (const x of entryInfo) if (x.src === 'CD' && supKeys.has(A.nameKey(x.memo))) supNames.get(A.nameKey(x.memo))!.cd++;
  const supByKey = new Map(suppliers.map((s) => [A.nameKey(s.name), s]));
  const supRows = [...supNames.values()].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
    const m = supByKey.get(A.nameKey(s.name));
    return { abssCard: s.name, match: m ? 'exact' : 'new', supplierCode: m?.code || '', pjEntries: s.pj, paymentHistoryCard: s.sph ? 'yes' : '', cdPayments: s.cd };
  });
  const cdPayeesNoSupplier = new Map<string, number>();
  for (const x of entryInfo) if (x.src === 'CD' && !supKeys.has(A.nameKey(x.memo))) cdPayeesNoSupplier.set(x.memo, (cdPayeesNoSupplier.get(x.memo) || 0) + 1);

  // ------------------------------------------------------------------ 10. documents
  // invoices: sum entries per number (imported-ledger rule)
  const sjByNo = new Map<string, any[]>();
  for (const x of entryInfo) if (x.src === 'SJ') sjByNo.set(x.id, [...(sjByNo.get(x.id) || []), x]);
  const itByNo = new Map((IT?.invoices || []).map((v: any) => [v.no, v]));
  const invRows: any[] = [];
  let linkFirst = 0;
  for (const [no, parts] of sjByNo) {
    const ar = R(parts.reduce((a: number, p: any) => a + p.arNet, 0));
    const tracker = invByName.get(`INV${no}`) || invByName.get(no);
    const it: any = itByNo.get(no);
    const abssOpen = it ? it.open : null;
    const kind = parts[0].type;
    let action: string;
    if (kind === 'ADJUSTMENT') action = 'journal only (credit applied between documents, AR net 0)';
    else if (tracker) { action = 'link first entry to existing invoice; restamp money from ABSS'; linkFirst++; }
    else action = kind === 'CREDIT_NOTE' ? 'new imported CREDIT_NOTE document' : 'new imported INVOICE document';
    const tGross = tracker ? grossOf(tracker.config) : null;
    invRows.push({
      abssNo: no, entries: parts.map((p: any) => p.jn).join(' '), date: parts[0].date, customer: parts[0].memo.replace(/^Sale; /, ''), type: kind,
      abssAr: ar, abssPaid: it ? it.payments : '', abssOpen: abssOpen ?? '', aimsDoc: tracker?.name || '', aimsGross: tGross ?? '',
      aimsOutstanding: tracker ? outstandingOf(tracker.config) ?? '' : '', grossDiff: tracker && tGross !== null ? R(ar - tGross) : '',
      action,
    });
    if (tracker && tGross !== null && Math.abs(ar - tGross) > 1) flag('invoice-amount-differs', { invoice: tracker.name, abss: ar, aims: tGross });
  }
  // historical sales: tracker invoices up to the last one ABSS carries in the customer balances brought forward
  const HIST_UNTIL = one('--historical-until', '2024-06-30')!;
  const sjNames = new Set([...sjByNo.keys()].flatMap((n) => [`INV${n}`, n]));
  const trackerNotInAbss = docs.filter((d) => d.type === 'INVOICE' && !sjNames.has(d.name));
  for (const d of trackerNotInAbss) {
    invRows.push({ abssNo: '', entries: '', date: d.config?.date, customer: d.config?.customerName, type: 'INVOICE', abssAr: '', abssPaid: '', abssOpen: '', aimsDoc: d.name,
      aimsGross: grossOf(d.config) ?? '', aimsOutstanding: outstandingOf(d.config) ?? '', grossDiff: '',
      action: String(d.config?.date || '') <= HIST_UNTIL
        ? 'no ABSS sale entry: in the ABSS customer balance brought forward (historical sale); keep, no journal'
        : 'NOT IN ABSS (owner): ABSS never booked this sale; tracker journal removed with the clear-out unless kept' });
  }
  const trackerNotInAbssGross = R(trackerNotInAbss.reduce((a, d) => a + (grossOf(d.config) || 0), 0));
  const trackerNotInAbssOpen = trackerNotInAbss.filter((d) => (outstandingOf(d.config) ?? 0) > 0.005);
  const histSales = trackerNotInAbss.filter((d) => String(d.config?.date || '') <= HIST_UNTIL);
  const notBooked = trackerNotInAbss.filter((d) => String(d.config?.date || '') > HIST_UNTIL);
  const moneyChanges = invRows.filter((r) => r.aimsDoc && r.abssOpen !== '' && r.aimsOutstanding !== '' && Math.abs(Number(r.abssOpen) - Number(r.aimsOutstanding)) > 0.005);
  // per ABSS card: customer balance brought forward vs the AIMS invoices that have no ABSS sale entry
  const codeById = new Map(customers.map((cu) => [cu.id, cu.code]));
  for (const r of custRows) {
    const mine = trackerNotInAbss.filter((d) => r.customerCode && codeById.get(d.config?.customerId) === r.customerCode);
    r.aimsInvoicesNotInAbss = mine.length;
    r.aimsInvoicesNotInAbssGross = R(mine.reduce((a, d) => a + (grossOf(d.config) || 0), 0));
    r.openingMinusThose = R(r.opening - r.aimsInvoicesNotInAbssGross);
  }
  // per customer: ABSS closing vs open SJ invoices (Invoice Transactions) -> what is left for non-SJ invoices
  const custAr: any[] = [];
  for (const card of CL?.cards || []) {
    const sjOpen = R((IT?.invoices || []).filter((v: any) => A.nameKey(v.customer) === A.nameKey(card.name)).reduce((a: number, v: any) => a + v.open, 0));
    if (Math.abs(card.closing - sjOpen) > 0.005) custAr.push({ card: card.name, closing: card.closing, sjOpen, other: R(card.closing - sjOpen) });
  }

  // bills
  const sphByPo = new Map<string, any[]>();
  for (const card of SPH?.cards || []) for (const r of card.rows) sphByPo.set(r.po, [...(sphByPo.get(r.po) || []), { ...r, card: card.name }]);
  const billRows: any[] = [];
  const pjByNo = new Map<string, any[]>();
  for (const x of entryInfo) if (x.src === 'PJ') pjByNo.set(x.id, [...(pjByNo.get(x.id) || []), x]);
  for (const [no, parts] of pjByNo) {
    const gross = R(parts.reduce((a: number, p: any) => a + p.apNet, 0));
    const pays = sphByPo.get(no) || [];
    const paid = R(pays.reduce((a: number, p: any) => a + p.applied, 0));
    billRows.push({ bill: `ABSS-PJ-${no}`, entries: parts.length, date: parts[0].date, supplier: parts[0].card, supplierInv: pays[0]?.supplierInv || '', gross, paid, open: R(gross - paid),
      paidBy: pays.map((p: any) => `ABSS-CD-${p.cheque} ${p.chqDate} ${money(p.applied)}`).join('; '), memo: parts[0].memo });
  }
  for (const [po, rows] of sphByPo) if (po && !pjByNo.has(po)) flag('payment-history-without-pj', { po, card: rows[0].card, applied: R(rows.reduce((a, r) => a + r.applied, 0)) });
  const billsOpen = R(billRows.reduce((a, b) => a + b.open, 0));

  // payments (CR -> OFFICIAL_RECEIPT, CD -> PAYMENT_VOUCHER)
  const crToInv = new Map<string, string[]>();
  for (const v of IT?.invoices || []) for (const t of v.txns) if (t.src === 'CR') crToInv.set(t.id, [...(crToInv.get(t.id) || []), `${v.no} ${money(t.payment)}`]);
  const crToCard = new Map<string, string>();
  for (const card of CL?.cards || []) for (const t of card.txns) if (t.src === 'CR') crToCard.set(t.id, card.name);
  const cdToBills = new Map<string, string[]>();
  for (const card of SPH?.cards || []) for (const r of card.rows) cdToBills.set(r.cheque, [...(cdToBills.get(r.cheque) || []), `ABSS-PJ-${r.po} ${money(r.applied)}`]);
  const payRows: any[] = [];
  for (const x of entryInfo) {
    if (x.src !== 'CR' && x.src !== 'CD') continue;
    const bank = x.lines.find((l: any) => /^1-21/.test(l.code) && (x.src === 'CR' ? l.dr > 0 : l.cr > 0));
    payRows.push({
      doc: x.jn, type: x.src === 'CR' ? 'OFFICIAL_RECEIPT' : 'PAYMENT_VOUCHER', date: x.date, amount: x.dr, bank: bank?.code || '', party: x.src === 'CR' ? crToCard.get(x.id) || x.memo.replace(/^[^;]*; /, '') : x.memo,
      ar: x.src === 'CR' ? -x.arNet : '', ap: x.src === 'CD' ? -x.apNet : '', appliedTo: (x.src === 'CR' ? crToInv.get(x.id) : cdToBills.get(x.id))?.join('; ') || '',
      accounts: [...new Set(x.lines.map((l: any) => l.code))].join(' '),
    });
  }

  // bank check: AIMS simulated bank balance vs Reconciliation Report
  const bankChecks = (REC?.accounts || []).map((a: any) => {
    const abssBal = Object.entries(a.summary).find(([k]) => /^ABSS Balance/.test(k))?.[1] as number;
    const aimsBal = nat(a.code, bal.get(a.code) || 0);
    return { code: a.code, name: a.name, abssBal, aimsBal, diff: R(abssBal - aimsBal), outstandingCheques: a.outstandingCheques, outstandingDeposits: a.outstandingDeposits,
      expectedStatement: a.summary['Expected Balance on Statement'], gjItems: [...a.cheques, ...a.deposits].filter((x: any) => /^GJ/.test(x.id)).length,
      notInImport: [...a.cheques, ...a.deposits].filter((x: any) => !numbered.has(`ABSS-CR-${x.id}`) && !numbered.has(`ABSS-CD-${x.id}`)).length };
  });

  const after = await counts();
  await c.end();

  // ------------------------------------------------------------------ 11. output
  const esc = (v: any) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = (name: string, rows: any[]) => {
    const keys = rows.length ? Object.keys(rows[0]) : ['empty'];
    fs.writeFileSync(path.join(OUT, name), [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n') + '\n');
  };
  const clearRows = [
    ...cutover.map((j) => ({ action: 'delete (backup json)', journal: j.jn, date: j.dt, type: j.type, createdBy: j.createdBy, totalDebit: j.td, why: 'replaced by ABSS-OPENING + ABSS entries + ABSS-YE' })),
    ...erpInWindow.map((j) => ({ action: 'delete (backup json)', journal: j.jn, date: j.dt, type: j.type, createdBy: j.createdBy, totalDebit: j.td, why: `tracker history inside the ABSS window (from ${OPEN_DAY}): ABSS entries replace it` })),
    ...openingDocs.map((d) => ({ action: 'delete document', journal: d.name, date: d.config?.date, type: d.type, createdBy: d.config?.erpImport?.source, totalDebit: grossOf(d.config), why: 'opening-balance document replaced by ABSS history' })),
  ];
  csv('clearout.csv', clearRows);
  csv('trial-balance.csv', tbRows);
  csv('missing-gj-opening-residual.csv', residual);
  csv('customers.csv', [...custRows, ...aimsOnlyCust.map((cu) => ({ abssCard: '', match: 'AIMS only (no ABSS card)', customerCode: cu.code, aimsName: cu.name }))]);
  csv('suppliers.csv', supRows);
  csv('invoices.csv', invRows);
  csv('bills.csv', billRows);
  csv('payments.csv', payRows);
  csv('flags.csv', flags.map((f) => ({ kind: f.kind, detail: JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'kind'))) })));

  const byType = (list: SimJe[]) => list.reduce((m, j) => m.set(j.type, (m.get(j.type) || 0) + 1), new Map<string, number>());
  const grp = (list: any[], f: (j: any) => string) => {
    const m = new Map<string, { n: number; min: string; max: string; dr: number }>();
    for (const j of list) {
      const k = f(j);
      const s = m.get(k) || { n: 0, min: j.dt, max: j.dt, dr: 0 };
      s.n++;
      s.min = j.dt < s.min ? j.dt : s.min;
      s.max = j.dt > s.max ? j.dt : s.max;
      s.dr = R(s.dr + j.td);
      m.set(k, s);
    }
    return m;
  };
  const out: string[] = [];
  const say = (s = '') => out.push(s);
  say(`${ORG.label} (${ORG.id}): ABSS full history import, DRY RUN (${ENV}, read-only, ${new Date().toISOString()})`);
  say(`Reports: ${DIR} (*${ORG.suffix}.txt) · chart codes: ${ORG.chart} · batch ${MARK}`);
  say('');
  say('1. AIMS now');
  say(`  Chart: ${chart.length} accounts (${chart.filter((a) => a.isActive).length} active, ${chart.filter((a) => a.accountType === 'HEADER').length} header). Control: AR ${AR}, AP ${AP}, RE ${RE}, bank ${ctl.bankAccount}, cash ${ctl.cashAccount}, GST out ${ctl.taxLiabilities}, GST in ${ctl.taxInput}. FY end ${setting?.fiscalYearEndDay}/${setting?.fiscalYearEndMonth}, locked through ${setting?.lockedThroughDate || 'none'}.`);
  say('  Journals by source:');
  for (const [k, v] of grp(jes, (j) => `${srcOf(j)} · ${j.createdBy || 'null'} · ${j.type} · ${j.status}`)) say(`    ${k}: ${v.n} (${v.min}..${v.max}, Dr ${money(v.dr)})`);
  say(`  Opening-balance journals: ${jes.filter((j) => j.type === 'OPENING_BALANCE').map((j) => `${j.jn} ${j.dt} ${money(j.td)}`).join(', ') || 'none'}`);
  say(`  Customers ${customers.length} · Suppliers ${suppliers.length} · Orders ${orders.length} (${orders.map((o) => `${o.orderNumber} ${o.status}`).join(', ')}) · Payment rows ${payments[0].n}`);
  say('  Documents by type / source:');
  const dg = new Map<string, { n: number; gross: number; owed: number }>();
  for (const d of docs) {
    const k = `${d.type} · ${d.status} · ${d.config?.erpImport?.source || 'app-native'}`;
    const s = dg.get(k) || { n: 0, gross: 0, owed: 0 };
    s.n++;
    s.gross = R(s.gross + (grossOf(d.config) || 0));
    s.owed = R(s.owed + (outstandingOf(d.config) || 0));
    dg.set(k, s);
  }
  for (const [k, v] of dg) say(`    ${k}: ${v.n} (gross ${money(v.gross)}, owed ${money(v.owed)})`);
  say(`  Posted after the 6 Nov cutover by app / ERP catch-up: ${otherLive.length} journals; documents created after 6 Nov: ${docs.filter((d) => d.ca > '2026-11-06 15:00').map((d) => `${d.type} ${d.name || '(no number)'}`).join(', ') || 'none'}`);
  say('');
  say('2. ABSS exports parsed');
  for (const [src, j] of Object.entries(J)) say(`  ${src}: ${j.entries.length} entries, ${j.entries.reduce((a: number, e: any) => a + e.lines.length, 0)} lines, ${j.entries.map((e: any) => e.date).sort()[0]}..${j.entries.map((e: any) => e.date).sort().slice(-1)[0]}, Dr ${money(j.parsed.dr)} = Grand Total ${money(j.grandTotal?.dr)}`);
  say(`  General Journal: ${J.GJ ? 'parsed' : `NOT EXPORTED (${gjSeen.size} GJ numbers referenced in other reports: ${[...gjSeen].sort().slice(0, 3).join(', ')} … ${[...gjSeen].sort().slice(-1)[0] || ''})`}`);
  say(`  Customer Ledger ${CL?.cards.length} cards (opening balances on ${CL?.cards.filter((x: any) => x.opening).length}, total ${money(clOpen)}; closing ${money((CL?.cards || []).reduce((a: number, x: any) => a + x.closing, 0))}) · Invoice Transactions ${IT?.invoices.length} invoices (open ${money((IT?.invoices || []).reduce((a: number, v: any) => a + v.open, 0))}) · Closed Invoices ${CI?.cards.reduce((a: number, x: any) => a + x.invoices.length, 0)} on ${CI?.cards.length} cards · Supplier Payment History ${SPH?.cards.reduce((a: number, x: any) => a + x.rows.length, 0)} rows on ${SPH?.cards.length} cards · Reconciliation ${REC?.accounts.map((a: any) => a.code).join(', ')}`);
  say('');
  say('3. Clear-out (mirrors WCT (S) 23 Nov: replaced journals DELETED with a backup json; older ERP history kept)');
  say(`  ABSS cutover journals: ${cutover.length} (${cutover.map((j) => `${j.jn} ${money(j.td)}`).join(', ')})`);
  for (const [k, v] of grp(erpInWindow, (j) => `${j.createdBy} ${j.type}`)) say(`  Tracker history in the ABSS window (${OPEN_DAY}+): ${k} ${v.n} (${v.min}..${v.max}, Dr ${money(v.dr)})`);
  say(`  Tracker history kept (before ${OPEN_DAY}): ${erpKept.length} (${erpKept.map((j) => j.jn).join(', ') || 'none'}); netted in the opening journal`);
  say(`  Opening-balance bills / documents: ${openingDocs.length}`);
  say(`  Other live journals (kept): ${otherLive.length}`);
  say(`  Documents kept: all ${docs.filter((d) => d.type === 'INVOICE').length} tracker invoices (money restamped from ABSS where ABSS has the number), ${docs.length - docs.filter((d) => d.type === 'INVOICE').length} other documents untouched. List: clearout.csv`);
  say('');
  say('4. Import plan (counts)');
  say(`  Opening: ${openingJe.jn} dated ${openDate}, ${openLines.length} lines (${openLines.map((l) => `${l.code} ${l.dr ? 'Dr' : 'Cr'} ${money(l.dr || l.cr)}`).join(', ')})`);
  say(`  ABSS journals: ${newJes.length} (${[...byType(newJes)].map(([k, v]) => `${k} ${v}`).join(', ')}); numbers reused (-2/-3 parts): ${reused.length}; year-end closes: ${closes.map((j) => j.jn).join(', ')}`);
  say(`  Accounts: ${chart.length} in AIMS, ${new Set(entryInfo.flatMap((x) => x.lines.map((l: any) => l.code))).size} used by ABSS entries, not in AIMS chart: ${unknownCodes.size}`);
  say(`  Customers: ${custRows.length} ABSS cards -> exact ${custRows.filter((r) => r.match === 'exact').length}, fuzzy ${custRows.filter((r) => r.match.startsWith('fuzzy')).length}, new ${custRows.filter((r) => r.match === 'new').length}; AIMS customers without an ABSS card ${aimsOnlyCust.length} (customers.csv)`);
  say(`  Suppliers: ${supRows.length} ABSS cards -> matched ${supRows.filter((r) => r.match !== 'new').length}, new ${supRows.filter((r) => r.match === 'new').length}; CD payees without a supplier card ${cdPayeesNoSupplier.size} (payee text only, like WCT (S))`);
  say(`  Invoices: ${sjByNo.size} ABSS sale numbers -> link to existing ${linkFirst}, new INVOICE ${invRows.filter((r) => r.action === 'new imported INVOICE document').length}, new CREDIT_NOTE ${invRows.filter((r) => r.action === 'new imported CREDIT_NOTE document').length}, journal only ${invRows.filter((r) => r.action.startsWith('journal only')).length}`);
  say(`  Tracker invoices with no ABSS sale entry: ${trackerNotInAbss.length} (gross ${money(trackerNotInAbssGross)}): ${histSales.length} dated to ${HIST_UNTIL} = ABSS historical sales (gross ${money(histSales.reduce((a, d) => a + (grossOf(d.config) || 0), 0))} vs Customer Ledger brought forward ${money(clOpen)}), ${notBooked.length} later = NOT in ABSS: ${notBooked.map((d) => `${d.name} ${d.config?.date} gross ${money(grossOf(d.config) || 0)} owed ${money(outstandingOf(d.config) || 0)}`).join('; ')}`);
  say(`  Invoice money restamped from ABSS (Invoice Transactions): ${moneyChanges.length} invoices change outstanding (${moneyChanges.map((r) => `${r.aimsDoc} ${money(Number(r.aimsOutstanding))}->${money(Number(r.abssOpen))}`).join(', ')}); AIMS owed now ${money(docs.filter((d) => d.type === 'INVOICE').reduce((a, d) => a + (outstandingOf(d.config) || 0), 0))} -> ABSS Invoice Transactions open ${money(R((IT?.invoices || []).reduce((a: number, v: any) => a + v.open, 0)))} (+ 7. for the rest of AR)`);
  say(`  Bills: ${billRows.length} (ABSS-PJ-<no>), gross ${money(billRows.reduce((a, b) => a + b.gross, 0))}, paid per Supplier Payment History ${money(billRows.reduce((a, b) => a + b.paid, 0))}, open ${money(billsOpen)} vs AP ${AP} ABSS ${money(target.get(AP)!.abss)}`);
  say(`  Receipts: ${payRows.filter((r) => r.type === 'OFFICIAL_RECEIPT').length} OFFICIAL_RECEIPT (tied to invoices via Invoice Transactions: ${payRows.filter((r) => r.type === 'OFFICIAL_RECEIPT' && r.appliedTo).length}) · Payments: ${payRows.filter((r) => r.type === 'PAYMENT_VOUCHER').length} PAYMENT_VOUCHER (tied to bills via Supplier Payment History: ${payRows.filter((r) => r.type === 'PAYMENT_VOUCHER' && r.appliedTo).length})`);
  say('');
  say(`5. Trial balance at ${AS_AT} vs ABSS Accounts List (leaf accounts; P&L = ABSS current year ${ABSS_FY_START}..; hash ${tbHash})`);
  say(`  MATCHED ${matched} of ${leafCount} (to the cent). Header totals consistent: ${headerChecks.filter((h) => h.ok).length} of ${headerChecks.length}.`);
  for (const r of tbRows.filter((x) => !x.ok)) say(`  ${r.code} ${r.name.padEnd(30)} ABSS ${money(r.abss).padStart(14)}  AIMS ${money(r.aims).padStart(14)}  diff ${money(r.diff).padStart(14)}  ${r.reason}`);
  say(`  What the missing GJ + opening balances must supply (missing-gj-opening-residual.csv): ${residual.length} accounts, net ${money(residualNet)} (0 = a balanced set, i.e. no other entry is missing; P&L before 2024 sits in 3-8000)`);
  say('');
  say('6. Bank check (Reconciliation Report)');
  for (const b of bankChecks) say(`  ${b.code} ${b.name}: ABSS ${money(b.abssBal)} · AIMS after import ${money(b.aimsBal)} (diff ${money(b.diff)}) · outstanding cheques ${money(b.outstandingCheques)}, deposits ${money(b.outstandingDeposits)} -> expected statement ${money(b.expectedStatement)} · ${b.gjItems} GJ items, ${b.notInImport} items not in the CR/CD exports`);
  say('');
  say('7. Receivables / payables cross-checks');
  say(`  Customer Ledger closing ${money((CL?.cards || []).reduce((a: number, x: any) => a + x.closing, 0))} = AR ${AR} ABSS ${money(target.get(AR)!.abss)}; Invoice Transactions open ${money((IT?.invoices || []).reduce((a: number, v: any) => a + v.open, 0))}; cards where closing <> open ABSS invoices: ${custAr.map((x) => `${x.card} ${money(x.other)}`).join('; ') || 'none'}`);
  say('');
  const kinds = flags.reduce((m, f) => m.set(f.kind, (m.get(f.kind) || 0) + 1), new Map<string, number>());
  say(`8. Flags (${flags.length}; flags.csv): ${[...kinds].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const f of flags.filter((x) => ['missing-report', 'duplicate-entry', 'possible-double-entry', 'invoice-amount-differs', 'account-not-in-aims-chart', 'two-abss-cards-one-customer', 'payment-history-without-pj', 'ap-payment-without-purchase', 'abss-ledger-already-present'].includes(x.kind)))
    say(`  ${f.kind}: ${JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'kind')))}`);
  say('');
  say('9. Blockers before any APPLY');
  if (!J.GJ) say(`  - General Journal ${ORG.suffix} export missing (${gjSeen.size} GJ numbers referenced). Without it ${leafCount - matched} accounts cannot equal ABSS.`);
  say(`  - ABSS opening balances at conversion (before ${firstDay}) are not in the exports except AR (Customer Ledger, ${money(clOpen)}). Need ABSS "Accounts List" / Trial Balance as at ${openDate} or the account opening balances.`);
  say('');
  say(`Row counts ${ORG.label} before -> after this run: ${before.map((b, i) => `${b.t} ${b.n}->${after[i].n}${b.mx !== after[i].mx ? ` (max updatedAt CHANGED ${b.mx} -> ${after[i].mx})` : ''}`).join(', ')}`);
  fs.writeFileSync(path.join(OUT, 'summary.txt'), out.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify({
    org: ORG.id, env: ENV, at: new Date().toISOString(), marker: MARK, batch, openDay: OPEN_DAY, openDate, asAt: AS_AT, abssFyStart: ABSS_FY_START, tbHash, matched, leafCount,
    before, after, clearOut: clearRows, opening: openingJe, closes, journals: newJes.length, flags: flags.length,
  }, null, 1));
  console.log(out.join('\n'));
  console.log(`\n-> ${OUT}`);
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
