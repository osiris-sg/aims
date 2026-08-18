import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const r = await p.chartOfAccount.groupBy({ by: ['accountType', 'category'], _count: { _all: true } });
  for (const x of r.sort((a, b) => a.accountType.localeCompare(b.accountType))) console.log(x.accountType.padEnd(22), x.category.padEnd(14), x._count._all);
  await p.$disconnect();
})();
