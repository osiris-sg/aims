// Round AW (2026-10-31): who may manage users / roles / permissions, and where.
// A platform admin is a holder of the `osirisadmin` role (ClerkAuthGuard sets
// req.isOsirisAdmin); everyone else acts only inside their current org.

/** The caller of a user / role endpoint. */
export interface AdminActor {
  /** The caller's current org (the "viewing as" org for a platform admin). */
  orgId: string;
  /** osirisadmin — keeps its cross-org reach. */
  platform: boolean;
  /** Clerk id of the caller. */
  userId?: string;
}

export const actorOf = (req: any, orgId: string): AdminActor => ({ orgId, platform: !!req?.isOsirisAdmin, userId: req?.user?.id });

/** Compared case-, space-, hyphen- and underscore-insensitively ("Super Admin" = superadmin). */
export const normRoleName = (name: unknown) => String(name ?? '').toLowerCase().replace(/[\s_\-.]+/g, '');

/** Role names the server or portal keys on. Only a platform admin may create one or rename a role to one. */
export const RESERVED_ROLE_NAMES = [
  'osirisadmin', // ClerkAuthGuard: platform admin
  'superadmin', // portal admin menus, useRoleGate
  'admin', // portal admin menus (case-insensitive)
  'field-tech', // field guard + push service
  'normal_user', // submit-only gate
  'Designer', // hierarchy tiers (role-tier.ts, useNavModules)
  'Junior Manager',
  'Senior Manager',
  'Marketing',
];
const RESERVED = new Set(RESERVED_ROLE_NAMES.map(normRoleName));
export const isReservedRoleName = (name: unknown) => RESERVED.has(normRoleName(name));

/** Roles only a platform admin may edit or delete. */
const PLATFORM_ROLES = new Set(['osirisadmin', 'superadmin']);
export const isPlatformRoleName = (name: unknown) => PLATFORM_ROLES.has(normRoleName(name));

/** Permissions that reach beyond one org; only a platform admin may add them to a role. */
export const PLATFORM_PERMISSIONS = [
  'permissions:create',
  'permissions:update',
  'permissions:delete',
  'organizations:create',
  'organizations:delete',
  'organizations:read', // lists every org
  'organizations:read-one', // reads any org by id
];

/** The org whose `osirisadmin` role makes a platform admin (id fixed by scripts/assign-osirisadmin.ts). */
export const PLATFORM_ORG_ID = 'osiris-platform';

/**
 * Round AW: a user-role row makes its holder a platform admin only when it is
 * the `osirisadmin` role OF the osiris-platform org (assigned in that org).
 * An `osirisadmin` role in any other org is just a role.
 */
export const isPlatformAdminRole = (ur: { organizationId?: string | null; role?: { name?: string | null; organizationId?: string | null } | null } | null | undefined) =>
  ur?.role?.name === 'osirisadmin' && ur.role.organizationId === PLATFORM_ORG_ID && (ur.organizationId === undefined || ur.organizationId === PLATFORM_ORG_ID);

/** The same rule as a Prisma UserRole filter. */
export const PLATFORM_ADMIN_ROLE_WHERE = { organizationId: PLATFORM_ORG_ID, role: { name: 'osirisadmin', organizationId: PLATFORM_ORG_ID } };
