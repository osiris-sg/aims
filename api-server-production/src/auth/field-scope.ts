import { Prisma } from '@prisma/client';

/**
 * Field-tech rule for service reports (2026-11-02). A user whose ONLY role in
 * the active org is `field-tech` (the SiteJobs field app):
 *  - READS every report in the org (list, by id, HTML, PDF, by asset / project);
 *  - CHANGES (draft, photos, sign, complete, location) only the reports they
 *    wrote or that sit on a job claimed by them (riderUserId) or planned for
 *    them (plannedRiderUserId) — 403 otherwise;
 *  - never creates an invoice from a report (office only).
 * Office roles, mixed roles and osiris admins are not limited. Customers are
 * not limited (field techs are trusted staff). ClerkAuthGuard puts the role
 * names of the active org on the request.
 */
export const FIELD_TECH_ROLE = 'field-tech';

export interface ScopedRequest {
  user?: { id?: string };
  isOsirisAdmin?: boolean;
  orgRoleNames?: string[];
}

/** The user id whose own reports a field-tech-only caller may change, or null (not limited). */
export function fieldScopeUserId(req: ScopedRequest | undefined): string | null {
  if (!req || req.isOsirisAdmin) return null;
  const names = req.orgRoleNames ?? [];
  if (!names.length || names.some((n) => n !== FIELD_TECH_ROLE)) return null;
  return req.user?.id ?? null;
}

/** Reports a field tech may change: written by them, or on a job of theirs. */
export function ownReportWhere(userId: string): Prisma.MaintenanceServiceReportWhereInput {
  return {
    OR: [{ technicianUserId: userId }, { delivery: { OR: [{ riderUserId: userId }, { plannedRiderUserId: userId }] } }],
  };
}
