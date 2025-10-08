import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const userOrgId = '383e60d0-7c23-4950-acb5-c69d9c6ffaf8';

  // Get the user organization
  const userOrg = await prisma.userOrganization.findUnique({
    where: { id: userOrgId },
    include: {
      organization: true,
    },
  });

  if (!userOrg) {
    console.error('❌ UserOrganization not found');
    return;
  }

  console.log(`Found user ID: ${userOrg.userId}`);
  console.log(`Organization: ${userOrg.organization.name} (${userOrg.organization.id})`);

  // Check if superadmin role exists for this organization
  let superadminRole = await prisma.role.findUnique({
    where: {
      name_organizationId: {
        name: 'superadmin',
        organizationId: userOrg.organization.id,
      },
    },
    include: {
      permissions: true,
    },
  });

  if (!superadminRole) {
    console.log('⚠️  Superadmin role not found for this organization. Creating it...');

    // Get all business operation permissions (excluding platform-level permissions)
    const permissions = await prisma.permission.findMany({
      where: {
        OR: [
          { resource: 'assets' },
          { resource: 'categories' },
          { resource: 'customers' },
          { resource: 'documents' },
          { resource: 'document-extraction' },
          { resource: 'documentTemplates' },
          { resource: 'inventories' },
          { resource: 'timeline-items' },
          { resource: 'projects' },
          { resource: 'uploads' },
          { resource: 'audit' },
          { resource: 'dashboard' },
        ],
      },
    });

    superadminRole = await prisma.role.create({
      data: {
        name: 'superadmin',
        description: 'Organization Super Administrator with full permissions within their organization',
        organizationId: userOrg.organization.id,
        permissions: {
          connect: permissions.map(p => ({ id: p.id })),
        },
      },
      include: {
        permissions: true,
      },
    });

    console.log(`✅ Created superadmin role with ${superadminRole.permissions.length} permissions`);
  } else {
    console.log(`✅ Superadmin role found with ${superadminRole.permissions.length} permissions`);
  }

  // Check if user already has this role
  const existingUserRole = await prisma.userRole.findUnique({
    where: {
      userId_roleId_organizationId: {
        userId: userOrg.userId,
        roleId: superadminRole.id,
        organizationId: userOrg.organizationId,
      },
    },
  });

  if (existingUserRole) {
    console.log('✅ User already has superadmin role');
  } else {
    // Assign superadmin role to user
    await prisma.userRole.create({
      data: {
        userId: userOrg.userId,
        roleId: superadminRole.id,
        organizationId: userOrg.organizationId,
      },
    });
    console.log('✅ Assigned superadmin role to user');
  }

  // Verify user roles
  const userRoles = await prisma.userRole.findMany({
    where: { userId: userOrg.userId },
    include: {
      role: {
        include: {
          permissions: true,
        },
      },
    },
  });

  console.log('\n📋 User roles:');
  userRoles.forEach(ur => {
    console.log(`  - ${ur.role.name} (${ur.role.permissions.length} permissions)`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
