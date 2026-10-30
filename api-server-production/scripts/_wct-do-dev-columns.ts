/**
 * WCT real DO numbers (2026-10-30): add DeliverySiteClockJob.syncedDoNumber on
 * the DEV database. Dev runs per-org tenancy and `prisma db push` refuses it
 * (see _sc-link-dev-tables.ts); the table is a platform model. Prod needs
 * nothing: Render's build pushes schema.prisma (public).
 *
 *   npx ts-node --transpile-only scripts/_wct-do-dev-columns.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_wct-do-dev-columns.ts --apply    # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const s = (process.argv.find((a) => a.startsWith('--schema='))?.split('=')[1] || 'platform').replace(/[^a-z0-9_]/gi, '');
const stmts = [`ALTER TABLE "${s}"."DeliverySiteClockJob" ADD COLUMN IF NOT EXISTS "syncedDoNumber" TEXT`];

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is not set');
  if (prod && new URL(url).host === new URL(prod.replace(/["\r]/g, '')).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  if (!apply) {
    for (const q of stmts) console.log(q + ';');
    console.log(`\n-- dry run (schema ${s}); pass --apply to execute`);
    return;
  }
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    for (const q of stmts) await c.query(q);
    const r = await c.query(`select column_name from information_schema.columns where table_schema = $1 and table_name = 'DeliverySiteClockJob' and column_name = 'syncedDoNumber'`, [s]);
    console.log(`schema ${s}: syncedDoNumber ${r.rows.length ? 'present' : 'MISSING'}`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
