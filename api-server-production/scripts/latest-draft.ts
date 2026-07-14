import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const d = await p.document.findFirst({
    where: { organizationId: ORG, type: 'INVOICE', status: 'draft' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, documentTemplateId: true, createdAt: true, config: true },
  });
  const c: any = d?.config;
  console.log(d?.name, 'created', d?.createdAt.toISOString(), 'cust=', c?.customer?.name ?? c?.customerId, 'items=', (c?.items || []).length);
  console.log(`http://localhost:3000/portal/documents/INVOICE/${d?.documentTemplateId}/${d?.id}`);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
