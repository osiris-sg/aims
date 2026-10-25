/** Round AK — create the LME feed tables in the DEV public schema (dev runs per-org tenancy; `db push` fails there). Prod gets them from Render's build. */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const SQL = [
  `CREATE TABLE IF NOT EXISTS "public"."LmeQuote" ("id" TEXT NOT NULL, "metal" TEXT NOT NULL, "date" TEXT NOT NULL, "cash" DECIMAL(12,2) NOT NULL, "threeMonth" DECIMAL(12,2), "stock" INTEGER, "source" TEXT NOT NULL, "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LmeQuote_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "public"."LmeMonthly" ("id" TEXT NOT NULL, "metal" TEXT NOT NULL, "month" TEXT NOT NULL, "cashAvg" DECIMAL(12,2) NOT NULL, "days" INTEGER NOT NULL, "final" BOOLEAN NOT NULL DEFAULT false, "publishedAvg" DECIMAL(12,2), "source" TEXT NOT NULL, "finalizedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LmeMonthly_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "public"."LmeFetchRun" ("id" TEXT NOT NULL, "source" TEXT NOT NULL, "trigger" TEXT NOT NULL, "ok" BOOLEAN NOT NULL, "rows" INTEGER NOT NULL DEFAULT 0, "error" TEXT, "summary" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "LmeFetchRun_pkey" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LmeQuote_metal_date_key" ON "public"."LmeQuote"("metal", "date")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LmeMonthly_metal_month_key" ON "public"."LmeMonthly"("metal", "month")`,
  `CREATE INDEX IF NOT EXISTS "LmeFetchRun_source_createdAt_idx" ON "public"."LmeFetchRun"("source", "createdAt")`,
];
(async () => {
  if (/prod/i.test(process.env.DATABASE_URL ?? '') || process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('refusing: this is for the dev DB');
  for (const s of SQL) await p.$executeRawUnsafe(s);
  console.log('dev LME tables ready');
  await p.$disconnect();
})();
