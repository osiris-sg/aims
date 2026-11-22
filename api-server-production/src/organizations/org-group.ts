/**
 * Org groups (WCT 2026-11-17): a parent org and its child orgs, stored as data
 * (Organization.parentOrgId; scripts/org-group-set.js sets it), never as
 * hard-coded ids.
 *
 * Tenancy stays per org. The ONLY cross-org read is a feature named in
 * ORG_GROUP_SHARED_FEATURES, and only when the parent org's own setting for it
 * is on (default off):
 *  - downward only: a parent reads its direct children; a child never reads its
 *    parent or its siblings; an org with no children reads only itself;
 *  - read only: every write keeps using the request org and its own ids;
 *  - nothing else (documents, customers, GL, search, reports) crosses orgs.
 *
 * Opening a record of another org from a shared view needs membership there
 * (an active UserOrganization row AND an active UserRole in that org);
 * otherwise the item is view only (the server strips its links).
 */
import { isOrgFeatureEnabled } from '../common/org-features';

/** Features that may read across an org group. The jobs calendar is the first and only one. */
export const ORG_GROUP_SHARED_FEATURES = ['jobsCalendar'] as const;
export type OrgGroupFeature = (typeof ORG_GROUP_SHARED_FEATURES)[number];

/** The per-org setting (OrganizationUIConfig.features) that turns each shared feature on for a parent org. */
export const GROUP_CALENDAR_FLAG = 'enableGroupCalendar';
export const ORG_GROUP_FEATURE_FLAG: Record<OrgGroupFeature, string> = { jobsCalendar: GROUP_CALENDAR_FLAG };

export interface GroupOrg {
  id: string;
  name: string;
}

export interface GroupReadScope {
  /** true = the group view is on: `orgs` holds the request org first, then its children. */
  group: boolean;
  orgs: GroupOrg[];
}

export const isGroupSharedFeature = (f: unknown): f is OrgGroupFeature => typeof f === 'string' && (ORG_GROUP_SHARED_FEATURES as readonly string[]).includes(f);

/**
 * The direct children of an org (parentOrgId = orgId), by name. Raw SQL on purpose:
 * the column is read without a regenerated Prisma client (worktrees share
 * node_modules), and a database that does not have the column yet answers [].
 */
export async function childOrgsOf(prisma: any, orgId: string): Promise<GroupOrg[]> {
  if (!orgId || typeof prisma?.$queryRawUnsafe !== 'function') return [];
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      'SELECT "id", "name" FROM "Organization" WHERE "parentOrgId" = $1 AND "id" <> $1 ORDER BY "name" ASC',
      orgId,
    );
    return (rows ?? []).filter((r) => r && typeof r.id === 'string' && r.id !== orgId).map((r) => ({ id: r.id, name: String(r.name ?? '') }));
  } catch {
    return [];
  }
}

/**
 * Which orgs a shared feature may read for a request org. Gate off (or a feature
 * outside the allowlist, or no children) = the request org alone, group false.
 */
export async function groupReadScope(prisma: any, orgId: string, feature: OrgGroupFeature): Promise<GroupReadScope> {
  const own: GroupReadScope = { group: false, orgs: [{ id: orgId, name: '' }] };
  if (!isGroupSharedFeature(feature)) return own;
  if (!(await isOrgFeatureEnabled(prisma, orgId, ORG_GROUP_FEATURE_FLAG[feature]))) return own;
  const children = await childOrgsOf(prisma, orgId);
  if (!children.length) return own;
  const me = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  return { group: true, orgs: [{ id: orgId, name: me?.name ?? '' }, ...children] };
}

/**
 * Of `orgIds`, those the user may open: an active membership AND an active role
 * in that org (the same two rows the auth guard needs to serve that org).
 */
export async function memberOrgIds(prisma: any, userId: string | null | undefined, orgIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(orgIds.filter(Boolean))];
  if (!userId || !ids.length) return out;
  const [memberships, roles] = await Promise.all([
    prisma.userOrganization.findMany({ where: { userId, organizationId: { in: ids }, isActive: true }, select: { organizationId: true } }),
    prisma.userRole.findMany({ where: { userId, organizationId: { in: ids }, isActive: true }, select: { organizationId: true } }),
  ]);
  const withRole = new Set((roles ?? []).map((r: any) => r.organizationId));
  for (const m of memberships ?? []) if (withRole.has(m.organizationId)) out.add(m.organizationId);
  return out;
}

/**
 * Group New job (WCT 2026-11-22): the group an org belongs to, for picking which company a new job goes under.
 * Root = the org's parent when that parent has the group calendar on, else the org itself when it has the flag on
 * and has children. Returns [root, ...children by name], or [] when the org is in no active group (every org outside
 * the WCT group). Writes still go to one org at a time: the client sends X-Active-Org-Id for the chosen company, so the
 * auth guard checks membership and the create-job permission THERE; this only says which orgs are in the group.
 */
export async function groupFamily(prisma: any, orgId: string): Promise<GroupOrg[]> {
  if (!orgId || typeof prisma?.$queryRawUnsafe !== 'function') return [];
  let root = orgId;
  try {
    const rows: any[] = await prisma.$queryRawUnsafe('SELECT "parentOrgId" FROM "Organization" WHERE "id" = $1', orgId);
    const parent = rows?.[0]?.parentOrgId;
    if (typeof parent === 'string' && parent && parent !== orgId) root = parent;
  } catch {
    return [];
  }
  if (!(await isOrgFeatureEnabled(prisma, root, GROUP_CALENDAR_FLAG))) return [];
  const children = await childOrgsOf(prisma, root);
  if (!children.length) return [];
  const me = await prisma.organization.findUnique({ where: { id: root }, select: { id: true, name: true } });
  if (!me) return [];
  return [{ id: me.id, name: me.name ?? '' }, ...children];
}

/** The ids of every org in orgId's group (root + children), whatever flags are on; [] outside a group. Never throws. */
export async function groupOrgIds(prisma: any, orgId: string): Promise<string[]> {
  if (!orgId || typeof prisma?.$queryRawUnsafe !== 'function') return [];
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      'SELECT o."id"::text AS id FROM "Organization" o, (SELECT coalesce("parentOrgId", "id") AS root FROM "Organization" WHERE "id" = $1) r WHERE o."id" = r.root OR o."parentOrgId" = r.root',
      orgId,
    );
    return rows.length > 1 ? rows.map((r) => String(r.id)) : [];
  } catch {
    return [];
  }
}

/** The New job "Company" choices: the group's orgs this user may open (osiris admins: all of them). */
export async function groupJobCompanies(prisma: any, orgId: string, userId: string | null | undefined, isAdmin = false): Promise<{ group: boolean; current: string; orgs: GroupOrg[] }> {
  const family = await groupFamily(prisma, orgId);
  if (!family.length) return { group: false, current: orgId, orgs: [] };
  const allowed = isAdmin ? new Set(family.map((o) => o.id)) : await memberOrgIds(prisma, userId, family.map((o) => o.id));
  return { group: true, current: orgId, orgs: family.filter((o) => allowed.has(o.id) || o.id === orgId) };
}

export const OUTSIDE_GROUP_MESSAGE = 'That company is not in your group';
export const NO_COMPANY_ACCESS_MESSAGE = 'You do not have access to that company';

/**
 * A job made from the group calendar under another company (groupFromOrgId = the calendar's org, targetOrgId = the
 * request org the guard already let in). The two must be in the same group, and the user must belong to the calendar's
 * org too. Returns an error message, or null when allowed. Same org = nothing to check.
 */
export async function groupJobTargetError(prisma: any, fromOrgId: unknown, targetOrgId: string, userId: string | null | undefined, isAdmin = false): Promise<string | null> {
  if (fromOrgId === undefined || fromOrgId === null || fromOrgId === '') return null;
  if (typeof fromOrgId !== 'string') return OUTSIDE_GROUP_MESSAGE;
  if (fromOrgId === targetOrgId) return null;
  const family = await groupFamily(prisma, fromOrgId);
  const ids = new Set(family.map((o) => o.id));
  if (!ids.has(fromOrgId) || !ids.has(targetOrgId)) return OUTSIDE_GROUP_MESSAGE;
  if (isAdmin) return null;
  const member = await memberOrgIds(prisma, userId, [fromOrgId, targetOrgId]);
  return member.has(fromOrgId) && member.has(targetOrgId) ? null : NO_COMPANY_ACCESS_MESSAGE;
}
