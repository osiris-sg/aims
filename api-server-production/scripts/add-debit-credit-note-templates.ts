#!/usr/bin/env ts-node

/**
 * Migration Script: Add Debit Note (DN) and Credit Note (CN) Document Templates
 *
 * This script adds DN and CN document templates to all existing organizations
 * that don't already have them.
 *
 * Usage:
 *   npx ts-node scripts/add-debit-credit-note-templates.ts
 *   npx ts-node scripts/add-debit-credit-note-templates.ts --dry-run   (preview changes)
 *   npx ts-node scripts/add-debit-credit-note-templates.ts --org <orgId>  (single org)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEMPLATES_TO_ADD = [
  {
    type: 'DEBIT_NOTE',
    templateVariant: 'DN',
    name: 'Debit Note',
    description: 'Debit Note document template',
  },
  {
    type: 'CREDIT_NOTE',
    templateVariant: 'CN',
    name: 'Credit Note',
    description: 'Credit Note document template',
  },
];

async function addDebitCreditNoteTemplates(dryRun = false, specificOrgId?: string) {
  console.log('🔄 Starting migration to add Debit Note and Credit Note document templates\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE'}\n`);

  try {
    // Fetch organizations to migrate
    const whereClause = specificOrgId ? { id: specificOrgId } : {};
    const organizations = await prisma.organization.findMany({
      where: whereClause,
      select: { id: true, name: true },
    });

    console.log(`Found ${organizations.length} organization(s) to process\n`);

    let totalCreated = 0;
    let totalSkipped = 0;
    let errorCount = 0;

    for (const org of organizations) {
      console.log(`\n📦 Processing: ${org.name} (ID: ${org.id})`);

      for (const template of TEMPLATES_TO_ADD) {
        try {
          // Check if template already exists
          const existingTemplate = await prisma.documentTemplate.findFirst({
            where: {
              organizationId: org.id,
              type: template.type,
            },
          });

          if (existingTemplate) {
            console.log(`  ⏭️  ${template.name} template already exists - skipping`);
            totalSkipped++;
            continue;
          }

          console.log(`  🔧 Creating ${template.name} template...`);

          if (!dryRun) {
            await prisma.documentTemplate.create({
              data: {
                organizationId: org.id,
                name: template.name,
                type: template.type,
                templateVariant: template.templateVariant,
                designName: 'Default',
                description: template.description,
                isActive: true,
                isDefault: true,
                config: {
                  route: `/portal/sales/${template.type.toLowerCase().replace('_', '-')}s`,
                },
              },
            });
            console.log(`  ✓ Created ${template.name} template`);
          }

          totalCreated++;
        } catch (error) {
          errorCount++;
          console.error(`  ❌ Failed to create ${template.name} template:`, error);
        }
      }
    }

    console.log('\n=================================');
    console.log('MIGRATION SUMMARY:');
    console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`  Total organizations: ${organizations.length}`);
    console.log(`  ${dryRun ? 'Would create' : 'Created'}: ${totalCreated} template(s)`);
    console.log(`  Skipped (already exists): ${totalSkipped}`);
    console.log(`  Failed: ${errorCount}`);
    console.log('=================================\n');

    if (dryRun && totalCreated > 0) {
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

  addDebitCreditNoteTemplates(dryRun, specificOrgId)
    .then(() => {
      console.log('✅ Migration process complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration process failed:', error);
      process.exit(1);
    });
}

export { addDebitCreditNoteTemplates };
