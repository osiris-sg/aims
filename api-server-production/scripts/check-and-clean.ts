/**
 * Read-only DB sanity check.
 * Prints masked DATABASE_URL host + db name, refuses on prod URLs,
 * and reports counts on the import-flow tables.
 *
 * Run from api-server-production/:
 *   npx ts-node scripts/check-and-clean.ts
 */
import { PrismaClient } from '@prisma/client';

function describeDatabaseUrl(rawUrl: string | undefined): { display: string; isProd: boolean } {
  if (!rawUrl) return { display: '(unset)', isProd: false };
  let host = '(unparseable)';
  let dbName = '(unparseable)';
  try {
    const u = new URL(rawUrl);
    host = u.hostname;
    dbName = u.pathname.replace(/^\//, '') || '(none)';
  } catch {
    // fall through — host/dbName stay as their defaults
  }
  const lower = rawUrl.toLowerCase();
  const isProd = lower.includes('prod') || lower.includes('production');
  return { display: `${host}/${dbName}`, isProd };
}

async function main() {
  const { display, isProd } = describeDatabaseUrl(process.env.DATABASE_URL);
  console.log(`DATABASE_URL host/db: ${display}`);

  if (isProd) {
    console.error('REFUSING: DATABASE_URL contains "prod" or "production". Exiting without queries.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const [
      assignmentCount,
      projectCount,
      documentCount,
      documentItemCount,
      inventoryCount,
      importInvoiceCount,
    ] = await Promise.all([
      prisma.assignment.count(),
      prisma.project.count(),
      prisma.document.count(),
      prisma.documentItem.count(),
      prisma.inventory.count(),
      prisma.importInvoice.count(),
    ]);

    const importByStatus = await prisma.importInvoice.groupBy({
      by: ['reviewStatus'],
      _count: { _all: true },
    });

    console.log('');
    console.log('Row counts:');
    console.log(`  Assignment    : ${assignmentCount}`);
    console.log(`  Project       : ${projectCount}`);
    console.log(`  Document      : ${documentCount}`);
    console.log(`  DocumentItem  : ${documentItemCount}`);
    console.log(`  Inventory     : ${inventoryCount}`);
    console.log(`  ImportInvoice : ${importInvoiceCount}`);
    console.log('');
    console.log('ImportInvoice by reviewStatus:');
    if (importByStatus.length === 0) {
      console.log('  (none)');
    } else {
      for (const row of importByStatus) {
        console.log(`  ${row.reviewStatus.padEnd(10)} : ${row._count._all}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('check-and-clean failed:', err);
  process.exit(1);
});
