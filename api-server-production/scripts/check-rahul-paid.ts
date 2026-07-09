import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const refs = ['26-00211', '26-00202'];

  for (const ref of refs) {
    console.log(`\n=== Ref ${ref} ===`);
    const entries = await p.journalEntry.findMany({
      where: { organizationId: ORG, OR: [{ reference: { contains: ref } }, { description: { contains: ref } }] },
      include: { lines: { include: { account: true } } },
      orderBy: { entryDate: 'asc' },
    });
    entries.forEach(e => {
      console.log(`  ${e.journalNumber.padEnd(18)} ${e.entryDate.toISOString().slice(0,10)} ${e.type.padEnd(12)} $${e.totalDebit.toFixed(2)}`);
      console.log(`    ${e.description?.slice(0,80)}`);
      e.lines.forEach(l => {
        const side = l.debit > 0 ? `Dr ${l.debit.toFixed(2)}` : `Cr ${l.credit.toFixed(2)}`;
        console.log(`      ${l.account.code.padEnd(6)} ${l.account.name.padEnd(30).slice(0,30)} ${side}`);
      });
    });
  }

  // Vendor outstanding (Rahul Shankar Pandey) — sum of AP lines mentioning him
  console.log('\n=== Rahul Shankar Pandey - all AP activity (acct 800) ===');
  const rahul = await p.journalEntryLine.findMany({
    where: {
      journalEntry: { organizationId: ORG, status: 'POSTED', OR: [{ description: { contains: 'Rahul' } }, { reference: { contains: 'Rahul' } }] },
      account: { code: '800' },
    },
    include: { journalEntry: true, account: true },
    orderBy: { journalEntry: { entryDate: 'asc' } },
  });
  let bal = 0;
  rahul.forEach(l => {
    bal += l.credit - l.debit; // AP normal balance is credit; positive = owed
    console.log(`  ${l.journalEntry.entryDate.toISOString().slice(0,10)} ${l.journalEntry.journalNumber.padEnd(18)} Dr ${l.debit.toFixed(2).padStart(10)} Cr ${l.credit.toFixed(2).padStart(10)} | Running owed: ${bal.toFixed(2)}`);
  });
  console.log(`\n  Net outstanding to Rahul: $${bal.toFixed(2)}`);
}
main().finally(() => p.$disconnect());
