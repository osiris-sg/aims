import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const byType = await p.document.groupBy({
    by: ['type'],
    where: { organizationId: ORG },
    _count: true,
  });
  console.log('Biofuel Document types:');
  byType.forEach(t => console.log(`  ${t.type.padEnd(25)} ${t._count}`));

  // All types across all orgs
  const allTypes = await p.document.groupBy({
    by: ['type'],
    _count: true,
  });
  console.log('\nAll document types in the system:');
  allTypes.forEach(t => console.log(`  ${t.type.padEnd(25)} ${t._count}`));

  // Sample of any AP-style doc (bill, purchase invoice)
  const samp = await p.document.findFirst({
    where: { OR: [
      { type: { contains: 'BILL', mode: 'insensitive' } },
      { type: { contains: 'PURCHASE', mode: 'insensitive' } },
    ]},
    select: { id: true, name: true, type: true, config: true, organizationId: true },
  });
  if (samp) {
    console.log('\nSample bill/purchase doc:');
    console.log(`  type=${samp.type} name=${samp.name} org=${samp.organizationId}`);
    console.log(`  configKeys=${Object.keys((samp.config as any) || {}).join(',')}`);
  } else {
    console.log('\nNo BILL/PURCHASE type docs found.');
  }
}
main().finally(()=>p.$disconnect());
