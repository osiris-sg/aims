import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const entries = await p.journalEntry.findMany({
    where: { organizationId: ORG, status: 'POSTED', type: 'INVOICE', entryDate: { gte: since } },
    include: { lines: { include: { account: true } } },
    orderBy: { entryDate: 'desc' },
  });
  const missing = entries.filter(e => !e.lines.some(l =>
    /^CL9/.test(l.account.code) || /^TX/.test(l.account.code) || l.account.accountType === 'TAX_LIABILITY'
  ));
  console.log(`Found ${missing.length} no-tax invoices in last 30 days:`);
  missing.forEach(m => {
    console.log(`\n  ${m.journalNumber} | ${m.entryDate.toISOString().slice(0,10)} | $${m.totalDebit.toFixed(2)}`);
    console.log(`  ${m.description?.slice(0,100)}`);
    console.log(`  ref: ${m.reference}`);
    m.lines.forEach(l => {
      const side = l.debit > 0 ? `Dr ${l.debit}` : `Cr ${l.credit}`;
      console.log(`    ${l.account.code.padEnd(6)} ${l.account.name.padEnd(35).slice(0,35)} ${side}`);
    });
  });
}
main().finally(() => p.$disconnect());
