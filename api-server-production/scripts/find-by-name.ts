import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const docs = await p.document.findMany({ where: { name: { in: ['BI2026070074', 'BI2026070005'] } }, select: { id: true, name: true, status: true, organizationId: true, createdAt: true } });
  console.log(JSON.stringify(docs, null, 1));
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
