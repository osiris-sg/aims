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
            },
          },
        },
      }),
    ]);

    const authQueryDuration = Date.now() - authStart;
    console.log(`📊 Auth queries completed in ${authQueryDuration}ms`);

    // Check if user has OsirisAdmin role
    const isOsirisAdmin = userRoles.some((userRole) => userRole.role.name === 'osirisadmin');

    // For OsirisAdmin, allow access without organization constraint for platform operations
    if (isOsirisAdmin) {
      console.log('User is osiris-admin');
      // Still attach organization if they have one (for mixed operations)
      request.userOrganization = userOrg?.organization || null;
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
