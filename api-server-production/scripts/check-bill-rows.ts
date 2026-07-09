import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const total = await p.bill.count();
  const bf = await p.bill.count({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1' } });
  const byOrg = await p.bill.groupBy({ by: ['organizationId'], _count: true });
  console.log(`Bill table: ${total} total across all orgs, ${bf} for Biofuel`);
  byOrg.forEach(b => console.log(`  org=${b.organizationId.slice(0,20)} count=${b._count}`));
}
main().finally(()=>p.$disconnect());
