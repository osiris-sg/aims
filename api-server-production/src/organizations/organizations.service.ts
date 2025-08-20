import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    name: string;
    id?: string;
    address?: string;
    phoneNumber?: string;
    registrationNumber?: string;
    logo?: string;
    defaultStamp?: string;
    customDocumentTypes?: Record<string, string>;
  }) {
    return this.prisma.organization.create({
      data: {
        id: data.id || undefined, // Let Prisma generate UUID if not provided
        name: data.name,
        address: data.address,
        phoneNumber: data.phoneNumber,
        registrationNumber: data.registrationNumber,
        logo: data.logo,
        defaultStamp: data.defaultStamp,
        customDocumentTypes: data.customDocumentTypes,
      },
    });
  }

  async findAll() {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            assets: true,
            userOrganizations: true,
            categories: true,
            customers: true,
            documents: true,
            inventories: true,
            projects: true,
            documentTemplates: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.organization.findUnique({
      where: { id },
      include: {
        assets: true,
        categories: true,
        inventories: true,
        customers: true,
        documents: true,
        projects: true,
        documentTemplates: true,
      },
    });
  }

  async update(
    id: string,
    data: { name?: string; address?: string; phoneNumber?: string; registrationNumber?: string; logo?: string; defaultStamp?: string; customDocumentTypes?: Record<string, string> },
  ) {
    return this.prisma.organization.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    return this.prisma.organization.delete({
      where: { id },
    });
  }

  // 👇 New methods for user-organization management

  async getUserOrganization(userId: string) {
    const userOrg = await this.prisma.userOrganization.findFirst({
      where: {
        userId,
        isActive: true,
      },
      include: {
        organization: true,
      },
    });

    return userOrg?.organization || null;
  }

  async getUserOrganizations(userId: string) {
    return this.prisma.userOrganization.findMany({
      where: {
        userId,
        isActive: true,
      },
      include: {
        organization: true,
      },
    });
  }

  async assignUserToOrganization(userId: string, organizationId: string) {
    return this.prisma.userOrganization.upsert({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      update: {
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId,
        organizationId,
        isActive: true,
      },
    });
  }

  async removeUserFromOrganization(userId: string, organizationId: string) {
    return this.prisma.userOrganization.update({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });
  }

  async getUserRolesInOrganization(userId: string, organizationId: string) {
    return this.prisma.userRole.findMany({
      where: {
        userId,
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
  }

  async assignRoleToUserInOrganization(userId: string, roleId: string, organizationId: string) {
    return this.prisma.userRole.create({
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
  }
}
