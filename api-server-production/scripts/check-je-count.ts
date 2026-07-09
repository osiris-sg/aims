import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const jeCount = await p.journalEntry.count({ where: { organizationId: ORG } });
  const xeroCount = await p.journalEntry.count({ where: { organizationId: ORG, postedBy: 'xero-import' } });
  const coa = await p.chartOfAccount.count({ where: { organizationId: ORG } });
  console.log('Biofuel JEs total:', jeCount, '| from xero-import:', xeroCount, '| CoA accounts:', coa);
}
main().finally(() => p.$disconnect());
