// src/users/users.service.ts
import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UserRole, Role, Permission } from '@prisma/client';
import { GetUsersDto } from './dto/get-users.dto';
import { ClerkClient } from '@clerk/backend';

interface UserRoleWithDetails extends UserRole {
  role: Role & {
    permissions: Permission[];
  };
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    @Inject('ClerkClient')
    private clerkClient: ClerkClient,
  ) {}

  async getUsers(getUsersDto: GetUsersDto) {
    const { page = 1, limit = 10, search, filters } = getUsersDto;
    const skip = (page - 1) * limit;

    // Get all unique userIds first
    const userRoles = await this.prisma.userRole.findMany({
      select: {
        userId: true,
      },
      distinct: ['userId'],
    });

    const userIds = userRoles.map((ur) => ur.userId);

    // Get total count for pagination
    const totalDocuments = userIds.length;

    // Get user roles with their roles and permissions
    const userRolesWithDetails = await this.prisma.userRole.findMany({
      where: {
        userId: {
          in: userIds.slice(skip, skip + limit),
        },
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Group user roles by userId
    const userRolesByUserId = userRolesWithDetails.reduce((acc, ur) => {
      if (!acc[ur.userId]) {
        acc[ur.userId] = [];
      }
      acc[ur.userId].push(ur);
      return acc;
    }, {});

    // Fetch user information from Clerk for each userId
    const transformedUsers = await Promise.all(
      Object.entries(userRolesByUserId).map(async ([userId, roles]: [string, UserRoleWithDetails[]]) => {
        const firstRole = roles[0];

        try {
          // Fetch user from Clerk
          const clerkUser = await this.clerkClient.users.getUser(userId);

          return {
            id: userId,
            email: clerkUser.emailAddresses[0]?.emailAddress || userId,
            name: `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || clerkUser.username || `User ${userId}`,
            roles: roles.map((ur) => ({
              id: ur.role.id,
              name: ur.role.name,
              description: ur.role.description,
              permissions: ur.role.permissions,
            })),
            createdAt: firstRole.createdAt,
            updatedAt: firstRole.createdAt, // Since we don't have updatedAt in UserRole
          };
        } catch (error) {
          console.error(`Error fetching user ${userId} from Clerk:`, error);
          // Fallback to placeholder data if Clerk fetch fails
          return {
            id: userId,
            email: userId,
            name: `User ${userId}`,
            roles: roles.map((ur) => ({
              id: ur.role.id,
              name: ur.role.name,
              description: ur.role.description,
              permissions: ur.role.permissions,
            })),
            createdAt: firstRole.createdAt,
            updatedAt: firstRole.createdAt,
          };
        }
      }),
    );

    return {
      users: transformedUsers,
      totalDocuments,
      totalPagesCount: Math.ceil(totalDocuments / limit),
    };
  }

  async assignRoleToUser(userId: string, roleId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Use upsert to handle both create and update cases
    return this.prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId,
          roleId,
        },
      },
      update: {},
      create: {
        userId,
        roleId,
      },
    });
  }

  async removeRoleFromUser(userId: string, roleId: string) {
    return this.prisma.userRole.delete({
      where: {
        userId_roleId: {
          userId,
          roleId,
        },
      },
    });
  }

  async getUserRoles(userId: string) {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    return userRoles.map((ur) => ur.role);
  }

  async hasRole(userId: string, roleName: string) {
    const count = await this.prisma.userRole.count({
      where: {
        userId,
        role: {
          name: roleName,
        },
      },
    });

    return count > 0;
  }
}
