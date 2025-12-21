#!/usr/bin/env ts-node

/**
 * Migration Script: Generate Customer Codes for Existing Customers
 *
 * This script generates customer codes for all existing customers that don't have one.
 * Format: C + first letter of name + 3-digit sequential number (e.g., CA001, CB002)
 *
 * Usage:
 *   npx ts-node scripts/generate-customer-codes.ts
 *   npx ts-node scripts/generate-customer-codes.ts --dry-run   (preview changes)
 *   npx ts-node scripts/generate-customer-codes.ts --org <orgId>  (single org)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function generateCustomerCodes(dryRun = false, specificOrgId?: string) {
  console.log('🔄 Starting migration to generate customer codes\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE'}\n`);

  try {
    // Fetch organizations to process
    const whereClause = specificOrgId ? { id: specificOrgId } : {};
    const organizations = await prisma.organization.findMany({
      where: whereClause,
      select: { id: true, name: true },
    });

    console.log(`Found ${organizations.length} organization(s) to process\n`);

    let totalUpdated = 0;
    let totalSkipped = 0;
    let errorCount = 0;

    for (const org of organizations) {
      console.log(`\n📦 Processing: ${org.name} (ID: ${org.id})`);

      // Get all customers without a customerCode, ordered by creation date
      const customersWithoutCode = await prisma.customer.findMany({
        where: {
          organizationId: org.id,
          OR: [
            { customerCode: null },
            { customerCode: '' },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, createdAt: true },
      });

      console.log(`  Found ${customersWithoutCode.length} customer(s) without codes`);

      // Track counts per prefix within this organization
      const prefixCounts: Record<string, number> = {};

      // First, get existing counts for each prefix
      const existingCustomers = await prisma.customer.findMany({
        where: {
          organizationId: org.id,
          customerCode: { not: null },
        },
        select: { customerCode: true },
      });

      // Count existing codes per prefix
      for (const customer of existingCustomers) {
        if (customer.customerCode) {
          const prefix = customer.customerCode.substring(0, 2); // e.g., "CA"
          prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
        }
      }

      for (const customer of customersWithoutCode) {
        try {
          // Get the first letter of the customer name (uppercase)
          const firstLetter = customer.name?.trim().charAt(0).toUpperCase() || 'X';
          const prefix = `C${firstLetter}`;

          // Get current count for this prefix and increment
          const currentCount = prefixCounts[prefix] || 0;
          const newCount = currentCount + 1;
          prefixCounts[prefix] = newCount;

          // Generate the code
          const customerCode = `${prefix}${String(newCount).padStart(3, '0')}`;

          console.log(`  🔧 ${customer.name} → ${customerCode}`);

          if (!dryRun) {
            await prisma.customer.update({
              where: { id: customer.id },
              data: { customerCode },
            });
          }

          totalUpdated++;
        } catch (error) {
          errorCount++;
          console.error(`  ❌ Failed to update ${customer.name}:`, error);
        }
      }

      if (customersWithoutCode.length === 0) {
        console.log(`  ✓ All customers already have codes`);
        totalSkipped++;
      }
    }

    console.log('\n=================================');
    console.log('MIGRATION SUMMARY:');
    console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`  Total organizations: ${organizations.length}`);
    console.log(`  ${dryRun ? 'Would update' : 'Updated'}: ${totalUpdated} customer(s)`);
    console.log(`  Organizations with all codes: ${totalSkipped}`);
    console.log(`  Failed: ${errorCount}`);
    console.log('=================================\n');

    if (dryRun && totalUpdated > 0) {
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

  generateCustomerCodes(dryRun, specificOrgId)
    .then(() => {
      console.log('✅ Migration process complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration process failed:', error);
      process.exit(1);
    });
}

export { generateCustomerCodes };
