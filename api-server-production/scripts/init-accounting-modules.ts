/**
 * Script to initialize accounting modules in the configuration system
 * Run this script to add Payments and Reports modules to your organization's configuration
 *
 * Usage: npx ts-node scripts/init-accounting-modules.ts <organizationId>
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function initializeAccountingModules(organizationId: string) {
  console.log(`\n🚀 Initializing accounting modules for organization: ${organizationId}\n`);

  try {
    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new Error(`Organization with ID ${organizationId} not found`);
    }

    console.log(`✅ Found organization: ${organization.name}\n`);

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

    console.log(`✅ Payments module created/updated: ${paymentsModule.id}`);

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
      console.log(`✅ Reports module created: ${reportsModule.id}`);
    } else {
      // Update Reports module to include Statement of Account
      const currentConfig: any = reportsModule.config || {};
      const currentSubModules = currentConfig.subModules || [];

      // Check if Statement of Account already exists
      const hasSOA = currentSubModules.some((sub: any) => sub.code === 'STATEMENT_OF_ACCOUNT');

      if (!hasSOA) {
        currentSubModules.push({
          code: 'STATEMENT_OF_ACCOUNT',
          name: 'Statement of Account',
          route: '/portal/reports/statement-of-account',
          permissions: ['statements:read'],
        });

        await prisma.organizationModule.update({
          where: { id: reportsModule.id },
          data: {
            config: {
              ...currentConfig,
              subModules: currentSubModules,
            },
          },
        });

        console.log(`✅ Reports module updated with Statement of Account`);
      } else {
        console.log(`ℹ️  Statement of Account already exists in Reports module`);
      }
    }

    console.log(`\n✅ Accounting modules initialization completed successfully!\n`);
    console.log(`📋 Summary:`);
    console.log(`   - Payments module: ${paymentsModule.enabled ? 'Enabled' : 'Disabled'} (${paymentsModule.config?.route})`);
    console.log(`   - Reports module: ${reportsModule.enabled ? 'Enabled' : 'Disabled'} (${reportsModule.config?.route})`);
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Run the seed script to add accounting permissions: npm run seed`);
    console.log(`   2. Assign permissions to roles in the admin panel`);
    console.log(`   3. Refresh your browser to see the new menu items\n`);

  } catch (error) {
    console.error(`\n❌ Error initializing accounting modules:`, error);
    throw error;
  }
}

async function main() {
  const organizationId = process.argv[2];

  if (!organizationId) {
    console.error('\n❌ Error: Organization ID is required\n');
    console.log('Usage: npx ts-node scripts/init-accounting-modules.ts <organizationId>\n');
    console.log('Example: npx ts-node scripts/init-accounting-modules.ts org_123abc\n');
    process.exit(1);
  }

  await initializeAccountingModules(organizationId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
