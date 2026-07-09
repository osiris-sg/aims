import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  
  // Most recent Document for Biofuel
  const docs = await p.document.findMany({ 
    where: { organizationId: ORG }, 
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { name: true, type: true, createdAt: true, config: true },
  });
  console.log('Most recent Documents (any type):');
  docs.forEach(d => console.log(`  ${d.createdAt.toISOString()}  ${d.type.padEnd(12)} ${d.name?.slice(0,40)}`));

  // Most recent Customer
  const cust = await p.customer.findMany({ where: { organizationId: ORG }, orderBy: { createdAt: 'desc' }, take: 3 });
  console.log('\nMost recent Customers:');
  cust.forEach(c => console.log(`  ${c.createdAt.toISOString()}  ${c.name?.slice(0,40)}`));

  // Most recent JE (any org)
  const je = await p.journalEntry.findFirst({ orderBy: { createdAt: 'desc' } });
  console.log('\nMost recent JE in DB (any org):', je?.createdAt?.toISOString() || '(no JEs at all)');

  // Most recent CoA (any org)
  const coa = await p.chartOfAccount.findFirst({ orderBy: { createdAt: 'desc' } });
  console.log('Most recent CoA in DB (any org):', coa?.createdAt?.toISOString() || '(no CoA at all)');
}
main().finally(()=>p.$disconnect());
