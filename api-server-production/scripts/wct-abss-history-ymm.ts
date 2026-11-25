/**
 * YMM Kitchen: ABSS full-history import, DRY RUN (owner 2026-11-25). READ-ONLY: there is no write path.
 *
 * Owner decision (binding): clear YMM's 6 Nov ABSS cutover (the ABSS-CUTOVER-2026-11-06 journal, any ABSS-YE-*, the
 * 25 OB-<code> opening bills) and replace it with the full ABSS history from the seven YMM report exports; keep and
 * reuse the 73 suppliers.
 *
 * What this script does (all in memory, nothing is written to any database):
 *   1. parses the ABSS exports (lib/abss-report-parse.js) and checks each report against its own Grand Total
 *   2. reads YMM's current books (chart, controls, journals, suppliers, customers, documents) read-only
 *   3. lists the clear-out (journals to void the app's way, opening bills to soft-delete) and checks nothing else uses them
 *   4. plans the import with the WCT (S) ledger conventions (lib/abss-history-plan.js):
 *        journals   ABSS-SJ / -PJ / -CR / -CD / -GJ-<ID#>[-n], createdBy abss-gl:<batch>, opening derived at 1 Dec 2024
 *        documents  invoices / credit notes (sales), bills (purchases), official receipts (CR), payment vouchers (CD),
 *                   names = the journal numbers, config.erpImport.source 'abss-ledger' (same as WCT (S))
 *        customers  one "BHOP outlet sales" customer (recommended) or one per receipt channel (--customers channel)
 *        suppliers  matched to the existing ones by name, the rest planned with the app's code rule
 *   5. trial balance as at 25 Nov 2026 after the plan, every account vs the ABSS Accounts List Summary
 * Outputs (default ~/Desktop/aims-agents/logs/wct/abss-history-2026-11-25/ymm/): summary.txt, plan.json, tb.csv,
 * clearout.csv, journals.csv, invoices.csv, bills.csv, receipts.csv, payments.csv, suppliers.csv, flags.csv.
 *
 *   DATABASE_URL=<prod> TZ=UTC npx ts-node --transpile-only scripts/wct-abss-history-ymm.ts --env prod [--customers single|channel] [--out <dir>]
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { Client, types } from 'pg';
import { stampDocumentMoney } from '../src/common/document-money';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const P = require('./lib/abss-report-parse');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const H = require('./lib/abss-history-plan');

types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(20, (v) => Number(v));

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env');
const CUSTOMERS = one('--customers', 'single')!;
const ORG = '5c700000-0000-4000-8000-5c7000000003';
const BATCH = 'ymm-abss-2026-11-25';
const CREATED_BY = `abss-gl:${BATCH}`;
const AS_AT = '2026-11-25';
const FIRST_DAY = '2024-12-01';
const SRC_DIR = path.join(os.homedir(), 'Desktop/aims-agents/imports/abss-racking-ymm');
const CHART_FILE = path.join(os.homedir(), 'Desktop/aims/_imports/wct/abss/ymm-abss-coa-2026-11-06.txt');
const OUT = one('--out', path.join(os.homedir(), 'Desktop/aims-agents/logs/wct/abss-history-2026-11-25/ymm'))!;
const REPORTS: Array<[string, string]> = [
  ['SJ', 'Sales & Receivables Journal YMM.txt'],
  ['PJ', 'Purchases & Payables Journal YMM.txt'],
  ['CR', 'Cash Receipts YMM.txt'],
  ['CD', 'Cash Disbursements YMM.txt'],
  ['GJ', 'General Journal YMM.txt'],
];
const SINGLE_CUSTOMER = 'BHOP Outlet Sales';
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => R(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v: any) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (file: string, head: string[], rows: any[][]) =>
  fs.writeFileSync(path.join(OUT, file), [head.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n');

type Flag = { kind: string; severity: 'INFO' | 'WARN' | 'STOP'; ref: string; detail: string };

(async () => {
  if (argv.includes('--apply')) throw new Error('Dry run only: this script has no write path. The apply step is built after the owner signs off the plan.');
  if (ENV !== 'prod' && ENV !== 'dev') throw new Error('--env prod|dev');
  if (!['single', 'channel'].includes(CUSTOMERS)) throw new Error('--customers single|channel');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).host;
  if (ENV === 'prod' && !host.includes('ep-icy-moon')) throw new Error('--env prod but DATABASE_URL is not the prod endpoint');
  fs.mkdirSync(OUT, { recursive: true });
  const flags: Flag[] = [];
  const flag = (kind: string, severity: Flag['severity'], ref: string, detail: string) => flags.push({ kind, severity, ref, detail });

  // ───────────────────────────── 1. parse the exports ─────────────────────────────
  const files: any = {};
  const parsed: Record<string, any> = {};
  for (const [src, file] of REPORTS) {
    const buf = fs.readFileSync(path.join(SRC_DIR, file));
    const dec = P.decode(buf);
    files[src] = { file, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16), encoding: dec.encoding, nonAscii: dec.nonAscii, crlf: dec.crlf };
    if (dec.nonAscii) flag('encoding', 'INFO', file, `${dec.nonAscii} non-ASCII bytes, decoded as ${dec.encoding}`);
    const r = P.parseJournalReport(dec.text);
    parsed[src] = r;
    const dr = R(r.entries.reduce((a: number, e: any) => a + P.entryTotals(e).dr, 0));
    const cr = R(r.entries.reduce((a: number, e: any) => a + P.entryTotals(e).cr, 0));
    files[src] = { ...files[src], entries: r.entries.length, headers: r.headerCount, lines: r.entries.reduce((a: number, e: any) => a + e.lines.length, 0), dr, cr, grandTotal: r.grandTotal, range: r.range };
    if (!r.grandTotal || Math.abs(r.grandTotal.debit - dr) > 0.005 || Math.abs(r.grandTotal.credit - cr) > 0.005)
      flag('grand-total', 'STOP', file, `parsed Dr ${money(dr)} / Cr ${money(cr)} vs report Grand Total ${JSON.stringify(r.grandTotal)}`);
    if (r.headerCount !== r.entries.length) flag('headers', 'STOP', file, `${r.headerCount} entry headers vs ${r.entries.length} entries`);
    for (const u of r.unparsed) flag('unparsed', 'STOP', `${file}:${u.lineNo}`, `${u.why}: ${u.text.slice(0, 120)}`);
    for (const e of r.entries) {
      const t = P.entryTotals(e);
      if (!e.lines.length) flag('empty-entry', 'STOP', `${src} ${e.date} line ${e.lineNo}`, e.memo);
      else if (!t.balanced) flag('unbalanced', 'STOP', `${src} ${t.ids[0]} ${e.date}`, `Dr ${t.dr} Cr ${t.cr}`);
      if (!e.memo) flag('no-memo', 'INFO', `${src} ${t.ids[0]} ${e.date}`, `entry header without a memo (report line ${e.lineNo})`);
      if (e.date < FIRST_DAY || e.date > AS_AT) flag('date-range', 'WARN', `${src} ${t.ids[0]}`, `dated ${e.date}, outside ${FIRST_DAY}..${AS_AT}`);
    }
  }
  const tbText = P.decode(fs.readFileSync(path.join(SRC_DIR, 'Accounts List Summary YMM.txt'))).text;
  const list = P.parseAccountsList(tbText);
  const chartFile = P.parseChartFile(fs.readFileSync(CHART_FILE, 'utf8'));
  const sphText = P.decode(fs.readFileSync(path.join(SRC_DIR, 'Supplier Payment History YMM.txt'))).text;
  const sph = P.parseSupplierPaymentHistory(sphText);
  for (const u of sph.unparsed) flag('unparsed', 'STOP', `Supplier Payment History:${u.lineNo}`, u.text.slice(0, 120));
  if (list.length !== chartFile.length) flag('accounts-list', 'STOP', 'Accounts List Summary', `${list.length} rows vs ${chartFile.length} in the chart file`);
  list.forEach((l: any, i: number) => {
    if (chartFile[i] && chartFile[i].name !== l.name) flag('accounts-list', 'STOP', chartFile[i].code, `chart "${chartFile[i].name}" vs list "${l.name}" at row ${i + 1}`);
  });

  // ───────────────────────────── 2. YMM now (read-only) ─────────────────────────────
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const q = async <T = any>(sql: string, p: any[] = []) => (await c.query(sql, p)).rows as T[];
  const snapshot = async () =>
    (
      await q(
        `select (select count(*) from "JournalEntry" where "organizationId" = $1)::int je,
                (select max("updatedAt")::text from "JournalEntry" where "organizationId" = $1) je_max,
                (select count(*) from "JournalEntryLine" l join "JournalEntry" j on j.id = l."journalEntryId" where j."organizationId" = $1)::int jel,
                (select count(*) from "Document" where "organizationId" = $1)::int doc,
                (select max("updatedAt")::text from "Document" where "organizationId" = $1) doc_max,
                (select count(*) from "Customer" where "organizationId" = $1)::int cust,
                (select max("updatedAt")::text from "Customer" where "organizationId" = $1) cust_max,
                (select count(*) from "Supplier" where "organizationId" = $1)::int sup,
                (select max("updatedAt")::text from "Supplier" where "organizationId" = $1) sup_max,
                (select count(*) from "ChartOfAccount" where "organizationId" = $1)::int coa,
                (select max("updatedAt")::text from "ChartOfAccount" where "organizationId" = $1) coa_max,
                (select count(*) from "BillPayment" where "organizationId" = $1)::int bp,
                (select count(*) from "Payment" where "organizationId" = $1)::int pay`,
        [ORG],
      )
    )[0];
  const before = await snapshot();
  const [org] = await q(`select id, name from "Organization" where id = $1`, [ORG]);
  if (!org) throw new Error(`org ${ORG} not found`);
  const chart = await q<{ id: string; code: string; name: string; accountType: string; isActive: boolean }>(
    `select id, code, name, "accountType", "isActive" from "ChartOfAccount" where "organizationId" = $1 order by code`,
    [ORG],
  );
  const acct = new Map(chart.map((a) => [a.code, a]));
  const [setting] = await q(`select "controlAccounts" c, "lockedThroughDate"::text l1, "staffLockedThroughDate"::text l2 from "AccountingSetting" where "organizationId" = $1`, [ORG]);
  const ctl = { ar: setting?.c?.debtorControl || '1-2200', ap: setting?.c?.creditorControl || '2-2200' };
  const journals = await q(
    `select je.id, je."journalNumber" jn, je."entryDate"::date::text dt, je.type, je.status, je."createdBy", je."sourceDocumentId" did, je."sourcePaymentId" pid,
            je."totalDebit"::float dr, je."totalCredit"::float cr, je.description, (select count(*)::int from "JournalEntryLine" l where l."journalEntryId" = je.id) lines
       from "JournalEntry" je where je."organizationId" = $1 order by je."entryDate", je."journalNumber"`,
    [ORG],
  );
  const lineSums = await q<{ jid: string; code: string; v: number }>(
    `select l."journalEntryId" jid, a.code, round(sum(l.debit - l.credit)::numeric, 2)::float v
       from "JournalEntryLine" l join "JournalEntry" je on je.id = l."journalEntryId" join "ChartOfAccount" a on a.id = l."accountId"
      where je."organizationId" = $1 and je.status <> 'VOID' group by 1, 2`,
    [ORG],
  );
  const suppliers = await q<{ id: string; code: string; name: string; updatedAt: string }>(
    `select id::text, "supplierCode" code, name, "updatedAt"::text from "Supplier" where "organizationId" = $1 order by "supplierCode"`,
    [ORG],
  );
  const customers = await q(`select id::text, "customerCode" code, name from "Customer" where "organizationId" = $1`, [ORG]);
  const docs = await q(
    `select d.id::text, d.name, d.type, d.status::text, d."createdAt"::text, d.config->'erpImport'->>'source' src, d.config->>'supplierId' sid,
            coalesce(nullif(d.config->>'totalWithTax','')::numeric, nullif(d.config->>'totalAmount','')::numeric)::float gross,
            nullif(d.config->>'outstandingBalance','')::float outstanding
       from "Document" d where d."organizationId" = $1 order by d.name`,
    [ORG],
  );
  const orders = await q(`select count(*)::int n from "Order" where "organizationId" = $1`, [ORG]);
  const sinceCutover = await q(
    `select "actorType", "actorName", action, resource, count(*)::int n, min("createdAt")::text first, max("createdAt")::text last
       from "ActionLog" where "organizationId" = $1 and "createdAt" >= '2026-11-06' and action not in ('VIEW')
      group by 1, 2, 3, 4 order by n desc`,
    [ORG],
  );

  // ───────────────────────────── 3. clear-out ─────────────────────────────
  const isAbssJournal = (j: any) =>
    /^abss-(cutover|gl):/.test(String(j.createdBy || '')) || /^ABSS-(CUTOVER|YE|OPENING|SJ|PJ|CR|CD|GJ)-/.test(j.jn);
  const clearJ = journals.filter((j) => j.status !== 'VOID' && isAbssJournal(j));
  const keptJ = journals.filter((j) => j.status !== 'VOID' && !isAbssJournal(j));
  const priorImport = journals.filter((j) => j.createdBy === CREATED_BY);
  if (priorImport.length) flag('already-imported', 'STOP', CREATED_BY, `${priorImport.length} journals of this batch already exist`);
  const obBills = docs.filter((d) => d.type === 'BILL' && d.src === 'abss-opening');
  const obIds = obBills.map((d) => d.id);
  const refs = {
    billPayments: obIds.length ? (await q(`select count(*)::int n from "BillPayment" where "billId" = any($1)`, [obIds]))[0].n : 0,
    journals: obIds.length ? (await q(`select count(*)::int n from "JournalEntry" where "sourceDocumentId" = any($1)`, [obIds]))[0].n : 0,
    payments: obIds.length ? (await q(`select count(*)::int n from "Payment" where "documentId"::text = any($1)`, [obIds]))[0].n : 0,
    otherDocs: obIds.length
      ? (await q(`select count(*)::int n from "Document" d where d."organizationId" = $1 and not (d.id::text = any($2)) and d.config::text ~ $3`, [ORG, obIds, obIds.join('|')]))[0].n
      : 0,
    orders: obIds.length ? (await q(`select count(*)::int n from "Order" o where o."organizationId" = $1 and coalesce(o."linkedDocuments"::text,'') ~ $2`, [ORG, obIds.join('|')]))[0].n : 0,
    allocations: obIds.length
      ? (await q(`select count(*)::int n from "Document" d where d."organizationId" = $1 and d.type in ('PAYMENT_VOUCHER','OFFICIAL_RECEIPT','DEBIT_NOTE','CREDIT_NOTE') and d.config::text ~ $2`, [ORG, obIds.join('|')]))[0].n
      : 0,
  };
  for (const [k, v] of Object.entries(refs)) if (v) flag('clearout-reference', 'STOP', k, `${v} row(s) still point at the opening bills`);
  if (setting?.l1 || setting?.l2) flag('lock-date', 'WARN', 'AccountingSetting', `lock dates ${setting.l1} / ${setting.l2}: voiding a journal inside them is refused`);
  const otherDocs = docs.filter((d) => !obIds.includes(d.id));
  for (const d of otherDocs) flag('native-document', 'WARN', d.name || d.id, `${d.type} ${d.status} would survive the clear-out`);
  for (const j of keptJ) flag('native-journal', 'WARN', j.jn, `${j.type} ${j.dt} ${j.createdBy} would survive the clear-out`);
  const clearLines = lineSums.filter((l) => clearJ.some((j) => j.id === l.jid));
  csv(
    'clearout.csv',
    ['action', 'kind', 'number', 'date', 'type / supplier', 'lines', 'total debit', 'total credit / amount', 'created by / batch', 'id'],
    [
      ...clearJ.map((j) => ['VOID in place (status VOID, voidedAt, voidedBy; lines kept)', 'journal', j.jn, j.dt, j.type, j.lines, j.dr.toFixed(2), j.cr.toFixed(2), j.createdBy, j.id]),
      ...obBills.map((d) => {
        const s = suppliers.find((x) => x.id === d.sid);
        return ['SOFT-DELETE (type DELETED + config.softDeleted)', 'bill', d.name, d.createdAt.slice(0, 10), s ? `${s.code} ${s.name}` : d.sid, 1, '', Number(d.gross).toFixed(2), 'abss-opening', d.id];
      }),
    ],
  );

  // ───────────────────────────── 4. plan the import ─────────────────────────────
  type PJ = { src: string; jn: string; id: string; n: number; date: string; type: string; memo: string; reference: string; description: string; lines: any[]; dr: number; cr: number; entry: any; doc?: string | null };
  const planned: PJ[] = [];
  const reuse: any[] = [];
  for (const [src] of REPORTS) {
    const numbered = H.numberEntries(src, parsed[src].entries);
    for (const x of numbered) {
      const e = x.entry;
      if (x.mixedIds) flag('mixed-ids', 'WARN', x.journalNumber, `one entry carries several ID#s: ${x.mixedIds.join(', ')}`);
      if (x.n > 1) reuse.push({ jn: x.journalNumber, id: x.id, date: e.date, memo: e.memo });
      const type = H.journalType(src, e, ctl);
      const t = P.entryTotals(e);
      const lines = e.lines.map((l: any, k: number) => {
        const a = acct.get(l.code);
        if (!a) flag('account-missing', 'STOP', `${x.journalNumber}`, `account ${l.code} ${l.name} is not in YMM's chart`);
        else if (a.accountType === 'HEADER') flag('header-account', 'STOP', x.journalNumber, `posts to header account ${l.code}`);
        else if (!a.isActive) flag('inactive-account', 'WARN', x.journalNumber, `posts to inactive account ${l.code}`);
        if (a && a.name !== l.name) flag('account-name', 'INFO', `${l.code}`, `ABSS "${l.name}" vs AIMS "${a.name}"`);
        return { lineNumber: k + 1, code: l.code, accountId: a?.id ?? null, debit: l.debit, credit: l.credit, description: [l.memo || e.memo, l.job ? `Job ${l.job}` : ''].filter(Boolean).join(' · ') || null };
      });
      planned.push({ src, jn: x.journalNumber, id: x.id, n: x.n, date: e.date, type, memo: e.memo, reference: x.id, description: `ABSS ${src} ${x.id} · ${e.memo || ''}`.trim(), lines, dr: t.dr, cr: t.cr, entry: e });
    }
  }
  const dupNo = planned.length - new Set(planned.map((j) => j.jn)).size;
  if (dupNo) flag('journal-number', 'STOP', 'plan', `${dupNo} duplicate journal numbers`);
  const clash = planned.filter((j) => keptJ.some((k) => k.jn === j.jn));
  for (const j of clash) flag('journal-number', 'STOP', j.jn, 'already used by a journal that stays');

  // possible duplicates: same source, date, POS / supplier invoice number and amount under different ABSS IDs
  const dupKey = new Map<string, PJ[]>();
  for (const j of planned) {
    const pos = j.src === 'SJ' ? P.posNumber(j.memo) : j.src === 'PJ' ? (j.memo.match(/Invoice:?\s*([^)]+)\)/i)?.[1] || null) : null;
    if (!pos) continue;
    const k = `${j.src}|${pos.trim()}|${j.dr.toFixed(2)}`;
    dupKey.set(k, [...(dupKey.get(k) || []), j]);
  }
  const dupes = [...dupKey.entries()].filter(([, v]) => v.length > 1);
  for (const [k, v] of dupes) flag('possible-duplicate', 'WARN', v.map((j) => j.jn).join(' + '), `same ${k.split('|')[0]} number ${k.split('|')[1]} and amount ${k.split('|')[2]} under ${v.length} ABSS IDs (${v.map((j) => j.date).join(', ')})`);
  const posSeen = new Map<string, string[]>();
  for (const j of planned.filter((x) => x.src === 'SJ')) {
    const pos = P.posNumber(j.memo);
    if (pos) posSeen.set(pos, [...(posSeen.get(pos) || []), j.jn]);
  }
  const posReuse = [...posSeen.entries()].filter(([, v]) => v.length > 1);

  // opening: what the accounts list says minus everything the entries carry (expected 0 everywhere: ABSS starts 1 Dec 2024)
  const entrySigned = new Map<string, number>();
  for (const j of planned) for (const l of j.lines) entrySigned.set(l.code, R((entrySigned.get(l.code) || 0) + l.debit - l.credit));
  const opening: Array<{ code: string; name: string; v: number }> = [];
  chartFile.forEach((row: any, i: number) => {
    const header = i + 1 < chartFile.length && chartFile[i + 1].level > row.level;
    if (header || row.code === '3-9000') return;
    const target = R(P.naturalSign(row.code) * (list[i]?.balance ?? 0));
    const diff = R(target - (entrySigned.get(row.code) || 0));
    if (Math.abs(diff) > 0.004) opening.push({ code: row.code, name: row.name, v: diff });
  });
  const openingBalanced = Math.abs(R(opening.reduce((a, o) => a + o.v, 0))) < 0.005;

  // ── suppliers ──
  const supByKey = new Map(suppliers.map((s) => [H.nameKey(s.name), s]));
  const taken = new Set<string>(suppliers.map((s) => s.code).filter(Boolean));
  const supPlan = new Map<string, { name: string; key: string; existing: any; code: string; bills: number; sph: number; cd: number }>();
  const needSupplier = (name: string, why: 'bills' | 'sph' | 'cd') => {
    const key = H.nameKey(name);
    if (!key) return null;
    let p = supPlan.get(key);
    if (!p) {
      const ex = supByKey.get(key) || H.findByName(name, suppliers) || null;
      if (ex && H.nameKey(ex.name) !== key) flag('supplier-near-match', 'INFO', ex.code, `ABSS "${name}" matched to existing "${ex.name}" (card name cut short)`);
      p = { name, key, existing: ex, code: ex ? ex.code : H.nextCode('S', name, taken), bills: 0, sph: 0, cd: 0 };
      supPlan.set(key, p);
    }
    p[why]++;
    return p;
  };

  // ── bills (PJ) ──
  const bills: any[] = [];
  for (const j of planned.filter((x) => x.src === 'PJ')) {
    const cards = [...new Set(j.entry.lines.map((l: any) => l.card).filter(Boolean))] as string[];
    if (cards.length !== 1) flag('bill-supplier', 'WARN', j.jn, `supplier cards on the entry: ${cards.join(' | ') || 'none'}`);
    const sp = cards[0] ? needSupplier(cards[0], 'bills') : null;
    const ap = -P.netOn(j.entry, ctl.ap);
    const items = j.entry.lines.filter((l: any) => l.code !== ctl.ap).map((l: any) => ({ description: l.memo || j.memo, quantity: 1, unitPrice: R(l.debit - l.credit), amount: R(l.debit - l.credit), accountCode: l.code, accountName: acct.get(l.code)?.name ?? l.name }));
    if (ap < 0) flag('supplier-credit', 'INFO', j.jn, `supplier credit ${money(-ap)} (${cards[0] || '?'}), open in ABSS: a BILL with a negative total`);
    bills.push({ jn: j.jn, id: j.id, date: j.date, supplier: sp, supplierName: cards[0] || null, gross: R(ap), memo: j.memo, supplierInv: j.memo.match(/Invoice:?\s*([^)]+)\)/i)?.[1]?.trim() || null, items, paid: [], open: R(ap) });
  }
  // ── supplier payments: Supplier Payment History rows -> CD entries (cheque + date) -> PJ bills (PO #) ──
  const cdEntries = planned.filter((x) => x.src === 'CD');
  const cdByChq = new Map<string, PJ[]>();
  for (const j of cdEntries) cdByChq.set(j.id, [...(cdByChq.get(j.id) || []), j]);
  const billsByPo = new Map<string, any[]>();
  for (const b of bills) billsByPo.set(b.id, [...(billsByPo.get(b.id) || []), b]);
  const sphByCd = new Map<string, any[]>();
  // one supplier payment = the history rows of one cheque, date and supplier; ABSS reuses a cheque number for several
  // CD entries on the same day (one per payee), so the payee name and the AP amount pick the entry
  const groups = new Map<string, any[]>();
  for (const row of sph.rows) {
    needSupplier(row.supplier, 'sph');
    const k = `${row.cheque}|${row.chqDate}|${row.supplier}`;
    groups.set(k, [...(groups.get(k) || []), row]);
  }
  const apLeft = new Map(cdEntries.map((j) => [j.jn, P.netOn(j.entry, ctl.ap)]));
  const cdFor = new Map<any, PJ>();
  for (const rows of groups.values()) {
    const { cheque, chqDate, supplier } = rows[0];
    const total = R(rows.reduce((a: number, r: any) => a + r.applied, 0));
    const cands = cdByChq.get(cheque) || [];
    const fits = (x: PJ) => (apLeft.get(x.jn) || 0) >= total - 0.004;
    const cd =
      cands.find((x) => x.date === chqDate && H.sameName(x.memo, supplier) && fits(x)) ||
      cands.find((x) => x.date === chqDate && Math.abs((apLeft.get(x.jn) || 0) - total) < 0.005) ||
      cands.find((x) => x.date === chqDate && fits(x)) ||
      (cands.length === 1 ? cands[0] : null);
    if (!cd) {
      flag('payment-no-cd', 'WARN', `cheque ${cheque}`, `${supplier} ${chqDate} ${money(total)}: no Cash Disbursements entry with that ID and date`);
      continue;
    }
    if (cd.date !== chqDate) flag('payment-date', 'INFO', cd.jn, `payment history cheque date ${chqDate} vs CD entry ${cd.date}`);
    apLeft.set(cd.jn, R((apLeft.get(cd.jn) || 0) - total));
    for (const r of rows) cdFor.set(r, cd);
  }
  for (const row of sph.rows) {
    const cd = cdFor.get(row);
    if (!cd) continue;
    sphByCd.set(cd.jn, [...(sphByCd.get(cd.jn) || []), row]);
    const bl = billsByPo.get(row.po) || [];
    const bill = bl.find((b) => b.open >= row.applied - 0.004) || bl[0];
    if (!bill) {
      flag('payment-no-bill', 'WARN', `cheque ${row.cheque}`, `PO ${row.po} (${row.supplier}) is not in the Purchases journal`);
      continue;
    }
    if (H.nameKey(bill.supplierName) !== H.nameKey(row.supplier)) flag('payment-supplier', 'WARN', bill.jn, `bill supplier "${bill.supplierName}" vs payment history "${row.supplier}"`);
    if (row.purchaseTotal !== null && Math.abs(row.purchaseTotal - bill.gross) > 0.004 && bl.length === 1) flag('payment-total', 'INFO', bill.jn, `payment history purchase total ${money(row.purchaseTotal)} vs journal ${money(bill.gross)}`);
    bill.open = R(bill.open - row.applied);
    bill.paid.push({ date: row.chqDate, amount: row.applied, voucher: cd.jn });
    if (bill.open < -0.004) flag('bill-overpaid', 'WARN', bill.jn, `applied beyond the bill: open ${money(bill.open)}`);
  }
  for (const t of sph.paymentTotals) {
    const sum = R(sph.rows.filter((r: any) => r.cheque === t.cheque && r.supplier === t.supplier).reduce((a: number, r: any) => a + r.applied, 0));
    if (Math.abs(sum - t.total) > 0.004) flag('sph-total', 'WARN', `cheque ${t.cheque}`, `rows ${money(sum)} vs "Total for Payment" ${money(t.total)}`);
  }
  // CD entries vs the payment history: the AP debit of each CD entry should equal what the history applies
  const payments: any[] = [];
  for (const j of cdEntries) {
    const apDr = P.netOn(j.entry, ctl.ap);
    const rows = sphByCd.get(j.jn) || [];
    const applied = R(rows.reduce((a: number, r: any) => a + r.applied, 0));
    if (Math.abs(apDr - applied) > 0.004) flag('cd-vs-history', 'WARN', j.jn, `AP debit ${money(apDr)} vs payment history ${money(applied)} (${j.memo})`);
    const cashOnly = j.entry.lines.every((l: any) => /^1-21/.test(l.code));
    const sup = rows[0]?.supplier
      ? supPlan.get(H.nameKey(rows[0].supplier))
      : [...supPlan.values()].find((p) => H.sameName(p.name, j.memo)) || (H.findByName(j.memo, suppliers) ? needSupplier(j.memo, 'cd') : null);
    const bank = j.entry.lines.filter((l: any) => /^1-21/.test(l.code) && l.credit > 0).map((l: any) => l.code);
    payments.push({ jn: j.jn, date: j.date, memo: j.memo, amount: j.cr, ap: apDr, applied, doc: cashOnly ? null : 'PAYMENT_VOUCHER', why: cashOnly ? 'bank / cash transfer: journal only' : '', supplier: sup ? sup.name : null, supplierCode: sup ? sup.code : null, bank: [...new Set(bank)].join(' '), bills: rows.map((r: any) => r.po).join(' ') });
  }
  const apOpen = R(bills.reduce((a, b) => a + b.open, 0));

  // ── sales (SJ) and receipts (CR) ──
  const sales = planned.filter((x) => x.src === 'SJ');
  const invoices = sales.filter((j) => j.type === 'INVOICE').map((j, k) => ({ key: j.jn, jn: j.jn, id: j.id, date: j.date, order: k, gross: P.netOn(j.entry, ctl.ar), memo: j.memo, pos: P.posNumber(j.memo), shape: [...new Set(j.entry.lines.filter((l: any) => l.code !== ctl.ar).map((l: any) => l.code))].sort().join('+'), entry: j.entry })) as any[];
  const creditNotes = sales.filter((j) => j.type === 'CREDIT_NOTE').map((j) => ({ jn: j.jn, date: j.date, amount: -P.netOn(j.entry, ctl.ar), memo: j.memo }));
  const adjustments = sales.filter((j) => j.type === 'ADJUSTMENT');
  const crEntries = planned.filter((x) => x.src === 'CR');
  const receiptPays: any[] = [];
  const receipts: any[] = [];
  for (const j of crEntries) {
    const channel = P.receiptChannel(j.memo);
    const arLines = j.entry.lines.filter((l: any) => l.code === ctl.ar);
    const arNet = -P.netOn(j.entry, ctl.ar);
    if (!arLines.length) {
      receipts.push({ jn: j.jn, date: j.date, memo: j.memo, channel, amount: j.dr, ar: 0, doc: null, why: 'no Trade Debtors line: journal only' });
      continue;
    }
    if (!channel) flag('receipt-channel', 'WARN', j.jn, `channel not recognised from "${j.memo}"`);
    for (const l of arLines) {
      const amt = R(l.credit - l.debit);
      if (amt < 0) flag('receipt-negative-line', 'WARN', j.jn, `Trade Debtors debit ${money(-amt)} inside a receipt`);
      receiptPays.push({ ref: j.jn, date: j.date, amount: amt, channel });
    }
    receipts.push({ jn: j.jn, date: j.date, memo: j.memo, channel, amount: j.dr, ar: R(arNet), doc: 'OFFICIAL_RECEIPT', why: '' });
  }
  // credits reduce the oldest open sale on or before their date, then receipts in date order
  const credits = creditNotes.map((cn) => ({ ref: cn.jn, date: cn.date, amount: cn.amount, channel: 'credit' }));
  const allPays = [...credits, ...receiptPays].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const alloc = H.allocate(invoices, allPays);
  for (const u of alloc.unplaced) flag('receipt-unplaced', 'WARN', u.ref, `${money(u.amount)} has no open sale on or before ${u.date}`);
  const arOpen = R(invoices.reduce((a, it) => a + it.open, 0) - alloc.unplaced.reduce((a: number, u: any) => a + u.amount, 0));
  const channelOf = (it: any) => {
    const ch = [...new Set(it.paid.filter((p: any) => p.channel && p.channel !== 'credit').map((p: any) => p.channel))];
    return ch.length === 1 ? ch[0] : ch.length > 1 ? 'mixed' : null;
  };
  const channelCount: Record<string, { n: number; gross: number; open: number }> = {};
  for (const it of invoices) {
    const ch = (channelOf(it) as string) || 'unknown (still open)';
    channelCount[ch] = channelCount[ch] || { n: 0, gross: 0, open: 0 };
    channelCount[ch].n++;
    channelCount[ch].gross = R(channelCount[ch].gross + it.gross);
    channelCount[ch].open = R(channelCount[ch].open + it.open);
  }
  const receiptChannels: Record<string, { n: number; amount: number }> = {};
  for (const r of receipts) {
    const ch = r.channel || (r.doc ? 'unrecognised' : 'non-AR');
    receiptChannels[ch] = receiptChannels[ch] || { n: 0, amount: 0 };
    receiptChannels[ch].n++;
    receiptChannels[ch].amount = R(receiptChannels[ch].amount + r.amount);
  }
  const custTaken = new Set<string>(customers.map((x: any) => x.code).filter(Boolean));
  const customerPlan =
    CUSTOMERS === 'single'
      ? [{ name: SINGLE_CUSTOMER, code: H.nextCode('C', SINGLE_CUSTOMER, custTaken), invoices: invoices.length, receipts: receipts.filter((r) => r.doc).length }]
      : [...Object.keys(channelCount)].map((ch) => ({ name: ch.startsWith('unknown') ? SINGLE_CUSTOMER : `${ch} (BHOP)`, code: H.nextCode('C', ch.startsWith('unknown') ? SINGLE_CUSTOMER : ch, custTaken), invoices: channelCount[ch].n, receipts: receipts.filter((r) => (r.channel || 'unknown') === ch).length }));

  // planned document configs (samples only; the dry run never builds 9k configs it would not write)
  const sampleInvoice = invoices.find((it) => it.open > 0 && it.entry.lines.length > 2) || invoices[0];
  const invoiceConfig = (it: any) =>
    stampDocumentMoney(
      {
        date: it.date,
        dueDate: it.date,
        currency: 'SGD',
        customerId: '<customer id>',
        customerName: customerPlan[0].name,
        customerCode: customerPlan[0].code,
        documentNumber: it.jn,
        referenceNo: it.pos || it.id,
        subject: it.memo,
        items: it.entry.lines
          .filter((l: any) => l.code !== ctl.ar)
          .map((l: any, k: number) => ({ id: k + 1, description: acct.get(l.code)?.name ?? l.name, quantity: 1, unitPrice: R(l.credit - l.debit), amount: R(l.credit - l.debit), accountCode: l.code, tax: '0' })),
        subTotal: it.gross,
        gstAmount: 0,
        gstPercent: 0,
        taxApplicable: 'N',
        nettTotal: it.gross,
        status: it.open <= 0.004 ? 'paid' : it.open < it.gross ? 'partially_paid' : 'pending_payment',
        inboundChannel: 'IMPORT',
        recordLocked: true,
        recordLockedBy: { name: 'ABSS import' },
        journalEntryId: '<ABSS-SJ journal id>',
        erpImport: { source: 'abss-ledger', batch: BATCH, erpId: `abss-sale:${it.jn.replace(/^ABSS-SJ-/, '')}`, originalNumber: it.id, posNumber: it.pos, channel: channelOf(it), status: it.open <= 0.004 ? 'Closed' : 'Open', paidBy: it.paid.map((p: any) => ({ date: p.date, amount: p.amount, receipt: p.ref, rule: p.rule })), balanceAtImport: it.open },
      },
      { gross: it.gross, outstanding: it.open, paid: R(it.gross - it.open) },
    );

  // ───────────────────────────── 5. trial balance after the plan ─────────────────────────────
  const tbRun = () => {
    const signed = new Map<string, number>();
    const add = (code: string, v: number) => signed.set(code, R((signed.get(code) || 0) + v));
    const keptIds = new Set(keptJ.map((j) => j.id));
    for (const l of lineSums) if (keptIds.has(l.jid)) add(l.code, l.v);
    for (const j of planned) for (const l of j.lines) add(l.code, l.debit - l.credit);
    for (const o of opening) add(o.code, o.v);
    const rows = H.compareTrialBalance(chartFile, list, signed);
    const extra = [...signed.entries()].filter(([code, v]) => !chartFile.some((r: any) => r.code === code) && Math.abs(v) > 0.004);
    return { rows, extra, signed };
  };
  const tb1 = tbRun();
  const tb2 = tbRun();
  const tbHash = (t: any) => crypto.createHash('sha256').update(JSON.stringify(t.rows)).digest('hex').slice(0, 16);
  const reason = (r: any) => {
    if (r.diff === null || Math.abs(r.diff) < 0.005) return '';
    if (!r.nameOk) return 'chart row does not line up with the Accounts List row';
    if (r.code === '3-9000') return 'computed by ABSS (all P&L): follows the P&L accounts';
    if (r.header) return 'header: sum of the accounts under it';
    return keptJ.length ? 'AIMS-native entry after the ABSS cutover' : 'not explained by the ABSS entries';
  };
  csv(
    'tb.csv',
    ['code', 'name', 'level', 'header', 'ABSS 25 Nov', 'AIMS after plan', 'difference', 'reason'],
    [...tb1.rows.map((r: any) => [r.code, r.name, r.level, r.header ? 'H' : '', r.abss?.toFixed(2), r.aims.toFixed(2), r.diff?.toFixed(2), reason(r)]), ...tb1.extra.map(([code, v]) => [code, acct.get(code)?.name, '', '', '', v.toFixed(2), '', 'AIMS account not in the ABSS list'])],
  );
  const postingRows = tb1.rows.filter((r: any) => !r.header && r.code !== '3-9000');
  const mism = tb1.rows.filter((r: any) => r.diff !== null && Math.abs(r.diff) >= 0.005);
  const glTotal = [...tb1.signed.values()].reduce((a, v) => a + v, 0);

  // year-end closes ABSS never ran (information: Retained Earnings is 0 in ABSS, all P&L since Dec 2024 is "current year")
  const pnlBy = (year: string) =>
    R(planned.filter((j) => j.date.startsWith(year)).reduce((a, j) => a + j.lines.filter((l: any) => /^[4-9]/.test(l.code)).reduce((s: number, l: any) => s + l.credit - l.debit, 0), 0));
  const pnlYears = { '2024': pnlBy('2024'), '2025': pnlBy('2025'), '2026': pnlBy('2026') };

  // ───────────────────────────── outputs ─────────────────────────────
  const byType: Record<string, number> = {};
  for (const j of planned) byType[`${j.src} ${j.type}`] = (byType[`${j.src} ${j.type}`] || 0) + 1;
  const typeTotals: Record<string, number> = {};
  for (const j of planned) typeTotals[j.type] = (typeTotals[j.type] || 0) + 1;
  csv(
    'journals.csv',
    ['journal number', 'date', 'type', 'reference', 'description', 'lines', 'total debit', 'document'],
    planned.map((j) => [j.jn, j.date, j.type, j.reference, j.description, j.lines.length, j.dr.toFixed(2), j.type === 'INVOICE' ? 'INVOICE' : j.type === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : j.type === 'BILL' ? 'BILL' : j.src === 'CR' ? (receipts.find((r) => r.jn === j.jn)?.doc ?? '') : j.src === 'CD' ? (payments.find((p) => p.jn === j.jn)?.doc ?? '') : '']),
  );
  csv(
    'invoices.csv',
    ['document', 'date', 'ABSS ID#', 'POS number', 'memo', 'accounts', 'gross', 'paid', 'open', 'status', 'channel (from receipts)', 'paid by'],
    invoices.map((it) => [it.jn, it.date, it.id, it.pos, it.memo, it.shape, it.gross.toFixed(2), R(it.gross - it.open).toFixed(2), it.open.toFixed(2), it.open <= 0.004 ? 'paid' : it.open < it.gross ? 'partially_paid' : 'pending_payment', channelOf(it) || '', it.paid.map((p: any) => `${p.ref} ${p.amount.toFixed(2)} ${p.rule}`).join('; ')]),
  );
  csv(
    'bills.csv',
    ['document', 'date', 'supplier', 'supplier code', 'supplier action', 'supplier invoice', 'gross', 'paid', 'open', 'billStatus', 'paid by'],
    bills.map((b) => [b.jn, b.date, b.supplierName, b.supplier?.code, b.supplier ? (b.supplier.existing ? 'match' : 'create') : '', b.supplierInv, b.gross.toFixed(2), R(b.gross - b.open).toFixed(2), b.open.toFixed(2), Math.abs(b.open) <= 0.004 ? 'PAID' : 'POSTED', b.paid.map((p: any) => `${p.voucher} ${p.amount.toFixed(2)}`).join('; ')]),
  );
  csv('receipts.csv', ['document', 'date', 'memo', 'channel', 'amount', 'Trade Debtors', 'planned document', 'note'], receipts.map((r) => [r.jn, r.date, r.memo, r.channel, r.amount.toFixed(2), r.ar.toFixed(2), r.doc, r.why]));
  csv('payments.csv', ['document', 'date', 'memo', 'supplier', 'supplier code', 'amount', 'AP debit', 'payment history applied', 'bank / cash', 'bills (PO #)', 'planned document', 'note'], payments.map((p) => [p.jn, p.date, p.memo, p.supplier, p.supplierCode, p.amount.toFixed(2), p.ap.toFixed(2), p.applied.toFixed(2), p.bank, p.bills, p.doc, p.why]));
  const supRows = [...supPlan.values()].sort((a, b) => a.name.localeCompare(b.name));
  const unusedExisting = suppliers.filter((s) => !supRows.some((p) => p.existing?.id === s.id));
  csv(
    'suppliers.csv',
    ['ABSS name', 'action', 'code', 'existing AIMS name', 'bills', 'payment history rows', 'cash payments'],
    [...supRows.map((p) => [p.name, p.existing ? 'match' : 'create', p.code, p.existing?.name, p.bills, p.sph, p.cd]), ...unusedExisting.map((s) => ['', 'keep (no ABSS entry)', s.code, s.name, 0, 0, 0])],
  );
  csv('flags.csv', ['severity', 'kind', 'ref', 'detail'], flags.map((f) => [f.severity, f.kind, f.ref, f.detail]));

  const after = await snapshot();
  await c.end();
  const unchanged = JSON.stringify(before) === JSON.stringify(after);

  const plan = {
    at: new Date().toISOString(),
    env: ENV,
    org: { id: ORG, name: org.name },
    batch: BATCH,
    createdBy: CREATED_BY,
    files,
    now: {
      chart: { accounts: chart.length, abssCoded: chart.filter((a) => /^\d-\d{4}$/.test(a.code)).length, inactiveDefaults: chart.filter((a) => !a.isActive).length },
      controls: setting?.c,
      lockDates: [setting?.l1, setting?.l2],
      journals: journals.map((j) => ({ jn: j.jn, date: j.dt, type: j.type, status: j.status, createdBy: j.createdBy, lines: j.lines, dr: j.dr })),
      suppliers: suppliers.length,
      customers: customers.length,
      documents: Object.entries(docs.reduce((m: any, d) => ((m[`${d.type} ${d.status} ${d.src ?? 'native'}`] = (m[`${d.type} ${d.status} ${d.src ?? 'native'}`] || 0) + 1), m), {})),
      orders: orders[0].n,
      activitySinceCutover: sinceCutover,
    },
    clearOut: {
      journals: clearJ.map((j) => ({ id: j.id, jn: j.jn, date: j.dt, type: j.type, lines: j.lines, dr: j.dr, cr: j.cr, createdBy: j.createdBy })),
      journalLinesByAccount: clearLines.length,
      bills: obBills.map((d) => ({ id: d.id, name: d.name, supplier: suppliers.find((s) => s.id === d.sid)?.name, amount: d.gross })),
      billsTotal: R(obBills.reduce((a, d) => a + Number(d.gross), 0)),
      references: refs,
      survivors: { journals: keptJ.length, documents: otherDocs.length },
    },
    opening: { date: '2024-11-30', journalNumber: 'ABSS-OPENING-2024-12-01', lines: opening, balanced: openingBalanced, needed: opening.length > 0 },
    counts: {
      journals: planned.length,
      journalsByType: typeTotals,
      journalsBySource: byType,
      reusedIds: reuse.length,
      customers: customerPlan,
      suppliers: { matched: supRows.filter((p) => p.existing).length, create: supRows.filter((p) => !p.existing).length, existingUnused: unusedExisting.length },
      invoices: invoices.length,
      invoiceStatus: {
        paid: invoices.filter((i) => i.open <= 0.004).length,
        partially_paid: invoices.filter((i) => i.open > 0.004 && i.open < i.gross).length,
        pending_payment: invoices.filter((i) => Math.abs(i.open - i.gross) < 0.005).length,
      },
      creditNotes: creditNotes.length,
      creditTotal: R(creditNotes.reduce((a, x) => a + x.amount, 0)),
      arAdjustments: adjustments.length,
      bills: bills.length,
      supplierCredits: bills.filter((b) => b.gross < 0).length,
      billStatus: { PAID: bills.filter((b) => Math.abs(b.open) <= 0.004).length, POSTED: bills.filter((b) => Math.abs(b.open) > 0.004).length },
      officialReceipts: receipts.filter((r) => r.doc).length,
      receiptsJournalOnly: receipts.filter((r) => !r.doc).length,
      paymentVouchers: payments.filter((p) => p.doc).length,
      paymentsJournalOnly: payments.filter((p) => !p.doc).length,
      supplierPaymentRows: sph.rows.length,
    },
    channels: { invoicesByChannel: channelCount, receiptsByChannel: receiptChannels, allocationRules: alloc.rules, unplaced: alloc.unplaced },
    ties: {
      arGl: R(tb1.signed.get(ctl.ar) || 0),
      arOpenDocs: arOpen,
      apGl: R(-(tb1.signed.get(ctl.ap) || 0)),
      apOpenDocs: apOpen,
    },
    trialBalance: { rows: tb1.rows.length, posting: postingRows.length, matched: tb1.rows.length - mism.length, mismatches: mism, extra: tb1.extra, glNet: R(glTotal), hash1: tbHash(tb1), hash2: tbHash(tb2), identical: tbHash(tb1) === tbHash(tb2) },
    pnlByYear: pnlYears,
    samples: { invoice: invoiceConfig(sampleInvoice) },
    duplicates: { possible: dupes.map(([k, v]) => ({ key: k, journals: v.map((j) => j.jn) })), posNumberReuse: posReuse.length, reusedIds: reuse },
    flags: flags.reduce((m: any, f) => ((m[`${f.severity} ${f.kind}`] = (m[`${f.severity} ${f.kind}`] || 0) + 1), m), {}),
    readOnly: { before, after, unchanged },
  };
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(plan, null, 1));

  // ── summary ──
  const s: string[] = [];
  const say = (x = '') => s.push(x);
  say(`YMM ABSS history import: DRY RUN (${ENV}, read-only, ${plan.at})`);
  say(`Org ${org.name} (${ORG}); batch ${CREATED_BY}`);
  say('');
  say('Reports parsed:');
  for (const [src] of REPORTS) {
    const f = files[src];
    say(`  ${src} ${f.file}: ${f.entries} entries (${f.headers} headers), ${f.lines} lines, Dr ${money(f.dr)} = Grand Total ${money(f.grandTotal?.debit ?? NaN)}; ${f.encoding}, ${f.range?.from}..${f.range?.to}`);
  }
  say(`  Supplier Payment History: ${sph.rows.length} rows, ${sph.paymentTotals.length} payments; Accounts List: ${list.length} rows`);
  say('');
  say('YMM now:');
  say(`  chart ${chart.length} accounts (${plan.now.chart.abssCoded} ABSS-coded, ${plan.now.chart.inactiveDefaults} inactive app defaults); controls AR ${ctl.ar}, AP ${ctl.ap}; lock dates ${setting?.l1 ?? 'none'} / ${setting?.l2 ?? 'none'}`);
  for (const j of journals) say(`  journal ${j.jn} ${j.dt} ${j.type} ${j.status} ${j.createdBy} ${j.lines} lines Dr ${money(j.dr)}`);
  say(`  suppliers ${suppliers.length}, customers ${customers.length}, orders ${orders[0].n}; documents: ${plan.now.documents.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  say(`  activity log since 6 Nov (non-view): ${sinceCutover.map((r: any) => `${r.actorName || r.actorType} ${r.action} ${r.resource} x${r.n}`).join('; ') || 'none'}`);
  say('');
  say('Clear-out (owner decision):');
  for (const j of clearJ) say(`  VOID journal ${j.jn} (${j.type}, ${j.dt}, ${j.lines} lines, Dr ${money(j.dr)} / Cr ${money(j.cr)})`);
  say(`  SOFT-DELETE ${obBills.length} opening bills, total ${money(plan.clearOut.billsTotal)} (list in clearout.csv)`);
  say(`  references to the opening bills: ${Object.entries(refs).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  say(`  survives the clear-out: ${keptJ.length} journals, ${otherDocs.length} documents`);
  say('');
  say(`Opening at 1 Dec 2024 (Accounts List 25 Nov minus every ABSS entry, per account): ${opening.length ? `${opening.length} non-zero lines` : 'ZERO on every account: ABSS YMM starts on 1 Dec 2024, no opening journal needed'}`);
  for (const o of opening) say(`  ${o.code} ${o.name} ${money(o.v)}`);
  say('');
  say('Planned import:');
  say(`  journals ${planned.length}: ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  say(`  ABSS IDs used by more than one entry (numbered -2 / -3): ${reuse.length}`);
  say(`  customers (${CUSTOMERS}): ${customerPlan.map((x) => `${x.code} ${x.name} (${x.invoices} invoices)`).join('; ')}`);
  say(`  suppliers: ${plan.counts.suppliers.matched} matched, ${plan.counts.suppliers.create} to create, ${unusedExisting.length} existing with no ABSS entry (kept)`);
  say(`  invoices ${invoices.length} (paid ${plan.counts.invoiceStatus.paid}, part-paid ${plan.counts.invoiceStatus.partially_paid}, open ${plan.counts.invoiceStatus.pending_payment}); credit notes ${creditNotes.length} (${money(plan.counts.creditTotal)}); AR adjustments (journal only) ${adjustments.length}`);
  say(`  bills ${bills.length} incl. ${plan.counts.supplierCredits} supplier credits (PAID ${plan.counts.billStatus.PAID}, open ${plan.counts.billStatus.POSTED}); official receipts ${plan.counts.officialReceipts} (+${plan.counts.receiptsJournalOnly} journal only); payment vouchers ${plan.counts.paymentVouchers} (+${plan.counts.paymentsJournalOnly} transfers journal only)`);
  say(`  receipt allocation (inferred, ABSS receipts carry no invoice numbers): ${JSON.stringify(alloc.rules)}, unplaced ${alloc.unplaced.length}`);
  say(`  sales by channel (from the receipts that paid them): ${Object.entries(channelCount).map(([k, v]) => `${k} ${v.n} (${money(v.gross)})`).join('; ')}`);
  say(`  receipts by channel: ${Object.entries(receiptChannels).map(([k, v]) => `${k} ${v.n} (${money(v.amount)})`).join('; ')}`);
  say('');
  say('Subledger ties after the plan:');
  say(`  AR ${ctl.ar}: GL ${money(plan.ties.arGl)} vs open invoices ${money(arOpen)} (${Math.abs(plan.ties.arGl - arOpen) < 0.005 ? 'TIES' : 'DIFF ' + money(plan.ties.arGl - arOpen)})`);
  say(`  AP ${ctl.ap}: GL ${money(plan.ties.apGl)} vs open bills ${money(apOpen)} (${Math.abs(plan.ties.apGl - apOpen) < 0.005 ? 'TIES' : 'DIFF ' + money(plan.ties.apGl - apOpen)})`);
  say('');
  say(`Trial balance as at ${AS_AT} vs ABSS Accounts List Summary: ${plan.trialBalance.matched} of ${tb1.rows.length} rows match to the cent (${postingRows.length} posting accounts); GL net ${money(glTotal)}`);
  for (const r of mism) say(`  MISMATCH ${r.code} ${r.name}: ABSS ${money(r.abss)} vs AIMS ${money(r.aims)} (diff ${money(r.diff)}) ${reason(r)}`);
  for (const [code, v] of tb1.extra) say(`  EXTRA ${code} ${acct.get(code)?.name}: ${money(v)} not in the ABSS list`);
  say(`  second computation identical: ${plan.trialBalance.identical} (${plan.trialBalance.hash1})`);
  say(`  P&L by calendar year (ABSS never closed a year, Retained Earnings 0): 2024 ${money(pnlYears['2024'])}, 2025 ${money(pnlYears['2025'])}, 2026 ${money(pnlYears['2026'])}`);
  say('');
  say(`Flags: ${Object.entries(plan.flags).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} (flags.csv)`);
  say(`Possible duplicates (same POS / supplier invoice number and amount under two ABSS IDs): ${dupes.length}; POS numbers on more than one sale entry: ${posReuse.length}`);
  say('');
  say(`Read-only check: org counts and max(updatedAt) before vs after this run ${unchanged ? 'IDENTICAL' : 'CHANGED'}: ${JSON.stringify(after)}`);
  fs.writeFileSync(path.join(OUT, 'summary.txt'), s.join('\n') + '\n');
  console.log(s.join('\n'));
  console.log(`\n-> ${OUT}`);
  if (flags.some((f) => f.severity === 'STOP')) process.exitCode = 3;
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
