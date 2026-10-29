/**
 * SiteClock link (2026-10-30): create SiteClockConnection + DeliverySiteClockJob
 * on the DEV database. Dev runs per-org tenancy (platform / org_* schemas) and
 * `prisma db push` refuses it, so the tables are created here; both are platform
 * models (prisma/tenancy/platform.prisma), so the default schema is "platform".
 * Prod needs nothing: Render's build pushes schema.prisma (public).
 *
 *   npx ts-node --transpile-only scripts/_sc-link-dev-tables.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_sc-link-dev-tables.ts --apply    # runs it (IF NOT EXISTS)
 *   --schema=<name> to target another schema.
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const s = (process.argv.find((a) => a.startsWith('--schema='))?.split('=')[1] || 'platform').replace(/[^a-z0-9_]/gi, '');

const sql = (s: string) => [
  `CREATE TABLE IF NOT EXISTS "${s}"."SiteClockConnection" (
       "id" TEXT NOT NULL,
       "organizationId" TEXT NOT NULL,
       "baseUrl" TEXT NOT NULL,
       "siteclockCompanyId" TEXT NOT NULL,
       "apiKeyEnc" TEXT NOT NULL,
       "apiKeyLast4" TEXT NOT NULL,
       "enabled" BOOLEAN NOT NULL DEFAULT false,
       "defaultDurationMin" INTEGER NOT NULL DEFAULT 60,
       "lastOkAt" TIMESTAMP(3),
       "lastError" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
   
       CONSTRAINT "SiteClockConnection_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE TABLE IF NOT EXISTS "${s}"."DeliverySiteClockJob" (
       "id" TEXT NOT NULL,
       "organizationId" TEXT NOT NULL,
       "deliveryId" TEXT NOT NULL,
       "workerId" TEXT,
       "workerName" TEXT,
       "durationMin" INTEGER NOT NULL DEFAULT 60,
       "externalRef" TEXT NOT NULL,
       "generation" INTEGER NOT NULL DEFAULT 1,
       "siteclockJobId" TEXT,
       "siteRef" TEXT,
       "syncedHash" TEXT,
       "lastPushedStatus" TEXT,
       "syncState" TEXT NOT NULL DEFAULT 'PENDING',
       "attempts" INTEGER NOT NULL DEFAULT 0,
       "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "lastError" TEXT,
       "lastSyncedAt" TIMESTAMP(3),
       "alertedAt" TIMESTAMP(3),
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
   
       CONSTRAINT "DeliverySiteClockJob_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SiteClockConnection_organizationId_key" ON "${s}"."SiteClockConnection"("organizationId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DeliverySiteClockJob_deliveryId_key" ON "${s}"."DeliverySiteClockJob"("deliveryId")`,
  `CREATE INDEX IF NOT EXISTS "DeliverySiteClockJob_organizationId_idx" ON "${s}"."DeliverySiteClockJob"("organizationId")`,
  `CREATE INDEX IF NOT EXISTS "DeliverySiteClockJob_syncState_nextAttemptAt_idx" ON "${s}"."DeliverySiteClockJob"("syncState", "nextAttemptAt")`,
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
    const r = await c.query(`select table_name from information_schema.tables where table_schema = $1 and table_name in ('SiteClockConnection','DeliverySiteClockJob')`, [s]);
    console.log(
      `schema ${s}: ${r.rows
        .map((x) => x.table_name)
        .sort()
        .join(', ')}`,
    );
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
