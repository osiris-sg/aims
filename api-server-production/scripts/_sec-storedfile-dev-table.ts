/** Security 2026-11-24: create StoredFile in the DEV public schema (dev runs per-org tenancy; `db push` fails there). Prod gets it from Render's build. */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const SQL = [
  `CREATE TABLE IF NOT EXISTS "public"."StoredFile" ("key" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "uploadedBy" TEXT, "source" TEXT, "quarantined" BOOLEAN NOT NULL DEFAULT false, "sharedOrgIds" TEXT[] DEFAULT ARRAY[]::TEXT[], "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("key"))`,
  `ALTER TABLE "public"."StoredFile" ADD COLUMN IF NOT EXISTS "sharedOrgIds" TEXT[] DEFAULT ARRAY[]::TEXT[]`,
  `CREATE INDEX IF NOT EXISTS "StoredFile_organizationId_idx" ON "public"."StoredFile"("organizationId")`,
];
(async () => {
  if (/prod/i.test(process.env.DATABASE_URL ?? '') || process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('refusing: this is for the dev DB');
  for (const s of SQL) await p.$executeRawUnsafe(s);
  console.log('dev StoredFile table ready');
  await p.$disconnect();
})();
