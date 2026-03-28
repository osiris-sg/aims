import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ClerkClient } from '@clerk/backend';

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    @Inject('ClerkClient')
    private readonly clerkClient: ClerkClient,
  ) {}

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
    const organization = await this.prisma.organization.create({
      data: {
        id: data.id || undefined,
        name: data.name,
        address: data.address,
        phoneNumber: data.phoneNumber,
        registrationNumber: data.registrationNumber,
        logo: data.logo,
        defaultStamp: data.defaultStamp,
        customDocumentTypes: data.customDocumentTypes,
      },
    });

    // Auto-create superadmin role with all permissions
    await this.createSuperadminRole(organization.id);

    return organization;
  }

  /**
   * Create a superadmin role for a new organization with all available permissions
   */
  private async createSuperadminRole(organizationId: string) {
    try {
      // Get all permissions
      const allPermissions = await this.prisma.permission.findMany({
        select: { id: true },
      });

      // Create superadmin role connected to all permissions
      await this.prisma.role.create({
        data: {
          name: 'superadmin',
          organizationId,
          permissions: {
            connect: allPermissions.map(p => ({ id: p.id })),
          },
        },
      });

      console.log(`Created superadmin role for org ${organizationId} with ${allPermissions.length} permissions`);
    } catch (error) {
      console.error('Error creating superadmin role:', error);
    }
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
    data: { name?: string; address?: string; phoneNumber?: string; registrationNumber?: string; logo?: string | null; defaultStamp?: string | null; customDocumentTypes?: Record<string, string>; taxRate?: number },
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

  async assignUserToOrganization(userId: string, organizationId: string, salesmanCode?: string) {
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
        salesmanCode: salesmanCode || undefined,
      },
      create: {
        userId,
        organizationId,
        salesmanCode: salesmanCode || null,
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

  async getSalesmenByOrganization(organizationId: string) {
    console.log('=== getSalesmenByOrganization ===');
    console.log('Organization ID:', organizationId);

    // Get all users in this organization
    const userOrgs = await this.prisma.userOrganization.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        userId: true,
        salesmanCode: true,
      },
    });

    console.log('User organizations found:', userOrgs.length);
    console.log('User orgs data:', JSON.stringify(userOrgs, null, 2));

    // Fetch user details from Clerk for each user
    const salesmen = await Promise.all(
      userOrgs.map(async (uo) => {
        try {
          console.log('Fetching Clerk user:', uo.userId);
          const clerkUser = await this.clerkClient.users.getUser(uo.userId);
          console.log('Clerk user found:', clerkUser.firstName, clerkUser.lastName);

          const name = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim()
            || clerkUser.username
            || clerkUser.emailAddresses[0]?.emailAddress
            || 'Unknown';

          return {
            id: uo.userId,
            salesmanCode: uo.salesmanCode || '',
            name,
            email: clerkUser.emailAddresses[0]?.emailAddress || '',
          };
        } catch (error) {
          console.error('Error fetching Clerk user:', uo.userId, error);
          // If Clerk fetch fails, return with basic info
          return {
            id: uo.userId,
            salesmanCode: uo.salesmanCode || '',
            name: 'Unknown',
            email: '',
          };
        }
      })
    );

    console.log('Final salesmen list:', salesmen.length);
    return salesmen;
  }
}
