import { type ExecutionContext, Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from './decorators/permissions.decorator';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class ClerkAuthGuard extends AuthGuard('clerk') {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {
    super();
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

    console.log('⚡ Auth guard started for user:', user.id);
    const authStart = Date.now();

    // Optimize: Get all user data in parallel with a single optimized query
    const [userRoles, userOrg] = await Promise.all([
      // Get all user roles with minimal nested data
      this.prisma.userRole.findMany({
        where: {
          userId: user.id,
          isActive: true,
        },
        select: {
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
        },
      }),
      // Get user organization
      this.prisma.userOrganization.findFirst({
        where: {
          userId: user.id,
          isActive: true,
        },
        select: {
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
        },
      }),
    ]);

    const authQueryDuration = Date.now() - authStart;
    console.log(`📊 Auth queries completed in ${authQueryDuration}ms`);

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
        console.log(`🔀 Org switch: ${userOrg?.organization?.name ?? '(none)'} → ${target.name}`);
      } else {
        console.warn(`Org switch: org "${headerVal}" not found; falling back to membership org`);
      }
    }

    // For OsirisAdmin, allow access without organization constraint for platform operations
    if (isOsirisAdmin) {
      console.log('User is osiris-admin');
      // Honor the switch override when present; otherwise fall back to the
      // user's membership org (the original behavior).
      request.userOrganization = overrideOrg ?? userOrg?.organization ?? null;
      request.isOsirisAdmin = true;
    } else {
      console.log('User is not osiris-admin');
      // For regular users, require organization assignment
      if (!userOrg) {
        console.log('User is not assigned to any organization');
        console.warn(`User ${user.id} is not assigned to any organization`);
        throw new ForbiddenException('User is not assigned to any organization. Please contact your administrator to be assigned to an organization.');
      } else {
        request.userOrganization = userOrg.organization;
        console.log('User is assigned to an organization:', userOrg.organization.name);
      }
      request.isOsirisAdmin = false;
    }

    // Get required permissions from the route handler
    const requiredPermissions = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getHandler());

    // If no permissions are required, user just needs to be authenticated
    if (!requiredPermissions || requiredPermissions.length === 0) {
      const totalAuthDuration = Date.now() - authStart;
      console.log(`✅ Auth completed in ${totalAuthDuration}ms (no permissions required)`);
      return true;
    }

    // OsirisAdmin bypasses all permission checks
    if (isOsirisAdmin) {
      const totalAuthDuration = Date.now() - authStart;
      console.log(`✅ Auth completed in ${totalAuthDuration}ms (osiris-admin bypass)`);
      return true;
    }

    // Filter roles based on context (we already have all the data)
    let relevantUserRoles;
    if (isOsirisAdmin) {
      // For OsirisAdmin, use all their roles
      relevantUserRoles = userRoles;
    } else {
      // For regular users, filter by organization
      relevantUserRoles = userRoles.filter((userRole) => userRole.organizationId === userOrg.organization.id);
    }

    if (relevantUserRoles.length === 0) {
      throw new ForbiddenException(isOsirisAdmin ? 'OsirisAdmin user has no assigned roles' : 'User has no assigned roles in this organization');
    }

    // Check if any of the user's roles has all the required permissions
    for (const userRole of relevantUserRoles) {
      const role = userRole.role;

      const hasAllPermissions = requiredPermissions.every((requiredPermission) => {
        const [resource, action] = requiredPermission.split(':');

        console.log(' Resource: ', resource);
        console.log(' Action: ', action);

        return role.permissions.some((p) => (p.resource === resource || p.resource === '*') && (p.action === action || p.action === '*'));
      });

      if (hasAllPermissions) {
        const totalAuthDuration = Date.now() - authStart;
        console.log(`✅ Auth completed in ${totalAuthDuration}ms (permissions verified)`);
        return true;
      }
    }

    const totalAuthDuration = Date.now() - authStart;
    console.log(`❌ Auth failed in ${totalAuthDuration}ms (insufficient permissions)`);
    throw new ForbiddenException('User does not have sufficient permissions');
  }
}
