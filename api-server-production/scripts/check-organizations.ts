#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkOrganizations() {
  console.log('\n📊 Checking Existing Organizations\n');
  console.log('=====================================\n');

  try {
    // Get all organizations
    const organizations = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: {
          select: {
            assets: true,
            customers: true,
            documents: true,
            inventories: true,
            projects: true,
            userOrganizations: true,
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    console.log(`Found ${organizations.length} organization(s):\n`);

    for (const org of organizations) {
      console.log(`📁 ${org.name}`);
      console.log(`   ID: ${org.id}`);
      console.log(`   Created: ${org.createdAt.toLocaleDateString()}`);
      console.log(`   Stats:`);
      console.log(`     - Assets: ${org._count.assets}`);
      console.log(`     - Customers: ${org._count.customers}`);
      console.log(`     - Documents: ${org._count.documents}`);
      console.log(`     - Inventories: ${org._count.inventories}`);
      console.log(`     - Projects: ${org._count.projects}`);
      console.log(`     - Users: ${org._count.userOrganizations}`);

      // Check if already has configuration
      const moduleCount = await prisma.organizationModule.count({
        where: { organizationId: org.id }
      });

      const customFieldCount = await prisma.customField.count({
        where: { organizationId: org.id }
      });

      const hasUIConfig = await prisma.organizationUIConfig.findUnique({
        where: { organizationId: org.id }
      });

      console.log(`   Configuration Status:`);
      console.log(`     - Modules configured: ${moduleCount > 0 ? `✅ (${moduleCount} modules)` : '❌ Not configured'}`);
      console.log(`     - Custom fields: ${customFieldCount > 0 ? `✅ (${customFieldCount} fields)` : '❌ None'}`);
      console.log(`     - UI Config: ${hasUIConfig ? '✅ Configured' : '❌ Not configured'}`);
      console.log('');
    }

    console.log('=====================================\n');

    // Summary
    const configuredOrgs = await prisma.organization.findMany({
      where: {
        modules: {
          some: {}
        }
      }
    });

    const unconfiguredOrgs = organizations.filter(
      org => !configuredOrgs.find(c => c.id === org.id)
    );

    if (unconfiguredOrgs.length > 0) {
      console.log(`⚠️  ${unconfiguredOrgs.length} organization(s) need configuration:`);
      unconfiguredOrgs.forEach(org => {
        console.log(`   - ${org.name} (${org.id})`);
      });
      console.log('\n💡 Run the migration script to configure these organizations.');
      console.log('   Command: ts-node scripts/migrate-existing-organizations.ts\n');
    } else {
      console.log('✅ All organizations are already configured!\n');
    }

    return {
      total: organizations.length,
      configured: configuredOrgs.length,
      unconfigured: unconfiguredOrgs.length,
      organizations: organizations.map(org => ({
        id: org.id,
        name: org.name,
        hasConfig: configuredOrgs.some(c => c.id === org.id)
      }))
    };

  } catch (error) {
    console.error('❌ Error checking organizations:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  checkOrganizations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { checkOrganizations };