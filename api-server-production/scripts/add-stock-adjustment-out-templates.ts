#!/usr/bin/env ts-node

/**
 * Migration Script: Add Stock Adjustment Out (SAO) Document Templates
 *
 * This script adds SAO document templates to all existing organizations
 * that don't already have one.
 *
 * Usage:
 *   npx ts-node scripts/add-stock-adjustment-out-templates.ts
 *   npx ts-node scripts/add-stock-adjustment-out-templates.ts --dry-run   (preview changes)
 *   npx ts-node scripts/add-stock-adjustment-out-templates.ts --org <orgId>  (single org)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addStockAdjustmentOutTemplates(dryRun = false, specificOrgId?: string) {
  console.log('🔄 Starting migration to add Stock Adjustment Out (SAO) document templates\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE'}\n`);

  try {
    // Fetch organizations to migrate
    const whereClause = specificOrgId ? { id: specificOrgId } : {};
    const organizations = await prisma.organization.findMany({
      where: whereClause,
      select: { id: true, name: true },
    });

    console.log(`Found ${organizations.length} organization(s) to process\n`);

    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const org of organizations) {
      console.log(`\n📦 Processing: ${org.name} (ID: ${org.id})`);

      try {
        // Check if SAO template already exists
        const existingTemplate = await prisma.documentTemplate.findFirst({
          where: {
            organizationId: org.id,
            type: 'SAO',
          },
        });

        if (existingTemplate) {
          console.log('  ⏭️  SAO template already exists - skipping');
          skippedCount++;
          continue;
        }

        console.log('  🔧 Creating SAO document template...');

        if (!dryRun) {
          await prisma.documentTemplate.create({
            data: {
              organizationId: org.id,
              name: 'Stock Adjustment Out',
              type: 'SAO',
              templateVariant: 'SAO',
              designName: 'Default',
              description: 'Stock Adjustment Out document template',
              isActive: true,
              isDefault: true,
              config: {
                route: '/portal/inventory/adjustment-out',
              },
            },
          });
          console.log('  ✓ Created SAO document template');
        }

        createdCount++;
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
    console.log(`  ${dryRun ? 'Would create' : 'Created'}: ${createdCount}`);
    console.log(`  Skipped (already has SAO template): ${skippedCount}`);
    console.log(`  Failed: ${errorCount}`);
    console.log('=================================\n');

    if (dryRun && createdCount > 0) {
      console.log('💡 Run without --dry-run flag to apply changes\n');
    }

  } catch (error) {
    console.error('Fatal error during migration:', error);
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

  addStockAdjustmentOutTemplates(dryRun, specificOrgId)
    .then(() => {
      console.log('✅ Migration process complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration process failed:', error);
      process.exit(1);
    });
}

export { addStockAdjustmentOutTemplates };
