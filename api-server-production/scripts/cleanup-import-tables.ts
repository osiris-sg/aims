/**
 * Wipes the import-flow tables in FK-respecting order.
 * REFUSES if DATABASE_URL contains "prod" or "production".
 *
 * Run from api-server-production/:
 *   npx ts-node scripts/cleanup-import-tables.ts
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
    // fall through
  }
  const lower = rawUrl.toLowerCase();
  const isProd = lower.includes('prod') || lower.includes('production');
  return { display: `${host}/${dbName}`, isProd };
}

async function main() {
  const { display, isProd } = describeDatabaseUrl(process.env.DATABASE_URL);
  if (isProd) {
    console.error(`REFUSING: DATABASE_URL points at ${display} which contains "prod"/"production". Exiting.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const [
      assignmentBefore,
      documentItemBefore,
      timelineItemBefore,
      priceHistoryBefore,
      documentBefore,
      inventoryBefore,
      projectBefore,
    ] = await Promise.all([
      prisma.assignment.count(),
      prisma.documentItem.count(),
      prisma.timelineItem.count(),
      prisma.priceHistory.count(),
      prisma.document.count(),
      prisma.inventory.count(),
      prisma.project.count(),
    ]);

    console.log(
      `Cleaning DB on host ${display}, will delete ${assignmentBefore} Assignments, ${documentItemBefore} DocumentItems, ${timelineItemBefore} TimelineItems, ${priceHistoryBefore} PriceHistory rows, ${documentBefore} Documents, ${inventoryBefore} Inventory rows, ${projectBefore} Projects. Proceeding.`,
    );

    // FK-respecting order:
    //   Assignment -> DocumentItem -> TimelineItem -> PriceHistory -> Document -> Inventory -> Project
    // deleteMany on an already-empty table returns { count: 0 } — script is idempotent.
    const a = await prisma.assignment.deleteMany();
    console.log(`Deleted ${a.count} Assignments`);
    const di = await prisma.documentItem.deleteMany();
    console.log(`Deleted ${di.count} DocumentItems`);
    const ti = await prisma.timelineItem.deleteMany();
    console.log(`Deleted ${ti.count} TimelineItems`);
    const ph = await prisma.priceHistory.deleteMany();
    console.log(`Deleted ${ph.count} PriceHistory rows`);
    const d = await prisma.document.deleteMany();
    console.log(`Deleted ${d.count} Documents`);
    const inv = await prisma.inventory.deleteMany();
    console.log(`Deleted ${inv.count} Inventory rows`);
    const p = await prisma.project.deleteMany();
    console.log(`Deleted ${p.count} Projects`);

    const [
      assignmentAfter,
      documentItemAfter,
      timelineItemAfter,
      priceHistoryAfter,
      documentAfter,
      inventoryAfter,
      projectAfter,
    ] = await Promise.all([
      prisma.assignment.count(),
      prisma.documentItem.count(),
      prisma.timelineItem.count(),
      prisma.priceHistory.count(),
      prisma.document.count(),
      prisma.inventory.count(),
      prisma.project.count(),
    ]);

    console.log('');
    console.log('Post-cleanup counts (all should be 0):');
    console.log(`  Assignment    : ${assignmentAfter}`);
    console.log(`  DocumentItem  : ${documentItemAfter}`);
    console.log(`  TimelineItem  : ${timelineItemAfter}`);
    console.log(`  PriceHistory  : ${priceHistoryAfter}`);
    console.log(`  Document      : ${documentAfter}`);
    console.log(`  Inventory     : ${inventoryAfter}`);
    console.log(`  Project       : ${projectAfter}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('cleanup failed:', err);
  process.exit(1);
});
