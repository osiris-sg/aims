import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Map old type codes to new document types
const TYPE_MAPPING: Record<string, string> = {
  'TI': 'INVOICE',
  'TI2': 'INVOICE',
  'QO1': 'QUOTATION',
  'QO2': 'QUOTATION',
  'DO': 'DELIVERY_ORDER',
  'RDO': 'RETURN_DELIVERY_ORDER',
  'MSR': 'MAINTENANCE_SERVICE_REPORT',
};

async function migrateEnabledDocumentTypes() {
  console.log('=== Migrating Enabled Document Types ===\n');

  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      customDocumentTypes: true,
    },
  });

  console.log(`Found ${organizations.length} organizations to check\n`);

  let updatedCount = 0;

  for (const org of organizations) {
    const oldTypes = org.customDocumentTypes as string[] | null;

    if (!oldTypes || !Array.isArray(oldTypes) || oldTypes.length === 0) {
      console.log(`⏭️  Skipping ${org.name}: No custom document types`);
      continue;
    }

    // Map old codes to new codes, remove duplicates
    const newTypes = [...new Set(oldTypes.map(oldType => TYPE_MAPPING[oldType] || oldType))];

    // Check if migration needed
    const needsMigration = oldTypes.some(oldType => TYPE_MAPPING[oldType]);

    if (!needsMigration) {
      console.log(`⏭️  Skipping ${org.name}: Already migrated`);
      continue;
    }

    console.log(`🔄 Migrating ${org.name}:`);
    console.log(`   Old types: ${oldTypes.join(', ')}`);
    console.log(`   New types: ${newTypes.join(', ')}`);

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        customDocumentTypes: newTypes,
      },
    });

    updatedCount++;
    console.log(`   ✅ Updated\n`);
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Updated: ${updatedCount} organizations`);
  console.log(`Skipped: ${organizations.length - updatedCount} organizations`);

  await prisma.$disconnect();
}

migrateEnabledDocumentTypes().catch((error) => {
  console.error('Migration failed:', error);
  prisma.$disconnect();
  process.exit(1);
});
