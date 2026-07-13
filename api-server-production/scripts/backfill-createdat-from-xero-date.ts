/**
 * Backfill Document.createdAt with the REAL Xero document date (config.date)
 * for Biofuel's imported docs. After a wipe+reimport, createdAt is just the
 * import timestamp (e.g. everything "10 July") — meaningless in the UI.
 *
 * Scope: xeroImported INVOICE / BILL / CREDIT_NOTE docs with a config.date.
 * Single raw UPDATE (per-row Prisma updates would be thousands of round trips).
 *
 * Run (dev):  npx ts-node --transpile-only scripts/backfill-createdat-from-xero-date.ts
 * Run (prod): dotenv -e .env.production -- npx ts-node --transpile-only scripts/backfill-createdat-from-xero-date.ts
 */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';

const prisma = createScriptPrisma();

async function main() {
  const before = await prisma.$queryRawUnsafe<any[]>(
    `SELECT count(*)::int AS n, min("createdAt") AS min, max("createdAt") AS max
     FROM "Document"
     WHERE "organizationId" = $1 AND type IN ('INVOICE','BILL','CREDIT_NOTE')
       AND config->>'xeroImported' = 'true' AND config->>'date' IS NOT NULL`,
    BIOFUEL_ORG_ID,
  );
  console.log('scope:', before[0]);

  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "Document"
     SET "createdAt" = (config->>'date')::timestamptz
     WHERE "organizationId" = $1 AND type IN ('INVOICE','BILL','CREDIT_NOTE')
       AND config->>'xeroImported' = 'true' AND config->>'date' IS NOT NULL
       AND "createdAt" <> (config->>'date')::timestamptz`,
    BIOFUEL_ORG_ID,
  );
  console.log(`updated ${updated} rows`);

  const after = await prisma.$queryRawUnsafe<any[]>(
    `SELECT min("createdAt") AS min, max("createdAt") AS max FROM "Document"
     WHERE "organizationId" = $1 AND type IN ('INVOICE','BILL','CREDIT_NOTE')
       AND config->>'xeroImported' = 'true'`,
    BIOFUEL_ORG_ID,
  );
  console.log('createdAt range now:', after[0]);
}

main().catch((e) => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
