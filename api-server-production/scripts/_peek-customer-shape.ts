import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const name = process.argv[2];
  const d = await prisma.document.findFirst({ where: { name: { contains: name } }, select: { name: true, type: true, config: true } });
  if (!d) { console.log('not found'); return; }
  const c: any = d.config || {};
  console.log(`${d.name} [${d.type}]`);
  for (const k of ['customer','customerName','customerAddress','address','billTo','attention','contactName','deliveryAddress','documentInfo']) {
    if (c[k] !== undefined) console.log(`  ${k}:`, JSON.stringify(c[k]).slice(0, 300));
  }
  console.log('  --- all top-level keys:', Object.keys(c).join(', '));
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
