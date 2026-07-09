import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const types = await p.chartOfAccount.groupBy({ by: ['accountType', 'category', 'normalBalance'], where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1' }, _count: true });
  console.log(types.map(t => `${t.accountType} | ${t.category} | ${t.normalBalance} (${t._count})`).join('\n'));
  const banks = await p.chartOfAccount.findMany({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', accountType: { in: ['BANK', 'CASH'] } }, select: { code: true, name: true, accountType: true } });
  console.log('\nbank/cash accounts:', JSON.stringify(banks));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
