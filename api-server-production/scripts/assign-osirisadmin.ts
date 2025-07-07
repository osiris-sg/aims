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
    const organizationName = process.argv[3]; // Optional for OsirisAdmin

    if (!userId) {
      console.error('Please provide a user ID as an argument.');
      console.error('Usage: npm run assign-osirisadmin <userId> [organizationName]');
      console.error('Note: organizationName is optional for OsirisAdmin (platform-level role)');
      return;
    }

    console.log(`🌟 Assigning OsirisAdmin role to user: ${userId}`);

    // Handle optional organization assignment
    let organization = null;
    if (organizationName) {
      // Try to find existing organization with the specified name
      organization = await prisma.organization.findFirst({
        where: { name: organizationName },
      });

      if (!organization) {
        console.log(`Creating organization: ${organizationName}...`);
        organization = await prisma.organization.create({
          data: {
            name: organizationName,
          },
        });
        console.log(`Created organization: ${organization.name} (${organization.id})`);
      } else {
        console.log(`Using existing organization: ${organization.name} (${organization.id})`);
      }

      // Create UserOrganization relationship if organization is specified
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
    } else {
      console.log('⚡ No organization specified - OsirisAdmin will have platform-level access only');
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
      // For OsirisAdmin, we need an organization ID for the UserRole table constraint
      // We'll use the provided organization or create/use a special "Osiris Platform" organization
      let platformOrganization = organization;

      if (!platformOrganization) {
        // Create or get the "Osiris Platform" organization for platform-level role assignments
        platformOrganization = await prisma.organization.findFirst({
          where: { name: 'Osiris Platform' },
        });

        if (!platformOrganization) {
          console.log('Creating Osiris Platform organization for platform-level roles...');
          platformOrganization = await prisma.organization.create({
            data: {
              name: 'Osiris Platform',
            },
          });
          console.log(`Created platform organization: ${platformOrganization.name} (${platformOrganization.id})`);
        }
      }

      // Assign osirisadmin role to user
      await prisma.userRole.create({
        data: {
          userId,
          roleId: osirisAdminRole.id,
          organizationId: platformOrganization.id,
          assignedBy: 'system',
        },
      });
      console.log(`✅ Assigned OsirisAdmin role to user ${userId}`);
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
