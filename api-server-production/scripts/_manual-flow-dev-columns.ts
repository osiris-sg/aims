/**
 * Manual order flow (2026-11-12): add Order.statusDates in the DEV database.
 * Dev runs per-org tenancy and `prisma db push` refuses it, so the column is
 * added here: in org_wct (the only org schema whose .prisma carries it) and in
 * public, where schema.prisma's client reads Order. Prod needs nothing:
 * Render's build pushes schema.prisma (public), additively.
 *
 *   npx ts-node --transpile-only scripts/_manual-flow-dev-columns.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_manual-flow-dev-columns.ts --apply    # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const SCHEMAS = ['org_wct', 'public'];

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is not set');
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    for (const s of SCHEMAS) {
      const has = (await c.query(`select to_regclass($1) r`, [`"${s}"."Order"`])).rows[0].r;
      if (!has) {
        console.log(`-- ${s}."Order" does not exist, skipped`);
        continue;
      }
      const q = `ALTER TABLE "${s}"."Order" ADD COLUMN IF NOT EXISTS "statusDates" JSONB`;
      console.log(q + ';');
      if (apply) await c.query(q);
    }
    console.log(apply ? '\nApplied.' : '\n-- dry run; pass --apply to execute');
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
