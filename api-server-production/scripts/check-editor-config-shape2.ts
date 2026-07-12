import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const docs = await p.document.findMany({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', type: 'INVOICE', NOT: { config: { path: ['xeroImported'], equals: true } } }, orderBy: { createdAt: 'desc' }, take: 5, select: { name: true, config: true } });
  for (const d of docs) {
    const c: any = d.config || {};
    console.log(d.name, '| top:', JSON.stringify({ sub: c.subTotal, gst: c.gstAmount, nett: c.nettTotal }), '| di:', JSON.stringify({ sub: c.documentInfo?.subTotal, gst: c.documentInfo?.gstAmount, nett: c.documentInfo?.nettTotal, pct: c.documentInfo?.gstPercent }));
  }
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
