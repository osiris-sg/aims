import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const org = await prisma.organization.findFirst({ where: { name: { contains: process.argv[2] || 'Biofuel', mode: 'insensitive' } }, select: { id: true, name: true } });
  if (!org) { console.log('org not found'); return; }
  console.log(`${org.name}  ${org.id}\n`);
  const profiles = await prisma.organizationMemberProfile.findMany({
    where: { organizationId: org.id },
    select: { userId: true, whatsappNumber: true },
  });
  const roles = await prisma.userRole.findMany({
    where: { organizationId: org.id, isActive: true },
    select: { userId: true, role: { select: { name: true } } },
  });
  const members = await prisma.userOrganization.findMany({ where: { organizationId: org.id, isActive: true }, select: { userId: true } });
  const ids = [...new Set([...profiles.map(p=>p.userId), ...members.map(m=>m.userId)])];
  for (const id of ids) {
    const p = profiles.find(x => x.userId === id);
    const r = roles.filter(x => x.userId === id).map(x => x.role?.name).join(', ');
    console.log(`${id}`);
    console.log(`   roles: ${r || '(none)'}   whatsappNumber: ${p?.whatsappNumber || '(not set)'}${p ? '' : '   (no member profile)'}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
