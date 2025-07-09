import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assignOsirisAdminRole() {
  try {
    // Get the osirisadmin role
    const osirisAdminRole = await prisma.role.findFirst({
      where: { name: 'osirisadmin' },
    });

    if (!osirisAdminRole) {
      console.error('OsirisAdmin role not found. Please run the seed script first.');
      return;
    }

    // Get arguments from command line
    const userId = process.argv[2];
    const organizationId = process.argv[3]; // Optional for OsirisAdmin

    if (!userId) {
      console.error('Please provide a user ID as an argument.');
      console.error('Usage: npm run assign-osirisadmin <userId> [organizationId]');
      console.error('Note: organizationId is optional for OsirisAdmin (platform-level role)');
      console.error('Default: If no organizationId provided, uses "osiris-platform"');
      return;
    }

    console.log(`🌟 Assigning OsirisAdmin role to user: ${userId}`);

    // Get target organization (specified or default to osiris-platform)
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
        console.log(`Using specified organization: ${organization.name} (${organization.id})`);
      }
    } else {
      // Use osiris-platform as default
      organization = await prisma.organization.findFirst({
        where: { id: 'osiris-platform' },
      });

      if (!organization) {
        console.log('Creating osiris-platform organization...');
        organization = await prisma.organization.create({
          data: {
            id: 'osiris-platform',
            name: 'osiris-platform',
          },
        });
        console.log(`Created platform organization: ${organization.name} (${organization.id})`);
      } else {
        console.log(`Using default organization: ${organization.name} (${organization.id})`);
      }
    }

    // Always create UserOrganization relationship for OsirisAdmin
    const existingUserOrg = await prisma.userOrganization.findFirst({
      where: {
        userId,
        organizationId: organization.id,
      },
    });

    if (existingUserOrg) {
      console.log(`User ${userId} already has organization relationship with ${organization.name}`);
    } else {
      await prisma.userOrganization.create({
        data: {
          userId,
          organizationId: organization.id,
          isActive: true,
        },
      });
      console.log(`✅ Created UserOrganization relationship for user ${userId} with ${organization.name}`);
    }

    // Check if user already has osirisadmin role
    // For OsirisAdmin, we create a global role assignment (not organization-scoped)
    const existingUserRole = await prisma.userRole.findFirst({
      where: {
        userId,
        roleId: osirisAdminRole.id,
        // For OsirisAdmin, we'll use a default organization or create one specifically for platform roles
      },
    });

    if (existingUserRole) {
      console.log(`User ${userId} already has OsirisAdmin role`);
    } else {
      // Assign osirisadmin role to user (organization is already set above)
      await prisma.userRole.create({
        data: {
          userId,
          roleId: osirisAdminRole.id,
          organizationId: organization.id,
          assignedBy: 'system',
        },
      });
      console.log(`✅ Assigned OsirisAdmin role to user ${userId} in organization ${organization.name}`);
    }

    console.log(`\n🎉 OsirisAdmin setup completed successfully!`);
    console.log(`   • User: ${userId}`);
    console.log(`   • Role: osirisadmin (Platform Administrator)`);
    console.log(`   • Access Level: Global platform access`);
    console.log(`   • Organization Constraint: None (can manage all organizations)`);
    if (organization) {
      console.log(`   • Optional Organization: ${organization.name} (${organization.id})`);
    }
    console.log(`   • Status: Active`);

    console.log(`\n🔑 OsirisAdmin Permissions:`);
    console.log(`   • Create/Read/Update/Delete Organizations`);
    console.log(`   • Manage Global Roles & Permissions`);
    console.log(`   • Manage Users Across All Organizations`);
    console.log(`   • Platform-level Administration`);
  } catch (error) {
    console.error('Error assigning OsirisAdmin role:', error);
  } finally {
    await prisma.$disconnect();
  }
}

assignOsirisAdminRole();
