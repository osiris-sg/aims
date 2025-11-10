/**
 * Script to initialize accounting modules for ALL organizations
 * Run this script to add Payments and Reports modules to all organizations at once
 *
 * Usage: npx ts-node scripts/init-accounting-all-orgs.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function initializeAccountingForOrg(organizationId: string, organizationName: string) {
  console.log(`\n📋 Processing: ${organizationName} (${organizationId})`);

  try {
    // 1. Create or update Payments module
    const paymentsModule = await prisma.organizationModule.upsert({
      where: {
        organizationId_moduleCode: {
          organizationId,
          moduleCode: 'PAYMENTS',
        },
      },
      update: {
        displayName: 'Payments',
        icon: 'Receipt',
        enabled: true,
        sortOrder: 50,
        config: {
          route: '/portal/payments',
          description: 'Record and manage customer payments',
          permissions: ['payments:read', 'payments:create', 'payments:update', 'payments:delete'],
        },
      },
      create: {
        organizationId,
        moduleCode: 'PAYMENTS',
        displayName: 'Payments',
        icon: 'Receipt',
        enabled: true,
        sortOrder: 50,
        config: {
          route: '/portal/payments',
          description: 'Record and manage customer payments',
          permissions: ['payments:read', 'payments:create', 'payments:update', 'payments:delete'],
        },
      },
    });

    console.log(`   ✅ Payments module: ${paymentsModule.id}`);

    // 2. Check if REPORTS module already exists
    let reportsModule = await prisma.organizationModule.findUnique({
      where: {
        organizationId_moduleCode: {
          organizationId,
          moduleCode: 'REPORTS',
        },
      },
    });

    if (!reportsModule) {
      // Create Reports module if it doesn't exist
      reportsModule = await prisma.organizationModule.create({
        data: {
          organizationId,
          moduleCode: 'REPORTS',
          displayName: 'Reports',
          icon: 'BarChart',
          enabled: true,
          sortOrder: 60,
          config: {
            route: '/portal/reports',
            description: 'View financial and operational reports',
            subModules: [
              {
                code: 'PRICE_HISTORY',
                name: 'Price History',
                route: '/portal/reports/price-history',
                permissions: ['reports:read'],
              },
              {
                code: 'STATEMENT_OF_ACCOUNT',
                name: 'Statement of Account',
                route: '/portal/reports/statement-of-account',
                permissions: ['statements:read'],
              },
            ],
          },
        },
      });
      console.log(`   ✅ Reports module created: ${reportsModule.id}`);
    } else {
      // Update Reports module to include Statement of Account
      const currentConfig: any = reportsModule.config || {};
      const currentSubModules = currentConfig.subModules || [];

      // Check if Price History exists
      const hasPriceHistory = currentSubModules.some((sub: any) => sub.code === 'PRICE_HISTORY');
      if (!hasPriceHistory) {
        currentSubModules.push({
          code: 'PRICE_HISTORY',
          name: 'Price History',
          route: '/portal/reports/price-history',
          permissions: ['reports:read'],
        });
      }

      // Check if Statement of Account exists
      const hasSOA = currentSubModules.some((sub: any) => sub.code === 'STATEMENT_OF_ACCOUNT');
      if (!hasSOA) {
        currentSubModules.push({
          code: 'STATEMENT_OF_ACCOUNT',
          name: 'Statement of Account',
          route: '/portal/reports/statement-of-account',
          permissions: ['statements:read'],
        });
      }

      // Update the module
      await prisma.organizationModule.update({
        where: { id: reportsModule.id },
        data: {
          icon: 'BarChart', // Ensure icon is set
          config: {
            ...currentConfig,
            route: currentConfig.route || '/portal/reports',
            description: currentConfig.description || 'View financial and operational reports',
            subModules: currentSubModules,
          },
        },
      });

      console.log(`   ✅ Reports module updated: ${reportsModule.id}`);
    }

    return { success: true, organization: organizationName };
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return { success: false, organization: organizationName, error: error.message };
  }
}

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🚀 Initializing Accounting Modules for ALL Organizations`);
  console.log(`${'='.repeat(70)}\n`);

  try {
    // Fetch all organizations
    const organizations = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    if (organizations.length === 0) {
      console.log('⚠️  No organizations found in the database.');
      return;
    }

    console.log(`📊 Found ${organizations.length} organization(s)\n`);

    const results = {
      success: [] as string[],
      failed: [] as { org: string; error: string }[],
    };

    // Process each organization
    for (const org of organizations) {
      const result = await initializeAccountingForOrg(org.id, org.name);

      if (result.success) {
        results.success.push(result.organization);
      } else {
        results.failed.push({ org: result.organization, error: result.error || 'Unknown error' });
      }
    }

    // Print summary
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 SUMMARY`);
    console.log(`${'='.repeat(70)}\n`);

    console.log(`✅ Successfully processed: ${results.success.length} organization(s)`);
    results.success.forEach(org => {
      console.log(`   - ${org}`);
    });

    if (results.failed.length > 0) {
      console.log(`\n❌ Failed: ${results.failed.length} organization(s)`);
      results.failed.forEach(item => {
        console.log(`   - ${item.org}: ${item.error}`);
      });
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`✅ Accounting modules initialization completed!`);
    console.log(`${'='.repeat(70)}\n`);

    console.log(`💡 Next steps:`);
    console.log(`   1. Permissions have already been added (seed was run)`);
    console.log(`   2. Assign permissions to roles in the admin panel:`);
    console.log(`      - Go to /portal/admin/roles`);
    console.log(`      - Edit roles and assign accounting permissions`);
    console.log(`   3. Refresh your browser to see the new menu items`);
    console.log(`   4. Test by:`);
    console.log(`      - Creating and confirming an invoice`);
    console.log(`      - Recording a payment at /portal/payments`);
    console.log(`      - Viewing SOA at /portal/reports/statement-of-account\n`);

  } catch (error) {
    console.error(`\n❌ Fatal error:`, error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
