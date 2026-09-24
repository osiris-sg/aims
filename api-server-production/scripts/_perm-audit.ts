import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ORG = '09e55c23-e031-4254-8152-a373597b2cb3';
async function main() {
  const roles = await prisma.role.findMany({ where: { organizationId: ORG }, include: { permissions: { select: { id: true } } } });
  for (const r of roles) console.log(`role ${r.name}: ${r.permissions.length} perms`);
  const urs = await prisma.userRole.findMany({
    where: { organizationId: ORG, userId: { in: ['user_3Ig5Q439YUk1Jd8YzwtlGTkeRho'] } },
    include: { role: { select: { name: true } } },
  });
  console.log('\nSummer roles:', urs.map((u) => `${u.role.name} active=${u.isActive}`).join(', '));
  // union check: Management vs Management+Designer
  const mgmt = roles.find((r) => r.name === 'Management');
  const des = roles.find((r) => r.name === 'Designer');
  if (mgmt && des) {
    const union = new Set([...mgmt.permissions.map((p) => p.id), ...des.permissions.map((p) => p.id)]);
    console.log(`Management ∪ Designer unique perms: ${union.size} (sum with dupes: ${mgmt.permissions.length + des.permissions.length})`);
  }
}
main().finally(() => prisma.$disconnect());
