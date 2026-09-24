import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const t = await prisma.team.findFirst({ where: { organizationId: '09e55c23-e031-4254-8152-a373597b2cb3', name: 'Junior Manager Trial Team' } });
  if (!t?.leaderUserId) return console.log('nothing to fix');
  await prisma.organizationMemberProfile.upsert({
    where: { organizationId_userId: { organizationId: t.organizationId, userId: t.leaderUserId } },
    update: { teamId: t.id },
    create: { organizationId: t.organizationId, userId: t.leaderUserId, teamId: t.id },
  });
  console.log('✔ leader added as member of', t.name);
}
main().finally(() => prisma.$disconnect());
