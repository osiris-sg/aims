/**
 * Rehearsal set-up for scripts/wct-abss-history.ts (2026-11-26): copies ONE org (WCT Racking or YMM) READ-ONLY from
 * a source database (prod) into a throwaway LOCAL Postgres that already has the Prisma schema (prisma db push), then
 * installs the same plain-SQL triggers prod has: aims_je_guard + aims_doc_delete_guard through the repo installer
 * (scripts/journal-guards.ts, run on node-pg via scripts/lib/pg-prisma-shim.js), and aims_inv_number_guard +
 * aims_doc_list_keys copied from the source's own function / trigger definitions. Prints the org fingerprint on both
 * sides (they differ only where a foreign key to a table not copied is nulled, which is listed).
 *
 *   cd api-server-production
 *   createdb -h localhost -p 5433 abss_rehearsal
 *   DATABASE_URL=postgresql://…@localhost:5433/abss_rehearsal npx prisma db push --skip-generate
 *   SOURCE_URL=<prod, read-only> TARGET_URL=postgresql://…@localhost:5433/abss_rehearsal \
 *     NODE_PATH=$PWD/node_modules npx ts-node --transpile-only scripts/wct-abss-history-rehearsal.ts --org ymm|racking [--replace]
 * The source session is read-only (default_transaction_read_only); the target must be localhost. Never prints a URL.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Client, types } from 'pg';

types.setTypeParser(1700, (v) => Number(v));
const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ORGS: Record<string, string> = { racking: '5c700000-0000-4000-8000-5c7000000002', ymm: '5c700000-0000-4000-8000-5c7000000003' };
const ORG = ORGS[one('--org', '')!];
const REPLACE = argv.includes('--replace');

// table, where (org scope), foreign keys to tables NOT copied (nulled, counted)
const TABLES: Array<[string, string, string[]]> = [
  ['Organization', `id = $1`, []],
  ['OrganizationUIConfig', `"organizationId" = $1`, []],
  ['AccountingSetting', `"organizationId" = $1`, []],
  ['ChartOfAccount', `"organizationId" = $1`, []],
  ['DocumentTemplate', `"organizationId" = $1`, []],
  ['OrganizationActiveTemplate', `"organizationId" = $1`, []],
  ['Customer', `"organizationId" = $1`, ['salesmanId']],
  ['Supplier', `"organizationId" = $1`, []],
  ['Document', `"organizationId" = $1`, ['projectId', 'projectDeploymentId']],
  ['DocumentItem', `"documentId" in (select id from "Document" where "organizationId" = $1)`, ['inventoryId', 'assetId']],
  ['JournalEntry', `"organizationId" = $1`, []],
  ['JournalEntryLine', `"journalEntryId" in (select id from "JournalEntry" where "organizationId" = $1)`, ['costCenterId']],
  ['Payment', `"organizationId" = $1`, []],
  ['BillPayment', `"organizationId" = $1`, []],
];

(async () => {
  if (!ORG) throw new Error('--org racking|ymm');
  const src = process.env.SOURCE_URL;
  const dst = process.env.TARGET_URL;
  if (!src || !dst) throw new Error('SOURCE_URL and TARGET_URL are required');
  const th = new URL(dst).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(th) || /neon\.tech/.test(dst)) throw new Error('TARGET_URL must be a localhost database');
  if (new URL(src).hostname === th) throw new Error('source and target are the same host');
  const S = new Client({ connectionString: src.replace('-pooler.', '.') });
  const T = new Client({ connectionString: dst });
  await S.connect();
  await T.connect();
  await S.query('SET default_transaction_read_only = on');
  try {
    const existing = (await T.query(`select count(*)::int n from "Organization" where id = $1`, [ORG])).rows[0].n;
    if (existing && !REPLACE) throw new Error('the org is already in the target database (pass --replace to drop and copy it again)');
    await T.query('BEGIN');
    if (existing) {
      for (const [t, where] of [...TABLES].reverse()) await T.query(`delete from "${t}" where ${where}`, [ORG]);
    }
    const nulled: Record<string, number> = {};
    for (const [t, where, fks] of TABLES) {
      const rows = (await S.query(`select row_to_json(x)::text j from "${t}" x where ${where}`, [ORG])).rows.map((r: any) => JSON.parse(r.j));
      for (const r of rows) for (const fk of fks) if (r[fk] !== null && r[fk] !== undefined) { r[fk] = null; nulled[`${t}.${fk}`] = (nulled[`${t}.${fk}`] || 0) + 1; }
      for (let i = 0; i < rows.length; i += 2000) {
        const part = rows.slice(i, i + 2000);
        await T.query(`insert into "${t}" select * from jsonb_populate_recordset(null::"${t}", $1::jsonb)`, [JSON.stringify(part)]);
      }
      console.log(`  ${t}: ${rows.length}`);
    }
    await T.query('COMMIT');
    console.log(`nulled foreign keys to tables not copied: ${JSON.stringify(nulled)}`);
    // triggers prod has, copied from the source's own definitions (aims_inv_number_guard, aims_doc_list_keys)
    const defs = (await S.query(
      `select p.proname::text fn, pg_get_functiondef(p.oid) fdef, pg_get_triggerdef(t.oid) tdef, t.tgname::text tg
         from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal and t.tgname in ('aims_inv_number_guard', 'aims_doc_list_keys')`,
    )).rows;
    for (const d of defs) {
      await T.query(d.fdef);
      await T.query(`drop trigger if exists ${d.tg} on "Document"`);
      await T.query(d.tdef);
      console.log(`  trigger ${d.tg} installed (source definition)`);
    }
  } finally {
    await S.end();
    await T.end();
  }
  // the journal guards through the repo installer (node-pg shim: the installer itself speaks Neon's WebSocket driver)
  const env = path.join(os.tmpdir(), `abss-rehearsal-${process.pid}.env`);
  fs.writeFileSync(env, `DATABASE_URL="${dst}"\n`, { mode: 0o600 });
  try {
    const out = execFileSync('node', ['-r', path.join(__dirname, 'lib/pg-prisma-shim.js'), '-r', 'ts-node/register/transpile-only', path.join(__dirname, 'journal-guards.ts'), 'apply', env], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: dst } });
    process.stdout.write(out);
    const audit = execFileSync('node', ['-r', path.join(__dirname, 'lib/pg-prisma-shim.js'), '-r', 'ts-node/register/transpile-only', path.join(__dirname, 'journal-guards.ts'), 'audit', env], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: dst } });
    process.stdout.write(audit);
  } finally {
    fs.unlinkSync(env);
  }
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
