/**
 * WCT Vehicles (2026-11-12): create Vehicle and VehicleUsage in the DEV
 * database. Dev runs per-org tenancy and `prisma db push` refuses it, so they
 * are created here; both are platform models (prisma/tenancy/platform.prisma),
 * so the schema is "platform". Prod needs nothing: Render's build pushes
 * schema.prisma (public), additively (two new tables, plain indexes).
 *
 *   npx ts-node --transpile-only scripts/_vehicles-dev-tables.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_vehicles-dev-tables.ts --apply    # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const s = (process.argv.find((a) => a.startsWith('--schema='))?.split('=')[1] || 'platform').replace(/[^a-z0-9_]/gi, '');

const sql = (s: string) => [
  `CREATE TABLE IF NOT EXISTS "${s}"."Vehicle" (
       "id" TEXT NOT NULL,
       "organizationId" TEXT NOT NULL,
       "vehicleNo" TEXT NOT NULL,
       "model" TEXT,
       "coeExpiry" TIMESTAMP(3),
       "lifespanExpiry" TIMESTAMP(3),
       "fixedAssetId" TEXT,
       "notes" TEXT,
       "archivedAt" TIMESTAMP(3),
       "createdBy" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "Vehicle_organizationId_idx" ON "${s}"."Vehicle"("organizationId")`,
  `CREATE TABLE IF NOT EXISTS "${s}"."VehicleUsage" (
       "id" TEXT NOT NULL,
       "organizationId" TEXT NOT NULL,
       "vehicleId" TEXT NOT NULL,
       "driverUserId" TEXT,
       "driverName" TEXT NOT NULL,
       "startDate" TIMESTAMP(3) NOT NULL,
       "startMileage" INTEGER NOT NULL,
       "endDate" TIMESTAMP(3),
       "endMileage" INTEGER,
       "repairDetails" TEXT,
       "repairLoggedAt" TIMESTAMP(3),
       "repairApprovedBy" TEXT,
       "repairApprovedById" TEXT,
       "repairApprovedAt" TIMESTAMP(3),
       "repairUnlocks" JSONB,
       "createdBy" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "VehicleUsage_pkey" PRIMARY KEY ("id"),
       CONSTRAINT "VehicleUsage_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "${s}"."Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS "VehicleUsage_organizationId_vehicleId_idx" ON "${s}"."VehicleUsage"("organizationId", "vehicleId")`,
  `CREATE INDEX IF NOT EXISTS "VehicleUsage_vehicleId_endDate_idx" ON "${s}"."VehicleUsage"("vehicleId", "endDate")`,
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
    const t = await c.query(`select table_name from information_schema.tables where table_schema = $1 and table_name in ('Vehicle','VehicleUsage') order by 1`, [s]);
    console.log(`OK: ${t.rows.map((r) => r.table_name).join(', ')} in ${s}`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
