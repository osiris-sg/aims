import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const r = await p.organizationModule.update({
    where: { organizationId_moduleCode: { organizationId: ORG, moduleCode: 'ACCOUNTING' } },
    data: { displayName: 'Accounting' },
  });
  console.log(`Renamed ACCOUNTING displayName → "${r.displayName}"`);
}
main().finally(()=>p.$disconnect());
