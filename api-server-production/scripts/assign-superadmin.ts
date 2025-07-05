// scripts/assign-superadmin.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assignSuperadminRole() {
  try {
    // Get the superadmin role
    const superadminRole = await prisma.role.findFirst({
      where: { name: 'superadmin' },
    });

    if (!superadminRole) {
      console.error('Superadmin role not found. Please run the seed script first.');
      return;
    }

    // Get arguments from command line
    const userId = process.argv[2];
    const organizationName = process.argv[3];

    if (!userId) {
      console.error('Please provide a user ID as an argument.');
      console.error('Usage: npm run assign-superadmin <userId> [organizationName]');
      return;
    }

    // Get or create organization
    let organization;
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
    } else {
      // Get the first organization (or create default if none exists)
      organization = await prisma.organization.findFirst();

      if (!organization) {
        console.log('No organization found. Creating a default organization...');
        organization = await prisma.organization.create({
          data: {
            name: 'Default Organization',
          },
        });
        console.log(`Created organization: ${organization.name} (${organization.id})`);
      } else {
        console.log(`Using existing organization: ${organization.name} (${organization.id})`);
      }
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
