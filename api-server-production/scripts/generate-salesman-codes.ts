#!/usr/bin/env ts-node

/**
 * Migration Script: Generate Salesman Codes for Existing Users
 *
 * This script generates salesman codes for all existing users that don't have one.
 * Format: First 3 letters of the user's name (uppercase)
 *
 * Usage:
 *   npx ts-node scripts/generate-salesman-codes.ts
 *   npx ts-node scripts/generate-salesman-codes.ts --dry-run
 */

import { config } from 'dotenv';
config(); // Load environment variables

import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';

const prisma = new PrismaClient();

// Initialize Clerk client
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

async function generateSalesmanCodes(dryRun = false) {
  console.log('🔄 Starting migration to generate salesman codes\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE'}\n`);

  try {
    // Get all user organizations without salesman codes
    const userOrgs = await prisma.userOrganization.findMany({
      where: {
        OR: [
          { salesmanCode: null },
          { salesmanCode: '' },
        ],
      },
      include: {
        organization: { select: { name: true } },
      },
    });

    console.log(`Found ${userOrgs.length} user(s) without salesman codes\n`);

    let updated = 0;
    let failed = 0;

    for (const userOrg of userOrgs) {
      try {
        // Fetch user from Clerk to get their name
        const clerkUser = await clerkClient.users.getUser(userOrg.userId);

        const fullName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim();
        const displayName = fullName || clerkUser.username || clerkUser.emailAddresses[0]?.emailAddress || 'USR';

        // Get first 3 letters of name (uppercase)
        const salesmanCode = displayName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() || 'USR';

        console.log(`  🔧 ${displayName} (${userOrg.organization.name}) → ${salesmanCode}`);

        if (!dryRun) {
          await prisma.userOrganization.update({
            where: { id: userOrg.id },
            data: { salesmanCode },
          });
        }

        updated++;
      } catch (error: any) {
        console.error(`  ❌ Failed for userId ${userOrg.userId}:`, error.message);
        failed++;
      }
    }

    console.log('\n=================================');
    console.log('MIGRATION SUMMARY:');
    console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`  ${dryRun ? 'Would update' : 'Updated'}: ${updated} user(s)`);
    console.log(`  Failed: ${failed}`);
    console.log('=================================\n');

    if (dryRun && updated > 0) {
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

  generateSalesmanCodes(dryRun)
    .then(() => {
      console.log('✅ Migration process complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration process failed:', error);
      process.exit(1);
    });
}

export { generateSalesmanCodes };
