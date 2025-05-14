// scripts/assign-superadmin.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assignSuperadminRole() {
  const userId = process.argv[2];
  
  if (!userId) {
    console.error('Please provide a user ID as an argument');
    process.exit(1);
  }

  // Get the superadmin role
  const superadminRole = await prisma.role.findUnique({
    where: { name: 'superadmin' },
  });

  if (!superadminRole) {
    console.error('Superadmin role not found. Run the seed script first.');
    process.exit(1);
  }

  try {
    // Assign the superadmin role to the user
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId,
          roleId: superadminRole.id,
        },
      },
      update: {},
      create: {
        userId,
        roleId: superadminRole.id,
      },
    });

    console.log(`Successfully assigned superadmin role to user ${userId}`);
  } catch (error) {
    console.error('Failed to assign superadmin role:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

assignSuperadminRole();