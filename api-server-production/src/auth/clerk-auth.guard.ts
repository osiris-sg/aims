import { type ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator';
import { PERMISSIONS_KEY } from 'src/auth/decorators/permissions.decorator';
import { PrismaService } from 'src/common/prisma.service';

@Injectable()
export class ClerkAuthGuard extends AuthGuard('clerk') {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService, // Inject PrismaService to check permissions
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // First check if user is authenticated
    const isAuthenticated = await super.canActivate(context);
    
    if (!isAuthenticated) {
      return false;
    }

    // Get required permissions from the route handler
    const requiredPermissions = this.reflector.get<string[]>(
      PERMISSIONS_KEY,
      context.getHandler(),
    );

    // If no permissions are required, user just needs to be authenticated
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Get user roles with permissions from database
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });
    
    if (userRoles.length === 0) {
      throw new ForbiddenException('User has no assigned roles');
    }

    // Check if any of the user's roles has all the required permissions
    for (const userRole of userRoles) {
      const role = userRole.role;

      console.log("user role:" ,userRole);
      
      const hasAllPermissions = requiredPermissions.every(requiredPermission => {
        const [resource, action] = requiredPermission.split(':');

        console.log(" Resource: ", resource);
        console.log(" Action: ", action);
        
        return role.permissions.some(
          p => (p.resource === resource || p.resource === '*') && 
               (p.action === action || p.action === '*')
        );
      });
      
      if (hasAllPermissions) {
        return true;
      }
    }

    throw new ForbiddenException('Insufficient permissions');
  }
}