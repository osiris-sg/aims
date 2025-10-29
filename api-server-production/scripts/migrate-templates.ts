import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Map old type codes to proper document types and template variants
const TYPE_MAPPING: Record<string, { documentType: string; templateVariant: string }> = {
  'TI': { documentType: 'INVOICE', templateVariant: 'TI' },
  'TI2': { documentType: 'INVOICE', templateVariant: 'TI2' },
  'QO1': { documentType: 'QUOTATION', templateVariant: 'QO1' },
  'DO': { documentType: 'DELIVERY_ORDER', templateVariant: 'DO' },
  'RDO': { documentType: 'RETURN_DELIVERY_ORDER', templateVariant: 'RDO' },
  'MSR': { documentType: 'MAINTENANCE_SERVICE_REPORT', templateVariant: 'MSR' },
};

async function migrateTemplates() {
  console.log('=== Migrating Document Templates ===\n');

  const templates = await prisma.documentTemplate.findMany();
  console.log(`Found ${templates.length} templates to migrate\n`);

  for (const template of templates) {
    const mapping = TYPE_MAPPING[template.type];

    if (!mapping) {
      console.log(`⚠️  Unknown type: ${template.type} (ID: ${template.id})`);
      continue;
    }

    // Update the template
    await prisma.documentTemplate.update({
      where: { id: template.id },
      data: {
        type: mapping.documentType,
        templateVariant: mapping.templateVariant,
      },
    });

    console.log(`✅ Migrated: ${template.name || 'Unnamed'}`);
    console.log(`   Old type: ${template.type} → New type: ${mapping.documentType}`);
    console.log(`   Template variant: ${mapping.templateVariant}\n`);
  }

  console.log('=== Migration Complete ===');

  // Show summary
  const updatedTemplates = await prisma.documentTemplate.groupBy({
    by: ['type', 'templateVariant'],
    _count: true,
  });

  console.log('\nSummary by document type and variant:');
  for (const group of updatedTemplates) {
    console.log(`  ${group.type} (${group.templateVariant}): ${group._count} templates`);
  }

  await prisma.$disconnect();
}

migrateTemplates().catch((error) => {
  console.error('Migration failed:', error);
  prisma.$disconnect();
  process.exit(1);
});
