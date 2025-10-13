import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addPdfPermission() {
  const organizationId = 'd068f159-e45a-4da8-beaf-62e903f44141';

  try {
    // First, check if the organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      console.error(`Organization ${organizationId} not found`);
      return;
    }

    console.log(`Found organization: ${organization.name}`);

    // Find the superadmin role for this organization
    const superadminRole = await prisma.role.findFirst({
      where: {
        organizationId: organizationId,
        name: 'superadmin',
      },
    });

    if (!superadminRole) {
      console.error('Superadmin role not found for this organization');
      return;
    }

    console.log(`Found superadmin role: ${superadminRole.id}`);

    // Check if the permission already exists
    const existingPermission = await prisma.permission.findFirst({
      where: {
        resource: 'documents',
        action: 'generate-pdf',
      },
    });

    let permission;
    if (existingPermission) {
      console.log('Permission documents:generate-pdf already exists, connecting to role...');
      permission = existingPermission;
    } else {
      // Create the new permission
      permission = await prisma.permission.create({
        data: {
          name: 'documents:generate-pdf',
          resource: 'documents',
          action: 'generate-pdf',
          description: 'Generate PDF documents',
        },
      });
      console.log('✅ Created new permission documents:generate-pdf');
    }

    // Connect the permission to the superadmin role
    await prisma.role.update({
      where: { id: superadminRole.id },
      data: {
        permissions: {
          connect: { id: permission.id },
        },
      },
    });

    console.log('✅ Successfully added permission documents:generate-pdf to superadmin role');
    console.log('Permission ID:', permission.id);

    // Also add other document permissions if they don't exist
    const documentPermissions = [
      'create-with-timeline',
      'create-basic',
      'read',
      'read-by-inventory',
      'read-by-asset',
      'read-one',
      'update',
      'delete',
      'create-revision',
      'tag-template-to-asset',
      'untag-template-from-asset',
    ];

    for (const action of documentPermissions) {
      const existing = await prisma.permission.findFirst({
        where: {
          resource: 'documents',
          action: action,
        },
      });

      let perm;
      if (existing) {
        perm = existing;
      } else {
        perm = await prisma.permission.create({
          data: {
            name: `documents:${action}`,
            resource: 'documents',
            action: action,
            description: `Permission for documents:${action}`,
          },
        });
        console.log(`✅ Created permission documents:${action}`);
      }

      // Connect to superadmin role
      await prisma.role.update({
        where: { id: superadminRole.id },
        data: {
          permissions: {
            connect: { id: perm.id },
          },
        },
      });
    }

    console.log('All document permissions have been added successfully!');

  } catch (error) {
    console.error('Error adding permissions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addPdfPermission()
  .catch(console.error)
  .finally(() => process.exit(0));