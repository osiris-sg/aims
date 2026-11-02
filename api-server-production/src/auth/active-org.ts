/**
 * Multi-organisation users (2026-11-02). A user may belong to several orgs with
 * a role in each; the portal sends the org of the tab as X-Active-Org-Id.
 *
 *  - The header is honoured only for an org the user is an ACTIVE member of
 *    (osiris admins: any org, as before). Any other org is a 403: the request
 *    never silently falls back to another org's data.
 *  - No header: the default org = the membership used most recently
 *    (UserOrganization.lastActiveAt, written by POST /users/me/active-org),
 *    then the oldest membership. Never an arbitrary row.
 *  - An email invited by an org admin before it had a login becomes a member
 *    on its first signed-in request (PendingOrgInvite).
 */

export const NOT_A_MEMBER_MESSAGE = 'You are not a member of that organisation';

/** Prisma orderBy for "the user's default org". */
export const DEFAULT_MEMBERSHIP_ORDER = [{ lastActiveAt: { sort: 'desc', nulls: 'last' } }, { joinedAt: 'asc' }] as const;

export const normEmail = (e: unknown) =>
  String(e ?? '')
    .trim()
    .toLowerCase();

/** A plausible email address (the form's own check; Clerk validates for real). */
export const isEmail = (e: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(e));

/**
 * Turn the open invitations for these emails into memberships + roles. Roles
 * that no longer exist in the org are skipped. Returns how many invitations
 * were accepted. Never throws (a failure leaves the invite open for the next try).
 */
export async function acceptPendingInvites(prisma: any, userId: string, emails: string[]): Promise<number> {
  const list = [...new Set(emails.map(normEmail).filter(Boolean))];
  if (!list.length) return 0;
  try {
    const invites = await prisma.pendingOrgInvite.findMany({ where: { email: { in: list }, acceptedAt: null, revokedAt: null } });
    let accepted = 0;
    for (const inv of invites) {
      await prisma.userOrganization.upsert({
        where: { userId_organizationId: { userId, organizationId: inv.organizationId } },
        update: { isActive: true },
        create: { userId, organizationId: inv.organizationId, isActive: true },
      });
      const roles = inv.roleIds?.length ? await prisma.role.findMany({ where: { id: { in: inv.roleIds }, organizationId: inv.organizationId }, select: { id: true } }) : [];
      for (const r of roles) {
        await prisma.userRole.upsert({
          where: { userId_roleId_organizationId: { userId, roleId: r.id, organizationId: inv.organizationId } },
          update: { isActive: true },
          create: { userId, roleId: r.id, organizationId: inv.organizationId },
        });
      }
      await prisma.pendingOrgInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date(), acceptedUserId: userId } });
      accepted++;
    }
    return accepted;
  } catch (e: any) {
    console.warn(`acceptPendingInvites(${userId}) failed: ${e?.message}`);
    return 0;
  }
}
