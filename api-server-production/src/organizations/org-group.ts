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
