import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const org: any = await p.organization.findUnique({ where: { id: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1' }, select: { name: true, taxRate: true } });
  console.log('org:', org);
  const editorDoc = await p.document.findFirst({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', name: 'TI2202607-003' }, select: { config: true } });
  const c: any = editorDoc?.config || {};
  console.log('editor invoice:', JSON.stringify({ subTotal: c.subTotal, gstAmount: c.gstAmount, nettTotal: c.nettTotal, taxApplicable: c.documentInfo?.taxApplicable, gstPercent: c.documentInfo?.gstPercent, itemTax: c.items?.[0]?.tax, summary: c.summary }));
  const rec = await p.document.findFirst({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', name: 'BIPL-JPSG-INV-20260708-0007' }, select: { config: true } });
  const rc: any = rec?.config || {};
  console.log('recurring invoice documentInfo:', JSON.stringify(rc.documentInfo));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
