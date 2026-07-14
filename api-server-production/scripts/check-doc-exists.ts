import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const d = await p.document.findUnique({ where: { id: 'e0e80b86-e682-40a3-8bca-de2f1d95df6d' }, select: { id: true, name: true, organizationId: true, status: true } });
  console.log('doc:', JSON.stringify(d));
  const count = await p.document.count({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', type: 'INVOICE' } });
  console.log('biofuel invoices in dev:', count);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
