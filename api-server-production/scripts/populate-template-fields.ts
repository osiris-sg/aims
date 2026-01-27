import { PrismaClient } from '@prisma/client';
import { TEMPLATE_FIELD_DEFINITIONS, getTemplateFields } from '../src/documentTemplates/templateFieldDefinitions';

const prisma = new PrismaClient();

async function populateTemplateFields() {
  console.log('=== Populating Template Field Definitions ===\n');

  // Get all templates
  const templates = await prisma.documentTemplate.findMany();
  console.log(`Found ${templates.length} templates to process\n`);

  const results = {
    total: templates.length,
    populated: 0,
    skipped: 0,
    errors: 0,
  };

  for (const template of templates) {
    try {
      const config = template.config as any;

      // Skip if already has formFields
      if (config?.formFields) {
        console.log(`⏭️  Skipping ${template.name || template.id}: Already has field definitions`);
        results.skipped++;
        continue;
      }

      // Get default fields for this template's variant
      const variant = template.templateVariant || template.designName || template.type;
      const defaultFields = getTemplateFields(variant);

      if (!defaultFields) {
        console.log(`⚠️  No default fields found for variant: ${variant} (Template: ${template.name || template.id})`);
        results.skipped++;
        continue;
      }

      // Update template with field definitions
      const updatedConfig = {
        ...config,
        formFields: defaultFields,
      };

      await prisma.documentTemplate.update({
        where: { id: template.id },
        data: { config: updatedConfig },
      });

      console.log(`✅ Populated: ${template.name || template.id}`);
      console.log(`   Variant: ${variant}`);
      console.log(`   Tabs: ${defaultFields.tabs.length}`);
      console.log(`   Total fields: ${defaultFields.tabs.reduce((sum, tab) => sum + tab.fields.length, 0)}\n`);
      results.populated++;
    } catch (err) {
      console.error(`❌ Error processing template ${template.id}:`, err);
      results.errors++;
    }
  }

  console.log('\n=== Population Complete ===');
  console.log(`Total templates: ${results.total}`);
  console.log(`Populated: ${results.populated}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Errors: ${results.errors}`);

  // Show summary by organization
  const orgSummary = await prisma.documentTemplate.findMany({
    select: {
      organizationId: true,
      organization: {
        select: {
          name: true,
        },
      },
    },
    distinct: ['organizationId'],
  });

  console.log('\nOrganizations affected:');
  for (const org of orgSummary) {
    const count = await prisma.documentTemplate.count({
      where: { organizationId: org.organizationId },
    });
    console.log(`  ${org.organization?.name || org.organizationId}: ${count} templates`);
  }

  await prisma.$disconnect();
}

// Run migration
populateTemplateFields().catch((error) => {
  console.error('Population failed:', error);
  prisma.$disconnect();
  process.exit(1);
});
