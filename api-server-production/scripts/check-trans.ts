import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const total = await p.transaction.count({ where: { organizationId: ORG } });
  const byType = await p.transaction.groupBy({ by: ['transactionType'], where: { organizationId: ORG }, _count: true });
  console.log(`Transaction rows: ${total}`);
  byType.forEach(t => console.log(`  ${t.transactionType.padEnd(15)} ${t._count}`));

  const balCount = await p.customerBalance.count({ where: { organizationId: ORG } });
  console.log(`\nCustomerBalance rows: ${balCount}`);
}
main().finally(()=>p.$disconnect());
