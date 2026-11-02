/**
 * SiteClock job photos (2026-11-02): create JobPhoto and the inbound-key columns
 * on SiteClockConnection in the DEV database. Dev runs per-org tenancy and
 * `prisma db push` refuses it, so they are created here; both are platform
 * models (prisma/tenancy/platform.prisma), so the default schema is "platform".
 * Prod needs nothing: Render's build pushes schema.prisma (public), additively.
 *
 *   npx ts-node --transpile-only scripts/_job-photos-dev-tables.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_job-photos-dev-tables.ts --apply    # runs it (IF NOT EXISTS)
 *   --schema=<name> to target another schema.
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const s = (process.argv.find((a) => a.startsWith('--schema='))?.split('=')[1] || 'platform').replace(/[^a-z0-9_]/gi, '');

const sql = (s: string) => [
  `ALTER TABLE "${s}"."SiteClockConnection" ADD COLUMN IF NOT EXISTS "inboundKeyHash" TEXT`,
  `ALTER TABLE "${s}"."SiteClockConnection" ADD COLUMN IF NOT EXISTS "inboundKeyLast4" TEXT`,
  `ALTER TABLE "${s}"."SiteClockConnection" ADD COLUMN IF NOT EXISTS "inboundKeyCreatedAt" TIMESTAMP(3)`,
  `ALTER TABLE "${s}"."SiteClockConnection" ADD COLUMN IF NOT EXISTS "inboundKeyLastUsedAt" TIMESTAMP(3)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SiteClockConnection_inboundKeyHash_key" ON "${s}"."SiteClockConnection"("inboundKeyHash")`,
  `CREATE TABLE IF NOT EXISTS "${s}"."JobPhoto" (
       "id" TEXT NOT NULL,
       "organizationId" TEXT NOT NULL,
       "deliveryId" TEXT NOT NULL,
       "externalRef" TEXT,
       "source" TEXT NOT NULL DEFAULT 'siteclock',
       "sourcePhotoId" TEXT NOT NULL,
       "tag" TEXT NOT NULL,
       "note" TEXT,
       "takenAt" TIMESTAMP(3),
       "workerSourceId" TEXT,
       "workerName" TEXT,
       "fileKey" TEXT NOT NULL,
       "thumbKey" TEXT NOT NULL,
       "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
       "bytes" INTEGER NOT NULL,
       "width" INTEGER,
       "height" INTEGER,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "deletedAt" TIMESTAMP(3),
       "deletedBy" TEXT,
       "deletedByName" TEXT,

       CONSTRAINT "JobPhoto_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JobPhoto_organizationId_source_sourcePhotoId_key" ON "${s}"."JobPhoto"("organizationId", "source", "sourcePhotoId")`,
  `CREATE INDEX IF NOT EXISTS "JobPhoto_organizationId_deliveryId_idx" ON "${s}"."JobPhoto"("organizationId", "deliveryId")`,
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
  try {
    for (const q of stmts) await c.query(q);
    const t = await c.query(`select count(*)::int n from information_schema.tables where table_schema = $1 and table_name = 'JobPhoto'`, [s]);
    const cols = await c.query(`select count(*)::int n from information_schema.columns where table_schema = $1 and table_name = 'SiteClockConnection' and column_name like 'inboundKey%'`, [s]);
    console.log(`schema ${s}: JobPhoto table ${t.rows[0].n ? 'present' : 'MISSING'}, SiteClockConnection inbound-key columns ${cols.rows[0].n}/4`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
