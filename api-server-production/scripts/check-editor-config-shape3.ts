import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const orgs = await p.document.groupBy({ by: ['organizationId'], where: { type: 'INVOICE' }, _count: true });
  console.log('orgs with invoices:', orgs.map(o => `${o.organizationId.slice(0, 8)}:${o._count}`).join(' '));
  const docs = await p.document.findMany({ where: { type: { in: ['INVOICE', 'TI', 'TI2'] } }, orderBy: { updatedAt: 'desc' }, take: 5, select: { name: true, organizationId: true, config: true } });
  for (const d of docs) {
    const c: any = d.config || {};
    console.log(d.name, d.organizationId.slice(0, 8), '| top:', JSON.stringify({ sub: c.subTotal, gst: c.gstAmount, nett: c.nettTotal }), '| di:', JSON.stringify({ sub: c.documentInfo?.subTotal, gst: c.documentInfo?.gstAmount, nett: c.documentInfo?.nettTotal, pct: c.documentInfo?.gstPercent }));
  }
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
