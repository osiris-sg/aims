import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  // Templates available
  const tmpls = await p.documentTemplate.findMany({
    where: { OR: [{ organizationId: ORG }, { isActive: true }], type: 'INVOICE' },
    select: { id: true, name: true, organizationId: true, isActive: true },
    take: 10,
  });
  console.log('INVOICE templates visible to Biofuel:');
  tmpls.forEach(t => console.log(' ', t));

  // Existing documents
  const docCount = await p.document.count({ where: { organizationId: ORG } });
  const xeroDocCount = await p.document.count({ where: { organizationId: ORG, name: { startsWith: 'XERO-' } } });
  console.log(`\nExisting documents in Biofuel: ${docCount} (Xero-imported: ${xeroDocCount})`);
  
  // Is there a xeroId field on Document already?
  const sample = await p.document.findFirst({ where: { organizationId: ORG }, select: { id: true, name: true, type: true, config: true } });
  if (sample) {
    console.log('\nSample document:');
    console.log(' ', { id: sample.id, name: sample.name, type: sample.type, configKeys: Object.keys((sample.config as any) || {}) });
  }
}
main().finally(()=>p.$disconnect());
