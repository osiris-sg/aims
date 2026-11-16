/**
 * WCT vehicle LOG BOOK (2026-11-16): create VehicleLogEntry and the three new
 * Vehicle expiry columns in the DEV database (per-org tenancy: `prisma db push`
 * refuses it). Platform models, so the schema is "platform". Prod needs nothing:
 * Render's build pushes schema.prisma (public) additively (one new table with
 * plain indexes, three nullable columns).
 *
 *   npx ts-node --transpile-only scripts/_vehicles-logbook-dev-tables.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_vehicles-logbook-dev-tables.ts --apply    # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const s = (process.argv.find((a) => a.startsWith('--schema='))?.split('=')[1] || 'platform').replace(/[^a-z0-9_]/gi, '');

const sql = (s: string) => [
  `ALTER TABLE "${s}"."Vehicle" ADD COLUMN IF NOT EXISTS "roadTaxExpiry" TIMESTAMP(3)`,
  `ALTER TABLE "${s}"."Vehicle" ADD COLUMN IF NOT EXISTS "insuranceExpiry" TIMESTAMP(3)`,
  `ALTER TABLE "${s}"."Vehicle" ADD COLUMN IF NOT EXISTS "inspectionExpiry" TIMESTAMP(3)`,
  `CREATE TABLE IF NOT EXISTS "${s}"."VehicleLogEntry" (
       "id" TEXT NOT NULL,
       "organizationId" TEXT NOT NULL,
       "vehicleId" TEXT NOT NULL,
       "date" TIMESTAMP(3) NOT NULL,
       "type" TEXT NOT NULL,
       "description" TEXT,
       "mileage" INTEGER,
       "amount" DECIMAL(12,2),
       "attachment" JSONB,
       "driverUserId" TEXT,
       "driverName" TEXT,
       "vendor" TEXT,
       "renewalKind" TEXT,
       "renewalExpiry" TIMESTAMP(3),
       "repairApprovedBy" TEXT,
       "repairApprovedById" TEXT,
       "repairApprovedAt" TIMESTAMP(3),
       "repairUnlocks" JSONB,
       "sourceUsageId" TEXT,
       "deletedAt" TIMESTAMP(3),
       "deletedBy" TEXT,
       "createdBy" TEXT,
       "createdByName" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "VehicleLogEntry_pkey" PRIMARY KEY ("id"),
       CONSTRAINT "VehicleLogEntry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "${s}"."Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS "VehicleLogEntry_organizationId_vehicleId_date_idx" ON "${s}"."VehicleLogEntry"("organizationId", "vehicleId", "date")`,
  `CREATE INDEX IF NOT EXISTS "VehicleLogEntry_sourceUsageId_idx" ON "${s}"."VehicleLogEntry"("sourceUsageId")`,
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
