import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const userId = 'user_2zkESbF4tR4g8gwzQyI2H6NAqYf';
  const organizationId = 'd068f159-e45a-4da8-beaf-62e903f44141';

  // Get user roles for this organization
  const userRoles = await prisma.userRole.findMany({
    where: {
      userId: userId,
      organizationId: organizationId,
      isActive: true,
    },
    include: {
      role: {
        include: {
          permissions: true,
        },
      },
    },
  });

  console.log(`\n📋 User roles in organization:`);
  userRoles.forEach(ur => {
    console.log(`\n  Role: ${ur.role.name}`);
    console.log(`  Total permissions: ${ur.role.permissions.length}`);

    // Check for document permissions
    const documentPermissions = ur.role.permissions.filter(p =>
      p.resource === 'documents' || p.resource === 'document-extraction'
    );

    console.log(`\n  Document-related permissions:`);
    documentPermissions.forEach(p => {
      console.log(`    - ${p.name} (${p.resource}:${p.action})`);
    });
  });

  // Check if the user has the specific permission needed
  const hasCreatePermission = userRoles.some(ur =>
    ur.role.permissions.some(p =>
      p.resource === 'documents' && p.action === 'create'
    )
  );

  console.log(`\n✅ Has 'documents:create' permission: ${hasCreatePermission}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
