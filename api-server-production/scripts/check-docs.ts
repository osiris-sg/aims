import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const byType = await p.document.groupBy({ by: ['type'], where: { organizationId: ORG }, _count: true });
  console.log('Biofuel Document counts by type:');
  byType.forEach(t => console.log(`  ${t.type.padEnd(20)} ${t._count}`));

  const billsInBillTable = await p.bill.count({ where: { organizationId: ORG } });
  console.log(`\nBill table rows: ${billsInBillTable}`);
}
main().finally(()=>p.$disconnect());
