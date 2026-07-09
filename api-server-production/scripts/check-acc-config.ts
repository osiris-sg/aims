import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const m = await p.organizationModule.findFirst({ where: { organizationId: ORG, moduleCode: 'ACCOUNTING' } });
  console.log('ACCOUNTING module row config:');
  console.log(JSON.stringify(m?.config, null, 2));
}
main().finally(()=>p.$disconnect());
