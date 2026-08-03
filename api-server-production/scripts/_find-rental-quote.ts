import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const docs = await p.document.findMany({
    where: {
      organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1',
      type: { in: ['QUOTATION', 'QT', 'QO', 'QO1', 'QO2'] },
    },
    select: { id: true, name: true, documentTemplateId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });
  const tpls = await p.documentTemplate.findMany({ where: { id: { in: docs.map(d => d.documentTemplateId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const tn = new Map(tpls.map(t => [t.id, t.name]));
  for (const d of docs) console.log(d.id, '|', d.name, '|', tn.get(d.documentTemplateId || '') || d.documentTemplateId);
  await p.$disconnect();
})();
