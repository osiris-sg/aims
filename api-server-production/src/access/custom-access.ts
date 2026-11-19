/**
 * Custom access at request time (see tab-access.ts for the model). Used by ClerkAuthGuard,
 * GET /users/me/roles, the Users list and the sales report scope.
 *
 * Every reader is a no-op unless the org has features.enableCustomAccess (or
 * features.enforcePresetTabs): resolveCustomAccess() returns null, and the caller carries on
 * exactly as before. The org's two settings are cached per process for 30 s (one read per org,
 * never per request); a user's CustomAccess rows only load in an org with the setting on.
 */
import {
  PRESET_TAB_ACCESS,
  UNRESTRICTED_ROLES,
  roleModulesFor,
  permissionsFor,
  readTabAccess,
  unionTabAccess,
  type TabAccessMap,
} from './tab-access';

export const CUSTOM_ACCESS_FLAG = 'enableCustomAccess';
export const PRESET_TABS_FLAG = 'enforcePresetTabs';
export const NO_TAB_ACCESS_MESSAGE = 'Your access does not include this page';
/** The role a custom-access person is shown as (GET /users/me/roles). */
export const CUSTOM_ACCESS_ROLE_ID = 'custom-access';
export const CUSTOM_ACCESS_ROLE_NAME = 'Custom access';
/** Stored on a custom role's description; how the portal tells it from a preset. */
export const CUSTOM_PREFIX = 'Custom · ';

export type AccessKind = 'ROLE' | 'USER';
export type ResolvedAccess = { source: 'user' | 'roles' | 'presets'; map: TabAccessMap };
type RoleLike = { id: string; name: string };

// Same TTL as the guard's role cache (AUTH_CACHE_TTL_MS, default 30 s; 0 = no cache).
const TTL_MS = (() => {
  const raw = process.env.AUTH_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 30_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30_000;
})();
const flagCache = new Map<string, { custom: boolean; presets: boolean; at: number }>();
const rowCache = new Map<string, { user: TabAccessMap | null; roles: Map<string, TabAccessMap>; at: number }>();

/** Drop cached settings / rows (an org's, or everything). Called after every access change. */
export function invalidateCustomAccess(organizationId?: string) {
  if (!organizationId) {
    flagCache.clear();
    rowCache.clear();
    return;
  }
  flagCache.delete(organizationId);
  for (const k of [...rowCache.keys()]) if (k.startsWith(`${organizationId}|`)) rowCache.delete(k);
}

/** The org's two settings. Never throws: a missing config row (or a test double without the table) is "off". */
export async function accessFlags(prisma: any, organizationId: string | null | undefined): Promise<{ custom: boolean; presets: boolean }> {
  if (!organizationId || !prisma?.organizationUIConfig?.findUnique) return { custom: false, presets: false };
  const hit = flagCache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  let custom = false;
  let presets = false;
  try {
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
    const f = ((ui?.features as any) || {}) as Record<string, unknown>;
    custom = f[CUSTOM_ACCESS_FLAG] === true;
    presets = f[PRESET_TABS_FLAG] === true;
  } catch {
    /* off */
  }
  const out = { custom, presets, at: Date.now() };
  if (TTL_MS > 0) flagCache.set(organizationId, out);
  return out;
}

/** The person's own map and the custom roles' maps among roleIds (one read, cached). */
export async function loadAccessRows(prisma: any, organizationId: string, userId: string, roleIds: string[]) {
  const key = `${organizationId}|${userId}|${[...roleIds].sort().join(',')}`;
  const hit = rowCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const out = { user: null as TabAccessMap | null, roles: new Map<string, TabAccessMap>(), at: Date.now() };
  if (prisma?.customAccess?.findMany) {
    try {
      const rows: any[] = await prisma.customAccess.findMany({
        where: { organizationId, OR: [{ kind: 'USER', subjectId: userId }, ...(roleIds.length ? [{ kind: 'ROLE', subjectId: { in: roleIds } }] : [])] },
        select: { kind: true, subjectId: true, tabs: true },
      });
      for (const r of rows) {
        if (r.kind === 'USER' && r.subjectId === userId) out.user = readTabAccess(r.tabs);
        else if (r.kind === 'ROLE') out.roles.set(r.subjectId, readTabAccess(r.tabs));
      }
    } catch {
      /* table missing: nothing custom */
    }
  }
  if (TTL_MS > 0) rowCache.set(key, out);
  return out;
}

/**
 * The tab map that governs this person in this org, or null (= roles and permissions as before).
 *   1. their own Custom access (supersedes every role);
 *   2. Admin / superadmin / field-tech / any hand-made role: null;
 *   3. only custom roles: the union of their maps;
 *   4. enforcePresetTabs orgs: presets (+ custom roles) by PRESET_TAB_ACCESS, union.
 */
export async function resolveCustomAccess(prisma: any, organizationId: string | null | undefined, userId: string | null | undefined, roles: RoleLike[]): Promise<ResolvedAccess | null> {
  if (!organizationId || !userId) return null;
  const flags = await accessFlags(prisma, organizationId);
  if (!flags.custom && !flags.presets) return null;
  const rows = flags.custom ? await loadAccessRows(prisma, organizationId, userId, roles.map((r) => r.id)) : { user: null, roles: new Map<string, TabAccessMap>() };
  if (rows.user) return { source: 'user', map: rows.user };
  if (!roles.length) return null;
  if (roles.some((r) => UNRESTRICTED_ROLES.has(r.name))) return null;
  const customMaps = roles.map((r) => rows.roles.get(r.id)).filter(Boolean) as TabAccessMap[];
  if (flags.custom && customMaps.length === roles.length) return { source: 'roles', map: unionTabAccess(customMaps) };
  if (flags.presets) {
    const maps = roles.map((r) => rows.roles.get(r.id) ?? PRESET_TAB_ACCESS[r.name]);
    if (maps.every(Boolean)) return { source: 'presets', map: unionTabAccess(maps as TabAccessMap[]) };
  }
  return null;
}

/**
 * GET /users/me/roles for a custom-access org: a person with their own Custom access is shown as
 * ONE role "Custom access" (its permissions + modules from the map), so every screen that reads
 * the roles (nav, buttons) follows it; custom roles carry their tabAccess. Other orgs: unchanged.
 */
export async function withCustomAccess(prisma: any, organizationId: string, userId: string, roles: any[]): Promise<any[]> {
  const flags = await accessFlags(prisma, organizationId);
  if (!flags.custom) return roles;
  const rows = await loadAccessRows(prisma, organizationId, userId, roles.map((r) => r.id));
  if (rows.user) {
    const catalogue: any[] = prisma?.permission?.findMany ? await prisma.permission.findMany({ select: { id: true, name: true, resource: true, action: true } }) : [];
    const names = new Set(permissionsFor(rows.user, catalogue.map((p) => p.name)));
    return [
      {
        id: CUSTOM_ACCESS_ROLE_ID,
        name: CUSTOM_ACCESS_ROLE_NAME,
        description: null,
        organizationId,
        allowedModules: roleModulesFor(rows.user),
        permissions: catalogue.filter((p) => names.has(p.name)),
        tabAccess: rows.user,
        isPrimary: true,
        customAccess: true,
      },
    ];
  }
  return roles.map((r) => (rows.roles.has(r.id) ? { ...r, tabAccess: rows.roles.get(r.id) } : r));
}

/** The people among userIds with their own Custom access in this org (Users list "Custom"). */
export async function customAccessUserIds(prisma: any, organizationId: string, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const flags = await accessFlags(prisma, organizationId);
  if (!flags.custom || !prisma?.customAccess?.findMany) return new Set();
  try {
    const rows: any[] = await prisma.customAccess.findMany({ where: { organizationId, kind: 'USER', subjectId: { in: userIds } }, select: { subjectId: true } });
    return new Set(rows.map((r) => r.subjectId));
  } catch {
    return new Set();
  }
}
