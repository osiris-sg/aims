import { type ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
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
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

    if (isPublic) {
      return true;
    }

    // First check if user is authenticated
    const isAuthenticated = await super.canActivate(context);

    if (!isAuthenticated) {
      return false;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Get user's organization
    const userOrg = await this.prisma.userOrganization.findFirst({
      where: {
        userId: user.id,
        isActive: true,
      },
      include: {
        organization: true,
      },
    });

    // For now, allow users without organization assignment (for development)
    // In production, you might want to require organization assignment
    if (!userOrg) {
      console.warn(`User ${user.id} is not assigned to any organization`);
      // You can either:
      // 1. Throw an error: throw new ForbiddenException('User is not assigned to any organization');
      // 2. Or allow access without organization context (current approach)
      request.userOrganization = null;
    } else {
      // Attach organization to request for use in controllers
      request.userOrganization = userOrg.organization;
    }

    // Get required permissions from the route handler
    const requiredPermissions = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getHandler());

    // If no permissions are required, user just needs to be authenticated
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    // If user has no organization, they can't have permissions
    if (!userOrg) {
      throw new ForbiddenException('User is not assigned to any organization');
    }

    // Get user roles with permissions from database (scoped to organization)
    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId: user.id,
        organizationId: userOrg.organization.id,
        isActive: true, // Only active roles
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (userRoles.length === 0) {
      throw new ForbiddenException('User has no assigned roles in this organization');
    }

    // Check if any of the user's roles has all the required permissions
    for (const userRole of userRoles) {
      const role = userRole.role;

      const hasAllPermissions = requiredPermissions.every((requiredPermission) => {
        const [resource, action] = requiredPermission.split(':');

        console.log(' Resource: ', resource);
        console.log(' Action: ', action);

        return role.permissions.some((p) => (p.resource === resource || p.resource === '*') && (p.action === action || p.action === '*'));
      });

      if (hasAllPermissions) {
        return true;
      }
    }

    throw new ForbiddenException('Insufficient permissions');
  }
}
