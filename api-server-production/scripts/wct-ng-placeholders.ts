/**
 * WCT (S) "(NG)" $1 placeholder invoices: SELECTION DRY RUN (read only, 2026-11-25).
 *
 * The owner's rule: WCT (S), ERP-imported, "(NG)" anywhere in the subject, and total = $1.00 OR $1 + old GST
 * ($1.07 / $1.08). Expected: 3,044 invoices, $3,044.15 (2,789 paid, 255 unpaid).
 * Also listed, not selected: the "(NG)" invoices over that (real) and the "(NG)" invoices at $0.00.
 *
 *   npx ts-node --transpile-only scripts/wct-ng-placeholders.ts [--csv <dir>]
 *
 * Reads PROD_DATABASE_URL from .env (never printed). Read-only session. Writes nothing to the database.
 * What APPLY does to the selection is the owner's decision; this script only selects and reports.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { amountPaidOf, grossOf, outstandingOf } from '../src/common/document-money';
import { erpImportOf } from '../src/common/erp-import';
import { ownSubjectOf } from '../src/documents/list-subject';

const WCT_S = '5c700000-0000-4000-8000-5c7000000001';
const PLACEHOLDER_TOTALS = [1.0, 1.07, 1.08];
const INVOICE_TYPES = ['INVOICE', 'TI', 'TI2', 'TAX_INVOICE', 'INV'];
const csvDir = (() => {
  const i = process.argv.indexOf('--csv');
  return i > 0 ? process.argv[i + 1] : null;
})();

function prodUrl(): string {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('PROD_DATABASE_URL='));
  if (!line) throw new Error('PROD_DATABASE_URL missing in .env');
  return line.slice('PROD_DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const isPlaceholderTotal = (g: number) => PLACEHOLDER_TOTALS.some((t) => Math.abs(g - t) < 0.005);

type Row = { id: string; name: string; subject: string; gross: number; paid: number; owed: number; status: string; date: string; customer: string };

(async () => {
  const c = new Client({ connectionString: prodUrl() });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const res = await c.query(
    `SELECT d.id, d.name, d.status::text AS status, d.config, d."createdAt", cu.name AS customer
       FROM "Document" d LEFT JOIN "Customer" cu ON cu.id = d."customerId"
      WHERE d."organizationId" = $1 AND upper(d.type::text) = ANY($2) AND d.config ? 'erpImport'
        AND (coalesce(d.config->>'subject','') ILIKE '%(NG)%' OR coalesce(d.config->'documentInfo'->>'subject','') ILIKE '%(NG)%')`,
    [WCT_S, INVOICE_TYPES],
  ).catch(async (e) => {
    // Some schemas keep the customer only in config: retry without the join.
    if (!/customerId/.test(e.message)) throw e;
    return c.query(
      `SELECT d.id, d.name, d.status::text AS status, d.config, d."createdAt", NULL AS customer FROM "Document" d
        WHERE d."organizationId" = $1 AND upper(d.type::text) = ANY($2) AND d.config ? 'erpImport'
          AND (coalesce(d.config->>'subject','') ILIKE '%(NG)%' OR coalesce(d.config->'documentInfo'->>'subject','') ILIKE '%(NG)%')`,
      [WCT_S, INVOICE_TYPES],
    );
  });

  const sel: Row[] = [];
  const real: Row[] = [];
  const zero: Row[] = [];
  const other: Row[] = [];
  for (const d of res.rows) {
    if (!erpImportOf(d.config)) continue;
    const subject = ownSubjectOf(d.config) ?? '';
    if (!/\(NG\)/i.test(subject)) continue;
    const gross = r2(Number(grossOf(d.config)) || 0);
    const owedRaw = outstandingOf(d.config);
    const owed = r2(owedRaw == null ? gross : Number(owedRaw) || 0);
    const paid = r2(Number(amountPaidOf(d.config)) || 0);
    const cfg = d.config || {};
    const row: Row = {
      id: d.id,
      name: d.name ?? '',
      subject,
      gross,
      paid,
      owed,
      status: d.status,
      date: String(cfg.documentInfo?.date ?? cfg.date ?? '').slice(0, 10),
      customer: d.customer ?? cfg.customer?.name ?? cfg.customerName ?? '',
    };
    if (isPlaceholderTotal(gross)) sel.push(row);
    else if (Math.abs(gross) < 0.005) zero.push(row);
    else if (gross > 1.08) real.push(row);
    else other.push(row);
  }

  // What the selection touches (for whatever APPLY turns out to be).
  const ids = sel.map((r) => r.id);
  const jr = ids.length
    ? await c.query(`SELECT count(*)::int n FROM "JournalEntry" WHERE "sourceDocumentId" = ANY($1) AND status::text <> 'VOID'`, [ids]).catch(() => ({ rows: [{ n: 'n/a' }] }))
    : { rows: [{ n: 0 }] };
  await c.end();

  const unpaid = sel.filter((r) => r.owed > 0.005);
  const paidRows = sel.filter((r) => r.owed <= 0.005);
  const sum = (rs: Row[], k: 'gross' | 'owed') => r2(rs.reduce((s, r) => s + r[k], 0));
  const byTotal = new Map<string, number>();
  for (const r of sel) byTotal.set(r.gross.toFixed(2), (byTotal.get(r.gross.toFixed(2)) ?? 0) + 1);
  const notAtStart = sel.filter((r) => !/^\s*\(NG\)/i.test(r.subject));

  console.log('WCT (S) "(NG)" $1 placeholder invoices: SELECTION DRY RUN (read only, nothing written)');
  console.log(`Rule: WCT (S), ERP-imported, "(NG)" anywhere in the subject, total $1.00 / $1.07 / $1.08`);
  console.log(`Selected: ${sel.length} invoices, total $${sum(sel, 'gross').toFixed(2)}`);
  console.log(`  by total: ${[...byTotal.entries()].sort().map(([t, n]) => `$${t} x ${n}`).join(', ')}`);
  console.log(`  paid: ${paidRows.length} ($${sum(paidRows, 'gross').toFixed(2)})   unpaid: ${unpaid.length} (owed $${sum(unpaid, 'owed').toFixed(2)})`);
  console.log(`  "(NG)" not at the start of the subject: ${notAtStart.length}: ${notAtStart.map((r) => r.name).join(', ')}`);
  console.log(`  at $1.07 / $1.08: ${sel.filter((r) => r.gross > 1.005).map((r) => `${r.name} $${r.gross.toFixed(2)}`).join(', ')}`);
  console.log(`  live (non-VOID) journals on the selection: ${jr.rows[0].n}`);
  console.log(`KEPT, real "(NG)" invoices over $1.08: ${real.length}`);
  for (const r of real) console.log(`  ${r.name.padEnd(14)} $${r.gross.toFixed(2).padStart(10)}  ${r.date}  ${r.customer}  | ${r.subject.slice(0, 60)}`);
  console.log(`LISTED ONLY, "(NG)" invoices at $0.00: ${zero.length} (not selected)`);
  for (const r of zero.slice(0, 10)) console.log(`  ${r.name.padEnd(14)} ${r.date}  ${r.customer}  | ${r.subject.slice(0, 60)}`);
  if (other.length) {
    console.log(`OTHER "(NG)" amounts not covered by the rule: ${other.length}`);
    for (const r of other) console.log(`  ${r.name} $${r.gross.toFixed(2)}`);
  }
  if (csvDir) {
    fs.mkdirSync(csvDir, { recursive: true });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const write = (f: string, rs: Row[]) =>
      fs.writeFileSync(path.join(csvDir, f), ['number,date,customer,subject,total,paid,owed,status', ...rs.map((r) => [r.name, r.date, r.customer, r.subject, r.gross.toFixed(2), r.paid.toFixed(2), r.owed.toFixed(2), r.status].map(esc).join(','))].join('\n'));
    write('ng-placeholders-selected.csv', sel);
    write('ng-real-kept.csv', real);
    write('ng-zero-listed.csv', zero);
    console.log(`CSVs: ${csvDir}`);
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
