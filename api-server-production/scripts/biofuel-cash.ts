import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const banks = await p.chartOfAccount.findMany({
    where: { organizationId: ORG, accountType: 'CURRENT_ASSET' },
    select: { id: true, code: true, name: true },
  });
  const filtered = banks.filter(b => /\bbank\b|\bcash\b/i.test(b.name));
  console.log(`Detected cash/bank accounts (${filtered.length}):`);
  let total = 0;
  for (const b of filtered) {
    const sums = await p.journalEntryLine.aggregate({
      where: { accountId: b.id, journalEntry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    const bal = (sums._sum.debit || 0) - (sums._sum.credit || 0);
    total += bal;
    console.log(`  ${b.code.padEnd(6)} ${b.name.padEnd(35)} $${bal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`);
  }
  console.log(`\nTotal Cash & Bank: $${total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`);
}
main().finally(()=>p.$disconnect());
