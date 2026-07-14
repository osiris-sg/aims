import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const d = await p.document.findFirst({
    where: { organizationId: ORG, type: 'INVOICE', status: 'draft' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, documentTemplateId: true },
  });
  console.log(d?.name, `https://aims-mocha.vercel.app/portal/documents/INVOICE/${d?.documentTemplateId}/${d?.id}`);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
