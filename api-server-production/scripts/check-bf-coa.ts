import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const c = await p.chartOfAccount.count({ where: { organizationId: ORG } });
  const cAll = await p.chartOfAccount.count();
  console.log(`ChartOfAccount: ${c} for Biofuel | ${cAll} total across all orgs`);
  
  const j = await p.journalEntry.count({ where: { organizationId: ORG } });
  const jAll = await p.journalEntry.count();
  console.log(`JournalEntry: ${j} for Biofuel | ${jAll} total across all orgs`);

  if (cAll > 0 && c === 0) {
    const sample = await p.chartOfAccount.findMany({ take: 5, select: { organizationId: true, code: true, name: true } });
    console.log('\nWhere the CoA actually went (samples):');
    sample.forEach(s => console.log(`  org=${s.organizationId.slice(0,20)} ${s.code} ${s.name}`));
  }
}
main().finally(()=>p.$disconnect());
