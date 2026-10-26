/** Service-report remote signature (2026-10-26): create ServiceReportSignLink in the DEV public schema (dev runs per-org tenancy; `db push` fails there). Prod gets it from Render's build. */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const SQL = [
  `CREATE TABLE IF NOT EXISTS "public"."ServiceReportSignLink" ("id" TEXT NOT NULL, "token" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "reportIds" TEXT[], "techSignatureKey" TEXT, "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "signedAt" TIMESTAMP(3), "signerName" TEXT, "signerIp" TEXT, "userAgent" TEXT, CONSTRAINT "ServiceReportSignLink_pkey" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ServiceReportSignLink_token_key" ON "public"."ServiceReportSignLink"("token")`,
  `CREATE INDEX IF NOT EXISTS "ServiceReportSignLink_organizationId_idx" ON "public"."ServiceReportSignLink"("organizationId")`,
];
(async () => {
  if (/prod/i.test(process.env.DATABASE_URL ?? '') || process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('refusing: this is for the dev DB');
  for (const s of SQL) await p.$executeRawUnsafe(s);
  console.log('dev ServiceReportSignLink table ready');
  await p.$disconnect();
})();
