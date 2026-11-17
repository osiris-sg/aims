// Multi-role users (features.enableMultiRole, WCT group 2026-11-17). The API side is
// api-server-production/src/roles/multi-role.ts. A selection is the chosen role ids in the
// order chosen; the FIRST one is the primary role.

type Perm = { resource: string; action: string };
type RoleLike = { id?: string; name?: string; permissions?: Perm[]; allowedModules?: string[] | null };

/** The union of the roles' permissions (what every org's portal already does). */
export function rolesHavePermission(roles: RoleLike[], resource: string, action: string): boolean {
  return roles.some((r) => (r.permissions || []).some((p) => (p.resource === resource || p.resource === "*") && (p.action === action || p.action === "*")));
}

/** The union of the roles' allowedModules: no roles, or any role with an empty list, opens every module. */
export function rolesAllowModule(roles: RoleLike[], moduleCode: string): boolean {
  if (roles.length === 0) return true;
  if (roles.some((r) => (r.allowedModules ?? []).length === 0)) return true;
  return roles.flatMap((r) => r.allowedModules ?? []).includes(moduleCode);
}

/** A user's roles as a selection, primary first (the list sends primaryRoleId on multi-role orgs). */
export function selectionFromUser(user: { roles?: Array<{ id: string }>; primaryRoleId?: string | null } | null | undefined): string[] {
  const ids = (user?.roles || []).map((r) => r.id);
  const p = user?.primaryRoleId;
  return p && ids.includes(p) ? [p, ...ids.filter((id) => id !== p)] : ids;
}

/** The Select's new value: kept roles stay in place, new ones are added at the end (the first chosen stays primary). */
export function applySelect(prev: string[], next: string[]): string[] {
  const kept = prev.filter((id) => next.includes(id));
  return [...kept, ...next.filter((id) => !kept.includes(id))];
}

/** Make a chosen role the primary one. */
export function makePrimary(sel: string[], id: string): string[] {
  return sel.includes(id) ? [id, ...sel.filter((x) => x !== id)] : sel;
}

/** Take a role off (the next one becomes primary when the primary is removed). */
export function removeRole(sel: string[], id: string): string[] {
  return sel.filter((x) => x !== id);
}

export const primaryOf = (sel: string[]): string | null => sel[0] ?? null;

/** What Add / Edit User send: the roles, plus the primary on multi-role orgs only. */
export function rolePayload(sel: string[], multi: boolean): { roleIds: string[]; primaryRoleId?: string } {
  return multi && sel.length ? { roleIds: sel, primaryRoleId: sel[0] } : { roleIds: sel };
}

/** Preset-role orgs pick ONE role, unless the org runs multi-role. */
export const singleRolePicker = (presets: boolean, multi: boolean): boolean => presets && !multi;
