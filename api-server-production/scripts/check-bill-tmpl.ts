import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const tmpls = await p.documentTemplate.findMany({
    where: { type: { in: ['BILL', 'PURCHASE_INVOICE', 'PO', 'PURCHASE_ORDER'] } },
    select: { id: true, name: true, type: true, organizationId: true },
  });
  console.log(`Templates with bill/po types: ${tmpls.length}`);
  tmpls.forEach(t => console.log(' ', t));

  // Inspect a PO doc for the convention
  const po = await p.document.findFirst({
    where: { type: 'PO', organizationId: ORG },
    select: { id: true, name: true, type: true, documentTemplateId: true, config: true },
  });
  if (po) {
    console.log('\nSample PO doc:');
    console.log(' ', { id: po.id, name: po.name, type: po.type, tmpl: po.documentTemplateId });
    console.log('  config keys:', Object.keys((po.config as any) || {}));
  }
}
main().finally(()=>p.$disconnect());
