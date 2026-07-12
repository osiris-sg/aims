import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const hits = await prisma.document.findMany({
    where: { organizationId: ORG, name: { in: ['INV-0033', 'INV-0059', 'BI202206014', 'INV-0045'] } },
    select: { id: true, name: true, type: true, documentTemplateId: true, status: true, createdAt: true },
  });
  console.log(`rows matching failing names: ${hits.length}`);
  for (const h of hits) console.log(`  ${h.name}  type=${h.type}  tmpl=${h.documentTemplateId}  status=${h.status}  created=${h.createdAt.toISOString()}`);
  const remaining = await prisma.document.groupBy({ by: ['type'], where: { organizationId: ORG }, _count: true });
  console.log('current Biofuel docs by type:', remaining.map(r => `${r.type}=${r._count}`).join('  '));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
