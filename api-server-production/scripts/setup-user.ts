import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function setupUser() {
  try {
    const userId = process.argv[2];

    if (!userId) {
      console.error('Please provide a user ID as an argument.');
      console.error('Usage: npm run setup-user <userId>');
      return;
    }

    console.log(`👤 Setting up user ${userId}...`);

    // Get the default organization
    const organization = await prisma.organization.findFirst();

    if (!organization) {
      console.error('No organization found. Please run setup-database first.');
      return;
    }

    console.log(`Using organization: ${organization.name} (${organization.id})`);

    // Get the superadmin role
    const superadminRole = await prisma.role.findUnique({
      where: { name: 'superadmin' },
    });

    if (!superadminRole) {
      console.error('Superadmin role not found. Please run setup-database first.');
      return;
    }

    // Create UserOrganization relationship
    await prisma.userOrganization.upsert({
      where: {
        userId_organizationId: {
          userId,
          organizationId: organization.id,
        },
      },
      update: {
        isActive: true,
      },
      create: {
        userId,
        organizationId: organization.id,
        isActive: true,
      },
    });

    // Assign superadmin role
    await prisma.userRole.upsert({
      where: {
        userId_roleId_organizationId: {
          userId,
          roleId: superadminRole.id,
          organizationId: organization.id,
        },
      },
      update: {},
      create: {
        userId,
        roleId: superadminRole.id,
        organizationId: organization.id,
      },
    });

    console.log(`✅ User ${userId} set up successfully!`);
    console.log(`   • Organization: ${organization.name}`);
    console.log(`   • Role: superadmin`);
    console.log(`   • Status: Active`);
  } catch (error) {
    console.error('❌ Error setting up user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setupUser();
