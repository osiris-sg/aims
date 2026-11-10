/**
 * All-day jobs (2026-11-10): add Delivery.scheduledAllDay on the DEV database.
 * Dev runs per-org tenancy, so `db push` cannot be used there; this adds the
 * column to every schema that has a "Delivery" table. Additive, default false.
 * PROD needs nothing: Render's build (`prisma db push`) adds it from schema.prisma.
 *
 *   npx ts-node --transpile-only scripts/_allday-dev-column.ts          # dry run
 *   npx ts-node --transpile-only scripts/_allday-dev-column.ts --apply
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL ?? '';
  if (!url || url === process.env.PROD_DATABASE_URL) throw new Error('Refusing: DATABASE_URL is empty or the prod URL');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const schemas = await prisma.$queryRaw<Array<{ s: string; has: boolean }>>`
      SELECT t.table_schema AS s,
             EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = t.table_schema AND c.table_name = 'Delivery' AND c.column_name = 'scheduledAllDay') AS has
      FROM information_schema.tables t WHERE t.table_name = 'Delivery' ORDER BY 1`;
    for (const { s, has } of schemas) {
      console.log(`${s}: ${has ? 'already has the column' : apply ? 'adding' : 'would add'}`);
      if (!has && apply) await prisma.$executeRawUnsafe(`ALTER TABLE "${s}"."Delivery" ADD COLUMN IF NOT EXISTS "scheduledAllDay" BOOLEAN NOT NULL DEFAULT false`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
