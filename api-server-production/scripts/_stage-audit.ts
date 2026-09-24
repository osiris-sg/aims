import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.project.findMany({
    where: { organizationId: '09e55c23-e031-4254-8152-a373597b2cb3' },
    select: { name: true, stage: true, status: true, source: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const byStage: Record<string, number> = {};
  for (const r of rows) byStage[r.stage || 'NULL'] = (byStage[r.stage || 'NULL'] || 0) + 1;
  console.log('stage counts:', byStage);
  console.log('\nNULL-stage projects:');
  for (const r of rows.filter((x) => !x.stage)) console.log(`  ${r.name} · status=${r.status} · source=${r.source} · ${r.createdAt.toISOString().slice(0, 10)}`);
}
main().finally(() => prisma.$disconnect());
