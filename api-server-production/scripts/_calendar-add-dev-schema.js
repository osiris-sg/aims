// DEV ONLY (per-org tenancy blocks db push): the WCT calendar-add columns on every Delivery table + CalendarNote in public.
// Prod gets the same from Render's build (prisma db push). Idempotent.
const { Client } = require('pg');
(async () => {
  const url = process.env.DATABASE_URL;
  if (!url || /PROD/i.test(process.env.DB_LABEL || '')) throw new Error('dev only');
  const c = new Client({ connectionString: url });
  await c.connect();
  const schemas = (await c.query(`select table_schema from information_schema.tables where table_name = 'Delivery' order by 1`)).rows.map((r) => r.table_schema);
  for (const s of schemas) {
    await c.query(`ALTER TABLE "${s}"."Delivery" ADD COLUMN IF NOT EXISTS "ptwStatus" TEXT, ADD COLUMN IF NOT EXISTS "ptwRemark" TEXT, ADD COLUMN IF NOT EXISTS "crewWorkers" JSONB`);
  }
  await c.query(`CREATE TABLE IF NOT EXISTS "public"."CalendarNote" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "title" TEXT NOT NULL, "type" TEXT NOT NULL,
    "staffId" TEXT, "staffName" TEXT, "startDate" TEXT NOT NULL, "endDate" TEXT NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT true, "startTime" TEXT, "endTime" TEXT, "remark" TEXT,
    "createdById" TEXT, "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalendarNote_pkey" PRIMARY KEY ("id"))`);
  await c.query(`CREATE INDEX IF NOT EXISTS "CalendarNote_organizationId_startDate_idx" ON "public"."CalendarNote"("organizationId", "startDate")`);
  await c.query(`CREATE INDEX IF NOT EXISTS "CalendarNote_organizationId_endDate_idx" ON "public"."CalendarNote"("organizationId", "endDate")`);
  console.log(`Delivery columns in ${schemas.length} schema(s); CalendarNote ready`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
