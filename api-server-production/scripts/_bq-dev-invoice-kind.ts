/**
 * Round BQ: add the TradeExtractionKind value INVOICE on the DEV database (every schema that has the enum — dev runs
 * per-org tenancy and `prisma db push` refuses it). Prod needs nothing: Render's build pushes schema.prisma (public).
 *
 *   npx ts-node --transpile-only scripts/_bq-dev-invoice-kind.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_bq-dev-invoice-kind.ts --apply    # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is not set');
  if (prod && new URL(url).host === new URL(prod.replace(/["\r]/g, '')).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const schemas = (await c.query(`select n.nspname from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typname = 'TradeExtractionKind' order by 1`)).rows.map((r) => r.nspname as string);
    const stmts = schemas.map((s) => `ALTER TYPE "${s}"."TradeExtractionKind" ADD VALUE IF NOT EXISTS 'INVOICE'`);
    if (!apply) {
      for (const q of stmts) console.log(q + ';');
      console.log(`\n-- dry run (${schemas.length} schema(s): ${schemas.join(', ')}); pass --apply to execute`);
      return;
    }
    for (const q of stmts) await c.query(q);
    console.log(`applied on ${schemas.length} schema(s): ${schemas.join(', ')}`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
