/**
 * WCT customer import follow-up (2026-11): add Customer.uen + Customer.externalRef.
 * Additive and nullable (ADD COLUMN IF NOT EXISTS) — nothing existing changes.
 * DRY RUN by default: prints the SQL and which schemas already have the columns.
 *
 *   # dev (per-org tenancy: every schema with a Customer table; db push refuses it)
 *   npx ts-node --transpile-only scripts/_wct-customer-uen-columns.ts [--apply]
 *   # prod (public schema only; Render's build would push the same columns from schema.prisma)
 *   DATABASE_URL=<prod> npx ts-node --transpile-only scripts/_wct-customer-uen-columns.ts --prod [--apply --confirm-prod]
 */
import 'dotenv/config';
import { Client } from 'pg';

const has = (f: string) => process.argv.includes(`--${f}`);
const COLUMNS = ['uen', 'externalRef'];

(async () => {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is not set');
  const prodUrl = (process.env.PROD_DATABASE_URL || '').replace(/["'\r\s]/g, '');
  const isProd = !!prodUrl && new URL(url).hostname.replace('-pooler', '') === new URL(prodUrl).hostname.replace('-pooler', '');
  if (has('prod') !== isProd) throw new Error(isProd ? 'DATABASE_URL is prod: pass --prod' : '--prod given but DATABASE_URL is not the prod database');
  if (has('apply') && isProd && !has('confirm-prod')) throw new Error('--apply on prod needs --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const all = (await c.query(`select table_schema from information_schema.tables where table_name = 'Customer' order by 1`)).rows.map((r) => r.table_schema as string);
    const schemas = isProd ? all.filter((s) => s === 'public') : all;
    const present = (await c.query(`select table_schema, column_name from information_schema.columns where table_name = 'Customer' and column_name = any($1)`, [COLUMNS])).rows;
    const stmts = schemas.flatMap((s) =>
      COLUMNS.filter((col) => !present.some((p) => p.table_schema === s && p.column_name === col)).map((col) => `ALTER TABLE "${s}"."Customer" ADD COLUMN IF NOT EXISTS "${col}" TEXT`),
    );
    console.log(`${isProd ? 'PROD' : 'dev'}: ${schemas.length} schema(s) with Customer: ${schemas.join(', ')}`);
    if (!stmts.length) return console.log('nothing to do: uen + externalRef already present everywhere');
    for (const q of stmts) console.log(q + ';');
    if (!has('apply')) return console.log(`\n-- dry run: ${stmts.length} statement(s); pass --apply to execute`);
    await c.query('BEGIN');
    for (const q of stmts) await c.query(q);
    await c.query('COMMIT');
    console.log(`WRITE ${stmts.length} column(s) added`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
