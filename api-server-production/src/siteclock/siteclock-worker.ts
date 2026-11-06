/**
 * SiteClock deliveries (2026-11-06): who a SiteClock worker is in AIMS.
 *
 * A SiteClock user is linked to an AIMS member by
 * OrganizationMemberProfile.siteclockUserId (written by the field-tech setup
 * script, as for enableWctMyJobs). The worker may do deliveries from SiteClock
 * only as an ACTIVE member of the org holding a FIELD role, i.e. a role that
 * can create delivery proof (maintenance-reports:create, the permission every
 * SiteJobs delivery endpoint checks). Used by the job sync (deliveryEnabled)
 * and by the worker delivery API's guard, so the two can never disagree.
 *
 * Pure helpers on the caller's Prisma (no module dependency).
 */
export const FIELD_PERMISSION = 'maintenance-reports:create';

export type WorkerResolution =
  | { ok: true; userId: string; name: string | null }
  | { ok: false; reason: 'NOT_LINKED' | 'NOT_A_MEMBER' | 'NO_FIELD_ROLE' };

export const WORKER_REFUSAL: Record<Exclude<WorkerResolution, { ok: true }>['reason'], string> = {
  NOT_LINKED: 'Your SiteClock login is not linked to an AIMS user. Ask the office to link it.',
  NOT_A_MEMBER: 'Your AIMS login is not active in this organisation. Ask the office.',
  NO_FIELD_ROLE: 'Your AIMS role does not allow deliveries. Ask the office for a field role.',
};

const grants = (perms: Array<{ resource: string; action: string }>, wanted: string) => {
  const [resource, action] = wanted.split(':');
  return perms.some((p) => (p.resource === resource || p.resource === '*') && (p.action === action || p.action === '*'));
};

export async function resolveSiteClockWorker(prisma: any, organizationId: string, siteclockUserId: string | null | undefined): Promise<WorkerResolution> {
  if (!siteclockUserId) return { ok: false, reason: 'NOT_LINKED' };
  const profiles: Array<{ userId: string }> = await prisma.organizationMemberProfile.findMany({
    where: { organizationId, siteclockUserId },
    select: { userId: true },
  });
  if (!profiles.length) return { ok: false, reason: 'NOT_LINKED' };
  let member = false;
  for (const p of profiles) {
    const uo = await prisma.userOrganization.findFirst({ where: { userId: p.userId, organizationId, isActive: true }, select: { userId: true } });
    if (!uo) continue;
    member = true;
    const roles: Array<{ role: { name: string; permissions: Array<{ resource: string; action: string }> } | null }> = await prisma.userRole.findMany({
      where: { userId: p.userId, organizationId, isActive: true },
      select: { role: { select: { name: true, permissions: { select: { resource: true, action: true } } } } },
    });
    if (roles.some((r) => r.role && grants(r.role.permissions, FIELD_PERMISSION))) {
      return { ok: true, userId: p.userId, name: null };
    }
  }
  return { ok: false, reason: member ? 'NO_FIELD_ROLE' : 'NOT_A_MEMBER' };
}
