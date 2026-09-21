import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const q = process.argv[2] || 'Default';
  const docs = await prisma.document.findMany({
    where: { name: { contains: q, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, name: true, type: true, status: true, createdAt: true, organizationId: true, config: true },
  });
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const on = (id: string) => orgs.find((o) => o.id === id)?.name || id;
  console.log(`${docs.length} document(s) matching "${q}":`);
  for (const d of docs) {
    const c: any = d.config || {};
    console.log(`  ${d.name}  [${d.type}]  ${d.status}`);
    console.log(`    id:  ${d.id}`);
    console.log(`    org: ${on(d.organizationId)}   created ${d.createdAt.toISOString().slice(0,16)}`);
    console.log(`    customer: ${typeof c.customer === 'string' ? c.customer : c.customer?.name || '(none)'}  lines: ${(c.items||[]).length}\n`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
