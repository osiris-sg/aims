#!/usr/bin/env ts-node

/**
 * Migration Script: Update Navigation to consolidate INVENTORY and ASSETS
 *
 * This script updates existing organization module configurations to:
 * 1. Remove old ASSETS module (consolidate into INVENTORY)
 * 2. Update INVENTORY module to have expandable submenus
 * 3. Reorder existing modules to accommodate the new structure
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-inventory-navigation.ts
 *   npx ts-node scripts/migrate-to-inventory-navigation.ts --dry-run   (preview changes)
 *   npx ts-node scripts/migrate-to-inventory-navigation.ts --org <orgId>  (single org)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// New INVENTORY module configuration with submenus
const INVENTORY_MODULE = {
  moduleCode: 'INVENTORY',
  displayName: 'Inventory',
  icon: 'Inventory',
  sortOrder: 1,
  enabled: true,
  config: {
    route: '/portal/inventory',
    subMenus: [
      { key: 'products', label: 'Products' },
      { key: 'purchases', label: 'Purchases' },
      { key: 'purchases-return', label: 'Purchases Return' },
      { key: 'adjustment-in', label: 'Stock Adjustment In' },
      { key: 'adjustment-out', label: 'Stock Adjustment Out' },
      { key: 'reports', label: 'Reports' },
      { key: 'stock-card', label: 'Stock Card' },
    ],
  },
};

// Module to be removed (consolidated into INVENTORY)
const MODULES_TO_REMOVE = ['ASSETS'];

// Updated sort orders for all modules
const UPDATED_SORT_ORDERS: Record<string, number> = {
  DASHBOARD: 0,
  INVENTORY: 1,
  CUSTOMERS: 2,
  SALES: 3,
  PROJECTS: 4,
  USER_MANAGEMENT: 5,
  AUDIT: 6,
};

async function migrateToInventoryNavigation(dryRun = false, specificOrgId?: string) {
  console.log('🔄 Starting migration to Inventory navigation structure\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE'}\n`);

  try {
    // Fetch organizations to migrate
    const whereClause = specificOrgId ? { id: specificOrgId } : {};
    const organizations = await prisma.organization.findMany({
      where: whereClause,
      select: { id: true, name: true },
    });

    console.log(`Found ${organizations.length} organization(s) to process\n`);

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const org of organizations) {
      console.log(`\n📦 Processing: ${org.name} (ID: ${org.id})`);

      try {
        // Check current modules
        const existingModules = await prisma.organizationModule.findMany({
          where: { organizationId: org.id },
          orderBy: { sortOrder: 'asc' },
        });

        // Check if there's an INVENTORY module at all
        const inventoryModule = existingModules.find(m => m.moduleCode === 'INVENTORY');
        if (!inventoryModule) {
          console.log('  ⏭️  No INVENTORY module found - skipping');
          skippedCount++;
          continue;
        }

        console.log(`  📋 Current modules: ${existingModules.map(m => m.moduleCode).join(', ')}`);
        console.log(`  🔧 Changes to make:`);

        const hasAssets = existingModules.some(m => m.moduleCode === 'ASSETS');
        if (hasAssets) {
          console.log('    - Remove ASSETS module (consolidate into INVENTORY)');
        }
        console.log('    - Update INVENTORY module with expandable submenus');
        console.log('    - Update sort orders');

        if (!dryRun) {
          // Step 1: Remove old ASSETS module
          if (hasAssets) {
            await prisma.organizationModule.deleteMany({
              where: {
                organizationId: org.id,
                moduleCode: { in: MODULES_TO_REMOVE },
              },
            });
            console.log('  ✓ Removed ASSETS module');
          }

          // Step 2: Update INVENTORY module with submenus
          await prisma.organizationModule.update({
            where: {
              organizationId_moduleCode: {
                organizationId: org.id,
                moduleCode: 'INVENTORY',
              },
            },
            data: {
              displayName: INVENTORY_MODULE.displayName,
              icon: INVENTORY_MODULE.icon,
              sortOrder: INVENTORY_MODULE.sortOrder,
              enabled: INVENTORY_MODULE.enabled,
              config: INVENTORY_MODULE.config,
            },
          });
          console.log('  ✓ Updated INVENTORY module with submenus');

          // Step 3: Update sort orders for remaining modules
          for (const [moduleCode, sortOrder] of Object.entries(UPDATED_SORT_ORDERS)) {
            await prisma.organizationModule.updateMany({
              where: {
                organizationId: org.id,
                moduleCode: moduleCode,
              },
              data: { sortOrder },
            });
          }
          console.log('  ✓ Updated sort orders');
        }

        successCount++;
        console.log(`  ✅ Migration ${dryRun ? 'would be ' : ''}successful`);

      } catch (error) {
        errorCount++;
        console.error(`  ❌ Migration failed:`, error);
      }
    }

    console.log('\n=================================');
    console.log('MIGRATION SUMMARY:');
    console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`  Total organizations: ${organizations.length}`);
    console.log(`  ${dryRun ? 'Would migrate' : 'Successfully migrated'}: ${successCount}`);
    console.log(`  Skipped (already migrated): ${skippedCount}`);
    console.log(`  Failed: ${errorCount}`);
    console.log('=================================\n');

    if (dryRun && successCount > 0) {
      console.log('💡 Run without --dry-run flag to apply changes\n');
    }

  } catch (error) {
    console.error('Fatal error during migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Rollback function in case migration needs to be undone
async function rollbackInventoryMigration(organizationId: string) {
  console.log(`🔄 Rolling back inventory migration for organization ${organizationId}\n`);

  try {
    // Update INVENTORY module back to simple (no submenus)
    await prisma.organizationModule.update({
      where: {
        organizationId_moduleCode: {
          organizationId,
          moduleCode: 'INVENTORY',
        },
      },
      data: {
        displayName: 'Inventory',
        icon: 'Inventory',
        sortOrder: 1,
        config: {
          route: '/portal/inventory',
        },
      },
    });
    console.log('  ✓ Reverted INVENTORY module to simple format');

    // Re-add ASSETS module
    await prisma.organizationModule.create({
      data: {
        organizationId,
        moduleCode: 'ASSETS',
        displayName: 'Products',
        icon: 'AnalyticsRounded',
        sortOrder: 2,
        enabled: true,
        config: {
          route: '/portal/assets',
        },
      },
    });
    console.log('  ✓ Re-added ASSETS module');

    // Update sort orders
    const originalSortOrders: Record<string, number> = {
      DASHBOARD: 0,
      INVENTORY: 1,
      ASSETS: 2,
      CUSTOMERS: 3,
      SALES: 4,
      PROJECTS: 5,
      USER_MANAGEMENT: 6,
      AUDIT: 7,
    };

    for (const [moduleCode, sortOrder] of Object.entries(originalSortOrders)) {
      await prisma.organizationModule.updateMany({
        where: { organizationId, moduleCode },
        data: { sortOrder },
      });
    }
    console.log('  ✓ Restored sort orders');

    console.log('\n✅ Rollback successful\n');

  } catch (error) {
    console.error('❌ Rollback failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Script entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  const dryRun = args.includes('--dry-run');
  const orgIndex = args.indexOf('--org');
  const specificOrgId = orgIndex !== -1 ? args[orgIndex + 1] : undefined;
  const rollbackIndex = args.indexOf('--rollback');
  const rollbackOrgId = rollbackIndex !== -1 ? args[rollbackIndex + 1] : undefined;

  if (rollbackOrgId) {
    rollbackInventoryMigration(rollbackOrgId)
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    migrateToInventoryNavigation(dryRun, specificOrgId)
      .then(() => {
        console.log('✅ Migration process complete');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Migration process failed:', error);
        process.exit(1);
      });
  }
}

export { migrateToInventoryNavigation, rollbackInventoryMigration };
