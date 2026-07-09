import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const now = new Date();
const yearStart = new Date(now.getFullYear(), 0, 1);

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0;
  const n = Array.isArray(r) ? `${r.length} rows` : '';
  console.log(`  ${ms.toString().padStart(6)} ms  ${label}  ${n}`);
  return r;
}

async function main() {
  console.log('Timing hub building-block queries against PROD Biofuel:\n');

  // 1) trialBalance core: ALL posted lines + account include (current impl)
  await time('trialBalance findMany (all posted lines + include account)', () =>
    p.journalEntryLine.findMany({
      where: { journalEntry: { organizationId: ORG, status: 'POSTED', entryDate: { lte: now } } },
      include: { account: true },
    }),
  );

  // 1b) groupBy alternative (Postgres-side aggregation)
  await time('trialBalance groupBy alternative (Postgres _sum by accountId)', () =>
    p.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { journalEntry: { organizationId: ORG, status: 'POSTED', entryDate: { lte: now } } },
      _sum: { debit: true, credit: true },
    }),
  );

  // 2) accountActivity YTD (findMany lines in range)
  await time('accountActivity YTD findMany', () =>
    p.journalEntryLine.findMany({
      where: { journalEntry: { organizationId: ORG, status: 'POSTED', entryDate: { gte: yearStart, lte: now } } },
      include: { account: true },
    }),
  );

  // 3) anomaly: all INVOICE journal entries with lines (duplicate + missing-tax detectors)
  await time('anomaly INVOICE journalEntry findMany (+lines)', () =>
    p.journalEntry.findMany({
      where: { organizationId: ORG, type: 'INVOICE' },
      include: { lines: true },
    }),
  );

  // 4) action-queue nested: all POSTED INVOICE sourceDocumentIds
  const srcIds = await time('action-queue POSTED INVOICE sourceDocumentId findMany', () =>
    p.journalEntry.findMany({
      where: { organizationId: ORG, status: 'POSTED', type: 'INVOICE' },
      select: { sourceDocumentId: true },
    }),
  );
  await time(`action-queue document.count with NOT IN (${srcIds.length} ids)`, () =>
    p.document.count({
      where: {
        organizationId: ORG, status: 'paid', type: { in: ['INVOICE', 'TI'] },
        NOT: { id: { in: srcIds.map((j) => j.sourceDocumentId).filter((x): x is string => !!x) } },
      },
    }),
  );

  console.log('\nDone.');
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
