// src/users/users.service.ts
import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UserRole, Role, Permission } from '@prisma/client';
import { GetUsersDto } from './dto/get-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
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

  async createUser(createUserDto: CreateUserDto) {
    const { firstName, lastName, email, password, roleIds } = createUserDto;

    // Verify that all roles exist
    const roles = await this.prisma.role.findMany({
      where: {
        id: {
          in: roleIds,
        },
      },
    });

    if (roles.length !== roleIds.length) {
      const foundRoleIds = roles.map((role) => role.id);
      const missingRoleIds = roleIds.filter((id) => !foundRoleIds.includes(id));
      throw new NotFoundException(`Roles with IDs ${missingRoleIds.join(', ')} not found`);
    }

    // Create user in Clerk
    let clerkUser;
    try {
      clerkUser = await this.clerkClient.users.createUser({
        firstName,
        lastName,
        emailAddress: [email],
        password,
        skipPasswordChecks: true,
        skipPasswordRequirement: true,
      });
    } catch (error: any) {
      console.error('Error creating user in Clerk:', error);
      if (error.errors?.[0]?.code === 'form_identifier_exists') {
        throw new NotFoundException('A user with this email address already exists');
      }
      throw new NotFoundException('Failed to create user in Clerk: ' + (error.message || 'Unknown error'));
    }

    const userId = clerkUser.id;

    // Create user roles
    const userRoles = await Promise.all(
      roleIds.map((roleId) =>
        this.prisma.userRole.create({
          data: {
            userId,
            roleId,
          },
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        }),
      ),
    );

    return {
      id: userId,
      email: clerkUser.emailAddresses[0]?.emailAddress || email,
      name: `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || clerkUser.username || `User ${userId}`,
      roles: userRoles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
        description: ur.role.description,
        permissions: ur.role.permissions,
      })),
      createdAt: userRoles[0].createdAt,
      updatedAt: userRoles[0].createdAt,
    };
  }

  async updateUser(userId: string, updateUserDto: UpdateUserDto) {
    const { firstName, lastName, email, password, roleIds } = updateUserDto;

    // Check if user exists by looking for their roles
    const existingUserRoles = await this.prisma.userRole.findMany({
      where: { userId },
    });

    if (existingUserRoles.length === 0) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // If roleIds are provided, verify they exist
    if (roleIds && roleIds.length > 0) {
      const roles = await this.prisma.role.findMany({
        where: {
          id: {
            in: roleIds,
          },
        },
      });

      if (roles.length !== roleIds.length) {
        const foundRoleIds = roles.map((role) => role.id);
        const missingRoleIds = roleIds.filter((id) => !foundRoleIds.includes(id));
        throw new NotFoundException(`Roles with IDs ${missingRoleIds.join(', ')} not found`);
      }
    }

    // Update user in Clerk if any profile information is provided
    let clerkUser;
    try {
      // First, get the current user to have existing data
      clerkUser = await this.clerkClient.users.getUser(userId);

      const clerkUpdateData: any = {};

      // Only add fields if they are provided and different from current values
      if (firstName && firstName.trim() && firstName.trim() !== clerkUser.firstName) {
        clerkUpdateData.firstName = firstName.trim();
      }

      if (lastName && lastName.trim() && lastName.trim() !== clerkUser.lastName) {
        clerkUpdateData.lastName = lastName.trim();
      }

      if (email && email.trim() && email.trim() !== clerkUser.emailAddresses[0]?.emailAddress) {
        clerkUpdateData.emailAddress = [email.trim()];
      }

      if (password && password.trim() && password.trim().length >= 8) {
        clerkUpdateData.password = password.trim();
        clerkUpdateData.skipPasswordChecks = true;
        clerkUpdateData.skipPasswordRequirement = true;
      }

      // Only update if there are actual changes
      if (Object.keys(clerkUpdateData).length > 0) {
        console.log('Updating Clerk user with data:', clerkUpdateData);
        clerkUser = await this.clerkClient.users.updateUser(userId, clerkUpdateData);
      }
    } catch (error: any) {
      console.error('Error updating user in Clerk:', error);
      console.error('Clerk error details:', error.errors || error.response?.data);

      if (error.status === 404) {
        throw new NotFoundException('User not found in Clerk');
      }

      // Provide more specific error messages based on Clerk's error response
      let errorMessage = 'Failed to update user in Clerk';
      if (error.errors && Array.isArray(error.errors)) {
        const errorMessages = error.errors.map((err: any) => `${err.code}: ${err.message}`);
        errorMessage += ': ' + errorMessages.join(', ');
      } else if (error.message) {
        errorMessage += ': ' + error.message;
      }

      throw new NotFoundException(errorMessage);
    }

    // Update role assignments if provided
    if (roleIds && roleIds.length > 0) {
      // Delete existing role assignments
      await this.prisma.userRole.deleteMany({
        where: { userId },
      });

      // Create new role assignments
      await Promise.all(
        roleIds.map((roleId) =>
          this.prisma.userRole.create({
            data: {
              userId,
              roleId,
            },
          }),
        ),
      );
    }

    // Fetch updated user roles with details
    const updatedUserRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    return {
      id: userId,
      email: clerkUser.emailAddresses[0]?.emailAddress || email,
      name: `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || clerkUser.username || `User ${userId}`,
      roles: updatedUserRoles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
        description: ur.role.description,
        permissions: ur.role.permissions,
      })),
      createdAt: updatedUserRoles[0]?.createdAt || new Date(),
      updatedAt: new Date(),
    };
  }

  async deleteUser(userId: string) {
    // Check if user has any roles assigned
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
    });

    if (userRoles.length === 0) {
      throw new NotFoundException(`User with ID ${userId} not found or has no roles assigned`);
    }

    // Delete all user role associations
    await this.prisma.userRole.deleteMany({
      where: { userId },
    });

    try {
      await this.clerkClient.users.deleteUser(userId);
    } catch (error) {
      console.error('Error deleting user from Clerk:', error);
    }

    return {
      message: `User ${userId} has been removed from the system`,
      success: true,
    };
  }
}
