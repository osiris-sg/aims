/**
 * Round AZ: add OrganizationMemberProfile.uiLang on the DEV database (every schema that has the table — dev runs
 * per-org tenancy and `prisma db push` refuses it). Prod needs nothing: Render's build pushes schema.prisma (public).
 *
 *   npx ts-node --transpile-only scripts/_az-dev-uilang-column.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_az-dev-uilang-column.ts --apply    # runs it (IF NOT EXISTS)
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
    const schemas = (await c.query(`select table_schema from information_schema.tables where table_name = 'OrganizationMemberProfile' order by 1`)).rows.map((r) => r.table_schema as string);
    const stmts = schemas.map((s) => `ALTER TABLE "${s}"."OrganizationMemberProfile" ADD COLUMN IF NOT EXISTS "uiLang" TEXT`);
    if (!apply) {
      for (const q of stmts) console.log(q + ';');
      console.log(`\n-- dry run (${schemas.length} schema(s): ${schemas.join(', ')}); pass --apply to execute`);
      return;
    }
    for (const q of stmts) await c.query(q);
    console.log(`uiLang present in: ${schemas.join(', ')}`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
