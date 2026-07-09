import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const agg = await p.journalEntryLine.aggregate({
    where: { journalEntry: { organizationId: ORG, postedBy: 'xero-import' } },
    _sum: { debit: true, credit: true },
  });
  const dr = agg._sum.debit ?? 0;
  const cr = agg._sum.credit ?? 0;
  const diff = Math.round((dr - cr) * 100) / 100;
  console.log(`Total Debit : ${dr.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total Credit: ${cr.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Difference  : ${diff}  ${diff === 0 ? '✅ BALANCED' : '*** OUT OF BALANCE ***'}`);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
