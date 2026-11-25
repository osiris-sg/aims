// Role preview (2026-11-25): "Viewing as" on the profile menu can show the portal's menus as one of the org's roles
// (e.g. a custom "Salesperson"), so an admin can check that role's menus. Portal only: the server still checks the
// person's own roles on every request. Kept per tab (sessionStorage) and per org.

export const ROLE_PREVIEW_KEY = "aims-role-preview";

export interface RolePreview {
  orgId: string;
  roleId: string;
  name: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const store = (): Store | null => {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

export function readRolePreview(s: Store | null = store()): RolePreview | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s.getItem(ROLE_PREVIEW_KEY) || "null");
    return v && typeof v.roleId === "string" && typeof v.orgId === "string" ? { orgId: v.orgId, roleId: v.roleId, name: String(v.name ?? "") } : null;
  } catch {
    return null;
  }
}

/** The preview for this org, or null (a preview started in another org does not apply here). */
export function rolePreviewFor(orgId: string | null | undefined, s: Store | null = store()): RolePreview | null {
  const p = readRolePreview(s);
  return p && orgId && p.orgId === orgId ? p : null;
}

export function startRolePreview(p: RolePreview, s: Store | null = store()): void {
  try {
    s?.setItem(ROLE_PREVIEW_KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: no preview.
  }
}

export function stopRolePreview(s: Store | null = store()): void {
  try {
    s?.removeItem(ROLE_PREVIEW_KEY);
  } catch {
    // nothing to do
  }
}

/** The roles "Viewing as" offers: the org's roles by name, platform roles left out. */
export function previewableRoles(roles: Array<{ id?: string; name?: string | null; organizationId?: string | null }> | null | undefined): Array<{ id: string; name: string }> {
  return (roles ?? [])
    .filter((r): r is { id: string; name: string } => !!r?.id && !!r?.name && !/^(superadmin|osirisadmin)$/i.test(String(r.name)))
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
