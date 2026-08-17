import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const doc = await p.document.deleteMany({ where: { id: '81f51e9b-6749-40a8-9245-a8a2d6086236', name: 'QO202608-0007' } });
  const cust = await p.customer.deleteMany({ where: { name: 'ZZ-Test QuickAdd Pte Ltd', customerCode: 'CZ008' } });
  console.log('deleted docs:', doc.count, '| deleted customers:', cust.count);
  await p.$disconnect();
})();
