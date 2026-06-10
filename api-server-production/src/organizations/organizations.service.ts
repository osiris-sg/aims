import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ClerkClient } from '@clerk/backend';
import { DEFAULT_DOCUMENT_TEMPLATES } from './default-templates';
import { DEFAULT_ORG_FEATURES } from './default-features';

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

    // Seed the default document templates so the org can immediately create
    // invoices, quotations, DOs, POs, etc. without hitting "template not found".
    await this.seedDefaultTemplates(organization.id);

    // Seed the canonical feature-flag set so the org shows the same flags as
    // every other org in the admin panel (values default per DEFAULT_ORG_FEATURES).
    await this.seedDefaultFeatures(organization.id);

    return organization;
  }

  /**
   * Ensure the org's OrganizationUIConfig has the canonical feature-flag set.
   * Idempotent — preserves any existing flag values, only fills in missing keys.
   */
  async seedDefaultFeatures(organizationId: string) {
    try {
      const existing = await this.prisma.organizationUIConfig.findUnique({
        where: { organizationId },
        select: { features: true },
      });
      const currentFeatures = (existing?.features as Record<string, boolean>) || {};
      // Existing values win; canonical defaults fill the gaps.
      const mergedFeatures = { ...DEFAULT_ORG_FEATURES, ...currentFeatures };
      await this.prisma.organizationUIConfig.upsert({
        where: { organizationId },
        update: { features: mergedFeatures },
        create: { organizationId, features: mergedFeatures },
      });
      return { ok: true };
    } catch (error) {
      console.error('Error seeding default features:', error);
      return { ok: false, error };
    }
  }

  /**
   * Seed the canonical document-template set for an organization. Idempotent —
   * skips any document type that already has a template, so it's safe to call
   * on org creation and to re-run as a backfill.
   */
  async seedDefaultTemplates(organizationId: string) {
    try {
      const existing = await this.prisma.documentTemplate.findMany({
        where: { organizationId },
        select: { type: true },
      });
      const existingTypes = new Set(existing.map((t) => t.type));
      const toCreate = DEFAULT_DOCUMENT_TEMPLATES.filter((t) => !existingTypes.has(t.type));
      if (toCreate.length === 0) {
        return { created: 0 };
      }
      await this.prisma.documentTemplate.createMany({
        data: toCreate.map((t) => ({
          organizationId,
          type: t.type,
          templateVariant: t.templateVariant,
          name: t.name,
          designName: 'Default',
          description: `${t.name} document template`,
          isActive: true,
          isDefault: true,
        })),
      });
      console.log(`Seeded ${toCreate.length} default document templates for org ${organizationId}`);
      return { created: toCreate.length };
    } catch (error) {
      console.error('Error seeding default templates:', error);
      return { created: 0, error };
    }
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

  /**
   * Read just the reward Points balance — cheap pinpoint query so the PO
   * editor can poll without dragging the whole org graph along.
   */
  async getPointsBalance(id: string) {
    return this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, pointsBalance: true },
    });
  }

  /** Set the org's Points balance to an absolute value (inline edit). */
  async setPointsBalance(id: string, balance: number) {
    return this.prisma.organization.update({
      where: { id },
      data: { pointsBalance: balance },
      select: { id: true, pointsBalance: true },
    });
  }

  /**
   * Atomic decrement used by the document confirm path when a Route Order PO
   * flips to confirmed. Returns the new balance. Negative balances are
   * allowed (the user can over-redeem and reconcile later).
   */
  async decrementPointsBalance(id: string, amount: number) {
    if (!amount) return this.getPointsBalance(id);
    return this.prisma.organization.update({
      where: { id },
      data: { pointsBalance: { decrement: amount } },
      select: { id: true, pointsBalance: true },
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
    data: { name?: string; address?: string; phoneNumber?: string; registrationNumber?: string; logo?: string | null; defaultStamp?: string | null; customDocumentTypes?: Record<string, string>; taxRate?: number; taxApplicable?: boolean; absorbTax?: boolean; defaultCurrency?: string; quoteRoundingStep?: number; docTypeDefaults?: Record<string, { tnc?: string; notes?: string; footerMessage?: string }> | null; bankDetails?: Record<string, string> },
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
