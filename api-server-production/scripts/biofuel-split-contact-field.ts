import { PrismaClient } from '@prisma/client';
import { getTemplateFields } from '../src/documentTemplates/templateFieldDefinitions';

const prisma = new PrismaClient();

const BIOFUEL_ORG_NAME = 'Biofuel';

async function splitContactField() {
  console.log('=== Splitting Contact → Contact Name + Contact Number for Biofuel ===\n');

  // Find Biofuel org
  const org = await prisma.organization.findFirst({
    where: { name: { contains: BIOFUEL_ORG_NAME, mode: 'insensitive' } },
  });

  if (!org) {
    console.error('❌ Biofuel organization not found');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Found org: ${org.name} (${org.id})\n`);

  // Get all templates for this org
  const templates = await prisma.documentTemplate.findMany({
    where: { organizationId: org.id },
  });

  console.log(`Found ${templates.length} templates\n`);

  let updated = 0;

  for (const template of templates) {
    const config = (template.config as any) || {};
    let formFields = config.formFields;

    // If no custom formFields, load from defaults
    if (!formFields) {
      const variant = template.templateVariant || template.designName || template.type;
      formFields = getTemplateFields(variant);
      if (!formFields) {
        console.log(`⏭️  Skipping ${template.name || template.id}: No field definitions found`);
        continue;
      }
    }

    // Find and replace contact field in all tabs
    let changed = false;
    for (const tab of formFields.tabs) {
      const contactIdx = tab.fields.findIndex(
        (f: any) => f.fieldName === 'documentInfo.contact'
      );

      if (contactIdx !== -1) {
        // Replace single contact with contactName + contactNumber
        tab.fields.splice(contactIdx, 1,
          {
            fieldName: 'documentInfo.contactName',
            displayLabel: 'Contact Name',
            fieldType: 'text',
            required: false,
          },
          {
            fieldName: 'documentInfo.contactNumber',
            displayLabel: 'Contact Number',
            fieldType: 'text',
            required: false,
          },
        );
        changed = true;
      }
    }

    if (!changed) {
      console.log(`⏭️  Skipping ${template.name || template.id} (${template.type}): No contact field found`);
      continue;
    }

    // Save updated config
    await prisma.documentTemplate.update({
      where: { id: template.id },
      data: {
        config: {
          ...config,
          formFields,
        },
      },
    });

    console.log(`✅ Updated: ${template.name || template.id} (${template.type} / ${template.templateVariant})`);
    updated++;
  }

  console.log(`\n=== Done: ${updated}/${templates.length} templates updated ===`);
  await prisma.$disconnect();
}

splitContactField().catch((error) => {
  console.error('Script failed:', error);
  prisma.$disconnect();
  process.exit(1);
});
