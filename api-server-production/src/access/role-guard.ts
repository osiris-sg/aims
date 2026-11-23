/**
 * Roles safety (WCT group, Elroy 2026-11-23; custom access orgs only, features.enableCustomAccess).
 *
 *   - Who may manage roles: anyone whose access gives Org Settings Edit (Admin / superadmin, a custom
 *     role with Org Settings Edit, or their own Custom access with it), and the platform admin.
 *   - Nobody removes their own last way into Org Settings Edit (editing a role they hold, or their
 *     own roles).
 *   - Only an Admin / superadmin (or the platform admin) gives or takes the Admin / superadmin role,
 *     so Org Settings Edit through a custom role can never be turned into Admin.
 * Every check is a no-op in orgs without custom access.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AdminActor } from '../auth/admin-scope';
import { accessFlags } from './custom-access';
import { PRESET_TAB_ACCESS, readTabAccess, unionTabAccess, type TabAccessMap } from './tab-access';

/** Roles that always carry Org Settings Edit (never narrowed by a map). */
export const ORG_SETTINGS_ROLES = new Set(['superadmin', 'Admin', 'osirisadmin']);
/** Roles only an Admin / superadmin may hand out or take away. */
export const PRIVILEGED_ROLES = new Set(['superadmin', 'Admin']);

export const LOCKOUT_MESSAGE = 'This change would take away your own Org Settings edit. Ask another person with Org Settings edit to make it.';
export const PRIVILEGED_MESSAGE = 'Only an Admin can give or take the Admin role';

export type RoleWithMap = { id?: string; name: string; map?: TabAccessMap | null };

/**
 * Does this access give Org Settings Edit? Own Custom access decides alone (it replaces the roles);
 * otherwise Admin / superadmin, or the highest level the roles' maps give (custom role map, else the
 * built-in role's preset table). A hand-made role with no map gives nothing here.
 */
export function orgSettingsEditFrom(own: TabAccessMap | null, roles: RoleWithMap[]): boolean {
  if (own) return own.orgSettings === 'edit';
  if (roles.some((r) => ORG_SETTINGS_ROLES.has(r.name))) return true;
  const maps = roles.map((r) => r.map ?? PRESET_TAB_ACCESS[r.name]).filter(Boolean) as TabAccessMap[];
  return maps.length ? unionTabAccess(maps).orgSettings === 'edit' : false;
}

/** The roles (with their custom maps) among roleIds in this org. */
export async function rolesWithMaps(prisma: any, organizationId: string, roleIds: string[]): Promise<RoleWithMap[]> {
  if (!roleIds.length) return [];
  const [roles, rows] = await Promise.all([
    prisma.role.findMany({ where: { id: { in: roleIds }, organizationId }, select: { id: true, name: true } }),
    prisma.customAccess?.findMany ? prisma.customAccess.findMany({ where: { organizationId, kind: 'ROLE', subjectId: { in: roleIds } }, select: { subjectId: true, tabs: true } }) : [],
  ]);
  const mapOf = new Map<string, TabAccessMap>((rows as any[]).map((r) => [r.subjectId, readTabAccess(r.tabs)]));
  return (roles as any[]).map((r) => ({ id: r.id, name: r.name, map: mapOf.get(r.id) ?? null }));
}

/** A person's active role ids in this org. */
export async function activeRoleIds(prisma: any, organizationId: string, userId: string): Promise<string[]> {
  const rows: any[] = await prisma.userRole.findMany({ where: { userId, organizationId, isActive: true }, select: { roleId: true } });
  return rows.map((r) => r.roleId);
}

/** The person's own Custom access map, or null. */
export async function ownAccessOf(prisma: any, organizationId: string, userId: string): Promise<TabAccessMap | null> {
  const row = prisma.customAccess?.findFirst ? await prisma.customAccess.findFirst({ where: { organizationId, kind: 'USER', subjectId: userId }, select: { tabs: true } }) : null;
  return row ? readTabAccess(row.tabs) : null;
}

/**
 * Org Settings Edit for a person, now or with other roles / another map for one role
 * (opts.roleIds = their roles after a change; opts.roleMap = a role's map after an edit).
 */
export async function hasOrgSettingsEdit(
  prisma: any,
  organizationId: string,
  userId: string,
  opts: { roleIds?: string[]; roleMap?: { id: string; map: TabAccessMap } } = {},
): Promise<boolean> {
  const own = await ownAccessOf(prisma, organizationId, userId);
  if (own) return own.orgSettings === 'edit';
  const ids = opts.roleIds ?? (await activeRoleIds(prisma, organizationId, userId));
  const roles = await rolesWithMaps(prisma, organizationId, ids);
  return orgSettingsEditFrom(
    null,
    roles.map((r) => (opts.roleMap && r.id === opts.roleMap.id ? { ...r, map: opts.roleMap.map } : r)),
  );
}

/**
 * A change of a person's roles (Add / Edit User, assign, remove) in a custom access org:
 * the Admin / superadmin role only by an Admin / superadmin, and never your own last Org Settings Edit.
 */
export async function assertRoleChange(prisma: any, organizationId: string, actor: AdminActor | undefined, targetUserId: string | null, beforeIds: string[], afterIds: string[]): Promise<void> {
  if (!actor || actor.platform) return;
  if (!(await accessFlags(prisma, organizationId)).custom) return;
  const before = new Set(beforeIds);
  const after = new Set(afterIds);
  const changed = [...new Set([...beforeIds, ...afterIds])].filter((id) => before.has(id) !== after.has(id));
  if (!changed.length) return;
  const changedRoles = await rolesWithMaps(prisma, organizationId, changed);
  if (changedRoles.some((r) => PRIVILEGED_ROLES.has(r.name))) {
    const mine = actor.userId ? await rolesWithMaps(prisma, organizationId, await activeRoleIds(prisma, organizationId, actor.userId)) : [];
    if (!mine.some((r) => PRIVILEGED_ROLES.has(r.name))) throw new ForbiddenException(PRIVILEGED_MESSAGE);
  }
  if (actor.userId && targetUserId && actor.userId === targetUserId) {
    const had = await hasOrgSettingsEdit(prisma, organizationId, targetUserId, { roleIds: beforeIds });
    const keeps = await hasOrgSettingsEdit(prisma, organizationId, targetUserId, { roleIds: afterIds });
    if (had && !keeps) throw new BadRequestException(LOCKOUT_MESSAGE);
  }
}

export const ADMIN_TARGET_MESSAGE = 'Only an Admin can change or remove an Admin';

/**
 * Editing (name, email, password, roles) or removing a person who holds Admin / superadmin, in a custom access org:
 * only an Admin / superadmin (or the platform admin) may (2026-11-23). Org Settings edit through a custom role gives
 * users:*, and must never reach an Admin's login. Yourself: the other guards decide.
 */
export async function assertMayManageAdmin(prisma: any, organizationId: string | null | undefined, actor: AdminActor | undefined, targetUserId: string | null | undefined): Promise<void> {
  if (!actor || actor.platform || !organizationId || !targetUserId || actor.userId === targetUserId) return;
  if (!(await accessFlags(prisma, organizationId)).custom) return;
  const target = await rolesWithMaps(prisma, organizationId, await activeRoleIds(prisma, organizationId, targetUserId));
  if (!target.some((r) => PRIVILEGED_ROLES.has(r.name))) return;
  const mine = actor.userId ? await rolesWithMaps(prisma, organizationId, await activeRoleIds(prisma, organizationId, actor.userId)) : [];
  if (!mine.some((r) => PRIVILEGED_ROLES.has(r.name))) throw new ForbiddenException(ADMIN_TARGET_MESSAGE);
}
