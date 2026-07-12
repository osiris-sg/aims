import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const doc = await p.document.findFirst({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', name: 'TI2202607-003' }, select: { config: true } });
  const c: any = doc?.config || {};
  console.log('top-level:', JSON.stringify({ subTotal: c.subTotal, gstAmount: c.gstAmount, nettTotal: c.nettTotal }));
  console.log('documentInfo:', JSON.stringify({ subTotal: c.documentInfo?.subTotal, gstAmount: c.documentInfo?.gstAmount, nettTotal: c.documentInfo?.nettTotal, gstPercent: c.documentInfo?.gstPercent, taxApplicable: c.documentInfo?.taxApplicable }));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
