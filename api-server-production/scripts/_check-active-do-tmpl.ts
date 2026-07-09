import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const orgs = await p.organization.findMany({ where: { OR: [{ name: { contains: 'Biofuel' } }, { name: { contains: 'Osiris' } }] }, select: { id: true, name: true } });
  for (const org of orgs) {
    const sel = await p.organizationActiveTemplate.findMany({ where: { organizationId: org.id, type: 'DELIVERY_ORDER' } });
    console.log(`\n${org.name} (${org.id}) — selections for DELIVERY_ORDER: ${sel.length}`);
    for (const s of sel) {
      const t = await p.documentTemplate.findUnique({ where: { id: s.templateId }, select: { name: true, designName: true, organizationId: true, isDefault: true, isActive: true } });
      console.log(`  sel -> ${s.templateId} isPrimary=${s.isPrimary} :: ${t?.name} / ${t?.designName ?? '-'} ownerOrg=${t?.organizationId} isDefault=${t?.isDefault}`);
    }
    if (!sel.length) {
      const fb = await p.documentTemplate.findMany({ where: { OR: [{ type: 'DELIVERY_ORDER', isDefault: true }, { type: 'DELIVERY_ORDER', organizationId: org.id, isActive: true }] }, select: { id: true, name: true, designName: true, isDefault: true, isActive: true, organizationId: true } });
      console.log(`  FALLBACK set (${fb.length}):`);
      fb.forEach(t => console.log(`    - ${t.id} ${t.name} / ${t.designName ?? '-'} isDefault=${t.isDefault} isActive=${t.isActive} ownerOrg=${t.organizationId}`));
    }
  }
  await p.$disconnect();
})();
