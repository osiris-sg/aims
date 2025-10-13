#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { initializeOrganizationConfiguration } from './initialize-organization-config';

const prisma = new PrismaClient();

async function migrateExistingOrganizations() {
  console.log('🔄 Starting migration of existing organizations to new configuration system\n');

  try {
    // Fetch all organizations
    const organizations = await prisma.organization.findMany();

    console.log(`Found ${organizations.length} organizations to migrate\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const org of organizations) {
      console.log(`\n📦 Processing: ${org.name} (ID: ${org.id})`);

      try {
        // Check if configuration already exists
        const existingModules = await prisma.organizationModule.count({
          where: { organizationId: org.id }
        });

        if (existingModules > 0) {
          console.log(`  ⚠️  Configuration already exists - skipping`);
          continue;
        }

        // Determine template type based on organization characteristics
        const templateType = determineTemplateType(org);
        console.log(`  📋 Using template: ${templateType}`);

        // Initialize configuration
        await initializeOrganizationConfiguration({
          organizationId: org.id,
          templateType,
          customConfig: {
            uiConfig: {
              terminology: extractCustomTerminology(org),
              features: determineFeatures(org),
            }
          }
        });

        // Migrate custom document types if they exist
        if (org.customDocumentTypes) {
          console.log(`  📄 Migrating custom document types`);
          const existingTerminology = await getExistingTerminology(org.id);
          const customDocTypes = org.customDocumentTypes as Record<string, string>;

          await prisma.organizationUIConfig.update({
            where: { organizationId: org.id },
            data: {
              terminology: {
                ...existingTerminology,
                ...customDocTypes
              }
            }
          });
        }

        // Create default custom fields based on existing data patterns
        await createInferredCustomFields(org.id);

        successCount++;
        console.log(`  ✅ Migration successful`);

      } catch (error) {
        errorCount++;
        console.error(`  ❌ Migration failed:`, error);
      }
    }

    console.log('\n=================================');
    console.log('MIGRATION SUMMARY:');
    console.log(`  Total organizations: ${organizations.length}`);
    console.log(`  Successfully migrated: ${successCount}`);
    console.log(`  Failed: ${errorCount}`);
    console.log(`  Skipped (already configured): ${organizations.length - successCount - errorCount}`);
    console.log('=================================\n');

  } catch (error) {
    console.error('Fatal error during migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

function determineTemplateType(org: any): 'standard' | 'enterprise' | 'minimal' {
  // Logic to determine template type based on organization data

  // Check if it's the osiris platform organization (likely needs enterprise)
  if (org.name === 'osiris-platform') {
    return 'enterprise';
  }

  // Check organization size indicators
  // This is a simplified heuristic - adjust based on your actual data
  return 'standard'; // Default to standard for most organizations
}

function extractCustomTerminology(org: any): Record<string, string> {
  const terminology: Record<string, string> = {};

  // If organization has specific naming patterns, extract them
  // This is a placeholder - implement based on your actual data patterns

  return terminology;
}

function determineFeatures(org: any): Record<string, boolean> {
  // Determine which features should be enabled based on organization data

  const features: Record<string, boolean> = {
    enableProjects: true, // Check if org has projects
    enableDocumentAI: true, // Check if org uses document extraction
    enableXeroIntegration: !!org.xeroConnection, // Check for Xero connection
    enableCustomFields: true, // Enable by default
  };

  return features;
}

async function getExistingTerminology(organizationId: string): Promise<Record<string, string>> {
  const uiConfig = await prisma.organizationUIConfig.findUnique({
    where: { organizationId },
    select: { terminology: true }
  });

  return (uiConfig?.terminology as Record<string, string>) || {};
}

async function createInferredCustomFields(organizationId: string) {
  console.log(`  🔍 Analyzing data patterns for custom fields...`);

  try {
    // Analyze existing assets for common patterns
    const assets = await prisma.asset.findMany({
      where: { organizationId },
      take: 100, // Sample size
    });

    const inferredFields: any[] = [];

    // Check if assets commonly have certain data patterns in descriptions
    // This is a simplified example - expand based on your needs

    if (assets.some(a => a.description?.includes('Serial:'))) {
      inferredFields.push({
        entityType: 'Asset',
        fieldName: 'serial_number',
        displayLabel: 'Serial Number',
        fieldType: 'text',
        required: false,
        showInList: true,
        showInForm: true,
        groupName: 'Identification',
        sortOrder: 1,
      });
    }

    if (assets.some(a => a.description?.includes('Warranty:'))) {
      inferredFields.push({
        entityType: 'Asset',
        fieldName: 'warranty_date',
        displayLabel: 'Warranty Expiry',
        fieldType: 'date',
        required: false,
        showInList: false,
        showInForm: true,
        groupName: 'Warranty',
        sortOrder: 2,
      });
    }

    // Create the inferred fields
    for (const field of inferredFields) {
      try {
        await prisma.customField.create({
          data: {
            organizationId,
            ...field,
          }
        });
        console.log(`    ➕ Added custom field: ${field.displayLabel}`);
      } catch (error) {
        // Field might already exist, skip
      }
    }

    if (inferredFields.length === 0) {
      console.log(`    ℹ️  No custom fields inferred from existing data`);
    }

  } catch (error) {
    console.error(`    ⚠️  Error analyzing data patterns:`, error);
  }
}

// Additional utility function to clean up failed migrations
async function cleanupFailedMigration(organizationId: string) {
  console.log(`Cleaning up failed migration for organization ${organizationId}`);

  try {
    // Delete any partial configuration
    await prisma.organizationModule.deleteMany({
      where: { organizationId }
    });

    await prisma.customField.deleteMany({
      where: { organizationId }
    });

    await prisma.organizationUIConfig.deleteMany({
      where: { organizationId }
    });

    console.log('Cleanup successful');
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

// Script entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--cleanup') {
    const organizationId = args[1];
    if (!organizationId) {
      console.error('Usage: ts-node migrate-existing-organizations.ts --cleanup <organizationId>');
      process.exit(1);
    }

    cleanupFailedMigration(organizationId)
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
      .finally(() => prisma.$disconnect());
  } else {
    migrateExistingOrganizations()
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