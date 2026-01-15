#!/usr/bin/env ts-node

/**
 * Migration Script: Update Navigation from DOCUMENTS/INVOICES to SALES
 *
 * This script updates existing organization module configurations to:
 * 1. Remove old DOCUMENTS and INVOICES modules
 * 2. Add the new SALES module with all document type submenus
 * 3. Reorder existing modules to accommodate the new structure
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-sales-navigation.ts
 *   npx ts-node scripts/migrate-to-sales-navigation.ts --dry-run   (preview changes)
 *   npx ts-node scripts/migrate-to-sales-navigation.ts --org <orgId>  (single org)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// New SALES module configuration
const SALES_MODULE = {
  moduleCode: 'SALES',
  displayName: 'Sales',
  icon: 'ShoppingCart',
  sortOrder: 3,
  enabled: true,
  config: {
    route: '/portal/sales',
    subMenus: [
      { key: 'quotations', label: 'Quotation' },
      { key: 'sales-orders', label: 'Sales Order' },
      { key: 'delivery-orders', label: 'Delivery Order' },
      { key: 'invoices', label: 'Invoice' },
      { key: 'debit-notes', label: 'Debit Note' },
      { key: 'credit-notes', label: 'Credit Note' },
      { key: 'stock-card', label: 'Stock Card' },
    ],
  },
};

// Modules to be removed
const MODULES_TO_REMOVE = ['DOCUMENTS', 'INVOICES'];

// Updated sort orders for remaining modules (SALES above CUSTOMERS)
const UPDATED_SORT_ORDERS: Record<string, number> = {
  DASHBOARD: 0,
  INVENTORY: 1,
  ASSETS: 2,
  SALES: 3,
  CUSTOMERS: 4,
  PROJECTS: 5,
  USER_MANAGEMENT: 6,
  AUDIT: 7,
};

async function migrateToSalesNavigation(dryRun = false, specificOrgId?: string) {
  console.log('🔄 Starting migration to Sales navigation structure\n');
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

        // Check if SALES module already exists
        const hasSalesModule = existingModules.some(m => m.moduleCode === 'SALES');
        if (hasSalesModule) {
          console.log('  ⏭️  SALES module already exists - skipping');
          skippedCount++;
          continue;
        }

        // Check if old modules exist
        const hasDocuments = existingModules.some(m => m.moduleCode === 'DOCUMENTS');
        const hasInvoices = existingModules.some(m => m.moduleCode === 'INVOICES');

        if (!hasDocuments && !hasInvoices) {
          console.log('  ⏭️  No DOCUMENTS or INVOICES modules found - skipping');
          skippedCount++;
          continue;
        }

        console.log(`  📋 Current modules: ${existingModules.map(m => m.moduleCode).join(', ')}`);
        console.log(`  🔧 Changes to make:`);
        if (hasDocuments) console.log('    - Remove DOCUMENTS module');
        if (hasInvoices) console.log('    - Remove INVOICES module');
        console.log('    - Add SALES module with submenus');
        console.log('    - Update sort orders');

        if (!dryRun) {
          // Step 1: Remove old DOCUMENTS and INVOICES modules
          await prisma.organizationModule.deleteMany({
            where: {
              organizationId: org.id,
              moduleCode: { in: MODULES_TO_REMOVE },
            },
          });
          console.log('  ✓ Removed old DOCUMENTS/INVOICES modules');

          // Step 2: Add new SALES module
          await prisma.organizationModule.create({
            data: {
              organizationId: org.id,
              moduleCode: SALES_MODULE.moduleCode,
              displayName: SALES_MODULE.displayName,
              icon: SALES_MODULE.icon,
              sortOrder: SALES_MODULE.sortOrder,
              enabled: SALES_MODULE.enabled,
              config: SALES_MODULE.config,
            },
          });
          console.log('  ✓ Created SALES module');

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

          // Step 4: Update ASSETS display name to "Products" if needed
          // (This is optional - depends on your tracking mode preference)
          await prisma.organizationModule.updateMany({
            where: {
              organizationId: org.id,
              moduleCode: 'ASSETS',
            },
            data: { displayName: 'Products' },
          });
          console.log('  ✓ Updated ASSETS display name to Products');
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
async function rollbackMigration(organizationId: string) {
  console.log(`🔄 Rolling back migration for organization ${organizationId}\n`);

  try {
    // Remove SALES module
    await prisma.organizationModule.deleteMany({
      where: {
        organizationId,
        moduleCode: 'SALES',
      },
    });
    console.log('  ✓ Removed SALES module');

    // Re-add DOCUMENTS module
    await prisma.organizationModule.create({
      data: {
        organizationId,
        moduleCode: 'DOCUMENTS',
        displayName: 'Documents',
        icon: 'Description',
        sortOrder: 4,
        enabled: true,
        config: {
          route: '/portal/documents',
          subMenus: ['templates', 'extraction'],
        },
      },
    });
    console.log('  ✓ Re-added DOCUMENTS module');

    // Re-add INVOICES module
    await prisma.organizationModule.create({
      data: {
        organizationId,
        moduleCode: 'INVOICES',
        displayName: 'Invoices',
        icon: 'AssignmentRounded',
        sortOrder: 5,
        enabled: true,
        config: {
          route: '/portal/invoices',
        },
      },
    });
    console.log('  ✓ Re-added INVOICES module');

    // Update sort orders
    const originalSortOrders: Record<string, number> = {
      DASHBOARD: 0,
      INVENTORY: 1,
      ASSETS: 2,
      CUSTOMERS: 3,
      DOCUMENTS: 4,
      INVOICES: 5,
      PROJECTS: 6,
      USER_MANAGEMENT: 7,
      AUDIT: 8,
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
    rollbackMigration(rollbackOrgId)
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    migrateToSalesNavigation(dryRun, specificOrgId)
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

export { migrateToSalesNavigation, rollbackMigration };
