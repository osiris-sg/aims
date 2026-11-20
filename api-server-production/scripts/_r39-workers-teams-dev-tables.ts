/**
 * Round 39 (WCT, 2026-11-20): the Workers & Teams tables on the DEV database only.
 * Dev runs per-org tenancy and `npm run db:push` fails there (P4002), so the new tables are
 * created in the public schema by hand (same columns / indexes as prisma/schema.prisma; models
 * missing from platform/org schemas route to the public client). Prod gets them from Render's
 * build (nest build + prisma db push: three new tables, nothing else changes).
 *   npx ts-node --transpile-only scripts/_r39-workers-teams-dev-tables.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: __dirname + '/../.env' });
import { Client } from 'pg';

const SQL = `
CREATE TABLE IF NOT EXISTS "public"."Worker" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL, "phone" TEXT, "role" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true, "siteclockId" TEXT, "siteclockData" JSONB, "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Worker_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "public"."WorkerTeam" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "siteclockId" TEXT, "siteclockData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerTeam_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "public"."WorkerTeamMember" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "teamId" TEXT NOT NULL, "workerId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkerTeamMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkerTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."WorkerTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkerTeamMember_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "public"."Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX IF NOT EXISTS "Worker_organizationId_idx" ON "public"."Worker"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "Worker_organizationId_siteclockId_key" ON "public"."Worker"("organizationId", "siteclockId");
CREATE INDEX IF NOT EXISTS "WorkerTeam_organizationId_idx" ON "public"."WorkerTeam"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkerTeam_organizationId_siteclockId_key" ON "public"."WorkerTeam"("organizationId", "siteclockId");
CREATE INDEX IF NOT EXISTS "WorkerTeamMember_organizationId_idx" ON "public"."WorkerTeamMember"("organizationId");
CREATE INDEX IF NOT EXISTS "WorkerTeamMember_workerId_idx" ON "public"."WorkerTeamMember"("workerId");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkerTeamMember_teamId_workerId_key" ON "public"."WorkerTeamMember"("teamId", "workerId");
`;

(async () => {
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL (dev) is not set');
  if (process.env.PROD_DATABASE_URL && url === process.env.PROD_DATABASE_URL) throw new Error('Refusing: DATABASE_URL is the prod database');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(SQL);
    const r = await c.query(`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('Worker','WorkerTeam','WorkerTeamMember') order by 1`);
    console.log('dev tables:', r.rows.map((x) => x.table_name).join(', '));
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
