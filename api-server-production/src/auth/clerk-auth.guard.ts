import { type ExecutionContext, Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from './decorators/permissions.decorator';
import { PrismaService } from '../common/prisma.service';
import { Prisma } from '@prisma/client';

// Selects defined once so the cached row types below stay in sync with the queries.
const USER_ROLE_SELECT = {
  id: true,
  organizationId: true,
  role: {
    select: {
      id: true,
      name: true,
      permissions: {
        select: {
          name: true,
          resource: true,
          action: true,
        },
      },
    },
  },
} satisfies Prisma.UserRoleSelect;

const USER_ORG_SELECT = {
  organization: {
    select: {
      id: true,
      name: true,
      address: true,
      phoneNumber: true,
      registrationNumber: true,
      logo: true,
      defaultStamp: true,
      customDocumentTypes: true,
      taxRate: true,
      taxApplicable: true,
      absorbTax: true,
      defaultCurrency: true,
      quoteRoundingStep: true,
      docTypeDefaults: true,
      pointsBalance: true,
      bankDetails: true,
    },
  },
} satisfies Prisma.UserOrganizationSelect;

// Narrowed (by `select`) row shapes that the two auth lookups actually return.
type CachedUserRoles = Prisma.UserRoleGetPayload<{ select: typeof USER_ROLE_SELECT }>[];
type CachedUserOrg = Prisma.UserOrganizationGetPayload<{ select: typeof USER_ORG_SELECT }> | null;

interface AuthCacheEntry {
  userRoles: CachedUserRoles;
  userOrg: CachedUserOrg;
  expiresAt: number;
}

// The guard is a singleton (registered as APP_GUARD with default scope), so this
// process-local cache is shared across every request. It removes the 2 Neon
// round-trips the guard otherwise runs on EVERY authenticated request (measured
// 65-604ms each under parallel load) — the biggest remaining per-request tax.
//
// Trade-off: role / org / permission changes take up to AUTH_CACHE_TTL_MS to
// propagate (or call ClerkAuthGuard.invalidateUser() from the mutating service
// for instant effect). Set AUTH_CACHE_TTL_MS=0 to disable caching entirely.
//
// Auth itself is NOT weakened: the session token is re-verified on every request
// in ClerkStrategy; this only caches the user's roles/org rows.
const AUTH_CACHE_TTL_MS = (() => {
  const raw = process.env.AUTH_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 30_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000;
})();

// Verbose per-request logging is off unless explicitly enabled — it was
// synchronous console I/O on every request in the original guard.
const AUTH_DEBUG = process.env.AUTH_DEBUG === 'true';
const dbg = (...args: unknown[]) => {
  if (AUTH_DEBUG) console.log(...args);
};

@Injectable()
export class ClerkAuthGuard extends AuthGuard('clerk') {
  // Module-level cache shared across all (singleton) instances of the guard.
  private static readonly authCache = new Map<string, AuthCacheEntry>();

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {
    super();
  }

  /**
   * Drop a user's cached roles/org so their next request re-reads from the DB.
   * Call this from services that mutate UserRole / UserOrganization / org
   * settings to propagate changes instantly instead of waiting out the TTL.
   */
  static invalidateUser(userId: string): void {
    ClerkAuthGuard.authCache.delete(userId);
  }

  /** Clear the entire auth cache (e.g. after a bulk permissions migration). */
  static invalidateAll(): void {
    ClerkAuthGuard.authCache.clear();
  }

  /**
   * Fetch the user's active roles + membership org, served from a short-lived
   * per-user cache when warm. The org-switch override (X-Active-Org-Id) is
   * applied by the caller AFTER this, so switching orgs is never cached.
   */
  private async loadUserAuth(userId: string): Promise<{ userRoles: CachedUserRoles; userOrg: CachedUserOrg }> {
    const now = Date.now();

    if (AUTH_CACHE_TTL_MS > 0) {
      const cached = ClerkAuthGuard.authCache.get(userId);
      if (cached && cached.expiresAt > now) {
        dbg('🎯 Auth cache hit for user:', userId);
        return { userRoles: cached.userRoles, userOrg: cached.userOrg };
      }
    }

    const [userRoles, userOrg] = await Promise.all([
      // Get all user roles with minimal nested data
      this.prisma.userRole.findMany({
        where: {
          userId,
          isActive: true,
        },
        select: USER_ROLE_SELECT,
      }),
      // Get user organization
      this.prisma.userOrganization.findFirst({
        where: {
          userId,
          isActive: true,
        },
        select: USER_ORG_SELECT,
      }),
    ]);

    if (AUTH_CACHE_TTL_MS > 0) {
      ClerkAuthGuard.authCache.set(userId, { userRoles, userOrg, expiresAt: now + AUTH_CACHE_TTL_MS });
      // Opportunistic sweep so the map can't grow unbounded as users churn.
      if (ClerkAuthGuard.authCache.size > 500) {
        for (const [key, entry] of ClerkAuthGuard.authCache) {
          if (entry.expiresAt <= now) ClerkAuthGuard.authCache.delete(key);
        }
      }
    }

    return { userRoles, userOrg };
  }

  async canActivate(context: ExecutionContext) {
    // Check if the route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

    if (isPublic) {
      return true;
    }

    const canActivate = await super.canActivate(context);
    if (!canActivate) {
      return false;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    dbg('⚡ Auth guard started for user:', user.id);
    const authStart = Date.now();

    // Roles + membership org — served from the per-user cache when warm.
    const { userRoles, userOrg } = await this.loadUserAuth(user.id);

    const authQueryDuration = Date.now() - authStart;
    dbg(`📊 Auth data ready in ${authQueryDuration}ms`);

    // Check if user has OsirisAdmin role
    const isOsirisAdmin = userRoles.some((userRole) => userRole.role.name === 'osirisadmin');

    // Org-switch override (X-Active-Org-Id): admin-only. When an osiris-admin
    // has selected a different organization in the org switcher, the frontend
    // sends the chosen org id as a header. We swap request.userOrganization
    // to that org so every downstream org-scoped query reads its data.
    //
    // The X-Use-Real-Org header is an opt-out used by OrganizationContext's
    // bootstrap fetch so it can still learn the user's actual membership org
    // even while a switch override is active.
    //
    // Non-admins: the header is silently ignored — no path overrides
    // request.userOrganization for them.
    let overrideOrg: { id: string; name: string; [k: string]: any } | null = null;
    const rawActiveOrgId = request.headers['x-active-org-id'];
    const rawUseRealOrg = request.headers['x-use-real-org'];
    if (isOsirisAdmin && rawActiveOrgId && !rawUseRealOrg) {
      const headerVal = Array.isArray(rawActiveOrgId) ? rawActiveOrgId[0] : rawActiveOrgId;
      const target = await this.prisma.organization.findUnique({
        where: { id: String(headerVal) },
        select: {
          id: true, name: true, address: true, phoneNumber: true,
          registrationNumber: true, logo: true, defaultStamp: true,
          customDocumentTypes: true, taxRate: true, taxApplicable: true,
          absorbTax: true, defaultCurrency: true, quoteRoundingStep: true,
          docTypeDefaults: true, pointsBalance: true, bankDetails: true,
        },
      });
      if (target) {
        overrideOrg = target;
        dbg(`🔀 Org switch: ${userOrg?.organization?.name ?? '(none)'} → ${target.name}`);
      } else {
        console.warn(`Org switch: org "${headerVal}" not found; falling back to membership org`);
      }
    }

    // For OsirisAdmin, allow access without organization constraint for platform operations
    if (isOsirisAdmin) {
      dbg('User is osiris-admin');
      // Honor the switch override when present; otherwise fall back to the
      // user's membership org (the original behavior).
      request.userOrganization = overrideOrg ?? userOrg?.organization ?? null;
      request.isOsirisAdmin = true;
    } else {
      dbg('User is not osiris-admin');
      // For regular users, require organization assignment
      if (!userOrg) {
        console.warn(`User ${user.id} is not assigned to any organization`);
        throw new ForbiddenException('User is not assigned to any organization. Please contact your administrator to be assigned to an organization.');
      } else {
        request.userOrganization = userOrg.organization;
        dbg('User is assigned to an organization:', userOrg.organization.name);
      }
      request.isOsirisAdmin = false;
    }

    // Get required permissions from the route handler
    const requiredPermissions = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getHandler());

    // If no permissions are required, user just needs to be authenticated
    if (!requiredPermissions || requiredPermissions.length === 0) {
      dbg(`✅ Auth completed in ${Date.now() - authStart}ms (no permissions required)`);
      return true;
    }

    // OsirisAdmin bypasses all permission checks
    if (isOsirisAdmin) {
      dbg(`✅ Auth completed in ${Date.now() - authStart}ms (osiris-admin bypass)`);
      return true;
    }

    // Filter roles based on context (we already have all the data)
    const relevantUserRoles = userRoles.filter((userRole) => userRole.organizationId === userOrg.organization.id);

    if (relevantUserRoles.length === 0) {
      throw new ForbiddenException('User has no assigned roles in this organization');
    }

    // Check if any of the user's roles has all the required permissions
    for (const userRole of relevantUserRoles) {
      const role = userRole.role;

      const hasAllPermissions = requiredPermissions.every((requiredPermission) => {
        const [resource, action] = requiredPermission.split(':');
        return role.permissions.some((p) => (p.resource === resource || p.resource === '*') && (p.action === action || p.action === '*'));
      });

      if (hasAllPermissions) {
        dbg(`✅ Auth completed in ${Date.now() - authStart}ms (permissions verified)`);
        return true;
      }
    }

    dbg(`❌ Auth failed in ${Date.now() - authStart}ms (insufficient permissions)`);
    throw new ForbiddenException('User does not have sufficient permissions');
  }
}
