import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { NotFoundException } from '@nestjs/common';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('ClerkClient') private readonly clerkClient: any,
  ) {}

  // ===== ASSETS ADMIN SERVICES =====

  async getAllAssets() {
    return this.prisma.asset.findMany({
      include: {
        organization: {
          select: { id: true, name: true },
        },
        category: true,
        inventories: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAssetsByOrganization(organizationId: string) {
    return this.prisma.asset.findMany({
      where: { organizationId },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        category: true,
        inventories: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAssetById(id: string) {
    return this.prisma.asset.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        category: true,
        inventories: true,
      },
    });
  }

  // ===== INVENTORY ADMIN SERVICES =====

  async getAllInventories() {
    return this.prisma.inventory.findMany({
      include: {
        organization: {
          select: { id: true, name: true },
        },
        asset: true,
        documents: true,
        timelineItems: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInventoriesByOrganization(organizationId: string) {
    return this.prisma.inventory.findMany({
      where: { organizationId },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        asset: true,
        documents: true,
        timelineItems: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInventoryById(id: string) {
    return this.prisma.inventory.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        asset: true,
        documents: true,
        timelineItems: true,
      },
    });
  }

  // ===== CUSTOMERS ADMIN SERVICES =====

  async getAllCustomers() {
    return this.prisma.customer.findMany({
      include: {
        organization: {
          select: { id: true, name: true },
        },
        documents: true,
        siteOffices: {
          include: {
            projects: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCustomersByOrganization(organizationId: string) {
    return this.prisma.customer.findMany({
      where: { organizationId },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        documents: true,
        siteOffices: {
          include: {
            projects: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCustomerById(id: string) {
    return this.prisma.customer.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        documents: true,
        siteOffices: {
          include: {
            projects: true,
          },
        },
      },
    });
  }

  // ===== DOCUMENTS ADMIN SERVICES =====

  async getAllDocuments() {
    return this.prisma.document.findMany({
      include: {
        organization: {
          select: { id: true, name: true },
        },
        inventory: true,
        customer: true,
        timelineItems: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocumentsByOrganization(organizationId: string) {
    return this.prisma.document.findMany({
      where: { organizationId },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        inventory: true,
        customer: true,
        timelineItems: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocumentById(id: string) {
    return this.prisma.document.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        inventory: true,
        customer: true,
        timelineItems: true,
      },
    });
  }

  // ===== DOCUMENT TEMPLATES ADMIN SERVICES =====

  async getAllDocumentTemplates() {
    return this.prisma.documentTemplate.findMany({
      include: {
        organization: {
          select: { id: true, name: true },
        },
        taggedAssets: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocumentTemplatesByOrganization(organizationId: string) {
    return this.prisma.documentTemplate.findMany({
      where: { organizationId },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        taggedAssets: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocumentTemplateById(id: string) {
    return this.prisma.documentTemplate.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        taggedAssets: true,
      },
    });
  }

  // ===== PROJECTS ADMIN SERVICES =====

  async getAllProjects() {
    return this.prisma.project.findMany({
      include: {
        organization: {
          select: { id: true, name: true },
        },
        siteOffice: {
          include: {
            customer: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProjectsByOrganization(organizationId: string) {
    return this.prisma.project.findMany({
      where: { organizationId },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        siteOffice: {
          include: {
            customer: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProjectById(id: string) {
    return this.prisma.project.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        siteOffice: {
          include: {
            customer: true,
          },
        },
      },
    });
  }

  // ===== ORGANIZATIONS ADMIN SERVICES =====

  async getAllOrganizations() {
    return this.prisma.organization.findMany({
      include: {
        _count: {
          select: {
            assets: true,
            inventories: true,
            customers: true,
            documents: true,
            documentTemplates: true,
            projects: true,
            userOrganizations: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrganizationById(id: string) {
    return this.prisma.organization.findUnique({
      where: { id },
      include: {
        modules: {
          orderBy: { sortOrder: 'asc' },
        },
        assets: true,
        inventories: true,
        customers: true,
        documents: true,
        documentTemplates: true,
        projects: true,
        userOrganizations: true,
        _count: {
          select: {
            assets: true,
            inventories: true,
            customers: true,
            documents: true,
            documentTemplates: true,
            projects: true,
            userOrganizations: true,
          },
        },
      },
    });
  }

  async getOrganizationStats(id: string) {
    const stats = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            assets: true,
            inventories: true,
            customers: true,
            documents: true,
            documentTemplates: true,
            projects: true,
            userOrganizations: true,
          },
        },
      },
    });

    // Get recent activity for this organization
    const recentAssets = await this.prisma.asset.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, name: true, createdAt: true },
    });

    const recentInventories = await this.prisma.inventory.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, sku: true, createdAt: true },
    });

    const recentDocuments = await this.prisma.document.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, type: true, createdAt: true },
    });

    return {
      organization: stats,
      recentActivity: {
        assets: recentAssets,
        inventories: recentInventories,
        documents: recentDocuments,
      },
    };
  }

  // ===== DASHBOARD/STATS ADMIN SERVICES =====

  async getDashboardStats() {
    const [totalOrganizations, totalAssets, totalInventories, totalCustomers, totalDocuments, totalDocumentTemplates, totalProjects, totalUserOrganizations] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.asset.count(),
      this.prisma.inventory.count(),
      this.prisma.customer.count(),
      this.prisma.document.count(),
      this.prisma.documentTemplate.count(),
      this.prisma.project.count(),
      this.prisma.userOrganization.count(),
    ]);

    return {
      totalOrganizations,
      totalAssets,
      totalInventories,
      totalCustomers,
      totalDocuments,
      totalDocumentTemplates,
      totalProjects,
      totalUserOrganizations,
    };
  }

  async getRecentActivity() {
    const [recentAssets, recentInventories, recentDocuments, recentCustomers] = await Promise.all([
      this.prisma.asset.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          organization: { select: { id: true, name: true } },
        },
      }),
      this.prisma.inventory.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          organization: { select: { id: true, name: true } },
          asset: { select: { id: true, name: true } },
        },
      }),
      this.prisma.document.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          organization: { select: { id: true, name: true } },
        },
      }),
      this.prisma.customer.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          organization: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      recentAssets,
      recentInventories,
      recentDocuments,
      recentCustomers,
    };
  }

  // ===== USER ORGANIZATIONS ADMIN SERVICES =====

  async getAllUserOrganizations() {
    return this.prisma.userOrganization.findMany({
      include: {
        organization: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserOrganizationsByOrganization(organizationId: string) {
    return this.prisma.userOrganization.findMany({
      where: { organizationId },
      include: {
        organization: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ===== USER ROLES ADMIN SERVICES =====

  async getAllUsers() {
    // Get all user-organization relationships with organization info and user roles
    const userOrganizations = await this.prisma.userOrganization.findMany({
      include: {
        organization: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get all user roles with role and permission details
    const userRoles = await this.prisma.userRole.findMany({
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        organization: true,
      },
    });

    // Combine data: merge user roles into user organizations
    const usersWithRoles = userOrganizations.map((userOrg) => {
      // Find all roles for this user in this organization
      const userRoleData = userRoles.filter((ur) => ur.userId === userOrg.userId && ur.organizationId === userOrg.organizationId);

      return {
        ...userOrg,
        roles: userRoleData.map((ur) => ur.role),
        permissions: userRoleData.flatMap((ur) => ur.role.permissions || []),
        userRoles: userRoleData,
      };
    });

    // Enrich with Clerk user data
    const enrichedUsers = await Promise.all(
      usersWithRoles.map(async (user) => {
        try {
          const clerkUser = await this.clerkClient.users.getUser(user.userId);
          return {
            ...user,
            clerkUser: {
              id: clerkUser.id,
              firstName: clerkUser.firstName,
              lastName: clerkUser.lastName,
              emailAddresses: clerkUser.emailAddresses,
              imageUrl: clerkUser.imageUrl,
            },
          };
        } catch (error) {
          console.log(`Could not fetch Clerk user data for ${user.userId}:`, error.message);
          return {
            ...user,
            clerkUser: null,
          };
        }
      }),
    );

    return enrichedUsers;
  }

  async createUser(createUserDto: CreateUserDto) {
    const { firstName, lastName, email, password, roleIds, organizationId } = createUserDto;

    console.log('Creating user using osiris Admin', createUserDto);

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

  async getAllRoles() {
    return this.prisma.role.findMany({
      include: {
        permissions: true,
        organization: true,
        userRoles: {
          include: {
            organization: true,
          },
        },
      },
    });
  }

  async getUserRolesByOrganization(organizationId: string) {
    return this.prisma.role.findMany({
      where: {
        organizationId,
      },
      include: {
        permissions: true,
        userRoles: {
          include: {
            organization: true,
          },
        },
        organization: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserRoleById(id: string) {
    return this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: true,
        userRoles: {
          include: {
            organization: true,
          },
        },
        organization: true,
      },
    });
  }

  // ===== USER PERMISSIONS ADMIN SERVICES =====

  async getAllUserPermissions() {
    return this.prisma.permission.findMany({
      orderBy: { resource: 'asc' },
    });
  }

  // ===== ORGANIZATION MODULE MANAGEMENT SERVICES =====

  async getOrganizationModules(organizationId: string) {
    return this.prisma.organizationModule.findMany({
      where: { organizationId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createOrganizationModule(organizationId: string, moduleData: any) {
    const { moduleCode, displayName, icon, sortOrder, enabled, config } = moduleData;

    // Check if module already exists
    const existing = await this.prisma.organizationModule.findFirst({
      where: { organizationId, moduleCode },
    });

    if (existing) {
      throw new Error(`Module ${moduleCode} already exists for this organization`);
    }

    return this.prisma.organizationModule.create({
      data: {
        organizationId,
        moduleCode,
        displayName,
        icon,
        sortOrder: sortOrder ?? 0,
        enabled: enabled ?? true,
        config: config || {},
      },
    });
  }

  async updateOrganizationModule(organizationId: string, moduleId: string, moduleData: any) {
    const { displayName, icon, sortOrder, enabled, config } = moduleData;

    return this.prisma.organizationModule.update({
      where: { id: moduleId },
      data: {
        displayName,
        icon,
        sortOrder,
        enabled,
        config,
      },
    });
  }

  async initializeDefaultModules(organizationId: string) {
    const defaultModules = [
      { moduleCode: 'DASHBOARD', displayName: 'Dashboard', icon: 'Dashboard', sortOrder: 0, config: { route: '/portal' } },
      { moduleCode: 'ASSETS', displayName: 'Assets', icon: 'Settings', sortOrder: 10, config: { route: '/portal/assets' } },
      { moduleCode: 'INVENTORY', displayName: 'Inventory', icon: 'Inventory', sortOrder: 20, config: { route: '/portal/inventory' } },
      { moduleCode: 'CUSTOMERS', displayName: 'Customers', icon: 'PeopleRounded', sortOrder: 30, config: { route: '/portal/customers' } },
      { moduleCode: 'DOCUMENTS', displayName: 'Documents', icon: 'Description', sortOrder: 40, config: { route: '/portal/documents' } },
      { moduleCode: 'INVOICES', displayName: 'Invoices', icon: 'Receipt', sortOrder: 50, config: { route: '/portal/invoices' } },
      { moduleCode: 'PROJECTS', displayName: 'Projects', icon: 'AccountTree', sortOrder: 60, config: { route: '/portal/projects' } },
      { moduleCode: 'USER_MANAGEMENT', displayName: 'User Management', icon: 'ManageAccounts', sortOrder: 70, config: { route: '/portal/user-management' } },
      { moduleCode: 'AUDIT', displayName: 'Audit', icon: 'Security', sortOrder: 80, config: { route: '/portal/audit' } },
      { moduleCode: 'ADMIN', displayName: 'Admin Panel', icon: 'AdminPanelSettings', sortOrder: 100, config: { route: '/portal/admin' } },
    ];

    const createdModules = await Promise.all(
      defaultModules.map(async (module) => {
        // Check if module already exists
        const existing = await this.prisma.organizationModule.findFirst({
          where: { organizationId, moduleCode: module.moduleCode },
        });

        if (existing) {
          return existing;
        }

        return this.prisma.organizationModule.create({
          data: {
            organizationId,
            ...module,
            enabled: true,
          },
        });
      }),
    );

    return {
      message: `Initialized ${createdModules.length} modules for organization ${organizationId}`,
      modules: createdModules,
    };
  }

  // ===== ORGANIZATION DOCUMENT TYPES MANAGEMENT SERVICES =====

  async updateOrganizationDocumentTypes(organizationId: string, documentTypes: string[]) {
    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        customDocumentTypes: documentTypes,
      },
    });

    return {
      success: true,
      message: 'Document types updated successfully',
      data: {
        organizationId: organization.id,
        customDocumentTypes: organization.customDocumentTypes,
      },
    };
  }
}
