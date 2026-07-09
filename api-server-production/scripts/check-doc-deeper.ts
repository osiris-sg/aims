import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

  // Document templates
  const tmpls = await p.documentTemplate.findMany({
    where: { type: 'INVOICE' },
    select: { id: true, name: true, organizationId: true, isActive: true },
  });
  console.log(`INVOICE templates (all orgs): ${tmpls.length}`);
  // Show ones available to Biofuel via OrganizationActiveTemplate
  const active = await p.organizationActiveTemplate.findMany({
    where: { organizationId: ORG, type: 'INVOICE' },
    select: { templateId: true },
  });
  console.log('Biofuel active INVOICE templates:', active);

  // Sample existing imported doc — full config
  const sample = await p.document.findFirst({ 
    where: { organizationId: ORG, config: { path: ['xeroImported'], equals: true } },
    select: { id: true, name: true, documentTemplateId: true, config: true, createdAt: true } 
  });
  console.log('\nSample xero-imported doc:');
  console.log(JSON.stringify(sample, null, 2).slice(0,2000));

  // Count by status
  const byStatus = await p.document.groupBy({
    by: ['status'],
    where: { organizationId: ORG, type: 'INVOICE' },
    _count: true,
  });
  console.log('\nINVOICE counts by status:');
  byStatus.forEach(s => console.log(' ', s));
}
main().finally(()=>p.$disconnect());
