import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const t = await p.documentTemplate.findMany({
    where: { OR: [{ name: { contains: 'rental', mode: 'insensitive' } }, { name: { contains: 'monthly', mode: 'insensitive' } }] },
    select: { id: true, name: true, type: true, organizationId: true },
  });
  for (const x of t) console.log(x.organizationId.slice(0, 8), x.type, x.name, x.id);
  console.log('--- Biofuel (52e90ba8) quotation templates:');
  const bf = await p.documentTemplate.findMany({
    where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', type: { in: ['QUOTATION', 'QT', 'QO', 'QO1', 'QO2'] } },
    select: { id: true, name: true, type: true, isActive: true },
  });
  console.log(JSON.stringify(bf, null, 1));
  await p.$disconnect();
})();
