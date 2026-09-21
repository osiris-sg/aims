import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  for (const o of orgs) {
    const active = await prisma.organizationActiveTemplate.findMany({
      where: { organizationId: o.id, type: 'SALES_ORDER' },
      select: { templateId: true, isPrimary: true },
    });
    const own = await prisma.documentTemplate.findMany({
      where: { organizationId: o.id, type: 'SALES_ORDER' },
      select: { id: true, name: true, isActive: true, isDefault: true },
    });
    const ids = [...new Set([...active.map((a) => a.templateId), ...own.map((t) => t.id)])];
    const flag = ids.length ? '✅' : '❌';
    console.log(`${flag} ${o.name}`);
    if (active.length) console.log(`     activated: ${active.length}${active.some((a) => a.isPrimary) ? ' (has primary)' : ''}`);
    if (own.length) console.log(`     own: ${own.map((t) => `${t.name}${t.isDefault ? ' [default]' : ''}${t.isActive ? '' : ' (inactive)'}`).join(', ')}`);
  }
  const shared = await prisma.documentTemplate.count({ where: { type: 'SALES_ORDER' } });
  const seeded = await prisma.documentTemplate.count({ where: { type: 'SALES_ORDER', isDefault: true } });
  console.log(`\nSALES_ORDER templates across all orgs: ${shared} (isDefault: ${seeded})`);
  console.log('Resolution falls back to a cross-org isDefault template, so a seeded default rescues orgs with none of their own.');
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
