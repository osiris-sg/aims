// src/roles/roles.service.ts
import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AdminActor, isPlatformRoleName, isReservedRoleName, normRoleName, PLATFORM_PERMISSIONS } from '../auth/admin-scope';
import { PrismaService } from 'src/common/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  /** Round AW: a non-platform caller only sees / changes roles of their own org (404 otherwise). */
  private assertOwn(role: { organizationId: string }, actor?: AdminActor) {
    if (actor && !actor.platform && role.organizationId !== actor.orgId) throw new NotFoundException('Role not found');
  }

  /** Round AW: permissions that reach beyond one org are added to a role only by a platform admin. */
  private async assertNoPlatformGrant(permissionIds: string[] | undefined, already: string[], actor?: AdminActor) {
    if (!actor || actor.platform || !permissionIds?.length) return;
    const added = permissionIds.filter((id) => !already.includes(id));
    if (!added.length) return;
    const hits = await this.prisma.permission.findMany({ where: { id: { in: added }, name: { in: PLATFORM_PERMISSIONS } }, select: { name: true } });
    if (hits.length) throw new ForbiddenException(`Only Osiris can grant ${hits.map((h) => h.name).join(', ')}`);
  }

  async create(createRoleDto: CreateRoleDto, organizationId: string, actor?: AdminActor) {
    const { permissionIds, allowedModules, ...roleData } = createRoleDto;
    if (actor && !actor.platform && isReservedRoleName(roleData.name)) {
      throw new BadRequestException(`"${roleData.name}" is a reserved role name`);
    }
    await this.assertNoPlatformGrant(permissionIds, [], actor);

    // Check if role with same name already exists in this organization
    const existingRole = await this.prisma.role.findUnique({
      where: {
        name_organizationId: {
          name: roleData.name,
          organizationId: organizationId,
        },
      },
    });

    if (existingRole) {
      throw new ConflictException(`Role with name '${roleData.name}' already exists in this organization`);
    }

    // Validate permission IDs if provided
    if (permissionIds && permissionIds.length > 0) {
      const validPermissions = await this.prisma.permission.findMany({
        where: { id: { in: permissionIds } },
      });

      if (validPermissions.length !== permissionIds.length) {
        throw new BadRequestException('One or more permission IDs are invalid');
      }
    }

    try {
      return await this.prisma.role.create({
        data: {
          ...roleData,
          organizationId: organizationId,
          allowedModules: allowedModules ?? [],
          permissions: permissionIds?.length
            ? {
                connect: permissionIds.map((id) => ({ id })),
              }
            : undefined,
        },
        include: {
          permissions: true,
        },
      });
    } catch (error) {
      throw new BadRequestException('Failed to create role');
    }
  }

  async findAll(query: any, organizationId: string) {
    const { page = 1, limit = 10, search, startDate, endDate } = query;
    const skip = (page - 1) * limit;

    // Build where clause for search and filters
    const where: any = {
      organizationId: organizationId,
    };

    // Search functionality - search in name and description
    if (search && search.trim()) {
      where.OR = [
        {
          name: {
            contains: search.trim(),
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: search.trim(),
            mode: 'insensitive',
          },
        },
      ];
    }

    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // Get total count for pagination
    const totalDocuments = await this.prisma.role.count({ where });

    // Get roles with pagination
    const roles = await this.prisma.role.findMany({
      where,
      include: {
        permissions: true,
      },
      skip,
      take: parseInt(limit.toString()),
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      roles,
      totalDocuments,
      totalPagesCount: Math.ceil(totalDocuments / limit),
      currentPage: parseInt(page.toString()),
      limit: parseInt(limit.toString()),
    };
  }

  async findOne(id: string, actor?: AdminActor) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: true,
        userRoles: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID '${id}' not found`);
    }
    this.assertOwn(role, actor);

    return role;
  }

  async findByName(name: string, organizationId: string) {
    return this.prisma.role.findUnique({
      where: {
        name_organizationId: {
          name: name,
          organizationId: organizationId,
        },
      },
      include: {
        permissions: true,
      },
    });
  }

  async update(id: string, updateRoleDto: UpdateRoleDto, actor?: AdminActor) {
    const { permissionIds, allowedModules, ...roleData } = updateRoleDto;

    // Check if role exists
    const existingRole = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { select: { id: true } } },
    });

    if (!existingRole) {
      throw new NotFoundException(`Role with ID '${id}' not found`);
    }
    this.assertOwn(existingRole, actor);
    if (actor && !actor.platform) {
      if (isPlatformRoleName(existingRole.name)) throw new ForbiddenException(`The ${existingRole.name} role is managed by Osiris`);
      if (roleData.name !== undefined && normRoleName(roleData.name) !== normRoleName(existingRole.name) && isReservedRoleName(roleData.name)) {
        throw new BadRequestException(`"${roleData.name}" is a reserved role name`);
      }
    }
    await this.assertNoPlatformGrant(permissionIds, existingRole.permissions.map((p) => p.id), actor);

    // Check if updating name and if new name conflicts with existing role in the same organization
    if (roleData.name && roleData.name !== existingRole.name) {
      const roleWithSameName = await this.prisma.role.findUnique({
        where: {
          name_organizationId: {
            name: roleData.name,
            organizationId: existingRole.organizationId,
          },
        },
      });

      if (roleWithSameName) {
        throw new ConflictException(`Role with name '${roleData.name}' already exists in this organization`);
      }
    }

    // Validate permission IDs if provided
    if (permissionIds && permissionIds.length > 0) {
      const validPermissions = await this.prisma.permission.findMany({
        where: { id: { in: permissionIds } },
      });

      if (validPermissions.length !== permissionIds.length) {
        throw new BadRequestException('One or more permission IDs are invalid');
      }
    }

    try {
      return await this.prisma.role.update({
        where: { id },
        data: {
          ...roleData,
          ...(allowedModules !== undefined && { allowedModules }),
          permissions:
            permissionIds !== undefined
              ? {
                  set: permissionIds.map((id) => ({ id })),
                }
              : undefined,
        },
        include: {
          permissions: true,
        },
      });
    } catch (error) {
      throw new BadRequestException('Failed to update role');
    }
  }

  async remove(id: string, actor?: AdminActor) {
    // Check if role exists
    const existingRole = await this.prisma.role.findUnique({
      where: { id },
      include: {
        userRoles: true,
      },
    });

    if (!existingRole) {
      throw new NotFoundException(`Role with ID '${id}' not found`);
    }
    this.assertOwn(existingRole, actor);
    if (actor && !actor.platform && isPlatformRoleName(existingRole.name)) throw new ForbiddenException(`The ${existingRole.name} role is managed by Osiris`);

    // Check if role is assigned to any users
    if (existingRole.userRoles && existingRole.userRoles.length > 0) {
      throw new ConflictException(`Cannot delete role '${existingRole.name}' as it is assigned to ${existingRole.userRoles.length} user(s)`);
    }

    try {
      // First disconnect all permissions
      await this.prisma.role.update({
        where: { id },
        data: {
          permissions: {
            set: [],
          },
        },
      });

      // Then delete the role
      return await this.prisma.role.delete({
        where: { id },
      });
    } catch (error) {
      throw new BadRequestException('Failed to delete role');
    }
  }
}
