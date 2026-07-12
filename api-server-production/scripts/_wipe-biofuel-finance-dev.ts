/**
 * ONE-OFF (dev): full clearance of Biofuel finance data ahead of a clean
 * Xero re-sync. Authorized by guru 2026-07-10.
 *
 * Deletes, in FK-safe order, for the Biofuel org only:
 *   1. PriceHistory rows referencing target docs   (required FK — would Restrict)
 *   2. Transaction rows (retired sub-ledger)       (would otherwise be orphan-nulled)
 *   3. Document rows type INVOICE / BILL / CREDIT_NOTE / DEBIT_NOTE
 *      (cascades: DocumentItem, DocumentEmbedding, DeliveryShareLink;
 *       set-null: Assignment, TimelineItem, MSR links — accepted)
 *   4. ALL JournalEntry rows (cascades JournalEntryLine)
 *
 * Refuses to run against a non-dev DATABASE_URL as a guard.
 * Run: npx ts-node --transpile-only scripts/_wipe-biofuel-finance-dev.ts
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const TYPES = ['INVOICE', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE'];

// Known non-dev Neon hosts — hard refuse.
const FORBIDDEN_HOSTS = ['ep-icy-moon-a19rnv5x', 'ep-gentle-bonus-a1hjwef9'];

async function main() {
  const url = process.env.DATABASE_URL || '';
  const host = url.match(/@([^/]+)\//)?.[1] || '';
  if (FORBIDDEN_HOSTS.some((h) => host.includes(h))) {
    throw new Error(`REFUSING: DATABASE_URL points at ${host} (staging/prod). This wipe is dev-only.`);
  }
  console.log(`Wiping Biofuel finance data on DB host: ${host}\n`);

  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: { in: TYPES } },
    select: { id: true },
  });
  const ids = docs.map((d) => d.id);
  console.log(`target documents: ${ids.length}`);

  let ph = 0;
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    ph += (await prisma.priceHistory.deleteMany({ where: { documentId: { in: chunk } } })).count;
  }
  console.log(`1. PriceHistory deleted: ${ph}`);

  const tx = await prisma.transaction.deleteMany({ where: { organizationId: ORG } });
  console.log(`2. Transaction (retired sub-ledger) deleted: ${tx.count}`);

  let dd = 0;
  for (let i = 0; i < ids.length; i += 2000) {
    const chunk = ids.slice(i, i + 2000);
    dd += (await prisma.document.deleteMany({ where: { id: { in: chunk } } })).count;
    process.stdout.write(`\r3. Documents deleted: ${dd}/${ids.length}`);
  }
  console.log();

  const je = await prisma.journalEntry.deleteMany({ where: { organizationId: ORG } });
  console.log(`4. JournalEntry deleted: ${je.count} (lines cascade)`);

  // Post-wipe verification
  const remainDocs = await prisma.document.count({ where: { organizationId: ORG, type: { in: TYPES } } });
  const remainJe = await prisma.journalEntry.count({ where: { organizationId: ORG } });
  const remainLines = await prisma.journalEntryLine.count({ where: { journalEntry: { organizationId: ORG } } });
  console.log(`\nverify → docs=${remainDocs} JE=${remainJe} lines=${remainLines} (all should be 0)`);
  if (remainDocs + remainJe + remainLines > 0) throw new Error('Wipe incomplete!');
  console.log('✓ Biofuel finance data cleared.');
}

main()
  .catch((e) => {
    console.error('FATAL', e?.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
