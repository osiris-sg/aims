#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addAdminModule() {
  try {
    // Get all organizations
    const organizations = await prisma.organization.findMany();

    for (const org of organizations) {
      console.log(`\nChecking organization: ${org.name}`);

      // Check if ADMIN module exists
      const adminModule = await prisma.organizationModule.findFirst({
        where: {
          organizationId: org.id,
          moduleCode: 'ADMIN'
        }
      });

      if (adminModule) {
        console.log('  ✅ ADMIN module already exists');

        // Enable it if it's disabled
        if (!adminModule.enabled) {
          await prisma.organizationModule.update({
            where: { id: adminModule.id },
            data: { enabled: true }
          });
          console.log('  ✅ ADMIN module enabled');
        }
      } else {
        // Create ADMIN module
        await prisma.organizationModule.create({
          data: {
            organizationId: org.id,
            moduleCode: 'ADMIN',
            displayName: 'Admin Panel',
            icon: 'AdminPanelSettings',
            enabled: true,
            sortOrder: 100,
            config: {
              route: '/portal/admin',
              permissions: ['admin:access', 'configuration:read', 'configuration:write']
            }
          }
        });
        console.log('  ✅ ADMIN module created and enabled');
      }
    }

    console.log('\n✅ Admin module setup completed for all organizations!');

  } catch (error) {
    console.error('❌ Error adding admin module:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  addAdminModule()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}