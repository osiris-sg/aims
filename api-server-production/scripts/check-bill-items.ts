import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const bills = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL' }, select: { name: true, config: true }, take: 200 });
  let withItems = 0, without = 0;
  let sample: any = null;
  for (const b of bills) {
    const c: any = b.config || {};
    if (Array.isArray(c.items) && c.items.length) { withItems++; if (!sample) sample = { name: b.name, item: c.items[0] }; }
    else without++;
  }
  console.log({ withItems, without });
  console.log('sample bill line:', JSON.stringify(sample, null, 2)?.slice(0, 600));
  const inv = await p.document.findFirst({ where: { organizationId: ORG, type: 'INVOICE', config: { path: ['xeroImported'], equals: true } }, select: { name: true, config: true } });
  const ic: any = inv?.config || {};
  console.log('sample imported invoice line:', JSON.stringify(ic.items?.[0], null, 2)?.slice(0, 500));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
