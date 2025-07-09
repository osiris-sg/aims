// scripts/assign-superadmin.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assignSuperadminRole() {
  try {
    // Get arguments from command line
    const userId = process.argv[2];
    const organizationId = process.argv[3];

    if (!userId) {
      console.error('Please provide a user ID as an argument.');
      console.error('Usage: npm run assign-superadmin <userId> [organizationId]');
      console.error('Note: organizationId is optional for superadmin (organization-scoped role)');
      console.error('Default: If no organizationId provided, uses "osiris-platform"');
      return;
    }

    // Get organization by ID
    let organization;
    if (organizationId) {
      // Try to find existing organization with the specified ID
      organization = await prisma.organization.findFirst({
        where: { id: organizationId },
      });

      if (!organization) {
        console.error(`Organization with ID "${organizationId}" not found.`);
        console.error('Please provide a valid organization ID or omit to use default "osiris-platform"');
        return;
      } else {
        console.log(`Using existing organization: ${organization.name} (${organization.id})`);
      }
    } else {
      // Use the osiris-platform organization by default
      organization = await prisma.organization.findFirst({
        where: { id: 'osiris-platform' },
      });

      if (!organization) {
        console.warn('No organization found. Please create it first.');
        return;
      }
    }

    // Get or create the superadmin role for this organization
    let superadminRole = await prisma.role.findFirst({
      where: {
        name: 'superadmin',
        organizationId: organization.id,
      },
    });

    if (!superadminRole) {
      console.log(`Creating superadmin role for organization ${organization.name}...`);

      // Get all permissions to assign to superadmin
      const allPermissions = await prisma.permission.findMany({
        where: {
          // Exclude platform-level permissions that should only be for OsirisAdmin
          NOT: {
            OR: [{ resource: 'organizations' }, { resource: 'roles', action: 'create' }, { resource: 'roles', action: 'delete' }, { resource: 'permissions' }],
          },
        },
      });

      superadminRole = await prisma.role.create({
        data: {
          name: 'superadmin',
          description: 'Organization Super Administrator with full permissions within their organization',
          organizationId: organization.id,
          permissions: {
            connect: allPermissions.map((p) => ({ id: p.id })),
          },
        },
      });
      console.log(`✅ Created superadmin role for organization ${organization.name}`);
    } else {
      console.log(`Found existing superadmin role for organization ${organization.name}`);
    }

    // Step 1: Create UserOrganization relationship
    const existingUserOrg = await prisma.userOrganization.findFirst({
      where: {
        userId,
        organizationId: organization.id,
      },
    });

    if (existingUserOrg) {
      console.log(`User ${userId} already has organization relationship`);
    } else {
      await prisma.userOrganization.create({
        data: {
          userId,
          organizationId: organization.id,
          isActive: true,
        },
      });
      console.log(`✅ Created UserOrganization relationship for user ${userId}`);
    }

    // Step 2: Check if user already has superadmin role in this organization
    const existingUserRole = await prisma.userRole.findFirst({
      where: {
        userId,
        roleId: superadminRole.id,
        organizationId: organization.id,
      },
    });

    if (existingUserRole) {
      console.log(`User ${userId} already has superadmin role in organization ${organization.name}`);
    } else {
      // Assign superadmin role to user
      await prisma.userRole.create({
        data: {
          userId,
          roleId: superadminRole.id,
          organizationId: organization.id,
        },
      });
      console.log(`✅ Assigned superadmin role to user ${userId}`);
    }

    console.log(`\n🎉 Setup completed successfully!`);
    console.log(`   • User: ${userId}`);
    console.log(`   • Organization: ${organization.name} (${organization.id})`);
    console.log(`   • Role: superadmin`);
    console.log(`   • Status: Active`);
  } catch (error) {
    console.error('Error assigning superadmin role:', error);
  } finally {
    await prisma.$disconnect();
  }
}

assignSuperadminRole();
