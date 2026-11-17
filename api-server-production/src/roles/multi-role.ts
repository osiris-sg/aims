// Multi-role users (WCT group, 2026-11-17), per-org setting features.enableMultiRole
// (default off). A person can hold several roles in one org; UserRole already is the
// link table (@@unique userId + roleId + organizationId), so there is NO new table.
//
//   - Permissions = the union of the roles' permissions.
//   - Modules = the union of the roles' allowedModules (an empty list = every module).
//   - Primary role = the active role with the EARLIEST UserRole.assignedAt (ties: createdAt,
//     then id). "First chosen" is therefore primary by default; making another role
//     primary moves its assignedAt to just before the others. No schema change: nothing
//     else reads UserRole.assignedAt, and UserRole.createdAt keeps the real assignment time.
//
// Setting off = exactly the old behaviour: every reader below is only called on the
// multi-role path, and multiRoleOn() is false for every org without the flag.

export const MULTI_ROLE_FLAG = 'enableMultiRole';

/** The org's enableMultiRole setting. Never throws: a missing config row (or a test double without the table) is "off". */
export async function multiRoleOn(prisma: any, organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId || !prisma?.organizationUIConfig?.findUnique) return false;
  try {
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
    return ((ui?.features as any) || {})[MULTI_ROLE_FLAG] === true;
  } catch {
    return false;
  }
}

/** The orgs among `ids` that have the setting on (one query). */
export async function multiRoleOrgs(prisma: any, ids: string[]): Promise<Set<string>> {
  if (!ids.length || !prisma?.organizationUIConfig?.findMany) return new Set();
  try {
    const rows = await prisma.organizationUIConfig.findMany({ where: { organizationId: { in: ids } }, select: { organizationId: true, features: true } });
    return new Set((rows as any[]).filter((r) => ((r.features as any) || {})[MULTI_ROLE_FLAG] === true).map((r) => r.organizationId));
  } catch {
    return new Set();
  }
}

type PermRow = { resource: string; action: string };
type RoleWithPerms = { permissions: PermRow[] };

const grants = (perms: PermRow[], required: string) => {
  const [resource, action] = required.split(':');
  return perms.some((p) => (p.resource === resource || p.resource === '*') && (p.action === action || p.action === '*'));
};

/**
 * Do these roles grant every required permission?
 *   union=false (the guard's historic rule): ONE role must hold them all.
 *   union=true (multi-role orgs): the roles together must hold them all.
 * With a single required permission (every @Permissions in the code today) both agree.
 */
export function rolesGrant(roles: RoleWithPerms[], required: string[], union: boolean): boolean {
  if (!required.length) return true;
  if (union) {
    const all = roles.flatMap((r) => r.permissions || []);
    return required.every((p) => grants(all, p));
  }
  return roles.some((r) => required.every((p) => grants(r.permissions || [], p)));
}

/**
 * Guard fallback (src/auth/clerk-auth.guard.ts calls this only after the one-role check
 * failed): for a multi-role org, the union of the user's roles there.
 */
export async function multiRoleUnionGrants(prisma: any, organizationId: string, roles: RoleWithPerms[], required: string[]): Promise<boolean> {
  if (roles.length < 2) return false;
  if (!(await multiRoleOn(prisma, organizationId))) return false;
  return rolesGrant(roles, required, true);
}

/** Modules the roles open together: null = every module (no roles, or any role with an empty list). */
export function unionAllowedModules(roles: Array<{ allowedModules?: string[] | null }>): string[] | null {
  if (!roles.length) return null;
  if (roles.some((r) => (r.allowedModules ?? []).length === 0)) return null;
  return [...new Set(roles.flatMap((r) => r.allowedModules ?? []))];
}

type RankRow = { roleId: string; assignedAt?: Date | string | null; createdAt?: Date | string | null; id?: string };
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER);

/** Sort active role rows primary first (earliest assignedAt, then createdAt, then id). */
export function orderPrimaryFirst<T extends RankRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => ms(a.assignedAt) - ms(b.assignedAt) || ms(a.createdAt) - ms(b.createdAt) || String(a.id ?? a.roleId).localeCompare(String(b.id ?? b.roleId)));
}

/** The primary role id among active role rows, or null when there are none. */
export function primaryRoleIdOf(rows: RankRow[]): string | null {
  return orderPrimaryFirst(rows)[0]?.roleId ?? null;
}

export type RoleSavePlan = {
  /** Active roles to switch off (rows kept, as Edit User always did). */
  deactivate: string[];
  /** Rows to create or switch on, with the assignedAt each must carry. */
  upserts: Array<{ roleId: string; assignedAt: Date }>;
  /** The primary role after the save. */
  primaryRoleId: string;
};

/**
 * A multi-role save. `roleIds` is the full chosen set in the order chosen; the primary is
 * `primaryRoleId` when it is one of them, else the current primary if kept, else the first
 * chosen. Kept roles keep their assignedAt unless they become primary; new (or switched
 * back on) roles get `now` (+1 ms each, in the chosen order) so they never jump ahead.
 */
export function planRoleSave(current: RankRow[], roleIds: string[], primaryRoleId: string | null | undefined, now: Date): RoleSavePlan {
  const ids = [...new Set(roleIds.filter(Boolean))];
  if (!ids.length) throw new Error('planRoleSave: at least one role');
  const kept = current.filter((r) => ids.includes(r.roleId));
  const deactivate = current.filter((r) => !ids.includes(r.roleId)).map((r) => r.roleId);
  const curPrimary = primaryRoleIdOf(kept);
  const primary = primaryRoleId && ids.includes(primaryRoleId) ? primaryRoleId : curPrimary ?? ids[0];

  const at = new Map<string, number>();
  for (const r of kept) at.set(r.roleId, ms(r.assignedAt ?? r.createdAt ?? now));
  const changed = new Set<string>();
  ids.filter((id) => !at.has(id)).forEach((id, i) => {
    at.set(id, now.getTime() + i);
    changed.add(id);
  });
  const others = ids.filter((id) => id !== primary).map((id) => at.get(id)!);
  const earliestOther = others.length ? Math.min(...others) : null;
  if (earliestOther !== null && at.get(primary)! >= earliestOther) {
    at.set(primary, earliestOther - 1000);
    changed.add(primary);
  }
  return {
    deactivate,
    upserts: ids.filter((id) => changed.has(id)).map((roleId) => ({ roleId, assignedAt: new Date(at.get(roleId)!) })),
    primaryRoleId: primary,
  };
}

/** Role names before / after a save, for the Activity Log row. */
export function roleChangeSummary(before: string[], after: string[], primaryBefore: string | null, primaryAfter: string | null) {
  const added = after.filter((n) => !before.includes(n));
  const removed = before.filter((n) => !after.includes(n));
  return {
    roles: { from: before, to: after },
    ...(added.length ? { added } : {}),
    ...(removed.length ? { removed } : {}),
    ...(primaryBefore !== primaryAfter ? { primaryRole: { from: primaryBefore, to: primaryAfter } } : {}),
  };
}
