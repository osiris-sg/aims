import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Map old type codes to proper document types
const TYPE_MAPPING: Record<string, string> = {
  'TI': 'INVOICE',
  'TI2': 'INVOICE',
  'QO1': 'QUOTATION',
  'QO2': 'QUOTATION',
  'DO': 'DELIVERY_ORDER',
  'RDO': 'RETURN_DELIVERY_ORDER',
  'MSR': 'MAINTENANCE_SERVICE_REPORT',
};

async function migrateDocumentTypes() {
  console.log('=== Migrating Document Types ===\n');

  const documents = await prisma.document.findMany({
    select: {
      id: true,
      type: true,
      name: true,
    },
  });

  console.log(`Found ${documents.length} documents to check\n`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const document of documents) {
    const newType = TYPE_MAPPING[document.type];

    if (!newType) {
      console.log(`⚠️  Unknown type: ${document.type} for document ${document.name || document.id}`);
      skippedCount++;
      continue;
    }

    // Check if already migrated
    if (document.type === newType) {
      skippedCount++;
      continue;
    }

    // Update the document
    await prisma.document.update({
      where: { id: document.id },
      data: {
        type: newType,
      },
    });

    updatedCount++;

    if (updatedCount % 10 === 0) {
      console.log(`  Processed ${updatedCount} documents...`);
    }
  }

  console.log(`\n✅ Migration Complete!`);
  console.log(`   Updated: ${updatedCount} documents`);
  console.log(`   Skipped: ${skippedCount} documents`);

  // Show summary
  const typeCounts = await prisma.document.groupBy({
    by: ['type'],
    _count: true,
  });

  console.log('\nDocuments by type:');
  for (const group of typeCounts) {
    console.log(`  ${group.type}: ${group._count} documents`);
  }

  await prisma.$disconnect();
}

migrateDocumentTypes().catch((error) => {
  console.error('Migration failed:', error);
  prisma.$disconnect();
  process.exit(1);
});
