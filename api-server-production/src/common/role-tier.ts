// Hierarchy access (guru 2026-09-19):
//   master — Management / Admin / superadmin etc.: everything, no approval.
//   senior — "Senior Manager" role: org-wide data, distributes leads anywhere.
//   junior — "Junior Manager" role: leads a Team; sees + assigns within it.
//   designer — only role is Designer: own records only.
// A user's tier is their HIGHEST role: any role outside the three named ones
// counts as master (so existing Management users are untouched).

export type RoleTier = 'master' | 'senior' | 'junior' | 'designer';

const SCOPED_ROLES = ['Designer', 'Junior Manager', 'Senior Manager'];

export function tierOfRoleNames(names: string[]): RoleTier {
  if (names.length === 0) return 'master'; // e.g. osirisadmin with no org roles
  if (names.some((n) => !SCOPED_ROLES.includes(n))) return 'master';
  if (names.includes('Senior Manager')) return 'senior';
  if (names.includes('Junior Manager')) return 'junior';
  return 'designer';
}

/** Tier + (for juniors) the Clerk user ids of their team, themselves included. */
export async function resolveTier(
  prisma: {
    userRole: { findMany: (args: any) => Promise<any[]> };
    team: { findFirst: (args: any) => Promise<any> };
    organizationMemberProfile: { findMany: (args: any) => Promise<any[]> };
  },
  organizationId: string,
  userId?: string | null,
): Promise<{ tier: RoleTier; teamUserIds: string[] | null; teamId: string | null; teamName: string | null; teamTarget: number | null }> {
  if (!userId) return { tier: 'master', teamUserIds: null, teamId: null, teamName: null, teamTarget: null };
  const roles = await prisma.userRole.findMany({
    where: { userId, organizationId, isActive: true },
    select: { role: { select: { name: true } } },
  });
  const tier = tierOfRoleNames(roles.map((r: any) => r.role.name));
  if (tier !== 'junior') return { tier, teamUserIds: null, teamId: null, teamName: null, teamTarget: null };
  const team = await prisma.team.findFirst({ where: { organizationId, leaderUserId: userId } });
  if (!team) return { tier, teamUserIds: [userId], teamId: null, teamName: null, teamTarget: null };
  const members = await prisma.organizationMemberProfile.findMany({
    where: { organizationId, teamId: team.id },
    select: { userId: true },
  });
  const ids = new Set<string>(members.map((m: any) => m.userId));
  ids.add(userId);
  return { tier, teamUserIds: [...ids], teamId: team.id, teamName: team.name, teamTarget: team.yearlyTarget ?? null };
}
