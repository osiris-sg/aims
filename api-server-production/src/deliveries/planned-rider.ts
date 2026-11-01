import { isOrgFeatureEnabled } from '../common/org-features';

/**
 * WCT worker logins (flag enableWctMyJobs, 2026-11-01, Phase 2).
 *
 * Every WCT SiteClock worker gets an AIMS field-tech login on their existing
 * Clerk user (scripts/setup-wct-siteclock-fieldtechs.ts), which also stores
 * their SiteClock user id on OrganizationMemberProfile.siteclockUserId. A job
 * scheduled on a SiteClock worker is then PLANNED for that AIMS user
 * (Delivery.plannedRiderUserId): the field app's "My jobs" lists it, and
 * starting a job planned for someone else asks first. riderUserId is still
 * whoever actually started it.
 *
 * Pure helpers on the caller's Prisma (no module dependency).
 */
export const WCT_MY_JOBS_FLAG = 'enableWctMyJobs';

/** The active WCT member behind a SiteClock worker id, or null. */
export async function resolvePlannedRider(prisma: any, organizationId: string, siteclockWorkerId: string | null | undefined): Promise<{ userId: string } | null> {
  if (!siteclockWorkerId) return null;
  const profiles = await prisma.organizationMemberProfile.findMany({
    where: { organizationId, siteclockUserId: siteclockWorkerId },
    select: { userId: true },
  });
  for (const p of profiles) {
    const member = await prisma.userOrganization.findFirst({ where: { userId: p.userId, organizationId, isActive: true }, select: { userId: true } });
    if (member) return { userId: member.userId };
  }
  return null;
}

/**
 * After a schedule save that SENT a worker pick (siteclockWorkerId present,
 * null = cleared): store who the job is planned for. Untouched when no pick
 * was sent (an edit from a form without the SiteClock section keeps it).
 * Flag-gated; best-effort, never throws.
 */
export async function savePlannedRider(
  prisma: any,
  organizationId: string,
  deliveryId: string,
  input: { siteclockWorkerId?: string | null; siteclockWorkerName?: string | null },
): Promise<void> {
  try {
    if (input.siteclockWorkerId === undefined) return;
    if (!(await isOrgFeatureEnabled(prisma, organizationId, WCT_MY_JOBS_FLAG))) return;
    const rider = await resolvePlannedRider(prisma, organizationId, input.siteclockWorkerId);
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        plannedRiderUserId: rider?.userId ?? null,
        plannedRiderName: input.siteclockWorkerId ? input.siteclockWorkerName?.trim() || null : null,
      },
    });
  } catch {
    /* best-effort: the schedule itself is already saved */
  }
}

/** For the field list: who the job is planned for and whether that is the viewer. */
export function plannedRiderView(run: { plannedRiderUserId?: string | null; plannedRiderName?: string | null }, viewerUserId?: string | null) {
  if (!run.plannedRiderUserId && !run.plannedRiderName) return null;
  return {
    userId: run.plannedRiderUserId ?? null,
    name: run.plannedRiderName ?? null,
    isMe: !!viewerUserId && run.plannedRiderUserId === viewerUserId,
  };
}
