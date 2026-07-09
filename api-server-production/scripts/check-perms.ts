import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const perms = await p.permission.findMany({
    where: { OR: [{ resource: 'bills' }, { resource: { contains: 'bill' } }] },
    select: { id: true, resource: true, action: true },
  });
  console.log('Existing bill permissions:');
  perms.forEach(p => console.log(`  ${p.resource}:${p.action}`));
}
main().finally(()=>p.$disconnect());
