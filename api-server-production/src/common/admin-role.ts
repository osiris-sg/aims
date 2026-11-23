/**
 * "Admin only" check (Biofuel, 2026-11-23): the user holds an active Admin,
 * superadmin or osirisadmin role in this org. Used where an action is limited to
 * Admins rather than to the manager tier (role-tier.ts counts field-tech,
 * normal_user and Manager as managers too):
 *  - enableOfficeDoEdits: editing a delivered / signed DO;
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
