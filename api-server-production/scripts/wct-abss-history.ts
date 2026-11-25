/**
 * WCT group: ABSS full-history import for WCT Racking and YMM Kitchen (owner 2026-11-25 / 26). ONE script for both
 * orgs (--org racking | ymm); every other org is refused. DRY RUN by default; --apply writes; --rollback undoes an apply.
 *
 * Owner decisions (binding, 25-26 Nov):
 *   - The 6 Nov import is replaced and HARD-DELETED (backup json written and re-read first), as WCT (S) on 23 Nov:
 *       YMM      the ABSS-CUTOVER-2026-11-06 journal (+ lines) and the 25 OB-* opening bills;
 *       Racking  ABSS-CUTOVER-2026-11-06, ABSS-YE-2022..2025 and the tracker journals (erp-gl:wctr-gl-2026-11-06) from
 *                1 Aug 2022 on; ERP-INV-INV22-001 (27 Jul 2022) stays; the Espirit INV26-062 / INV26-063 tracker
 *                invoices + journals stay (post-ABSS AIMS entries, listed apart in the trial balance check).
 *   - YMM: AR mirrors ABSS; one customer "BHOP Outlet Sales" (app code rule); one invoice document per ABSS sale; the
 *     receipt channel (Cash / GrabCar / NETS / PayNow / Transfer / mixed) on each receipt; NO year-end journals.
 *   - Duplicates are imported as ABSS has them and listed for finance in <out>/possible-duplicates.csv.
 *   - Racking: the ABSS card "BreakTalk" is customer CB004 (BreadTalk). YMM: negative open bills (supplier credits) OK.
 *
 * Conventions (WCT (S), batch abss-gl:wct-abss-2026-11-23, read back from prod rows):
 *   journals   ABSS-<SRC>-<ID#>, -2 / -3 for repeats in date order; reference = ID#; description "ABSS <SRC> <ID#> · <memo>";
 *              postedBy abss-gl; createdBy abss-gl:<org>-abss-<batch day>; SJ INVOICE / CREDIT_NOTE / ADJUSTMENT,
 *              PJ BILL, CR / CD PAYMENT, GJ MANUAL; Racking also ABSS-OPENING-<day> and ABSS-YE-<year>.
 *   documents  sale journals tie to the existing invoice (Racking, money restamped from ABSS) or to a new invoice
 *              ABSS-SJ-<no> (YMM, and Racking sales the tracker never had); PJ -> BILL ABSS-PJ-<no> (paidBy);
 *              CR -> OFFICIAL_RECEIPT ABSS-CR-<no> (allocations); CD -> PAYMENT_VOUCHER ABSS-CD-<no> (allocations);
 *              config.erpImport.source 'abss-ledger', recordLocked "ABSS import", money via stampDocumentMoney,
 *              config.referenceNo canonical. A repeat (-2) part gets its own document (journal guard: one active
 *              INVOICE / BILL journal per document). Credit notes, AR adjustments, GJ, transfers: journal only.
 *   counters   document-number counters and the JV sequence are never touched.
 *
 * Gates (--apply refuses unless ALL hold): org racking|ymm; the trial balance after the import equals the ABSS
 * Accounts List to the cent on every account (Racking 113/113 leaf accounts, YMM 132/132 rows); the org's
 * fingerprint (row counts + row hash) equals the dry run's plan.json (no drift); the AR / AP control accounts tie
 * to the open documents; no STOP flag; --env host check; --confirm-prod on prod.
 *
 * Write step (--apply): a session advisory lock on a DIRECT (non-pooler) connection, held only for the apply and
 * released explicitly; ONE transaction: fingerprint re-checked, rows to delete locked, backup json written +
 * re-read + verified, hard delete (journals before their documents; the guard triggers stay on), multi-row inserts,
 * Activity Log SYSTEM rows, the trial balance / AR / AP / guard checks re-run on the database, apply log json with
 * every inserted id, COMMIT. Anything off -> ROLLBACK (nothing written).
 * --rollback <apply log> [--apply]: deletes every row the batch inserted (log ids + batch marker), restores the
 * updated rows and re-inserts the backup rows exactly, proves the org fingerprint equals the pre-apply one. Dry run
 * by default.
 *
 *   cd api-server-production
 *   DATABASE_URL=… TZ=UTC NODE_PATH=$PWD/node_modules npx ts-node --transpile-only scripts/wct-abss-history.ts \
 *     --org ymm|racking --env prod|dev|rehearsal [--apply [--confirm-prod]] [--rollback <apply log> [--apply]]
 *     [--dir <reports>] [--out <dir>] [--chart <file>] [--batch-day yyyy-mm-dd]
 * The apply needs the dry run's <out>/plan.json (same fingerprint, same plan hash): run the dry run right before it.
 * Rehearsal (localhost only): scripts/wct-abss-history-rehearsal.ts copies the org into a local database;
 * --rehearsal-ignore-tb (refused unless --env rehearsal) skips only the trial-balance / STOP gates there, so the write
 * path of an org whose books are not ready yet (Racking) can still be exercised and rolled back.
 * Racking kept post-ABSS items (Espirit INV26-062 / INV26-063): the gate compares ABSS with the ledger WITHOUT them
 * (must be 113/113) and requires every remaining difference to be exactly theirs (1-3100, 4-1000, 3-9000 +22,040).
 * Never prints the database URL.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { Client, types } from 'pg';
import { grossOf, outstandingOf, stampDocumentMoney } from '../src/common/document-money';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const A = require('./lib/abss-reports');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const H = require('./lib/abss-history-plan');

types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(20, (v) => Number(v));

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const HOME = os.homedir();
const SCRIPT = 'system:wct-abss-history';
const RUN_DAY = '2026-11-26';

type OrgCfg = {
  key: string; id: string; suffix: string; label: string; chart: string;
  fyStart: string | null; yearEnds: boolean; opening: 'ledgers' | 'none';
  tbGate: { mode: 'leaves' | 'all'; expect: number };
  customers: 'cards' | 'single'; singleCustomer?: string; cardOverrides?: Record<string, string>;
  keepPostAbss?: string[]; keepBefore?: boolean; invoicePrefix?: string;
  asAtCut: boolean; // trial balance counts only entries dated up to the Accounts List date
};
const ORGS: Record<string, OrgCfg> = {
  racking: {
    key: 'racking', id: '5c700000-0000-4000-8000-5c7000000002', suffix: 'WCTR', label: 'WCT Racking',
    chart: path.join(HOME, 'Desktop/aims/_imports/wct/abss/wctr-coa-2026-11-06.txt'),
    fyStart: '2024-01-01', yearEnds: true, opening: 'ledgers', tbGate: { mode: 'leaves', expect: 113 },
    customers: 'cards', cardOverrides: { breaktalk: 'CB004' }, keepPostAbss: ['INV26-062', 'INV26-063'], keepBefore: true, invoicePrefix: 'INV', asAtCut: true,
  },
  ymm: {
    key: 'ymm', id: '5c700000-0000-4000-8000-5c7000000003', suffix: 'YMM', label: 'YMM Kitchen',
    chart: path.join(HOME, 'Desktop/aims/_imports/wct/abss/ymm-abss-coa-2026-11-06.txt'),
    fyStart: null, yearEnds: false, opening: 'none', tbGate: { mode: 'all', expect: 132 },
    customers: 'single', singleCustomer: 'BHOP Outlet Sales', asAtCut: false,
  },
};
const ORG_KEY = one('--org', '')!;
const ENV = one('--env', '')!;
const APPLY = argv.includes('--apply');
const ROLLBACK = one('--rollback');
const CONFIRM_PROD = argv.includes('--confirm-prod');
// REHEARSAL ONLY (localhost, refused elsewhere): exercise the write path of an org whose trial balance is not ready
// yet. Skips only the trial-balance / STOP-flag gates; the fingerprint, AR / AP, guard, orphan and balance checks stay.
const REHEARSAL_IGNORE_TB = argv.includes('--rehearsal-ignore-tb');
const ORG = ORGS[ORG_KEY];
const DIR = one('--dir', path.join(HOME, 'Desktop/aims-agents/imports/abss-racking-ymm'))!;
const OUT = one('--out', path.join(HOME, `Desktop/aims-agents/logs/wct/abss-history-${RUN_DAY}/${ORG_KEY || 'x'}`))!;
const BATCH_DAY = one('--batch-day', RUN_DAY)!;
const CHART = one('--chart', ORG?.chart)!;
const BATCH = `${ORG_KEY}-abss-${BATCH_DAY}`;
const MARK = `abss-gl:${BATCH}`;
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => R(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
/** Deterministic uuid (v4 layout) per batch + key: the dry run shows the ids the apply inserts; reruns are stable. */
const uid = (key: string) => {
  const h = crypto.createHash('sha1').update(`${MARK}|${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const esc = (v: any) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (name: string, rows: any[], keys?: string[]) => {
  const k = keys || (rows.length ? Object.keys(rows[0]) : ['empty']);
  fs.writeFileSync(path.join(OUT, name), [k.join(','), ...rows.map((r) => k.map((x) => esc(r[x])).join(','))].join('\n') + '\n');
};

type JLine = { code: string; dr: number; cr: number; desc?: string | null };
type PlanJe = { id: string; jn: string; date: string; type: string; reference: string | null; description: string; sourceDocumentId: string | null; lines: JLine[]; src: string; createdBy?: string };
type Flag = { kind: string; severity: 'INFO' | 'WARN' | 'STOP'; ref: string; detail: string };

// ─────────────────────────────────────────────────────────── connection + env guard
/** The database the run talks to: --env must match the host (prod ep-icy-moon, dev ep-steep-truth, rehearsal localhost). */
function connectionUrl(): { url: string; direct: string; host: string } {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const u = new URL(url);
  const host = u.hostname;
  const neon = /neon\.tech|ep-[a-z]+-[a-z]+/.test(host);
  if (ENV === 'prod' && !host.includes('ep-icy-moon')) throw new Error('--env prod but DATABASE_URL is not the prod endpoint');
  if (ENV === 'dev' && !host.includes('ep-steep-truth')) throw new Error('--env dev but DATABASE_URL is not the dev endpoint');
  if (ENV === 'rehearsal' && (!['localhost', '127.0.0.1', '::1'].includes(host) || neon || /ep-icy-moon/.test(url))) throw new Error('--env rehearsal needs a localhost DATABASE_URL (never a Neon endpoint)');
  if (!['prod', 'dev', 'rehearsal'].includes(ENV)) throw new Error('--env prod|dev|rehearsal');
  if (REHEARSAL_IGNORE_TB && ENV !== 'rehearsal') throw new Error('--rehearsal-ignore-tb is for --env rehearsal (localhost) only');
  for (const k of ['pool_timeout', 'connect_timeout', 'connection_limit', 'schema', 'pgbouncer']) u.searchParams.delete(k);
  // advisory locks and the apply transaction go over the DIRECT endpoint: pooled session state outlives the script
  const d = new URL(u.toString());
  d.hostname = d.hostname.replace('-pooler.', '.');
  return { url: u.toString(), direct: d.toString(), host: d.hostname.replace(/^([^.]*).*$/, '$1…') };
}

// ─────────────────────────────────────────────────────────── fingerprint (no drift between dry run, apply, rollback)
const FP_TABLES: Array<[string, string]> = [
  ['JournalEntry', `"organizationId" = $1`],
  ['JournalEntryLine', `"journalEntryId" in (select id from "JournalEntry" where "organizationId" = $1)`],
  ['Document', `"organizationId" = $1`],
  ['DocumentItem', `"documentId" in (select id from "Document" where "organizationId" = $1)`],
  ['Customer', `"organizationId" = $1`],
  ['Supplier', `"organizationId" = $1`],
  ['ChartOfAccount', `"organizationId" = $1`],
  ['AccountingSetting', `"organizationId" = $1`],
  ['DocumentTemplate', `"organizationId" = $1`],
  ['Payment', `"organizationId" = $1`],
  ['BillPayment', `"organizationId" = $1`],
];
/** Row counts + an md5 over every row (to_jsonb: keys sorted, so physical column order does not matter). */
async function fingerprint(c: Client, orgId: string) {
  const tables: Record<string, { n: number; md5: string; maxUpdatedAt: string | null }> = {};
  for (const [t, where] of FP_TABLES) {
    const hasUpd = !['JournalEntryLine', 'DocumentItem'].includes(t);
    const [r] = (await c.query(
      `select count(*)::int n, coalesce(md5(string_agg(md5(to_jsonb(x)::text), '' order by x.id::text)), '') h${hasUpd ? `, max(x."updatedAt")::text mx` : ''}
         from "${t}" x where ${where}`,
      [orgId],
    )).rows;
    tables[t] = { n: r.n, md5: r.h, maxUpdatedAt: r.mx ?? null };
  }
  return { tables, hash: sha(JSON.stringify(Object.entries(tables).map(([k, v]) => [k, v.n, v.md5]))).slice(0, 24) };
}

// ─────────────────────────────────────────────────────────── 1. reports
function loadReports(flag: (k: string, s: Flag['severity'], ref: string, d: string) => void) {
  const inputs: any[] = [];
  const read = (name: string) => {
    const p = path.join(DIR, `${name} ${ORG.suffix}.txt`);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    const d = A.decode(buf);
    inputs.push({ file: path.basename(p), bytes: buf.length, sha256: sha(buf).slice(0, 16), encoding: d.encoding });
    for (const o of d.oddChars.slice(0, 50)) flag('encoding', 'INFO', `${path.basename(p)}:${o.line}`, `byte ${o.byte} read as ${o.char}`);
    return d.text as string;
  };
  const J: Record<string, any> = {};
  const jfiles: Record<string, string> = { SJ: 'Sales & Receivables Journal', PJ: 'Purchases & Payables Journal', CR: 'Cash Receipts', CD: 'Cash Disbursements', GJ: 'General Journal' };
  for (const [src, name] of Object.entries(jfiles)) {
    const t = read(name);
    if (t === null) { flag('missing-report', src === 'GJ' ? 'STOP' : 'STOP', `${name} ${ORG.suffix}.txt`, src === 'GJ' ? 'General Journal entries (GJ######) are not in the export set' : 'journal missing'); continue; }
    const j = A.parseJournal(t, src);
    J[src] = j;
    if (j.strayCr) flag('stray-cr', 'INFO', `${name} ${ORG.suffix}.txt`, `${j.strayCr} CR glued to names, stripped`);
    for (const f of j.flags) flag(`parse:${f.kind}`, ['mixed-id-in-entry'].includes(f.kind) ? 'WARN' : 'STOP', `${name}:${f.line ?? ''}`, JSON.stringify(f).slice(0, 200));
    if (j.headerCount !== j.entries.length) flag('headers', 'STOP', name, `${j.headerCount} headers vs ${j.entries.length} entries`);
  }
  const other = (name: string, fn: string) => {
    const t = read(name);
    if (t === null) return null;
    const r = A[fn](t);
    for (const f of r.flags) flag(`parse:${f.kind}`, 'WARN', `${name}:${f.line ?? ''}`, JSON.stringify(f).slice(0, 200));
    return r;
  };
  const AL = other('Accounts List Summary', 'parseAccountsList');
  if (!AL) throw new Error(`Accounts List Summary ${ORG.suffix}.txt missing`);
  const CL = other('Customer Ledger', 'parseCustomerLedger');
  const IT = other('Invoice Transactions', 'parseInvoiceTransactions');
  const CI = other('Payments [Closed Invoices]', 'parseClosedInvoices');
  const SPH = other('Supplier Payment History', 'parseSupplierPayments');
  const REC = other('Reconciliation Report', 'parseReconciliation');
  const tbFile = fs.readdirSync(DIR).find((f) => new RegExp(`^Trial Balance.*${ORG.suffix}`, 'i').test(f));
  if (tbFile) flag('trial-balance-export', 'STOP', tbFile, 'a Trial Balance export is present but this script has no reader for it yet (layout not seen): add one before using it for the opening');
  const chartBuf = fs.readFileSync(CHART);
  inputs.push({ file: CHART, bytes: chartBuf.length, sha256: sha(chartBuf).slice(0, 16), encoding: 'utf8' });
  const chartRows = A.parseChartFile(chartBuf.toString('utf8'));
  if (AL.rows.length !== chartRows.length) throw new Error(`Accounts List rows ${AL.rows.length} <> chart file rows ${chartRows.length}`);
  chartRows.forEach((c: any, i: number) => {
    if (A.nameKey(AL.rows[i].name) !== A.nameKey(c.name)) throw new Error(`Accounts List row ${i + 1} "${AL.rows[i].name}" <> chart ${c.code} "${c.name}"`);
  });
  return { J, AL, CL, IT, CI, SPH, REC, chartRows, inputs };
}

// ─────────────────────────────────────────────────────────── 2. org (read-only)
async function readOrg(c: Client) {
  const q = async <T = any>(sql: string, p: any[] = []) => (await c.query(sql, p)).rows as T[];
  const [org] = await q(`select id, name from "Organization" where id = $1`, [ORG.id]);
  if (!org) throw new Error(`org ${ORG.id} not found`);
  const [setting] = await q(`select "controlAccounts" c, "lockedThroughDate"::text l1, "staffLockedThroughDate"::text l2 from "AccountingSetting" where "organizationId" = $1`, [ORG.id]);
  const chart = await q(`select id, code, name, "accountType", "isActive" from "ChartOfAccount" where "organizationId" = $1 order by code`, [ORG.id]);
  const jes = await q(`select id, "journalNumber" jn, "entryDate"::date::text dt, type, status, "createdBy", reference, "sourceDocumentId" sdid, "sourcePaymentId" spid, "totalDebit"::float td
                         from "JournalEntry" where "organizationId" = $1 order by "entryDate", "journalNumber"`, [ORG.id]);
  const jls = await q(`select l."journalEntryId" jid, a.code, l.debit::float dr, l.credit::float cr from "JournalEntryLine" l join "JournalEntry" j on j.id = l."journalEntryId"
                         join "ChartOfAccount" a on a.id = l."accountId" where j."organizationId" = $1`, [ORG.id]);
  const customers = await q(`select id::text, "customerCode" code, name from "Customer" where "organizationId" = $1 order by "customerCode"`, [ORG.id]);
  const suppliers = await q(`select id::text, "supplierCode" code, name from "Supplier" where "organizationId" = $1 order by "supplierCode"`, [ORG.id]);
  const docs = await q(`select id::text, name, type, status::text, "documentTemplateId" tpl, "createdAt"::text ca, "updatedAt"::text ua, config from "Document" where "organizationId" = $1`, [ORG.id]);
  const templates = await q(`select id::text, type, name, "isDefault", "isActive", "createdAt"::text ca from "DocumentTemplate" where "organizationId" = $1 order by "createdAt"`, [ORG.id]);
  const activeTpl = await q(`select type, "templateId"::text tid, "isPrimary" from "OrganizationActiveTemplate" where "organizationId" = $1`, [ORG.id]);
  return { org, setting, chart, jes, jls, customers, suppliers, docs, templates, activeTpl };
}

// ─────────────────────────────────────────────────────────── 3. plan
async function buildPlan(c: Client) {
  const flags: Flag[] = [];
  const flag = (kind: string, severity: Flag['severity'], ref: string, detail: string) => flags.push({ kind, severity, ref, detail });
  const rep = loadReports(flag);
  const S = await readOrg(c);
  const ctlAll = S.setting?.c || {};
  const ctl = { ar: ctlAll.debtorControl, ap: ctlAll.creditorControl, re: ctlAll.retainedProfits || '3-8000', hb: ctlAll.historicalBalancing || '3-9999', gstOut: ctlAll.taxLiabilities, gstIn: ctlAll.taxInput };
  if (!ctl.ar || !ctl.ap) throw new Error('AccountingSetting.controlAccounts has no debtorControl / creditorControl');
  if (S.setting?.l1 || S.setting?.l2) flag('lock-date', 'STOP', 'AccountingSetting', `lock dates ${S.setting.l1} / ${S.setting.l2}`);
  const acct = new Map(S.chart.map((a: any) => [a.code, a]));
  const asAt = rep.AL.asAt;
  const isBank = (code: string) => /^1-21/.test(code);
  const nowIso = new Date().toISOString();

  // ── entries -> journals (numbering, types, accounts)
  const entries: any[] = [];
  for (const src of ['SJ', 'PJ', 'CR', 'CD', 'GJ']) {
    if (!rep.J[src]) continue;
    for (const x of H.numberEntries(src, rep.J[src].entries)) {
      const e = x.entry;
      if (x.mixedIds) flag('mixed-ids', 'WARN', x.journalNumber, `one entry carries several ID#s: ${x.mixedIds.join(', ')}`);
      if (!e.lines.length) flag('empty-entry', 'STOP', x.journalNumber, e.memo);
      const t = A.entryTotals(e);
      if (!t.balanced) flag('unbalanced', 'STOP', x.journalNumber, `Dr ${t.dr} Cr ${t.cr}`);
      for (const l of e.lines) {
        const a: any = acct.get(l.code);
        if (!a) flag('account-missing', 'STOP', x.journalNumber, `account ${l.code} ${l.name} is not in the AIMS chart`);
        else if (a.accountType === 'HEADER') flag('header-account', 'STOP', x.journalNumber, `posts to header account ${l.code}`);
        else if (!a.isActive) flag('inactive-account', 'WARN', x.journalNumber, `posts to inactive account ${l.code}`);
      }
      const type = H.journalType(src, e, ctl);
      const arNet = A.netOn(e, ctl.ar);
      const apNet = R(-A.netOn(e, ctl.ap));
      const card = e.lines.find((l: any) => l.card)?.card || (src === 'SJ' ? e.memo.replace(/^Sale;\s*/, '') || null : null);
      entries.push({ src, jn: x.journalNumber, id: x.id, n: x.n, date: e.date, memo: e.memo, type, entry: e, arNet, apNet, card, amount: src === 'SJ' ? Math.abs(arNet) || t.dr : src === 'PJ' ? Math.abs(apNet) || t.dr : t.dr, lines: e.lines });
    }
  }
  const byJn = new Map(entries.map((x) => [x.jn, x]));
  const firstDay = entries.map((x) => x.date).sort()[0];
  const OPEN_DAY = `${firstDay.slice(0, 7)}-01`;
  const openDate = new Date(Date.parse(`${OPEN_DAY}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (asAt) for (const x of entries) if (x.date > asAt) flag('dated-after-accounts-list', 'INFO', x.jn, `dated ${x.date}, after the Accounts List date ${asAt}`);

  // ── clear-out (what ABSS replaces) and what stays
  const isCutover = (j: any) => String(j.createdBy || '').startsWith('abss-cutover:');
  const keepRefs = new Set(ORG.keepPostAbss || []);
  const erp = (j: any) => String(j.createdBy || '').startsWith('erp-gl:');
  const keptPostAbss = S.jes.filter((j: any) => erp(j) && j.status !== 'VOID' && keepRefs.has(j.reference));
  const clearJ = S.jes.filter((j: any) => j.status !== 'VOID' && (isCutover(j) || (erp(j) && j.dt >= OPEN_DAY && !keepRefs.has(j.reference))));
  const priorBatch = S.jes.filter((j: any) => String(j.createdBy || '').startsWith('abss-gl:'));
  if (priorBatch.length) flag('abss-ledger-already-present', 'STOP', priorBatch[0].createdBy, `${priorBatch.length} abss-gl journals exist: roll the earlier import back first`);
  const clearIds = new Set(clearJ.map((j: any) => j.id));
  const keptJ = S.jes.filter((j: any) => j.status !== 'VOID' && !clearIds.has(j.id));
  const clearDocs = S.docs.filter((d: any) => d.config?.erpImport?.source === 'abss-opening' || (d.type === 'BILL' && /^OB-/.test(d.name || '')));
  const clearDocIds = new Set(clearDocs.map((d: any) => d.id));
  for (const j of keptJ) if (j.sdid && clearDocIds.has(j.sdid)) flag('clearout-reference', 'STOP', j.jn, 'a kept journal points at an opening document being deleted');
  const unexpectedKept = keptJ.filter((j: any) => !(erp(j) && (j.dt < OPEN_DAY || keepRefs.has(j.reference))));
  for (const j of unexpectedKept) flag('journal-survives', 'STOP', j.jn, `${j.type} ${j.dt} ${j.createdBy}: neither replaced nor on the keep list`);

  // ── journal numbers free
  const taken = new Map(S.jes.filter((j: any) => !clearIds.has(j.id)).map((j: any) => [j.jn, j]));
  const docNames = new Map(S.docs.filter((d: any) => !clearDocIds.has(d.id)).map((d: any) => [`${d.type}|${d.name}`, d]));

  // ── templates (the app's getOrCreate rule: the org's own template of that type, else a new one)
  const tplOf = new Map<string, { id: string; create?: any }>();
  const template = (type: string, name: string) => {
    if (tplOf.has(type)) return tplOf.get(type)!.id;
    const prim = S.activeTpl.find((a: any) => a.type === type && a.isPrimary) || S.activeTpl.find((a: any) => a.type === type);
    const own = S.templates.find((t: any) => t.type === type && t.isActive) || S.templates.find((t: any) => t.type === type);
    if (prim) tplOf.set(type, { id: prim.tid });
    else if (own) tplOf.set(type, { id: own.id });
    else tplOf.set(type, { id: uid(`template:${type}`), create: { id: uid(`template:${type}`), type, name } });
    return tplOf.get(type)!.id;
  };

  // ── customers
  const custTaken = new Set<string>(S.customers.map((x: any) => x.code).filter(Boolean));
  const newCustomers: any[] = [];
  const custByCard = new Map<string, any>();
  const customerFor = (card: string | null) => (card ? custByCard.get(A.nameKey(card)) : null) || null;
  const custRows: any[] = [];
  if (ORG.customers === 'single') {
    const name = ORG.singleCustomer!;
    const ex = S.customers.find((x: any) => A.nameKey(x.name) === A.nameKey(name));
    const cu = ex || { id: uid(`customer:${name}`), code: H.nextCode('C', name, custTaken), name, create: true };
    if (!ex) newCustomers.push(cu);
    custByCard.set('*', cu);
    custRows.push({ abssCard: '(all YMM sales)', match: ex ? 'exact' : 'create', customerCode: cu.code, aimsName: cu.name });
  } else {
    const invByName = new Map(S.docs.filter((d: any) => d.type === 'INVOICE').map((d: any) => [d.name, d]));
    const byCode = new Map(S.customers.map((x: any) => [x.code, x]));
    const byKey = new Map(S.customers.map((x: any) => [A.nameKey(x.name), x]));
    for (const card of rep.CL?.cards || []) {
      const k = A.nameKey(card.name);
      let m: any = null;
      let how = '';
      const ov = ORG.cardOverrides?.[H.partyKey(card.name)];
      if (ov) { m = byCode.get(ov); how = `owner rule: ${card.name} = ${ov}`; }
      if (!m && byKey.get(k)) { m = byKey.get(k); how = 'exact'; }
      if (!m) {
        const ids = new Set<string>();
        for (const t of card.txns) if (t.src === 'SJ') { const d: any = invByName.get(`${ORG.invoicePrefix || ''}${t.id}`); if (d?.config?.customerId) ids.add(d.config.customerId); }
        if (ids.size === 1) { m = S.customers.find((x: any) => x.id === [...ids][0]); how = 'same invoices'; }
      }
      if (!m) {
        const pre = S.customers.filter((x: any) => A.nameKey(x.name).startsWith(k) || k.startsWith(A.nameKey(x.name)));
        if (pre.length === 1) { m = pre[0]; how = 'truncated name'; }
      }
      if (!m) { const f = H.findByName(card.name, S.customers); if (f) { m = f; how = 'party name'; } }
      if (!m) {
        const best = S.customers.map((cu: any) => ({ cu, s: words(card.name, cu.name) })).sort((a: any, b: any) => b.s - a.s)[0];
        if (best && best.s >= 0.75) { m = best.cu; how = `words ${best.s.toFixed(2)}`; }
      }
      if (!m) {
        // spelling (Equipement / Equipment, "Mr Kevin Ng"): letter-pair similarity on the first 30 characters
        const best = S.customers.map((cu: any) => ({ cu, s: dice(card.name, cu.name) })).sort((a: any, b: any) => b.s - a.s)[0];
        if (best && best.s >= 0.8) { m = best.cu; how = `spelling ${best.s.toFixed(2)} (check)`; flag('customer-spelling-match', 'INFO', best.cu.code, `ABSS "${card.name}" -> "${best.cu.name}" (${best.s.toFixed(2)})`); }
      }
      if (!m) {
        m = { id: uid(`customer:${k}`), code: H.nextCode('C', card.name, custTaken), name: card.name, create: true };
        newCustomers.push(m);
        how = 'create';
      }
      custByCard.set(k, m);
      custRows.push({ abssCard: card.name, match: how, customerCode: m.code, aimsName: m.name, opening: card.opening, closing: card.closing });
    }
    const multi = new Map<string, string[]>();
    for (const r of custRows) multi.set(r.customerCode, [...(multi.get(r.customerCode) || []), r.abssCard]);
    for (const [code, v] of multi) if (v.length > 1) flag('two-abss-cards-one-customer', 'INFO', code, v.join(' | '));
  }
  function words(a: string, b: string) {
    const t = (s: string) => new Set(A.nameKey(s).split(' ').filter((w: string) => w && !['pte', 'ltd', 'and', 's', 'the', 'private', 'limited', 'sg', 'singapore'].includes(w)));
    const x = t(a);
    const y = t(b);
    if (!x.size || !y.size) return 0;
    let i = 0;
    for (const w of x) if (y.has(w)) i++;
    return i / Math.max(x.size, y.size);
  }
  function dice(a: string, b: string) {
    const g = (s: string) => {
      const k = A.nameKey(s).replace(/^(mr|ms|mrs|dr) /, '').replace(/ pte ltd$/, '').replace(/ /g, '').slice(0, 30);
      const m = new Map<string, number>();
      for (let i = 0; i < k.length - 1; i++) m.set(k.slice(i, i + 2), (m.get(k.slice(i, i + 2)) || 0) + 1);
      return { m, n: Math.max(k.length - 1, 0) };
    };
    const x = g(a);
    const y = g(b);
    if (!x.n || !y.n) return 0;
    let i = 0;
    for (const [k, c] of x.m) i += Math.min(c, y.m.get(k) || 0);
    return (2 * i) / (x.n + y.n);
  }
  const saleCustomer = (x: any) => (ORG.customers === 'single' ? custByCard.get('*') : customerFor(x.card));

  // ── suppliers
  const supTaken = new Set<string>(S.suppliers.map((x: any) => x.code).filter(Boolean));
  const newSuppliers: any[] = [];
  const supPlan = new Map<string, any>();
  const supplierFor = (name: string | null, create = true) => {
    if (!name) return null;
    const k = H.partyKey(name);
    if (!k) return null;
    if (supPlan.has(k)) return supPlan.get(k);
    const known = [...supPlan.values()].find((p: any) => H.sameName(p.name, name));
    if (known) return known;
    const ex = S.suppliers.find((s: any) => H.partyKey(s.name) === k) || H.findByName(name, S.suppliers);
    if (ex && H.partyKey(ex.name) !== k) flag('supplier-near-match', 'INFO', ex.code, `ABSS "${name}" matched to existing "${ex.name}"`);
    if (!ex && !create) return null;
    const p = ex ? { ...ex, existing: true } : { id: uid(`supplier:${k}`), code: H.nextCode('S', name, supTaken), name, create: true };
    if (!ex) newSuppliers.push(p);
    supPlan.set(k, p);
    return p;
  };

  const journals: PlanJe[] = [];
  const docs: any[] = [];
  const docUpdates: any[] = [];
  const stampLock = { recordLocked: true, recordLockedAt: nowIso, recordLockedBy: { name: 'ABSS import' }, inboundChannel: 'IMPORT', glSource: 'abss-import' };
  const erpImp = (erpId: string, originalNumber: string, extra: any = {}) => ({ source: 'abss-ledger', batch: BATCH, erpId, originalNumber, ...extra });
  const jeFor = (x: any, sourceDocumentId: string | null): PlanJe => {
    if (taken.has(x.jn)) flag('journal-number', 'STOP', x.jn, 'already used by a journal that stays');
    const je: PlanJe = {
      id: uid(`je:${x.jn}`), jn: x.jn, date: x.date, type: x.type, reference: x.id, src: x.src,
      description: `ABSS ${x.src} ${x.id} · ${x.memo || ''}`.trim(), sourceDocumentId,
      lines: x.lines.map((l: any) => ({ code: l.code, dr: l.dr, cr: l.cr, desc: [l.memo || x.memo, l.job ? `Job ${l.job}` : ''].filter(Boolean).join(' · ') || null })),
    };
    journals.push(je);
    x.je = je;
    return je;
  };
  const addDoc = (type: string, name: string, tplName: string, status: string, config: any, key: string) => {
    if (docNames.has(`${type}|${name}`)) flag('document-name', 'STOP', name, `a ${type} ${name} already exists`);
    const d = { id: uid(`doc:${type}:${name}`), type, name, status, documentTemplateId: template(type, tplName), config, key };
    docNames.set(`${type}|${name}`, d);
    docs.push(d);
    return d;
  };
  const itemsOf = (lines: any[], skip: (l: any) => boolean, sign: 1 | -1) =>
    lines.filter((l) => !skip(l)).map((l, k) => ({ id: k + 1, description: l.memo || acct.get(l.code)?.name || l.name, quantity: 1, unitPrice: R(sign * (l.cr - l.dr)), amount: R(sign * (l.cr - l.dr)), accountCode: l.code, accountName: acct.get(l.code)?.name || l.name, tax: '0', isService: true }));

  // ── sales: invoices (items with gross, open, paid[]) ──────────────────────────────
  const sj = entries.filter((x) => x.src === 'SJ');
  const sjByNo = new Map<string, any[]>();
  for (const x of sj) sjByNo.set(x.id, [...(sjByNo.get(x.id) || []), x]);
  const invoiceItems: any[] = []; // one per invoice document (new or linked)
  const trackerInv = new Map(S.docs.filter((d: any) => d.type === 'INVOICE').map((d: any) => [d.name, d]));
  for (const [no, parts] of sjByNo) {
    parts.sort((a, b) => a.n - b.n);
    let host: any = null;
    for (const x of parts) {
      if (x.type !== 'INVOICE') continue; // credit notes / adjustments: journal only (WCT (S))
      if (!host) {
        const tracker: any = ORG.customers === 'cards' ? trackerInv.get(`${ORG.invoicePrefix || ''}${no}`) || trackerInv.get(no) : null;
        host = { key: x.jn, no, date: x.date, gross: 0, parts: [], tracker, first: x, order: invoiceItems.length };
        invoiceItems.push(host);
        host.parts.push(x);
        x.host = host;
      } else {
        // a repeated invoice number: its own document (the guard allows one active INVOICE journal per document)
        const h2 = { key: x.jn, no, date: x.date, gross: 0, parts: [x], tracker: null, first: x, order: invoiceItems.length, repeat: true };
        invoiceItems.push(h2);
        x.host = h2;
      }
    }
    // credit notes / adjustments under the number count on the first invoice of the number (imported-ledger tie)
    if (host) for (const x of parts) if (x.type !== 'INVOICE') { host.parts.push(x); x.noDocOf = host; }
  }
  for (const it of invoiceItems) it.gross = R(it.parts.filter((p: any) => p.type === 'INVOICE' || p.noDocOf === it).reduce((a: number, p: any) => a + p.arNet, 0));
  for (const it of invoiceItems) {
    const inv = it.parts.filter((p: any) => p.type === 'INVOICE');
    it.saleGross = R(inv.reduce((a: number, p: any) => a + p.arNet, 0));
    it.credits = R(it.saleGross - it.gross);
    it.gross = it.saleGross; // credits are applied below like payments (WCT (S): CN journal only, invoice owed reduced)
  }
  if (ORG.customers === 'cards') for (const [no, parts] of sjByNo) if (!parts.some((p) => p.type === 'INVOICE')) flag('credit-without-invoice', 'INFO', `ABSS-SJ-${no}`, `${parts.map((p) => p.type).join(', ')} only: journal only`);

  // receipts / credits -> allocation
  const cr = entries.filter((x) => x.src === 'CR');
  const receiptPays: any[] = [];
  for (const x of cr) {
    x.channel = A.receiptChannel(x.memo);
    const arLines = x.lines.filter((l: any) => l.code === ctl.ar);
    x.ar = R(-x.arNet);
    if (arLines.length && !x.channel && ORG.customers === 'single') flag('receipt-channel', 'WARN', x.jn, `channel not recognised from "${x.memo}"`);
    for (const l of arLines) {
      const amt = R(l.cr - l.dr);
      if (amt < 0) flag('receipt-negative-line', 'WARN', x.jn, `AR debit ${money(-amt)} inside a receipt`);
      receiptPays.push({ ref: x.jn, date: x.date, amount: amt, channel: x.channel });
    }
  }
  const creditPays = sj.filter((x) => x.type === 'CREDIT_NOTE').map((x) => ({ ref: x.jn, date: x.date, amount: R(-x.arNet), channel: 'credit', host: x.noDocOf || null }));
  let allocMethod: string;
  let alloc: any;
  if (rep.IT) {
    allocMethod = 'ABSS Invoice Transactions (real allocation)';
    alloc = H.allocateFromInvoiceTransactions(invoiceItems, rep.IT.invoices, cr.map((x) => ({ ref: x.jn, id: x.id, date: x.date })));
    // credits on the same number reduce that invoice (ABSS shows them as SJ rows on the invoice)
    for (const p of creditPays) if (p.host) { p.host.open = R(p.host.open - p.amount); p.host.paid.push({ ref: p.ref, date: p.date, amount: p.amount, rule: 'credit' }); }
    // Invoice Transactions is ABSS's own open balance: restamp from it where the invoice is listed
    const itByNo = new Map(rep.IT.invoices.map((v: any) => [v.no, v]));
    for (const it of invoiceItems) {
      const v: any = itByNo.get(it.no);
      if (!v || it.repeat) continue;
      if (Math.abs(v.open - it.open) > 0.005) flag('invoice-open-vs-abss', 'INFO', it.key, `allocated open ${money(it.open)} vs ABSS Invoice Transactions open ${money(v.open)}: ABSS value used`);
      it.abssOpen = v.open;
    }
  } else {
    allocMethod = 'amount matching (ABSS Invoice Transactions export not in hand)';
    const pays = [...creditPays, ...receiptPays].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    alloc = H.allocate(invoiceItems, pays);
  }
  for (const u of alloc.unplaced) flag('receipt-unplaced', 'WARN', u.ref, `${money(u.amount)} not placed on an invoice (${u.why || `nothing open on or before ${u.date}`})`);
  const allocByRef = new Map<string, any[]>();
  for (const it of invoiceItems) for (const p of it.paid) allocByRef.set(p.ref, [...(allocByRef.get(p.ref) || []), { it, ...p }]);
  const channelOf = (it: any) => {
    const ch = [...new Set(it.paid.filter((p: any) => p.channel && p.channel !== 'credit').map((p: any) => p.channel))];
    return ch.length === 1 ? (ch[0] as string) : ch.length > 1 ? 'mixed' : null;
  };

  // invoice documents (new) / restamps (linked tracker invoices)
  const invoiceRows: any[] = [];
  for (const it of invoiceItems) {
    const x = it.first;
    const open = R(it.abssOpen ?? it.open);
    const paid = R(it.gross - open);
    const cstat = open <= 0.004 ? 'paid' : open < it.gross - 0.004 ? 'partially_paid' : 'pending_payment';
    const dstat = open <= 0.004 ? 'paid' : 'pending_payment';
    const cu = saleCustomer(x);
    const paidBy = it.paid.map((p: any) => ({ date: p.date, amount: p.amount, receipt: p.ref, rule: p.rule }));
    const abss = { batch: BATCH, journalNumber: x.jn, number: it.no, gross: it.gross, open, paid, channel: channelOf(it), paidBy };
    let docId: string;
    if (it.tracker) {
      const t = it.tracker;
      const tg = grossOf(t.config);
      if (tg !== null && Math.abs(tg - it.gross) > 1) flag('invoice-amount-differs', 'WARN', t.name, `ABSS ${money(it.gross)} vs AIMS ${money(tg)}`);
      const cfg = stampDocumentMoney({ ...t.config, status: cstat, abssLedger: abss }, { gross: it.gross, outstanding: open, paid });
      docUpdates.push({ id: t.id, name: t.name, type: 'INVOICE', status: dstat, config: cfg, before: { gross: tg, outstanding: outstandingOf(t.config), status: t.status } });
      docId = t.id;
    } else {
      const items = itemsOf(x.lines, (l) => l.code === ctl.ar || l.code === ctl.gstOut, 1);
      const gst = R(x.lines.filter((l: any) => l.code === ctl.gstOut).reduce((a: number, l: any) => a + l.cr - l.dr, 0));
      const pos = A.posNumber(x.memo);
      const name = x.jn;
      const cfg = stampDocumentMoney(
        {
          date: x.date, dueDate: x.date, currency: 'SGD', customerId: cu?.id || null, customerName: cu?.name || x.card || null, customerCode: cu?.code || null,
          documentNumber: name, referenceNo: pos || (ORG.invoicePrefix ? `${ORG.invoicePrefix}${it.no}` : it.no), subject: x.memo || `ABSS sale ${it.no}`,
          items, subTotal: R(it.gross - gst), grossTotal: R(it.gross - gst), gstAmount: gst, gstPercent: gst ? 9 : 0, taxApplicable: gst ? 'Y' : 'N', nettTotal: it.gross,
          status: cstat, journalEntryId: uid(`je:${x.jn}`), journalNumber: x.jn, ...stampLock,
          erpImport: erpImp(`abss-sale:${x.jn.replace(/^ABSS-SJ-/, '')}`, it.no, { posNumber: pos, channel: channelOf(it), status: open <= 0.004 ? 'Closed' : 'Open', paidBy, balanceAtImport: open, customerName: x.card || cu?.name || null }),
        },
        { gross: it.gross, outstanding: open, paid },
      );
      docId = addDoc('INVOICE', name, 'Invoice', dstat, cfg, x.jn).id;
    }
    it.docId = docId;
    it.finalOpen = open;
    for (const p of it.parts) if (p.type === 'INVOICE') p.docId = p.host === it ? docId : p.docId;
    invoiceRows.push({ document: it.tracker ? it.tracker.name : x.jn, action: it.tracker ? 'link + restamp' : 'create', abssNo: it.no, journals: it.parts.map((p: any) => p.jn).join(' '), date: it.date, customer: cu?.code || '', gross: it.gross, credits: it.credits, paid, open, status: cstat, channel: channelOf(it) || '', paidBy: paidBy.map((p: any) => `${p.receipt} ${p.amount}`).join('; ') });
  }
  for (const x of sj) jeFor(x, x.type === 'INVOICE' ? x.host?.docId || null : null);

  // official receipts
  const receiptRows: any[] = [];
  for (const x of cr) {
    const arLines = x.lines.filter((l: any) => l.code === ctl.ar);
    if (!arLines.length) { jeFor(x, null); receiptRows.push({ document: '', journal: x.jn, date: x.date, memo: x.memo, channel: x.channel || '', amount: x.entry.dr, ar: 0, note: 'no AR line: journal only' }); continue; }
    const card = ORG.customers === 'single' ? null : (rep.CL?.cards || []).find((cc: any) => cc.txns.some((t: any) => t.src === 'CR' && t.id === x.id && t.date === x.date))?.name || x.memo.replace(/^[^;]*;\s*/, '');
    const cu = ORG.customers === 'single' ? custByCard.get('*') : customerFor(card);
    if (!cu) flag('receipt-customer', 'WARN', x.jn, `no customer for "${card}"`);
    const al = (allocByRef.get(x.jn) || []).map((a: any) => ({ date: a.date, amount: a.amount, reference: a.it.tracker ? a.it.tracker.name : a.it.key, documentId: a.it.docId, description: a.it.tracker ? a.it.tracker.name : a.it.key }));
    const bank = x.lines.find((l: any) => isBank(l.code) && l.dr > 0)?.code || null;
    const name = x.jn;
    const cfg = {
      date: x.date, rate: 1, glHeld: null, remarks: x.memo, savedAt: nowIso, savedBy: 'ABSS import', chequeNo: null, currency: 'SGD',
      customerId: cu?.id || null, customerName: cu?.name || card || null, allocations: al, journalNumber: x.jn, journalEntryId: uid(`je:${x.jn}`),
      paymentMethod: x.channel === 'Cash' ? 'cash' : 'transfer', receiptChannel: x.channel, receiptAmount: x.ar, debitAccountCode: bank, creditAccountCode: ctl.ar, incompleteReason: null,
      referenceNo: x.id, ...stampLock,
      erpImport: erpImp(`abss-receipt:${x.id}:${x.date}`, x.id, { status: 'Paid', customerName: card || cu?.name || null, channel: x.channel, unallocated: R(x.ar - al.reduce((a: number, y: any) => a + y.amount, 0)) }),
    };
    const d = addDoc('OFFICIAL_RECEIPT', name, 'Official Receipt', 'confirmed', cfg, x.jn);
    jeFor(x, d.id);
    receiptRows.push({ document: name, journal: x.jn, date: x.date, memo: x.memo, channel: x.channel || '', amount: x.entry.dr, ar: x.ar, allocated: al.length, note: '' });
  }

  // bills + supplier payments (Supplier Payment History -> CD entry by cheque, date, payee, AP amount -> PJ bills by PO #)
  const pj = entries.filter((x) => x.src === 'PJ');
  const bills: any[] = [];
  for (const x of pj) {
    const cards = [...new Set(x.lines.map((l: any) => l.card).filter(Boolean))] as string[];
    if (cards.length !== 1) flag('bill-supplier', 'WARN', x.jn, `supplier cards on the entry: ${cards.join(' | ') || 'none'}`);
    const sp = supplierFor(cards[0] || null);
    const b = { x, jn: x.jn, po: x.id, date: x.date, sp, supplierName: cards[0] || null, gross: x.apNet, open: x.apNet, paid: [] as any[], supplierInv: (x.memo.match(/Invoice:?\s*([^)]+)\)/i)?.[1] || '').trim() || null };
    if (b.gross < 0) flag('supplier-credit', 'INFO', x.jn, `supplier credit ${money(-b.gross)} (${b.supplierName}): a BILL with a negative total`);
    bills.push(b);
  }
  const cd = entries.filter((x) => x.src === 'CD');
  const cdById = new Map<string, any[]>();
  for (const x of cd) cdById.set(x.id, [...(cdById.get(x.id) || []), x]);
  const billsByPo = new Map<string, any[]>();
  for (const b of bills) billsByPo.set(b.po, [...(billsByPo.get(b.po) || []), b]);
  const apLeft = new Map(cd.map((x) => [x.jn, R(A.netOn(x.entry, ctl.ap))]));
  const cdRows = new Map<string, any[]>();
  const groups = new Map<string, any[]>();
  for (const row of rep.SPH?.rows || []) {
    supplierFor(row.supplier);
    const k = `${row.cheque}|${row.chqDate}|${row.supplier}`;
    groups.set(k, [...(groups.get(k) || []), row]);
  }
  for (const rows of groups.values()) {
    const { cheque, chqDate, supplier } = rows[0];
    const total = R(rows.reduce((a: number, r: any) => a + r.applied, 0));
    const cands = cdById.get(cheque) || [];
    const fits = (x: any) => (apLeft.get(x.jn) || 0) >= total - 0.004;
    const hit = cands.find((x) => x.date === chqDate && H.sameName(x.memo, supplier) && fits(x)) || cands.find((x) => x.date === chqDate && Math.abs((apLeft.get(x.jn) || 0) - total) < 0.005) || cands.find((x) => x.date === chqDate && fits(x)) || (cands.length === 1 ? cands[0] : null);
    if (!hit) {
      // ABSS split the cheque into several CD entries (same ID and date, one per AP batch): place row by row
      const same = cands.filter((x) => x.date === chqDate && (apLeft.get(x.jn) || 0) > 0.004);
      if (!same.length) { flag('payment-no-cd', 'WARN', `cheque ${cheque}`, `${supplier} ${chqDate} ${money(total)}: no Cash Disbursements entry with that ID and date`); continue; }
      for (const r of [...rows].sort((a: any, b: any) => b.applied - a.applied)) {
        const t = same.find((x) => Math.abs((apLeft.get(x.jn) || 0) - r.applied) < 0.005) || same.find((x) => (apLeft.get(x.jn) || 0) >= r.applied - 0.004) || same.sort((a, b) => (apLeft.get(b.jn) || 0) - (apLeft.get(a.jn) || 0))[0];
        apLeft.set(t.jn, R((apLeft.get(t.jn) || 0) - r.applied));
        cdRows.set(t.jn, [...(cdRows.get(t.jn) || []), r]);
      }
      flag('payment-split', 'INFO', `cheque ${cheque}`, `${supplier} ${chqDate} ${money(total)} placed over ${same.length} CD entries of that ID`);
      continue;
    }
    if (hit.date !== chqDate) flag('payment-date', 'INFO', hit.jn, `payment history cheque date ${chqDate} vs CD entry ${hit.date}`);
    apLeft.set(hit.jn, R((apLeft.get(hit.jn) || 0) - total));
    cdRows.set(hit.jn, [...(cdRows.get(hit.jn) || []), ...rows]);
  }
  const billAllocs = new Map<string, any[]>();
  for (const [jn, rows] of cdRows) {
    for (const row of rows) {
      if (!row.po) { flag('payment-without-purchase', 'INFO', jn, `${row.supplier} ${money(row.applied)}: pays a purchase from before the ABSS conversion (no PO #)`); continue; }
      const bl = billsByPo.get(row.po) || [];
      const bill = bl.find((b) => b.open >= row.applied - 0.004) || bl[0];
      if (!bill) { flag('payment-no-bill', 'WARN', jn, `PO ${row.po} (${row.supplier}) is not in the Purchases journal`); continue; }
      bill.open = R(bill.open - row.applied);
      bill.paid.push({ date: byJn.get(jn).date, amount: row.applied, voucher: jn, voucherId: uid(`doc:PAYMENT_VOUCHER:${jn}`) });
      billAllocs.set(jn, [...(billAllocs.get(jn) || []), { bill, amount: row.applied }]);
      if (bill.open < -0.004) flag('bill-overpaid', 'WARN', bill.jn, `applied beyond the bill: open ${money(bill.open)}`);
    }
  }
  const billRows: any[] = [];
  for (const b of bills) {
    const x = b.x;
    const items = itemsOf(x.lines, (l) => l.code === ctl.ap || l.code === ctl.gstIn, -1);
    const tax = R(x.lines.filter((l: any) => l.code === ctl.gstIn).reduce((a: number, l: any) => a + l.dr - l.cr, 0));
    const paid = R(b.gross - b.open);
    const status = Math.abs(b.open) <= 0.004 ? 'PAID' : 'POSTED';
    const cfg = stampDocumentMoney(
      {
        date: x.date, kind: 'SIN', items, lines: items, dueDate: null, billDate: x.date, currency: 'SGD', subtotal: R(b.gross - tax), taxAmount: tax, totalAmount: b.gross,
        supplier: b.sp ? { id: b.sp.id, name: b.sp.name } : null, supplierId: b.sp?.id || null, supplierCode: b.sp?.code || null,
        reference: b.supplierInv || x.id, referenceNo: b.supplierInv || x.id, description: x.memo, amountPaid: paid, amountsAre: 'EXCLUSIVE', billStatus: status,
        documentInfo: { absorbTax: false, gstPercent: tax ? 9 : 0 }, journalEntryId: uid(`je:${x.jn}`), journalNumber: x.jn, ...stampLock,
        erpImport: erpImp(`abss-purchase:${x.jn.replace(/^ABSS-PJ-/, '')}`, x.id, { status: status === 'PAID' ? 'Closed' : 'Open', supplierName: b.supplierName, paidBy: b.paid, balanceAtImport: b.open }),
      },
      { gross: b.gross, outstanding: b.open, paid },
    );
    const d = addDoc('BILL', x.jn, 'Bill', 'confirmed', cfg, x.jn);
    jeFor(x, d.id);
    billRows.push({ document: x.jn, date: x.date, supplier: b.supplierName, supplierCode: b.sp?.code || '', supplierAction: b.sp ? (b.sp.create ? 'create' : 'match') : '', supplierInv: b.supplierInv || '', gross: b.gross, paid, open: b.open, billStatus: status, paidBy: b.paid.map((p: any) => `${p.voucher} ${p.amount}`).join('; ') });
  }
  const paymentRows: any[] = [];
  for (const x of cd) {
    const cashOnly = x.lines.every((l: any) => isBank(l.code));
    if (cashOnly) { jeFor(x, null); paymentRows.push({ document: '', journal: x.jn, date: x.date, memo: x.memo, amount: x.entry.dr, ap: 0, note: 'bank / cash transfer: journal only' }); continue; }
    const rows = cdRows.get(x.jn) || [];
    const sp = rows[0]?.supplier ? supplierFor(rows[0].supplier) : supplierFor(x.memo, false);
    const apDr = R(A.netOn(x.entry, ctl.ap));
    const applied = R((billAllocs.get(x.jn) || []).reduce((a: number, y: any) => a + y.amount, 0));
    if (Math.abs(apDr - R(rows.reduce((a: number, r: any) => a + r.applied, 0))) > 0.004) flag('cd-vs-history', 'WARN', x.jn, `AP debit ${money(apDr)} vs payment history ${money(R(rows.reduce((a: number, r: any) => a + r.applied, 0)))} (${x.memo})`);
    const allocs = (billAllocs.get(x.jn) || []).map((y: any) => ({ date: x.date, amount: y.amount, reference: y.bill.jn, documentId: uid(`doc:BILL:${y.bill.jn}`), supplierId: sp?.id || null, description: 'SUPPLIER INVOICE' }));
    const bankLines = x.lines.filter((l: any) => isBank(l.code) && l.cr > 0);
    const bank = bankLines[0]?.code || null;
    const lines: any[] = [];
    if (Math.abs(apDr) > 0.004) lines.push({ id: `creditor-${sp?.id || 'none'}`, amount: apDr, accountCode: ctl.ap, description: 'ACCOUNTS PAYABLE', remarks: x.memo, offset: { rate: 1, currency: 'SGD', updateFx: false, supplierId: sp?.id || null, allocations: allocs, supplierName: sp?.name || null, fxAccountCode: null, voucherAmount: apDr, supplierAmount: apDr } });
    x.lines.filter((l: any) => l.code !== ctl.ap && !(isBank(l.code) && l.cr > 0)).forEach((l: any, k: number) => lines.push({ id: `l${k + 1}`, amount: R(l.dr - l.cr), offset: null, remarks: l.job ? `Job ${l.job}` : '', accountCode: l.code, description: l.memo || acct.get(l.code)?.name || l.name }));
    const total = R(bankLines.reduce((a: number, l: any) => a + l.cr - l.dr, 0)) || x.entry.dr;
    const cfg = {
      date: x.date, rate: 1, lines, notes: '', payee: x.memo, glHeld: null, remarks: x.memo, savedAt: nowIso, savedBy: 'ABSS import', chequeNo: x.id, currency: 'SGD',
      preparedBy: 'ABSS import', supplierId: sp?.id || null, supplierCode: sp?.code || null, supplierName: sp?.name || null, allocations: allocs, journalNumber: x.jn, journalEntryId: uid(`je:${x.jn}`),
      paymentAmount: total, voucherAmount: total, paymentMethod: 'transfer', bankAccountCode: bank, creditAccountCode: bank, debitAccountCode: lines[0]?.accountCode || null,
      debtorAccountCode: ctl.ar, creditorAccountCode: ctl.ap, referenceNo: x.id, ...stampLock,
      erpImport: erpImp(`abss-payment:${x.id}:${x.date}`, x.id, { status: 'Paid', applied }),
    };
    const d = addDoc('PAYMENT_VOUCHER', x.jn, 'Payment Voucher', 'confirmed', cfg, x.jn);
    jeFor(x, d.id);
    paymentRows.push({ document: x.jn, journal: x.jn, date: x.date, memo: x.memo, supplier: sp?.name || '', supplierCode: sp?.code || '', amount: total, ap: apDr, applied, bank: bank || '', bills: (billAllocs.get(x.jn) || []).map((y: any) => y.bill.jn).join(' '), note: '' });
  }
  for (const x of entries.filter((y) => y.src === 'GJ')) jeFor(x, null);

  // ── opening + year-end closes
  const asSim = (j: any) => ({ id: j.id, jn: j.jn, date: j.dt, type: j.type, lines: (S.jls.filter((l: any) => l.jid === j.id) as any[]).map((l) => ({ code: l.code, dr: l.dr, cr: l.cr })) });
  const linesByJid = new Map<string, JLine[]>();
  for (const l of S.jls) linesByJid.set(l.jid, [...(linesByJid.get(l.jid) || []), { code: l.code, dr: l.dr, cr: l.cr }]);
  const keptSim = keptJ.map((j: any) => ({ id: j.id, jn: j.jn, date: j.dt, type: j.type, lines: linesByJid.get(j.id) || [], kept: true, postAbss: keepRefs.has(j.reference) }));
  void asSim;
  let openingJe: PlanJe | null = null;
  const openingInfo: any = { day: OPEN_DAY, date: openDate, lines: [] };
  const sumLines = (list: any[]) => {
    const m = new Map<string, number>();
    for (const j of list) for (const l of j.lines) m.set(l.code, R((m.get(l.code) || 0) + l.dr - l.cr));
    return m;
  };
  if (ORG.opening === 'none') {
    // ABSS starts with the entries: Accounts List minus every entry must be zero on every account (else STOP)
    const s = sumLines([...keptSim.filter((j: any) => !j.postAbss), ...entries.map((x) => ({ lines: x.lines }))]);
    rep.chartRows.forEach((row: any, i: number) => {
      const header = i + 1 < rep.chartRows.length && rep.chartRows[i + 1].level > row.level;
      if (header || row.code === '3-9000') return;
      const d = R(A.naturalSign(row.code) * (rep.AL.rows[i].balance ?? 0) - (s.get(row.code) || 0));
      if (Math.abs(d) > 0.004) { openingInfo.lines.push({ code: row.code, v: d }); flag('opening-needed', 'STOP', row.code, `Accounts List minus the entries = ${money(d)}: the exports do not start from zero`); }
    });
  } else {
    // Racking: ABSS opening balances known from the exports: AR (Customer Ledger brought forward), AP (payments of
    // purchases from before the conversion, Supplier Payment History rows without a PO #); the rest is not exported.
    const keptBefore = sumLines(keptSim.filter((j: any) => !j.postAbss));
    const want = new Map<string, number>();
    want.set(ctl.ar, R((rep.CL?.cards || []).reduce((a: number, x: any) => a + x.opening, 0)));
    const noPo = (rep.SPH?.rows || []).filter((r: any) => !r.po);
    if (noPo.length) want.set(ctl.ap, R(-noPo.reduce((a: number, r: any) => a + r.applied, 0)));
    const lines: JLine[] = [];
    for (const code of [...new Set([...keptBefore.keys(), ...want.keys()])].sort()) {
      const w = want.get(code) || 0;
      const h = keptBefore.get(code) || 0;
      const d = R(w - h);
      if (Math.abs(d) < 0.005) continue;
      lines.push({ code, dr: d > 0 ? d : 0, cr: d < 0 ? -d : 0, desc: `ABSS ${money(w)} · AIMS history ${money(h)}` });
    }
    const net = R(lines.reduce((a, l) => a + l.dr - l.cr, 0));
    if (Math.abs(net) >= 0.005) {
      lines.push({ code: ctl.hb, dr: net < 0 ? -net : 0, cr: net > 0 ? net : 0, desc: 'Historical balancing (ABSS opening balances not in the exports)' });
      flag('opening-balancing', 'STOP', ctl.hb, `${money(net)} on ${ctl.hb}: the ABSS opening balances other than AR / AP are not in the exports (Trial Balance at ${openDate} needed)`);
    }
    const jn = `ABSS-OPENING-${OPEN_DAY}`;
    if (taken.has(jn)) flag('journal-number', 'STOP', jn, 'already used');
    openingJe = { id: uid(`je:${jn}`), jn, date: openDate, type: 'OPENING_BALANCE', reference: `ABSS exports ${ORG.suffix}`, description: `Opening balances from ABSS at ${OPEN_DAY} (Customer Ledger brought forward, supplier payments of pre-conversion purchases)`, sourceDocumentId: null, lines, src: 'OPENING' };
    openingInfo.lines = lines;
    if (lines.length) journals.push(openingJe);
  }
  const closes: PlanJe[] = [];
  if (ORG.yearEnds) {
    const sim = [...keptSim, ...journals.map((j) => ({ ...j }))];
    const minYear = Number(sim.map((j: any) => j.date).sort()[0].slice(0, 4));
    for (let y = minYear; y < Number((asAt || RUN_DAY).slice(0, 4)); y++) {
      const pnl = new Map<string, number>();
      for (const j of sim) if (j.date >= `${y}-01-01` && j.date <= `${y}-12-31`) for (const l of j.lines) if (/^[4-9]/.test(l.code)) pnl.set(l.code, R((pnl.get(l.code) || 0) + l.dr - l.cr));
      const lines: JLine[] = [];
      let net = 0;
      for (const [code, v] of [...pnl.entries()].sort()) {
        if (Math.abs(v) < 0.005) continue;
        lines.push({ code, dr: v < 0 ? -v : 0, cr: v > 0 ? v : 0, desc: `Year-end close ${y}` });
        net = R(net + v);
      }
      if (!lines.length) continue;
      lines.push({ code: ctl.re, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0, desc: `Year-end close ${y}` });
      const jn = `ABSS-YE-${y}`;
      if (taken.has(jn)) flag('journal-number', 'STOP', jn, 'already used');
      closes.push({ id: uid(`je:${jn}`), jn, date: `${y}-12-31`, type: 'ADJUSTMENT', reference: `YE-${y}`, description: `Year-end close ${y}: roll P&L into retained earnings`, sourceDocumentId: null, lines, src: 'YE' });
    }
    journals.push(...closes);
  }
  for (const j of journals) {
    const dr = R(j.lines.reduce((a, l) => a + l.dr, 0));
    const crr = R(j.lines.reduce((a, l) => a + l.cr, 0));
    if (Math.abs(dr - crr) > 0.004) flag('unbalanced-journal', 'STOP', j.jn, `Dr ${dr} Cr ${crr}`);
    for (const l of j.lines) if (!acct.get(l.code)) flag('account-missing', 'STOP', j.jn, l.code);
  }
  const dupJn = journals.length - new Set(journals.map((j) => j.jn)).size;
  if (dupJn) flag('journal-number', 'STOP', 'plan', `${dupJn} duplicate journal numbers in the plan`);

  // ── journal guard (aims_je_guard): one active native journal per (document, type) among kept + new
  const guardKey = new Map<string, string[]>();
  const native = (type: string) => !['PAYMENT', 'ADJUSTMENT'].includes(type);
  for (const j of keptJ) if (j.sdid && native(j.type) && !j.spid && j.createdBy !== 'xero-import') guardKey.set(`${j.sdid}|${j.type}`, [...(guardKey.get(`${j.sdid}|${j.type}`) || []), j.jn]);
  for (const j of journals) if (j.sourceDocumentId && native(j.type)) guardKey.set(`${j.sourceDocumentId}|${j.type}`, [...(guardKey.get(`${j.sourceDocumentId}|${j.type}`) || []), j.jn]);
  const guardHits = [...guardKey.entries()].filter(([, v]) => v.length > 1);
  for (const [k, v] of guardHits) flag('journal-guard', 'STOP', k, `two active ${k.split('|')[1]} journals on one document: ${v.join(', ')}`);
  const docIdsAfter = new Set([...S.docs.filter((d: any) => !clearDocIds.has(d.id)).map((d: any) => d.id), ...docs.map((d) => d.id)]);
  for (const j of journals) if (j.sourceDocumentId && !docIdsAfter.has(j.sourceDocumentId)) flag('journal-guard', 'STOP', j.jn, `sourceDocumentId ${j.sourceDocumentId} is not a document`);

  // ── trial balance vs the ABSS Accounts List (twice: the result must be identical)
  const simLines = (withPostAbss: boolean) => [
    ...keptSim.filter((j: any) => withPostAbss || !j.postAbss).flatMap((j: any) => j.lines.map((l: any) => ({ ...l, date: j.date, close: /^ABSS-YE-/.test(j.jn) }))),
    ...journals.flatMap((j) => j.lines.map((l) => ({ code: l.code, dr: l.dr, cr: l.cr, date: j.date, close: j.src === 'YE' }))),
  ];
  const tb = (withPostAbss: boolean) => trialBalance(rep, simLines(withPostAbss), ctl.re, asAt);
  const tb1 = tb(true);
  const tb2 = tb(true);
  if (tb1.hash !== tb2.hash) flag('tb-not-deterministic', 'STOP', 'trial balance', `${tb1.hash} vs ${tb2.hash}`);
  const tbScope = keptSim.some((j: any) => j.postAbss) ? tb(false) : tb1;
  // the post-ABSS kept items, per account, as the Accounts List shows them
  const keptEffect = new Map<string, number>();
  for (const j of keptSim.filter((y: any) => y.postAbss)) for (const l of j.lines) keptEffect.set(l.code, R((keptEffect.get(l.code) || 0) + l.dr - l.cr));
  const keptRows = keptSim.filter((j: any) => j.postAbss).map((j: any) => ({ journal: j.jn, date: j.date, type: j.type, lines: j.lines.map((l: any) => `${l.code} ${l.dr ? 'Dr ' + money(l.dr) : 'Cr ' + money(l.cr)}`).join(' | ') }));
  const scopeOk = tbScope.gate.ok;
  // strict diffs must be exactly the kept items (and 3-9000 / headers move with the P&L ones)
  const residualAfterKept = tb1.rows.filter((r: any) => !r.ok).map((r: any) => {
    const scope = tbScope.rows.find((s: any) => s.code === r.code);
    return { code: r.code, name: r.name, strictDiff: r.diff, abssScopeDiff: scope?.diff, keptNet: R(A.naturalSign(r.code) * (keptEffect.get(r.code) || 0)) };
  });
  const keptExplains = scopeOk && residualAfterKept.every((x: any) => Math.abs(x.abssScopeDiff || 0) < 0.005);
  const tbGate = keptRows.length ? { ok: scopeOk && keptExplains, text: `ABSS scope ${tbScope.gate.text}; with the ${keptRows.length} kept post-ABSS journals ${tb1.gate.text}` } : tb1.gate;

  // ── AR / AP control vs open documents (the invariants script's rule)
  const allSigned = new Map<string, number>();
  for (const l of simLines(true)) allSigned.set(l.code, R((allSigned.get(l.code) || 0) + l.dr - l.cr));
  const finalDocs = [
    ...S.docs.filter((d: any) => !clearDocIds.has(d.id) && !docUpdates.some((u) => u.id === d.id)).map((d: any) => ({ type: d.type, config: d.config, status: d.status })),
    ...docUpdates.map((u) => ({ type: u.type, config: u.config, status: u.status })),
    ...docs.map((d) => ({ type: d.type, config: d.config, status: d.status })),
  ];
  const ties = tieOut(finalDocs, allSigned, ctl);
  if (!ties.arOk) flag('ar-tie', 'STOP', ctl.ar, `GL ${money(ties.arGl)} vs open invoices ${money(ties.arDocs)} (diff ${money(ties.arGl - ties.arDocs)})`);
  if (!ties.apOk) flag('ap-tie', 'STOP', ctl.ap, `GL ${money(ties.apGl)} vs open bills ${money(ties.apDocs)} (diff ${money(ties.apGl - ties.apDocs)})`);
  if (!tbGate.ok) flag('trial-balance', 'STOP', 'Accounts List', tbGate.text);

  // ── possible duplicates (finance list)
  const supInvOf = new Map<string, string>();
  for (const r of rep.SPH?.rows || []) if (r.po && r.supplierInv) supInvOf.set(r.po, r.supplierInv);
  const dupRows = H.findDuplicates(
    entries.map((x) => ({ jn: x.jn, src: x.src, id: x.id, date: x.date, memo: x.memo, card: x.card, amount: R(x.amount), lines: x.lines })),
    (e: any) => (e.src === 'SJ' ? A.posNumber(e.memo) : e.src === 'PJ' ? (e.memo.match(/Invoice:?\s*([^)]+)\)/i)?.[1]?.trim() || supInvOf.get(e.id) || null) : null),
  );

  // ── write set + hash (ids are deterministic; timestamps excluded)
  const writeSet = {
    deleteJournals: clearJ.map((j: any) => j.id).sort(),
    deleteDocuments: clearDocs.map((d: any) => d.id).sort(),
    templates: [...tplOf.values()].filter((t) => t.create).map((t) => t.create),
    customers: newCustomers.map((x) => ({ id: x.id, code: x.code, name: x.name })),
    suppliers: newSuppliers.map((x) => ({ id: x.id, code: x.code, name: x.name })),
    documents: docs.map((d) => ({ id: d.id, type: d.type, name: d.name, status: d.status, tpl: d.documentTemplateId, gross: grossOf(d.config), owed: outstandingOf(d.config) })),
    updates: docUpdates.map((u) => ({ id: u.id, status: u.status, gross: grossOf(u.config), owed: outstandingOf(u.config) })),
    journals: journals.map((j) => ({ id: j.id, jn: j.jn, date: j.date, type: j.type, doc: j.sourceDocumentId, lines: j.lines.map((l) => [l.code, l.dr, l.cr]) })),
  };
  const planHash = sha(JSON.stringify(writeSet)).slice(0, 24);

  return {
    rep, S, ctl, flags, entries, journals, docs, docUpdates, newCustomers, newSuppliers, templates: writeSet.templates, clearJ, clearDocs, keptJ, keptRows, keptEffect,
    openingInfo, openingJe, closes, OPEN_DAY, tb1, tb2, tbScope, tbGate, residualAfterKept, ties, dupRows, planHash, writeSet, asAt, allocMethod, alloc,
    rows: { invoiceRows, receiptRows, billRows, paymentRows, custRows },
  };
}

/** Trial balance (abssView + compareTrialBalance) with the org's gate (leaf accounts or every row, expected count). */
function trialBalance(rep: any, lines: any[], re: string, asAt: string | null) {
  const signed = H.abssView(lines, { fyStart: ORG.fyStart, retainedEarnings: re, asAt: ORG.asAtCut ? asAt : null });
  const rows = H.compareTrialBalance(rep.chartRows, rep.AL.rows, signed);
  const gated = ORG.tbGate.mode === 'leaves' ? rows.filter((r: any) => !r.header) : rows;
  const matched = gated.filter((r: any) => r.ok).length;
  const ok = gated.length === ORG.tbGate.expect && matched === gated.length;
  const hash = sha(JSON.stringify(rows.map((r: any) => [r.code, r.abss, r.aims]))).slice(0, 16);
  return { rows, signed, matched, total: gated.length, hash, gate: { ok, text: `${matched}/${gated.length} ${ORG.tbGate.mode === 'leaves' ? 'leaf accounts' : 'rows'} (expected ${ORG.tbGate.expect}/${ORG.tbGate.expect})` } };
}

/** AR / AP control vs open documents (verify-accounting-invariants.ts checks 6 / 7). */
function tieOut(docs: Array<{ type: string; config: any; status?: string }>, signed: Map<string, number>, ctl: any) {
  const OPEN = ['confirmed', 'pending_payment', 'partially_paid', 'overdue'];
  const out = (c: any) => {
    const g = [c?.totalWithTax, c?.xeroGross, c?.nettTotal, c?.documentInfo?.nettTotal].map((v) => (v === '' || v === null || v === undefined ? null : Number(v))).find((v) => v !== null && !Number.isNaN(v)) ?? null;
    const o = [c?.outstandingBalance, c?.xeroBalance].map((v) => (v === '' || v === null || v === undefined ? null : Number(v))).find((v) => v !== null && !Number.isNaN(v));
    return o ?? g ?? 0;
  };
  const arDocs = R(docs.filter((d) => d.type === 'INVOICE' && (OPEN.includes(String(d.config?.status || d.status || '').toLowerCase()) || d.config?.xeroStatus === 'AUTHORISED')).reduce((a, d) => a + out(d.config), 0));
  const apDocs = R(docs.filter((d) => d.type === 'BILL' && (d.config?.billStatus === 'POSTED' || d.config?.xeroStatus === 'AUTHORISED')).reduce((a, d) => a + out(d.config), 0));
  const arGl = R(signed.get(ctl.ar) || 0);
  const apGl = R(-(signed.get(ctl.ap) || 0));
  return { arGl, arDocs, apGl, apDocs, arOk: Math.abs(arGl - arDocs) < 0.01, apOk: Math.abs(apGl - apDocs) < 0.01 };
}

// ─────────────────────────────────────────────────────────── outputs
function writeOutputs(P: any, fp: any, extra: { mode: string; at: string; timings: any }) {
  fs.mkdirSync(OUT, { recursive: true });
  const { S, tb1, tbScope, tbGate, ties } = P;
  csv('trial-balance.csv', tb1.rows.map((r: any) => {
    const s = tbScope.rows.find((x: any) => x.code === r.code);
    return { code: r.code, name: r.name, level: r.level, header: r.header ? 'H' : '', abss: r.abss, aims: r.aims, diff: r.diff, ok: r.ok ? 'yes' : 'NO', abssScopeAims: s?.aims, abssScopeDiff: s?.diff, keptPostAbss: R(A.naturalSign(r.code) * (P.keptEffect.get(r.code) || 0)) || '' };
  }));
  csv('clearout.csv', [
    ...P.clearJ.map((j: any) => ({ action: 'HARD DELETE (backup json first)', kind: 'journal', number: j.jn, date: j.dt, type: j.type, createdBy: j.createdBy, amount: j.td, id: j.id })),
    ...P.clearDocs.map((d: any) => ({ action: 'HARD DELETE (backup json first)', kind: 'document', number: d.name, date: d.config?.date, type: d.type, createdBy: d.config?.erpImport?.source, amount: grossOf(d.config), id: d.id })),
  ], ['action', 'kind', 'number', 'date', 'type', 'createdBy', 'amount', 'id']);
  csv('kept-post-abss.csv', P.keptRows, ['journal', 'date', 'type', 'lines']);
  csv('journals.csv', P.journals.map((j: PlanJe) => ({ id: j.id, journal: j.jn, date: j.date, type: j.type, reference: j.reference, description: j.description, lines: j.lines.length, debit: R(j.lines.reduce((a, l) => a + l.dr, 0)), document: j.sourceDocumentId || '' })));
  csv('invoices.csv', P.rows.invoiceRows);
  csv('receipts.csv', P.rows.receiptRows);
  csv('bills.csv', P.rows.billRows);
  csv('payments.csv', P.rows.paymentRows);
  csv('customers.csv', [...P.rows.custRows, ...P.newCustomers.filter((x: any) => !P.rows.custRows.some((r: any) => r.customerCode === x.code)).map((x: any) => ({ abssCard: '', match: 'create', customerCode: x.code, aimsName: x.name }))]);
  csv('suppliers.csv', [...P.newSuppliers.map((x: any) => ({ action: 'create', code: x.code, name: x.name, id: x.id })), ...S.suppliers.map((x: any) => ({ action: 'existing', code: x.code, name: x.name, id: x.id }))]);
  csv('flags.csv', P.flags, ['severity', 'kind', 'ref', 'detail']);
  csv('possible-duplicates.csv', P.dupRows.map((r: any) => ({ group: r.group, date: r.date, number: r.jn, abssId: r.id, source: r.src, card: r.card, amount: r.amount, why: r.why, sameAs: r.with, memo: r.memo })), ['group', 'date', 'number', 'abssId', 'source', 'card', 'amount', 'why', 'sameAs', 'memo']);
  const byType = (list: any[], f: (x: any) => string) => list.reduce((m: any, x: any) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  const plan = {
    script: 'scripts/wct-abss-history.ts', mode: extra.mode, at: extra.at, env: ENV, org: { key: ORG.key, id: ORG.id, name: S.org.name }, batch: BATCH, marker: MARK,
    inputs: P.rep.inputs, fingerprint: fp, planHash: P.planHash, asAt: P.asAt, openDay: P.OPEN_DAY,
    trialBalance: { gate: tbGate, strict: { matched: tb1.matched, total: tb1.total, hash: tb1.hash }, second: { hash: P.tb2.hash, identical: tb1.hash === P.tb2.hash }, abssScope: { matched: tbScope.matched, total: tbScope.total, hash: tbScope.hash }, mismatches: tb1.rows.filter((r: any) => !r.ok) },
    ties, allocation: { method: P.allocMethod, rules: P.alloc.rules, unplaced: P.alloc.unplaced.length },
    counts: {
      deleteJournals: P.clearJ.length, deleteDocuments: P.clearDocs.length, keptJournals: P.keptJ.length, keptPostAbss: P.keptRows.length,
      journals: P.journals.length, journalsByType: byType(P.journals, (j) => j.type), journalsBySource: byType(P.journals, (j) => j.src),
      journalLines: P.journals.reduce((a: number, j: PlanJe) => a + j.lines.length, 0),
      documents: P.docs.length, documentsByType: byType(P.docs, (d) => d.type), documentUpdates: P.docUpdates.length,
      customersNew: P.newCustomers.length, suppliersNew: P.newSuppliers.length, templatesNew: P.templates.length,
      accounts: S.chart.length, customersAfter: S.customers.length + P.newCustomers.length, suppliersAfter: S.suppliers.length + P.newSuppliers.length,
      possibleDuplicates: P.dupRows.length,
    },
    flags: P.flags.reduce((m: any, f: Flag) => ((m[`${f.severity} ${f.kind}`] = (m[`${f.severity} ${f.kind}`] || 0) + 1), m), {}),
    stop: P.flags.filter((f: Flag) => f.severity === 'STOP'),
    writeSet: P.writeSet,
    timings: extra.timings,
  };
  return plan;
}

function summary(P: any, plan: any, before: any, after: any) {
  const s: string[] = [];
  const say = (x = '') => s.push(x);
  const { S, tb1, tbScope, ties } = P;
  say(`${ORG.label} (${ORG.id}) ABSS full-history import: ${plan.mode} (${ENV}, ${plan.at})`);
  say(`Batch ${MARK} · reports ${DIR} (*${ORG.suffix}.txt) · chart ${CHART}`);
  say('');
  say('Reports:');
  for (const [src, j] of Object.entries(P.rep.J) as any) say(`  ${src}: ${j.entries.length} entries, ${j.entries.reduce((a: number, e: any) => a + e.lines.length, 0)} lines, Dr ${money(j.parsed.dr)} = Grand Total ${money(j.grandTotal?.dr ?? NaN)}`);
  say(`  Accounts List ${P.rep.AL.rows.length} rows at ${P.rep.AL.asAt}; Supplier Payment History ${P.rep.SPH?.rows.length ?? 'missing'} rows; Customer Ledger ${P.rep.CL ? P.rep.CL.cards.length + ' cards' : 'not exported'}; Invoice Transactions ${P.rep.IT ? P.rep.IT.invoices.length + ' invoices' : 'not exported'}; Closed Invoices ${P.rep.CI ? 'yes' : 'not exported'}`);
  say('');
  say(`Org now: journals ${S.jes.length}, documents ${S.docs.length}, customers ${S.customers.length}, suppliers ${S.suppliers.length}, accounts ${S.chart.length} · fingerprint ${plan.fingerprint.hash}`);
  say('');
  say(`Clear-out (HARD DELETE after a verified backup): ${P.clearJ.length} journals, ${P.clearDocs.length} documents (clearout.csv)`);
  const g = new Map<string, { n: number; min: string; max: string }>();
  for (const j of P.clearJ) { const k = `${j.createdBy} ${j.type}`; const v = g.get(k) || { n: 0, min: j.dt, max: j.dt }; v.n++; v.min = j.dt < v.min ? j.dt : v.min; v.max = j.dt > v.max ? j.dt : v.max; g.set(k, v); }
  for (const [k, v] of g) say(`  ${k}: ${v.n} (${v.min}..${v.max})`);
  if (P.clearDocs.length) say(`  documents: ${P.clearDocs.length} ${[...new Set(P.clearDocs.map((d: any) => d.type))].join('/')} (${P.clearDocs.slice(0, 3).map((d: any) => d.name).join(', ')}…), total ${money(P.clearDocs.reduce((a: number, d: any) => a + (grossOf(d.config) || 0), 0))}`);
  say(`  kept: ${P.keptJ.length} journals (${P.keptJ.map((j: any) => j.jn).join(', ') || 'none'})`);
  say('');
  say('Import:');
  say(`  journals ${plan.counts.journals} (${plan.counts.journalLines} lines): ${Object.entries(plan.counts.journalsBySource).map(([k, v]) => `${k} ${v}`).join(', ')}; by type ${Object.entries(plan.counts.journalsByType).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  say(`  documents ${plan.counts.documents}: ${Object.entries(plan.counts.documentsByType).map(([k, v]) => `${k} ${v}`).join(', ')}; existing invoices restamped ${plan.counts.documentUpdates}`);
  say(`  customers new ${plan.counts.customersNew} (${P.newCustomers.slice(0, 5).map((x: any) => `${x.code} ${x.name}`).join('; ')}${P.newCustomers.length > 5 ? ' …' : ''}), suppliers new ${plan.counts.suppliersNew}, document templates new ${plan.counts.templatesNew} (${P.templates.map((t: any) => t.type).join(', ') || 'none'})`);
  say(`  opening: ${P.openingJe ? `${P.openingJe.jn} dated ${P.openingJe.date}: ${P.openingJe.lines.map((l: JLine) => `${l.code} ${l.dr ? 'Dr' : 'Cr'} ${money(l.dr || l.cr)}`).join(', ')}` : P.openingInfo.lines.length ? 'NEEDED (STOP)' : 'none needed (every account starts at zero)'}; year-end closes: ${P.closes.map((j: PlanJe) => j.jn).join(', ') || 'none'}`);
  say(`  receipt allocation: ${P.allocMethod}: ${JSON.stringify(P.alloc.rules)}, unplaced ${P.alloc.unplaced.length}`);
  if (ORG.customers === 'single') {
    const ch: any = {};
    for (const r of P.rows.receiptRows) { const k = r.channel || (r.document ? 'unrecognised' : 'non-AR'); ch[k] = ch[k] || { n: 0, a: 0 }; ch[k].n++; ch[k].a = R(ch[k].a + r.amount); }
    say(`  receipts by channel: ${Object.entries(ch).map(([k, v]: any) => `${k} ${v.n} (${money(v.a)})`).join('; ')}`);
    const ic: any = {};
    for (const r of P.rows.invoiceRows) { const k = r.channel || (r.open > 0.004 ? 'open' : 'none'); ic[k] = (ic[k] || 0) + 1; }
    say(`  invoices by channel (from the receipts that paid them): ${Object.entries(ic).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  say(`  invoices: paid ${P.rows.invoiceRows.filter((r: any) => r.status === 'paid').length}, part-paid ${P.rows.invoiceRows.filter((r: any) => r.status === 'partially_paid').length}, open ${P.rows.invoiceRows.filter((r: any) => r.status === 'pending_payment').length}; bills PAID ${P.rows.billRows.filter((r: any) => r.billStatus === 'PAID').length}, open ${P.rows.billRows.filter((r: any) => r.billStatus === 'POSTED').length} (negative ${P.rows.billRows.filter((r: any) => r.gross < 0).length})`);
  say('');
  say(`Trial balance at ${P.asAt} vs ABSS Accounts List: ${plan.trialBalance.gate.text} -> ${plan.trialBalance.gate.ok ? 'PASS' : 'FAIL'} (hash ${tb1.hash}, second computation ${plan.trialBalance.second.identical ? 'identical' : 'DIFFERENT'})`);
  for (const r of tb1.rows.filter((x: any) => !x.ok && (ORG.tbGate.mode === 'all' || !x.header))) {
    const sc = tbScope.rows.find((x: any) => x.code === r.code);
    say(`  ${r.code} ${String(r.name).padEnd(30)} ABSS ${money(r.abss).padStart(14)}  AIMS ${money(r.aims).padStart(14)}  diff ${money(r.diff).padStart(14)}${P.keptRows.length ? `  (ABSS scope diff ${money(sc?.diff ?? 0)})` : ''}`);
  }
  if (P.keptRows.length) {
    say(`  Kept post-ABSS AIMS entries (owner: keep): ${P.keptRows.map((k: any) => `${k.journal} ${k.date} [${k.lines}]`).join('; ')}`);
    say(`  Without them (ABSS scope): ${tbScope.matched}/${tbScope.total}; every difference above is ${P.residualAfterKept.every((x: any) => Math.abs(x.abssScopeDiff || 0) < 0.005) ? 'exactly' : 'NOT only'} the kept items.`);
  }
  say('');
  say(`AR ${P.ctl.ar}: GL ${money(ties.arGl)} vs open invoices ${money(ties.arDocs)} ${ties.arOk ? 'TIES' : `DIFF ${money(ties.arGl - ties.arDocs)}`}; AP ${P.ctl.ap}: GL ${money(ties.apGl)} vs open bills ${money(ties.apDocs)} ${ties.apOk ? 'TIES' : `DIFF ${money(ties.apGl - ties.apDocs)}`}`);
  say(`Possible duplicates for finance: ${P.dupRows.length} entries (possible-duplicates.csv)`);
  say(`Flags: ${Object.entries(plan.flags).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} (flags.csv)`);
  for (const f of plan.stop.slice(0, 25)) say(`  STOP ${f.kind} ${f.ref}: ${f.detail}`);
  if (plan.stop.length > 25) say(`  … ${plan.stop.length - 25} more STOP flags`);
  say('');
  say(`Apply gate: ${plan.stop.length ? `REFUSED (${plan.stop.length} STOP flags)` : 'all gates pass'} · plan ${plan.planHash} · fingerprint ${plan.fingerprint.hash}`);
  if (before && after) say(`Read-only check: org fingerprint before vs after this run ${before.hash === after.hash ? 'IDENTICAL' : 'CHANGED'} (${after.hash}); max(updatedAt) JE ${after.tables.JournalEntry.maxUpdatedAt}, Document ${after.tables.Document.maxUpdatedAt}, Customer ${after.tables.Customer.maxUpdatedAt}, Supplier ${after.tables.Supplier.maxUpdatedAt}, ChartOfAccount ${after.tables.ChartOfAccount.maxUpdatedAt}`);
  return s;
}

// ─────────────────────────────────────────────────────────── apply
const LOCK_KEY = `aims-wct-abss-history:${ORG?.id}`;
const DOC_CHILDREN = ['DocumentItem', 'DocumentEmbedding', 'DocumentShareLink', 'DeliveryShareLink', 'DocumentSignLink'];
const DOC_REFS_BLOCK: Array<[string, string]> = [
  ['TimelineItem', 'documentId'], ['Document', 'baseDocumentId'], ['ProjectDeployment', 'sourceDocumentId'], ['Assignment', 'documentId'], ['Order', 'sourceQuotationId'],
  ['PriceHistory', 'documentId'], ['Payment', 'documentId'], ['Transaction', 'documentId'], ['MaintenanceServiceReport', 'invoiceDocumentId'], ['MaintenanceServiceReport', 'documentId'],
  ['Delivery', 'documentId'], ['DeliveryItem', 'documentId'],
];
const JE_REFS_BLOCK: Array<[string, string]> = [['Payment', 'journalEntryId'], ['DepreciationEntry', 'journalEntryId'], ['Bill', 'journalEntryId'], ['BillPayment', 'journalEntryId'], ['BankStatementLine', 'postedJournalEntryId'], ['LotPosting', 'journalEntryId'], ['JournalEntry', 'reversesEntryId']];

async function blockingRefs(c: Client, docIds: string[], jeIds: string[], lineIds: string[]) {
  const hits: string[] = [];
  const has = async (t: string, col: string) => (await c.query(`select 1 from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = $2`, [t, col])).rowCount;
  for (const [t, col] of DOC_REFS_BLOCK) if (docIds.length && (await has(t, col))) {
    const n = (await c.query(`select count(*)::int n from "${t}" where "${col}"::text = any($1)`, [docIds])).rows[0].n;
    if (n) hits.push(`${t}.${col} ${n}`);
  }
  if (docIds.length) {
    const n = (await c.query(`select count(*)::int n from "JournalEntry" where "sourceDocumentId" = any($1) and not (id = any($2))`, [docIds, jeIds])).rows[0].n;
    if (n) hits.push(`JournalEntry.sourceDocumentId ${n}`);
    if (await has('BillPayment', 'billId')) {
      const bp = (await c.query(`select count(*)::int n from "BillPayment" where "billId"::text = any($1)`, [docIds])).rows[0].n;
      if (bp) hits.push(`BillPayment.billId ${bp}`);
    }
  }
  for (const [t, col] of JE_REFS_BLOCK) if (jeIds.length && (await has(t, col))) {
    const n = (await c.query(`select count(*)::int n from "${t}" where "${col}"::text = any($1) ${t === 'JournalEntry' ? 'and not (id = any($1))' : ''}`, [jeIds])).rows[0].n;
    if (n) hits.push(`${t}.${col} ${n}`);
  }
  if (lineIds.length && (await has('BankStatementLine', 'matchedJournalLineId'))) {
    const n = (await c.query(`select count(*)::int n from "BankStatementLine" where "matchedJournalLineId" = any($1)`, [lineIds])).rows[0].n;
    if (n) hits.push(`BankStatementLine.matchedJournalLineId ${n}`);
  }
  return hits;
}

/** DB-side checks inside the transaction: TB from the stored lines, AR / AP ties, guard duplicates, orphans. */
async function dbChecks(c: Client, P: any) {
  const lines = (await c.query(
    `select a.code, l.debit::float dr, l.credit::float cr, j."entryDate"::date::text date, (j."journalNumber" like 'ABSS-YE-%') close, (j.reference = any($2)) post
       from "JournalEntryLine" l join "JournalEntry" j on j.id = l."journalEntryId" join "ChartOfAccount" a on a.id = l."accountId"
      where j."organizationId" = $1 and j.status <> 'VOID' and coalesce(j."isUnconfirmed", false) = false`,
    [ORG.id, ORG.keepPostAbss || []],
  )).rows;
  const tbAll = trialBalance(P.rep, lines, P.ctl.re, P.asAt);
  const tbScope = trialBalance(P.rep, lines.filter((l: any) => !l.post || !(ORG.keepPostAbss || []).length), P.ctl.re, P.asAt);
  const signed = new Map<string, number>();
  for (const l of lines) signed.set(l.code, R((signed.get(l.code) || 0) + l.dr - l.cr));
  const docs = (await c.query(`select type, config, status::text status from "Document" where "organizationId" = $1 and type in ('INVOICE','BILL')`, [ORG.id])).rows;
  const ties = tieOut(docs, signed, P.ctl);
  const dups = (await c.query(
    `select "sourceDocumentId", type, count(*)::int n from "JournalEntry" je where je."organizationId" = $1 and je."sourceDocumentId" is not null and je.status <> 'VOID'
        and je."createdBy" is distinct from 'xero-import' and je."sourcePaymentId" is null and je.type not in ('PAYMENT','ADJUSTMENT') group by 1, 2 having count(*) > 1`,
    [ORG.id],
  )).rows.length;
  const orphans = (await c.query(`select count(*)::int n from "JournalEntry" je where je."organizationId" = $1 and je."sourceDocumentId" is not null and je.status <> 'VOID'
                                    and not exists (select 1 from "Document" d where d.id::text = je."sourceDocumentId")`, [ORG.id])).rows[0].n;
  const unbalanced = (await c.query(`select count(*)::int n from (select je.id from "JournalEntry" je join "JournalEntryLine" l on l."journalEntryId" = je.id where je."organizationId" = $1 and je.status <> 'VOID'
                                       group by je.id having abs(sum(l.debit) - sum(l.credit)) > 0.005) x`, [ORG.id])).rows[0].n;
  const tbOk = (ORG.keepPostAbss || []).length ? tbScope.gate.ok && tbAll.rows.every((r: any) => r.ok || Math.abs((tbScope.rows.find((s: any) => s.code === r.code)?.diff) || 0) < 0.005) : tbAll.gate.ok;
  return { tb: tbAll, tbScope, tbOk, ties, dups, orphans, unbalanced };
}

async function insertAll(c: Client, P: any, step: (s: string) => void) {

  if (P.templates.length) await c.query(`insert into "DocumentTemplate"(id, name, type, "templateVariant", "createdAt", "updatedAt", config, "organizationId", "designName", "isActive", "isDefault")
      select x.id, x.name, x.type, 'Default', now(), now(), '{}'::jsonb, $2, 'Default', true, false from jsonb_to_recordset($1::jsonb) as x(id uuid, name text, type text)`, [JSON.stringify(P.templates), ORG.id]);
  if (P.newCustomers.length) await c.query(`insert into "Customer"(id, "customerCode", name, currency, "organizationId", "createdAt", "updatedAt")
      select x.id, x.code, x.name, 'SGD', $2, now(), now() from jsonb_to_recordset($1::jsonb) as x(id uuid, code text, name text)`, [JSON.stringify(P.newCustomers.map((x: any) => ({ id: x.id, code: x.code, name: x.name }))), ORG.id]);
  if (P.newSuppliers.length) await c.query(`insert into "Supplier"(id, "supplierCode", name, currency, "organizationId", "createdAt", "updatedAt")
      select x.id, x.code, x.name, 'SGD', $2, now(), now() from jsonb_to_recordset($1::jsonb) as x(id uuid, code text, name text)`, [JSON.stringify(P.newSuppliers.map((x: any) => ({ id: x.id, code: x.code, name: x.name }))), ORG.id]);
  step(`templates ${P.templates.length}, customers ${P.newCustomers.length}, suppliers ${P.newSuppliers.length}`);
  let n = 0;
  for (const part of chunks(P.docs, 1000)) {
    const r = await c.query(`insert into "Document"(id, "createdAt", "updatedAt", config, "documentTemplateId", type, "organizationId", name, status, "revisionNumber", version)
        select x.id, now(), now(), x.config, x.tpl, x.type, $2, x.name, x.status::"DocumentStatus", 0, 0 from jsonb_to_recordset($1::jsonb) as x(id uuid, config jsonb, tpl text, type text, name text, status text)`,
      [JSON.stringify(part.map((d: any) => ({ id: d.id, config: d.config, tpl: d.documentTemplateId, type: d.type, name: d.name, status: d.status }))), ORG.id]);
    n += r.rowCount || 0;
  }
  if (n !== P.docs.length) throw new Error(`documents inserted ${n} <> ${P.docs.length}`);
  step(`documents ${n}`);
  for (const part of chunks(P.docUpdates, 500)) {
    const r = await c.query(`update "Document" d set config = x.config, status = x.status::"DocumentStatus", "updatedAt" = now()
        from jsonb_to_recordset($1::jsonb) as x(id uuid, config jsonb, status text) where d.id = x.id and d."organizationId" = $2`,
      [JSON.stringify(part.map((u: any) => ({ id: u.id, config: u.config, status: u.status }))), ORG.id]);
    if (r.rowCount !== part.length) throw new Error(`document updates ${r.rowCount} <> ${part.length}`);
  }
  step(`document updates ${P.docUpdates.length}`);
  const acct = new Map(P.S.chart.map((a: any) => [a.code, a.id]));
  n = 0;
  for (const part of chunks(P.journals as PlanJe[], 2000)) {
    const r = await c.query(`insert into "JournalEntry"(id, "organizationId", "journalNumber", "entryDate", type, status, "isUnconfirmed", reference, description, "totalDebit", "totalCredit", currency,
          "sourceDocumentId", "postedAt", "postedBy", "createdAt", "updatedAt", "createdBy")
        select x.id, $2, x.jn, x.date::timestamp, x.type, 'POSTED', false, x.reference, x.description, x.td, x.tc, 'SGD', x.doc, now(), 'abss-gl', now(), now(), $3
          from jsonb_to_recordset($1::jsonb) as x(id text, jn text, date text, type text, reference text, description text, td float8, tc float8, doc text)`,
      [JSON.stringify(part.map((j) => ({ id: j.id, jn: j.jn, date: j.date, type: j.type, reference: j.reference, description: j.description, td: R(j.lines.reduce((a, l) => a + l.dr, 0)), tc: R(j.lines.reduce((a, l) => a + l.cr, 0)), doc: j.sourceDocumentId }))), ORG.id, MARK]);
    n += r.rowCount || 0;
  }
  if (n !== P.journals.length) throw new Error(`journals inserted ${n} <> ${P.journals.length}`);
  const lineRows = (P.journals as PlanJe[]).flatMap((j) => j.lines.map((l, k) => ({ id: uid(`jel:${j.jn}:${k + 1}`), jid: j.id, acc: acct.get(l.code), no: k + 1, desc: l.desc ?? null, dr: l.dr, cr: l.cr })));
  if (lineRows.some((l) => !l.acc)) throw new Error('a journal line has no account id');
  n = 0;
  for (const part of chunks(lineRows, 5000)) {
    const r = await c.query(`insert into "JournalEntryLine"(id, "journalEntryId", "accountId", "lineNumber", description, debit, credit)
        select x.id, x.jid, x.acc, x.no, x."desc", x.dr, x.cr from jsonb_to_recordset($1::jsonb) as x(id text, jid text, acc text, no int, "desc" text, dr float8, cr float8)`, [JSON.stringify(part)]);
    n += r.rowCount || 0;
  }
  if (n !== lineRows.length) throw new Error(`journal lines inserted ${n} <> ${lineRows.length}`);
  step(`journals ${P.journals.length}, lines ${lineRows.length}`);
  return { lineIds: lineRows.map((l) => l.id) };
}

async function actionLog(c: Client, action: string, resource: string, note: string, details: any) {
  const id = crypto.randomUUID();
  await c.query(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status, "createdAt")
                 values ($1, 'SYSTEM', $2, 'System creation', $3, 'operator', $4, $5, $6::jsonb, 'SUCCESS', now())`, [id, SCRIPT, ORG.id, action, resource, JSON.stringify({ note, batch: BATCH, ...details })]);
  return id;
}

async function rowsJson(c: Client, table: string, where: string, params: any[]) {
  return (await c.query(`select row_to_json(t)::text j from "${table}" t where ${where} order by t.id::text`, params)).rows.map((r: any) => JSON.parse(r.j));
}

async function doApply(P: any, url: { direct: string }, planFile: any) {
  const t0 = Date.now();
  const timings: any = {};
  const step = (s: string) => { timings[s] = Date.now() - t0; console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); };
  const stops = P.flags.filter((f: Flag) => f.severity === 'STOP');
  const refuse = (why: string) => { throw new Error(`APPLY REFUSED: ${why}`); };
  if (!ORGS[ORG_KEY]) refuse('org must be racking or ymm');
  if (ENV === 'prod' && !CONFIRM_PROD) refuse('--env prod needs --confirm-prod');
  if (stops.length && !REHEARSAL_IGNORE_TB) refuse(`${stops.length} STOP flag(s): ${stops.slice(0, 5).map((f: Flag) => `${f.kind} ${f.ref}`).join('; ')}`);
  if (!P.tbGate.ok && !REHEARSAL_IGNORE_TB) refuse(`trial balance ${P.tbGate.text}`);
  if (REHEARSAL_IGNORE_TB) console.log(`  REHEARSAL: trial balance (${P.tbGate.text}) and ${stops.length} STOP flag(s) ignored on localhost`);
  if (!P.ties.arOk || !P.ties.apOk) refuse('AR / AP control does not tie to the open documents');
  if (!planFile) refuse(`no dry-run plan.json in ${OUT}: run the dry run first`);
  const c = new Client({ connectionString: url.direct });
  await c.connect();
  let locked = false;
  let committed = false;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    locked = (await c.query(`select pg_try_advisory_lock(hashtext($1)) ok`, [LOCK_KEY])).rows[0].ok;
    if (!locked) refuse('another run holds the advisory lock');
    const fpLive = await fingerprint(c, ORG.id);
    if (fpLive.hash !== planFile.fingerprint.hash) refuse(`org changed since the dry run (fingerprint ${fpLive.hash} vs plan ${planFile.fingerprint.hash}): run the dry run again`);
    if (P.planHash !== planFile.planHash) refuse(`the plan differs from the dry run's (${P.planHash} vs ${planFile.planHash}): run the dry run again`);
    step('gates passed, lock held');
    await c.query('BEGIN');
    await c.query(`SET LOCAL statement_timeout = 0`);
    await c.query(`SET LOCAL idle_in_transaction_session_timeout = 0`);
    await c.query(`SET LOCAL lock_timeout = '30s'`);
    // Prisma stores UTC in "timestamp without time zone": now() must be UTC whatever the server's TimeZone is
    await c.query(`SET LOCAL TimeZone = 'UTC'`);
    const txNow = (await c.query(`select now()::timestamp(3)::text t`)).rows[0].t as string;
    const fpTx = await fingerprint(c, ORG.id);
    if (fpTx.hash !== planFile.fingerprint.hash) refuse('org changed between the gate and the transaction');
    const jeIds: string[] = P.clearJ.map((j: any) => j.id);
    const docIds: string[] = P.clearDocs.map((d: any) => d.id);
    const updIds: string[] = P.docUpdates.map((u: any) => u.id);
    if (jeIds.length) await c.query(`select id from "JournalEntry" where id = any($1) for update`, [jeIds]);
    if (docIds.length || updIds.length) await c.query(`select id from "Document" where id = any($1::uuid[]) for update`, [[...docIds, ...updIds]]);
    // backup of every row the apply deletes or changes, then re-read and verified before the first write
    const backup: any = {
      at: new Date().toISOString(), script: 'scripts/wct-abss-history.ts', env: ENV, org: ORG.id, batch: BATCH, marker: MARK, fingerprintBefore: fpTx,
      journals: jeIds.length ? await rowsJson(c, 'JournalEntry', `id = any($1)`, [jeIds]) : [],
      journalLines: jeIds.length ? await rowsJson(c, 'JournalEntryLine', `"journalEntryId" = any($1)`, [jeIds]) : [],
      documents: docIds.length ? await rowsJson(c, 'Document', `id = any($1::uuid[])`, [docIds]) : [],
      documentChildren: {} as Record<string, any[]>,
      updatedDocuments: updIds.length ? await rowsJson(c, 'Document', `id = any($1::uuid[])`, [updIds]) : [],
    };
    // (a failed statement would abort the transaction: only tables that exist with a documentId column are read)
    for (const t of DOC_CHILDREN) {
      const ok = (await c.query(`select 1 from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = 'documentId'`, [t])).rowCount;
      backup.documentChildren[t] = docIds.length && ok ? await rowsJson(c, t, `"documentId" = any($1::uuid[])`, [docIds]) : [];
    }
    const lineIdsDel = backup.journalLines.map((l: any) => l.id);
    const blocks = await blockingRefs(c, docIds, jeIds, lineIdsDel);
    if (blocks.length) refuse(`other rows point at what would be deleted: ${blocks.join(', ')}`);
    fs.mkdirSync(OUT, { recursive: true });
    const backupFile = path.join(OUT, `backup-${ts}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup));
    const reread = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    const want = { journals: jeIds.length, journalLines: P.clearJ.reduce((a: number, j: any) => a + P.S.jls.filter((l: any) => l.jid === j.id).length, 0), documents: docIds.length, updatedDocuments: updIds.length };
    for (const [k, v] of Object.entries(want)) if (reread[k].length !== v) refuse(`backup ${k} ${reread[k].length} <> expected ${v}`);
    if (reread.fingerprintBefore.hash !== planFile.fingerprint.hash) refuse('backup fingerprint differs');
    const backupSha = sha(fs.readFileSync(backupFile));
    step(`backup written + verified: ${backupFile} (journals ${want.journals}, lines ${want.journalLines}, documents ${want.documents}, updated ${want.updatedDocuments})`);
    // hard delete: journals first (lines cascade), then the documents (the delete guard sees no active journal)
    if (jeIds.length) { const r = await c.query(`delete from "JournalEntry" where id = any($1) and "organizationId" = $2`, [jeIds, ORG.id]); if (r.rowCount !== jeIds.length) refuse(`deleted ${r.rowCount} journals, expected ${jeIds.length}`); }
    if (docIds.length) { const r = await c.query(`delete from "Document" where id = any($1::uuid[]) and "organizationId" = $2`, [docIds, ORG.id]); if (r.rowCount !== docIds.length) refuse(`deleted ${r.rowCount} documents, expected ${docIds.length}`); }
    const alClear = await actionLog(c, 'DELETE', 'journal', `ABSS history import (${ORG.label}): the 6 Nov import it replaces removed (backup ${path.basename(backupFile)})`, { phase: 'clear-out', journals: jeIds.length, journalLines: want.journalLines, documents: docIds.length, backup: path.basename(backupFile) });
    step(`clear-out: journals ${jeIds.length}, documents ${docIds.length}`);
    const ins = await insertAll(c, P, step);
    const alImport = await actionLog(c, 'IMPORT', 'journal', `ABSS history import (${ORG.label}): ${P.journals.length} ABSS journals, ${P.docs.length} documents, ${P.docUpdates.length} invoices restamped, ${P.newCustomers.length} customers, ${P.newSuppliers.length} suppliers`, {
      phase: 'import', journals: P.journals.length, journalLines: ins.lineIds.length, documents: P.docs.length, documentUpdates: P.docUpdates.length, customers: P.newCustomers.length, suppliers: P.newSuppliers.length, templates: P.templates.length, marker: MARK,
    });
    const chk = await dbChecks(c, P);
    step(`database checks: TB ${chk.tb.gate.text}${(ORG.keepPostAbss || []).length ? `, ABSS scope ${chk.tbScope.gate.text}` : ''}, AR ${chk.ties.arOk ? 'ties' : 'DIFF'} (${money(chk.ties.arGl)} / ${money(chk.ties.arDocs)}), AP ${chk.ties.apOk ? 'ties' : 'DIFF'} (${money(chk.ties.apGl)} / ${money(chk.ties.apDocs)}), guard dups ${chk.dups}, orphans ${chk.orphans}, unbalanced ${chk.unbalanced}`);
    if ((!chk.tbOk && !REHEARSAL_IGNORE_TB) || !chk.ties.arOk || !chk.ties.apOk || chk.dups || chk.orphans || chk.unbalanced) refuse('database checks after the import failed: nothing committed');
    if (chk.tb.hash !== P.tb1.hash) refuse(`trial balance on the database (${chk.tb.hash}) differs from the plan (${P.tb1.hash})`);
    const log = {
      at: new Date().toISOString(), script: 'scripts/wct-abss-history.ts', env: ENV, org: ORG.id, orgKey: ORG.key, batch: BATCH, marker: MARK, backup: backupFile, backupSha256: backupSha,
      fingerprintBefore: fpTx.hash, planHash: P.planHash, insertedAt: txNow,
      inserted: { templates: P.templates.map((t: any) => t.id), customers: P.newCustomers.map((x: any) => x.id), suppliers: P.newSuppliers.map((x: any) => x.id), documents: P.docs.map((d: any) => d.id), journals: P.journals.map((j: PlanJe) => j.id), journalLines: ins.lineIds },
      updatedDocuments: updIds, deleted: { journals: jeIds, journalLines: lineIdsDel, documents: docIds }, actionLogs: [alClear, alImport],
      checks: { tb: chk.tb.gate, tbScope: chk.tbScope.gate, ties: chk.ties, tbHash: chk.tb.hash }, timings,
    };
    const logFile = path.join(OUT, `apply-${ts}.log.json`);
    fs.writeFileSync(logFile, JSON.stringify(log));
    await c.query('COMMIT');
    committed = true;
    step('COMMIT');
    const fpAfter = await fingerprint(c, ORG.id);
    log.timings = timings;
    (log as any).fingerprintAfter = fpAfter.hash;
    fs.writeFileSync(logFile, JSON.stringify(log));
    console.log(`\nAPPLIED ${ORG.label}: deleted ${jeIds.length} journals + ${docIds.length} documents; inserted ${P.journals.length} journals (${ins.lineIds.length} lines), ${P.docs.length} documents, ${P.docUpdates.length} restamped, ${P.newCustomers.length} customers, ${P.newSuppliers.length} suppliers.\n  backup ${backupFile}\n  log    ${logFile}\n  rollback: --rollback ${logFile} (dry run) then add --apply`);
    return { logFile, backupFile, timings, fpAfter };
  } catch (e) {
    if (!committed) await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    if (locked) await c.query(`select pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]).catch(() => undefined);
    await c.end().catch(() => undefined);
  }
}

// ─────────────────────────────────────────────────────────── rollback
async function doRollback(url: { direct: string }) {
  const log = JSON.parse(fs.readFileSync(ROLLBACK!, 'utf8'));
  if (log.org !== ORG.id || log.marker !== MARK) throw new Error(`log is for ${log.org} / ${log.marker}, not ${ORG.id} / ${MARK} (pass the same --org and --batch-day)`);
  const bbuf = fs.readFileSync(log.backup);
  if (sha(bbuf) !== log.backupSha256) throw new Error('backup file changed since the apply (sha256 differs)');
  const backup = JSON.parse(bbuf.toString('utf8'));
  const I = log.inserted;
  const t0 = Date.now();
  const timings: any = {};
  const step = (s: string) => { timings[s] = Date.now() - t0; console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); };
  const c = new Client({ connectionString: url.direct });
  await c.connect();
  let locked = false;
  let committed = false;
  try {
    if (!APPLY) await c.query('SET default_transaction_read_only = on');
    const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
    // what is there now
    const present = {
      journals: (await q(`select count(*)::int n from "JournalEntry" where id = any($1)`, [I.journals]))[0].n,
      batchJournals: (await q(`select count(*)::int n from "JournalEntry" where "organizationId" = $1 and "createdBy" = $2`, [ORG.id, MARK]))[0].n,
      documents: (await q(`select count(*)::int n from "Document" where id = any($1::uuid[])`, [I.documents]))[0].n,
      customers: (await q(`select count(*)::int n from "Customer" where id = any($1::uuid[])`, [I.customers]))[0].n,
      suppliers: (await q(`select count(*)::int n from "Supplier" where id = any($1::uuid[])`, [I.suppliers]))[0].n,
      templates: (await q(`select count(*)::int n from "DocumentTemplate" where id = any($1::uuid[])`, [I.templates]))[0].n,
    };
    // every row the apply wrote carries the apply transaction's now() (UTC): any other updatedAt = edited since
    const edited = (await q(`select name from "Document" where (id = any($1::uuid[]) or id = any($2::uuid[])) and "updatedAt" is distinct from $3::timestamp(3)`, [I.documents, log.updatedDocuments, log.insertedAt])).map((r: any) => r.name);
    const editedJe = (await q(`select "journalNumber" from "JournalEntry" where id = any($1) and "updatedAt" is distinct from $2::timestamp(3)`, [I.journals, log.insertedAt])).map((r: any) => r.journalNumber);
    const foreignJe = (await q(`select "journalNumber" from "JournalEntry" where "sourceDocumentId" = any($1) and "createdBy" is distinct from $2`, [I.documents, MARK])).map((r: any) => r.journalNumber);
    const refs = await blockingRefs(c, I.documents, I.journals, I.journalLines);
    const custRefs = I.customers.length ? (await q(`select count(*)::int n from "Document" where config->>'customerId' = any($1) and not (id = any($2::uuid[]))`, [I.customers, I.documents]))[0].n : 0;
    console.log(`ROLLBACK ${APPLY ? 'APPLY' : 'DRY RUN'} of ${ROLLBACK}`);
    console.log(`  inserted by the apply, present now: journals ${present.journals}/${I.journals.length} (batch marker ${present.batchJournals}), documents ${present.documents}/${I.documents.length}, customers ${present.customers}/${I.customers.length}, suppliers ${present.suppliers}/${I.suppliers.length}, templates ${present.templates}/${I.templates.length}`);
    console.log(`  to restore from ${log.backup}: journals ${backup.journals.length} (${backup.journalLines.length} lines), documents ${backup.documents.length}, restamped invoices ${backup.updatedDocuments.length}; fingerprint to get back: ${backup.fingerprintBefore.hash}`);
    const problems = [
      ...(present.batchJournals !== present.journals ? [`${present.batchJournals - present.journals} journals carry the batch marker but are not in the log`] : []),
      ...(edited.length ? [`documents edited after the apply: ${edited.length} (${edited.slice(0, 10).join(', ')})`] : []),
      ...(editedJe.length ? [`journals changed after the apply: ${editedJe.length} (${editedJe.slice(0, 10).join(', ')})`] : []),
      ...(foreignJe.length ? [`journals posted on imported documents by someone else: ${foreignJe.slice(0, 10).join(', ')}`] : []),
      ...refs.map((r) => `points at imported rows: ${r}`),
      ...(custRefs ? [`${custRefs} other documents use the imported customers`] : []),
    ];
    for (const p of problems) console.log(`  REFUSE: ${p}`);
    if (!APPLY) { console.log(problems.length ? '\nDry run: rollback would be REFUSED.' : '\nDry run: rollback can run. Add --apply.'); return null; }
    if (problems.length) throw new Error('ROLLBACK REFUSED (see above)');
    if (ENV === 'prod' && !CONFIRM_PROD) throw new Error('--env prod needs --confirm-prod');
    locked = (await c.query(`select pg_try_advisory_lock(hashtext($1)) ok`, [LOCK_KEY])).rows[0].ok;
    if (!locked) throw new Error('another run holds the advisory lock');
    await c.query('BEGIN');
    await c.query(`SET LOCAL statement_timeout = 0`);
    await c.query(`SET LOCAL idle_in_transaction_session_timeout = 0`);
    await c.query(`SET LOCAL TimeZone = 'UTC'`);
    const del = async (sql: string, p: any[], want: number, what: string) => { const r = await c.query(sql, p); if (r.rowCount !== want) throw new Error(`${what}: ${r.rowCount} rows, expected ${want} (nothing committed)`); };
    await del(`delete from "JournalEntry" where "organizationId" = $1 and (id = any($2) or "createdBy" = $3)`, [ORG.id, I.journals, MARK], I.journals.length, 'journals');
    await del(`delete from "Document" where "organizationId" = $1 and id = any($2::uuid[])`, [ORG.id, I.documents], I.documents.length, 'documents');
    if (backup.updatedDocuments.length) {
      const r = await c.query(`update "Document" d set config = b.config, status = b.status, "updatedAt" = b."updatedAt", name = b.name, "listIssueDate" = b."listIssueDate", "listSearch" = b."listSearch",
          "listCustomerId" = b."listCustomerId", version = b.version from jsonb_populate_recordset(null::"Document", $1::jsonb) b where d.id = b.id`, [JSON.stringify(backup.updatedDocuments)]);
      if (r.rowCount !== backup.updatedDocuments.length) throw new Error('restamped invoices not all restored');
    }
    await del(`delete from "Customer" where "organizationId" = $1 and id = any($2::uuid[])`, [ORG.id, I.customers], I.customers.length, 'customers');
    await del(`delete from "Supplier" where "organizationId" = $1 and id = any($2::uuid[])`, [ORG.id, I.suppliers], I.suppliers.length, 'suppliers');
    await del(`delete from "DocumentTemplate" where "organizationId" = $1 and id = any($2::uuid[])`, [ORG.id, I.templates], I.templates.length, 'templates');
    step('batch rows deleted, restamped invoices restored');
    const restore = async (t: string, rows: any[]) => {
      for (const part of chunks(rows, 2000)) {
        const r = await c.query(`insert into "${t}" select * from jsonb_populate_recordset(null::"${t}", $1::jsonb)`, [JSON.stringify(part)]);
        if (r.rowCount !== part.length) throw new Error(`restore ${t}: ${r.rowCount} <> ${part.length}`);
      }
    };
    await restore('Document', backup.documents);
    for (const [t, rows] of Object.entries(backup.documentChildren || {})) if ((rows as any[]).length) await restore(t, rows as any[]);
    await restore('JournalEntry', backup.journals);
    await restore('JournalEntryLine', backup.journalLines);
    step(`backup rows restored: documents ${backup.documents.length}, journals ${backup.journals.length}, lines ${backup.journalLines.length}`);
    const fp = await fingerprint(c, ORG.id);
    if (fp.hash !== backup.fingerprintBefore.hash) {
      const diff = Object.keys(fp.tables).filter((k) => fp.tables[k].md5 !== backup.fingerprintBefore.tables[k].md5 || fp.tables[k].n !== backup.fingerprintBefore.tables[k].n);
      throw new Error(`fingerprint after rollback ${fp.hash} <> before apply ${backup.fingerprintBefore.hash} (tables ${diff.join(', ')}): nothing committed`);
    }
    const al = await actionLog(c, 'DELETE', 'journal', `ABSS history import (${ORG.label}) rolled back: ${I.journals.length} journals, ${I.documents.length} documents removed; ${backup.journals.length} journals and ${backup.documents.length} documents restored`, {
      phase: 'rollback', applyLog: path.basename(ROLLBACK!), journalsRemoved: I.journals.length, documentsRemoved: I.documents.length, journalsRestored: backup.journals.length, documentsRestored: backup.documents.length, invoicesRestored: backup.updatedDocuments.length,
    });
    await c.query('COMMIT');
    committed = true;
    step(`COMMIT: org fingerprint = pre-apply ${fp.hash}`);
    const rlog = path.join(OUT, `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.log.json`);
    fs.writeFileSync(rlog, JSON.stringify({ at: new Date().toISOString(), applyLog: ROLLBACK, fingerprint: fp, actionLog: al, timings }, null, 1));
    console.log(`\nROLLED BACK. Org fingerprint ${fp.hash} equals the pre-apply fingerprint. Log ${rlog}`);
    return { fp, timings };
  } catch (e) {
    if (!committed && APPLY) await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    if (locked) await c.query(`select pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]).catch(() => undefined);
    await c.end().catch(() => undefined);
  }
}

// ─────────────────────────────────────────────────────────── main
(async () => {
  if (!ORG) throw new Error(`--org must be one of: ${Object.keys(ORGS).join(', ')} (no other org is in scope)`);
  const url = connectionUrl();
  fs.mkdirSync(OUT, { recursive: true });
  if (ROLLBACK) { await doRollback(url); return; }
  const t0 = Date.now();
  const c = new Client({ connectionString: url.direct });
  await c.connect();
  let P: any;
  let before: any;
  let after: any;
  try {
    await c.query('SET default_transaction_read_only = on');
    await c.query('BEGIN TRANSACTION READ ONLY');
    before = await fingerprint(c, ORG.id);
    P = await buildPlan(c);
    after = await fingerprint(c, ORG.id);
    await c.query('ROLLBACK');
  } finally {
    await c.end();
  }
  const tPlan = Date.now() - t0;
  const planPath = one('--plan', path.join(OUT, 'plan.json'))!;
  const prior = APPLY && fs.existsSync(planPath) ? JSON.parse(fs.readFileSync(planPath, 'utf8')) : null;
  const at = new Date().toISOString();
  if (!APPLY) {
    const plan = writeOutputs(P, before, { mode: 'DRY RUN (read-only)', at, timings: { planMs: tPlan } });
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 1));
    const s = summary(P, plan, before, after);
    s.push('', `Outputs: ${OUT}`);
    fs.writeFileSync(path.join(OUT, 'summary.txt'), s.join('\n') + '\n');
    console.log(s.join('\n'));
    if (before.hash !== after.hash) process.exitCode = 4;
    return;
  }
  console.log(`${ORG.label}: APPLY (${ENV}, host ${url.host}) · plan ${P.planHash} · fingerprint ${before.hash} · TB ${P.tbGate.text}`);
  const res = await doApply(P, url, prior);
  const plan = writeOutputs(P, before, { mode: 'APPLIED', at, timings: { planMs: tPlan, ...res.timings } });
  fs.writeFileSync(path.join(OUT, `plan-applied-${at.replace(/[:.]/g, '-')}.json`), JSON.stringify(plan, null, 1));
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
