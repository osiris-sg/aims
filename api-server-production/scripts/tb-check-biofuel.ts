import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const sums = await p.journalEntryLine.aggregate({
    where: { journalEntry: { organizationId: ORG, status: 'POSTED' } },
    _sum: { debit: true, credit: true },
  });
  const totalDr = sums._sum.debit || 0;
  const totalCr = sums._sum.credit || 0;
  console.log(`Posted lines total Debit:  ${totalDr.toFixed(2)}`);
  console.log(`Posted lines total Credit: ${totalCr.toFixed(2)}`);
  console.log(`Diff: ${(totalDr - totalCr).toFixed(2)} ${Math.abs(totalDr - totalCr) < 0.5 ? '✓ balanced' : '✗ out of balance'}`);

  // Date span
  const minMax = await p.journalEntry.aggregate({
    where: { organizationId: ORG, status: 'POSTED' },
    _min: { entryDate: true },
    _max: { entryDate: true },
    _count: true,
  });
  console.log(`\nEntries: ${minMax._count}`);
  console.log(`Date span: ${minMax._min.entryDate?.toISOString().slice(0,10)} → ${minMax._max.entryDate?.toISOString().slice(0,10)}`);

  // Breakdown by type
  const byType = await p.journalEntry.groupBy({
    by: ['type'],
    where: { organizationId: ORG },
    _count: true,
  });
  console.log('\nBy type:');
  byType.forEach(t => console.log(`  ${t.type.padEnd(20)} ${t._count}`));
}
main().finally(() => p.$disconnect());
