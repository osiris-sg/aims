/**
 * Round AY part 2: add TradeStep.dueAt / dueSetById / dueSetByName / dueSetAt on the DEV database (every schema that
 * has a "TradeStep" table — dev runs per-org tenancy and `prisma db push` refuses it). Prod needs nothing: Render's
 * build pushes schema.prisma (public).
 *
 *   npx ts-node --transpile-only scripts/_ay-dev-due-columns.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_ay-dev-due-columns.ts --apply    # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const cols = [
  ['dueAt', 'TIMESTAMP(3)'],
  ['dueSetById', 'TEXT'],
  ['dueSetByName', 'TEXT'],
  ['dueSetAt', 'TIMESTAMP(3)'],
];

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is not set');
  if (prod && new URL(url).host === new URL(prod.replace(/["\r]/g, '')).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const schemas = (await c.query(`select table_schema from information_schema.tables where table_name = 'TradeStep' order by 1`)).rows.map((r) => r.table_schema as string);
    const stmts = schemas.flatMap((s) => cols.map(([n, t]) => `ALTER TABLE "${s}"."TradeStep" ADD COLUMN IF NOT EXISTS "${n}" ${t}`));
    if (!apply) {
      for (const q of stmts) console.log(q + ';');
      console.log(`\n-- dry run (${schemas.length} schema(s): ${schemas.join(', ')}); pass --apply to execute`);
      return;
    }
    for (const q of stmts) await c.query(q);
    for (const s of schemas) {
      const r = await c.query(`select count(*)::int n from information_schema.columns where table_schema = $1 and table_name = 'TradeStep' and column_name = any($2)`, [s, cols.map((x) => x[0])]);
      console.log(`schema ${s}: ${r.rows[0].n}/${cols.length} due columns present`);
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
