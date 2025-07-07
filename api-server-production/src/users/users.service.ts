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
    @Inject('ClerkClient')
    private readonly clerkClient: ClerkClient,
    private readonly prisma: PrismaService,
  ) {}

  async getUsers(getUsersDto: GetUsersDto) {
    const { page = 1, limit = 10, search = '', filters = {} } = getUsersDto;
    const skip = (page - 1) * limit;

    // Build where clause for user roles
    const whereClause: any = {};

    if (search) {
      // Note: We can't search by user name/email directly since users are in Clerk
      // We'll search by userId if it matches the search pattern
      if (search.match(/^[a-zA-Z0-9_-]+$/)) {
        whereClause.userId = { contains: search, mode: 'insensitive' };
      }
    }

    // Get all user roles with pagination
    const userRoles = await this.prisma.userRole.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    const totalDocuments = await this.prisma.userRole.count({ where: whereClause });

    // Group user roles by userId
    const userRolesByUserId: { [key: string]: UserRoleWithDetails[] } = {};
    userRoles.forEach((userRole) => {
      if (!userRolesByUserId[userRole.userId]) {
        userRolesByUserId[userRole.userId] = [];
      }
      userRolesByUserId[userRole.userId].push(userRole as UserRoleWithDetails);
    });

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

  async getUserPermissions(userId: string) {
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

    // Flatten all permissions from all user roles and remove duplicates
    const permissions = new Map();
    userRoles.forEach((userRole) => {
      userRole.role.permissions.forEach((permission) => {
        permissions.set(permission.id, permission);
      });
    });

    return {
      success: true,
      data: Array.from(permissions.values()),
    };
  }

  async assignRoleToUser(userId: string, roleId: string, organizationId: string) {
    // Check if user already has this role in this organization
    const existingUserRole = await this.prisma.userRole.findFirst({
      where: {
        userId,
        roleId,
        organizationId,
      },
    });

    if (existingUserRole) {
      throw new NotFoundException('User already has this role in this organization');
    }

    // Create the user role assignment
    const userRole = await this.prisma.userRole.create({
      data: {
        userId,
        roleId,
        organizationId,
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    return userRole.role;
  }

  async removeRoleFromUser(userId: string, roleId: string, organizationId: string) {
    const userRole = await this.prisma.userRole.findFirst({
      where: {
        userId,
        roleId,
        organizationId,
      },
    });

    if (!userRole) {
      throw new NotFoundException('User does not have this role in this organization');
    }

    await this.prisma.userRole.delete({
      where: { id: userRole.id },
    });

    return { message: 'Role removed successfully' };
  }

  async createUser(createUserDto: CreateUserDto) {
    const { firstName, lastName, email, password, roleIds, organizationId } = createUserDto;

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

    // Ensure user is assigned to the organization
    await this.prisma.userOrganization.upsert({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      update: {
        isActive: true,
      },
      create: {
        userId,
        organizationId,
        isActive: true,
      },
    });

    // Create user roles with organization context
    const userRoles = await Promise.all(
      roleIds.map((roleId) =>
        this.prisma.userRole.create({
          data: {
            userId,
            roleId,
            organizationId,
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
      createdAt: userRoles[0]?.createdAt || new Date(),
      updatedAt: userRoles[0]?.createdAt || new Date(),
    };
  }

  async updateUser(userId: string, updateUserDto: UpdateUserDto) {
    const { firstName, lastName, email, password, roleIds, organizationId } = updateUserDto;

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
    if (roleIds && roleIds.length > 0 && organizationId) {
      // Ensure user is assigned to the organization
      await this.prisma.userOrganization.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
        update: {
          isActive: true,
        },
        create: {
          userId,
          organizationId,
          isActive: true,
        },
      });

      // Delete existing role assignments for this organization
      await this.prisma.userRole.deleteMany({
        where: {
          userId,
          organizationId,
        },
      });

      // Create new role assignments
      await Promise.all(
        roleIds.map((roleId) =>
          this.prisma.userRole.create({
            data: {
              userId,
              roleId,
              organizationId,
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
