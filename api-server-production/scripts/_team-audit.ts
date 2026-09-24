import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const teams = await prisma.team.findMany({ where: { organizationId: '09e55c23-e031-4254-8152-a373597b2cb3' } });
  for (const t of teams) {
    const members = await prisma.organizationMemberProfile.findMany({ where: { teamId: t.id }, select: { userId: true } });
    console.log(`${t.name} · leader=${t.leaderUserId} · target=${t.yearlyTarget} · members=${members.map((m) => m.userId).join(',') || 'NONE'}`);
  }
}
main().finally(() => prisma.$disconnect());
