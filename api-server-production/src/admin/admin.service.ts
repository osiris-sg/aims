import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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
}
