import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const rows = await p.document.findMany({
    where: { organizationId: ORG, name: '92001' },
    select: { id: true, name: true, type: true, documentTemplateId: true, status: true },
  });
  console.log(`Documents named '92001' in Biofuel: ${rows.length}`);
  rows.forEach(r => console.log(' ', r));
}
main().finally(()=>p.$disconnect());
