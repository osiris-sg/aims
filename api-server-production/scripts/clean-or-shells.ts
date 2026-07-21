import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({ where: { organizationId: ORG, type: 'OFFICIAL_RECEIPT' }, select: { id: true, name: true, config: true } });
  for (const d of docs) {
    const c: any = d.config || {};
    const empty = !c.customerId && (!c.allocations || c.allocations.length === 0);
    console.log(d.name, empty ? 'EMPTY-SHELL' : `saved (${c.customerName}, ${c.receiptAmount})`);
    if (empty) {
      await p.payment.deleteMany({ where: { organizationId: ORG, receiptId: d.id } });
      await p.document.delete({ where: { id: d.id } });
      console.log('  deleted');
    }
  }
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
