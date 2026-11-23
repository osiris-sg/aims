/**
 * "Admin only" check (Biofuel, 2026-11-23): the user holds an active Admin,
 * superadmin or osirisadmin role in this org. Used where an action is limited to
 * Admins rather than to the manager tier (role-tier.ts counts field-tech,
 * normal_user and Manager as managers too):
 *  - enableDeliveryUnitSwap: swapping a unit on a delivered run.
 */
export const ADMIN_ROLE_NAMES = ['admin', 'superadmin', 'osirisadmin'];

export function isAdminRoleName(name: string | null | undefined): boolean {
  return ADMIN_ROLE_NAMES.includes(String(name || '').trim().toLowerCase());
}

export async function hasAdminRole(
  prisma: { userRole: { findMany: (args: any) => Promise<Array<{ role: { name: string } }>> } },
  organizationId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const rows = await prisma.userRole.findMany({
    where: { userId, organizationId, isActive: true },
    select: { role: { select: { name: true } } },
  });
  return rows.some((r) => isAdminRoleName(r.role?.name));
}

/**
 * Field-tech only: every active role this user holds in the org is field-tech
 * (Biofuel, 2026-11-24). Used by enableOfficeDoEdits: a delivered / signed DO is
 * edited with the normal DO edit permission, except a field-tech-only user is
 * refused. No user, or no role here (e.g. the global osirisadmin), is not field-tech.
 */
export function isFieldTechOnlyRoleNames(names: Array<string | null | undefined>): boolean {
  const clean = names.map((n) => String(n || '').trim().toLowerCase()).filter(Boolean);
  return clean.length > 0 && clean.every((n) => n === 'field-tech');
}

export async function isFieldTechOnly(
  prisma: { userRole: { findMany: (args: any) => Promise<Array<{ role: { name: string } }>> } },
  organizationId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const rows = await prisma.userRole.findMany({
    where: { userId, organizationId, isActive: true },
    select: { role: { select: { name: true } } },
  });
  return isFieldTechOnlyRoleNames(rows.map((r) => r.role?.name));
}
