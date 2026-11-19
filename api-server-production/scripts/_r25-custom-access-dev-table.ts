/**
 * Custom access (WCT round 25, 2026-11-19): create the CustomAccess table on the DEV database.
 * Dev runs per-org tenancy, so `db push` cannot be used there; CustomAccess is in no platform /
 * org schema, so the app reads it from "public" (tenancy-router "legacy"), and that is where it
 * goes. Additive (new table only). PROD needs nothing: Render's build (`prisma db push`) creates it
 * from schema.prisma.
 *
 *   npx ts-node --transpile-only scripts/_r25-custom-access-dev-table.ts          # dry run
 *   npx ts-node --transpile-only scripts/_r25-custom-access-dev-table.ts --apply
 */
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SQL = [
  `CREATE TABLE IF NOT EXISTS "public"."CustomAccess" (
     "id" TEXT NOT NULL,
     "organizationId" TEXT NOT NULL,
     "kind" TEXT NOT NULL,
     "subjectId" TEXT NOT NULL,
     "tabs" JSONB NOT NULL,
     "createdBy" TEXT,
     "updatedBy" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "CustomAccess_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CustomAccess_organizationId_kind_subjectId_key" ON "public"."CustomAccess"("organizationId", "kind", "subjectId")`,
  `CREATE INDEX IF NOT EXISTS "CustomAccess_organizationId_idx" ON "public"."CustomAccess"("organizationId")`,
];

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL ?? '';
  if (!url || url === process.env.PROD_DATABASE_URL) throw new Error('Refusing: DATABASE_URL is empty or the prod URL');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [has] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'CustomAccess'`;
    console.log(`dev public."CustomAccess": ${has.n ? 'already exists' : apply ? 'creating' : 'would create'}`);
    if (!apply) {
      for (const s of SQL) console.log(`${s.replace(/\s+/g, ' ')};`);
      console.log('DRY RUN: nothing written. Re-run with --apply.');
      return;
    }
    for (const s of SQL) await prisma.$executeRawUnsafe(s);
    console.log('done');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
