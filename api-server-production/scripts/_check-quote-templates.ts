import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const t = await p.documentTemplate.findMany({
    where: { type: { in: ['QUOTATION', 'QT', 'QO', 'QO1', 'QO2'] } },
    select: { id: true, name: true, type: true, organizationId: true, isActive: true },
  });
  console.log(JSON.stringify(t, null, 1));
  const orgs = await p.organization.findMany({ select: { id: true, name: true } });
  console.log(orgs.filter(o => /biofuel/i.test(o.name)));
  await p.$disconnect();
})();
