import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP' } },
    select: { id: true, name: true, createdAt: true, config: true },
  });
  const jul11 = docs.filter((d) => d.createdAt.toISOString().slice(0, 10) === '2026-07-11');
  console.log('JP bills created 2026-07-11:', jul11.length, 'of', docs.length, 'JP bills total');
  const c: any = jul11[0]?.config;
  console.log(JSON.stringify({ ...c, lines: (c?.lines || []).slice(0, 2), items: undefined }, null, 1).slice(0, 1500));
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
