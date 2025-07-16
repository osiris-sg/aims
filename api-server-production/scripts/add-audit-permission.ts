import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addAuditPermission() {
  try {
    console.log('🔍 Adding audit permission...');

    // Create the audit permission
    const auditPermission = await prisma.permission.upsert({
      where: { name: 'audit:read' },
      update: {},
      create: {
        name: 'audit:read',
        description: 'Can read audit logs',
        resource: 'audit',
        action: 'read',
      },
    });

    console.log('✅ Audit permission created/updated:', auditPermission);

    // Find all organizations
    const organizations = await prisma.organization.findMany();
    console.log(`📋 Found ${organizations.length} organizations`);

    // Add audit permission to all existing roles (optional - you can customize this)
    for (const organization of organizations) {
      const roles = await prisma.role.findMany({
        where: { organizationId: organization.id },
      });

      for (const role of roles) {
        // Check if permission is already assigned
        const existingPermission = await prisma.permission.findFirst({
          where: {
            name: 'audit:read',
            roles: {
              some: {
                id: role.id,
              },
            },
          },
        });

        if (!existingPermission) {
          await prisma.role.update({
            where: { id: role.id },
            data: {
              permissions: {
                connect: { name: 'audit:read' },
              },
            },
          });
          console.log(`✅ Added audit permission to role: ${role.name} in ${organization.name}`);
        } else {
          console.log(`ℹ️  Role ${role.name} in ${organization.name} already has audit permission`);
        }
      }
    }

    console.log('🎉 Audit permission setup completed successfully!');
  } catch (error) {
    console.error('❌ Error setting up audit permission:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addAuditPermission();
