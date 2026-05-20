import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const org = await prisma.organization.findFirst({
    where: { name: { contains: 'Biofuel', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!org) throw new Error('Biofuel org not found');
  const roles = await prisma.role.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true, allowedModules: true },
  });
  console.log(`Org: ${org.name}\n`);
  for (const r of roles) {
    const allowed = r.allowedModules ?? [];
    if (allowed.length === 0) {
      console.log(`- ${r.name}: [] (allows all already) — skip`);
      continue;
    }
    if (allowed.includes('SUPPLIERS')) {
      console.log(`- ${r.name}: already has SUPPLIERS — skip`);
      continue;
    }
    const updated = [...allowed, 'SUPPLIERS'];
    await prisma.role.update({ where: { id: r.id }, data: { allowedModules: updated } });
    console.log(`- ${r.name}: added SUPPLIERS -> ${JSON.stringify(updated)}`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
