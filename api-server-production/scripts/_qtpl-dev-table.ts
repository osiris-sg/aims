/**
 * Quotation templates (2026-11-18): create the QuotationTemplate table in the DEV
 * database (per-org tenancy: `prisma db push` refuses it). Platform model, so the
 * default schema is "platform"; --schema=public also creates it in public (the
 * router sends a model it does not know to public until the platform client is
 * regenerated: `npx prisma generate --schema prisma/tenancy/platform.prisma`).
 * Prod needs nothing: Render's build pushes schema.prisma (one new table, plain
 * index, no relation).
 *
 *   npx ts-node --transpile-only scripts/_qtpl-dev-table.ts                    # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_qtpl-dev-table.ts --apply            # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const s = (process.argv.find((a) => a.startsWith('--schema='))?.split('=')[1] || 'platform').replace(/[^a-z0-9_]/gi, '');

const sql = (s: string) => [
  `CREATE TABLE IF NOT EXISTS "${s}"."QuotationTemplate" (
       "id" TEXT NOT NULL,
       "organizationId" TEXT NOT NULL,
       "name" TEXT NOT NULL,
       "lines" JSONB NOT NULL,
       "subject" TEXT,
       "category" TEXT,
       "termsAndConditions" TEXT,
       "hiddenAt" TIMESTAMP(3),
       "hiddenBy" TEXT,
       "createdBy" TEXT,
       "createdByName" TEXT,
       "updatedBy" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "QuotationTemplate_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "QuotationTemplate_organizationId_hiddenAt_idx" ON "${s}"."QuotationTemplate"("organizationId", "hiddenAt")`,
];

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is not set');
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  const stmts = sql(s);
  if (!apply) {
    for (const q of stmts) console.log(q + ';');
    console.log(`\n-- dry run (schema ${s}); pass --apply to execute`);
    return;
  }
  const c = new Client({ connectionString: url });
  await c.connect();
  for (const q of stmts) await c.query(q);
  await c.end();
  console.log(`applied ${stmts.length} statements in schema ${s}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
