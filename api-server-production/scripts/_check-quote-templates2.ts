import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const t = await p.documentTemplate.findMany({
    where: { type: { in: ['QUOTATION', 'QT', 'QO', 'QO1', 'QO2'] } },
    select: { id: true, name: true, type: true, organizationId: true, isActive: true },
  });
  console.log('total', t.length);
  for (const x of t) console.log(x.organizationId.slice(0, 8), x.type, x.isActive ? 'ACTIVE' : '-', x.name);
  const sel = await p.organizationActiveTemplate.findMany({ where: { type: { in: ['QUOTATION', 'QT', 'QO', 'QO1', 'QO2'] } } });
  console.log('selections:', JSON.stringify(sel, null, 1));
  await p.$disconnect();
})();
