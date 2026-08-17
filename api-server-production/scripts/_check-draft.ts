import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const d = await p.document.findUnique({ where: { id: '050dc6bf-c177-4c6f-a341-431672b07bd3' }, select: { id: true, name: true, status: true, updatedAt: true } });
  console.log(d || 'DELETED');
  await p.$disconnect();
})();
