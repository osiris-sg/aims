import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const total = await p.document.count({ where: { organizationId: ORG, type: 'INVOICE' } });
  const withXeroId = await p.document.count({ where: { organizationId: ORG, type: 'INVOICE', config: { path: ['xeroInvoiceId'], not: Prisma.JsonNull } } });
  console.log(`INVOICE docs total: ${total}`);
  console.log(`with xeroInvoiceId stamped: ${withXeroId}`);
  console.log(`(was 1796 at start — anything > that means new ones created)`);
}
import { Prisma } from '@prisma/client';
main().finally(()=>p.$disconnect());
