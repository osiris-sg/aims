/** Round AR — DEV only: create TradeIssue in the dev DB's public schema (db push fails on the per-org
 * dev layout). Prod gets them from Render's build (prisma db push). Refuses the prod URL. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
(async () => {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('dev only');
  const p = new PrismaClient();
  const sql = [
    `CREATE TABLE IF NOT EXISTS "public"."TradeIssue" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), "organizationId" TEXT NOT NULL, "title" TEXT NOT NULL, "summaryEn" TEXT, "summaryJa" TEXT, "customerId" TEXT, "supplierId" TEXT, "orderIds" TEXT[] DEFAULT ARRAY[]::TEXT[], "shipmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[], "emailLogIds" TEXT[] DEFAULT ARRAY[]::TEXT[], "docTypes" TEXT[] DEFAULT ARRAY[]::TEXT[], "effectiveFrom" TEXT, "status" TEXT NOT NULL DEFAULT 'OPEN', "resolvedAt" TIMESTAMP(3), "resolvedByName" TEXT, "createdById" TEXT, "createdByName" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "TradeIssue_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "TradeIssue_organizationId_status_idx" ON "public"."TradeIssue"("organizationId", "status")`,
    `CREATE INDEX IF NOT EXISTS "TradeIssue_organizationId_customerId_idx" ON "public"."TradeIssue"("organizationId", "customerId")`,
    `CREATE INDEX IF NOT EXISTS "TradeIssue_organizationId_supplierId_idx" ON "public"."TradeIssue"("organizationId", "supplierId")`,
  ];
  for (const s of sql) await p.$executeRawUnsafe(s);
  const r: any[] = await p.$queryRawUnsafe(`select table_name from information_schema.tables where table_schema='public' and table_name in ('TradeIssue')`);
  console.log('dev tables:', r.map((x) => x.table_name).join(', '));
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
