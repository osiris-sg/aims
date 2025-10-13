import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function removeQO2() {
  try {
    console.log('🚀 Starting QO2 removal process...\n');

    // Step 1: Delete all QO2 document templates
    console.log('📝 Step 1: Deleting QO2 document templates...');
    const deletedTemplates = await prisma.documentTemplate.deleteMany({
      where: {
        type: 'QO2',
      },
    });
    console.log(`✅ Deleted ${deletedTemplates.count} QO2 document templates\n`);

    // Step 2: Update all organizations to remove QO2 from customDocumentTypes
    console.log('🏢 Step 2: Updating organization customDocumentTypes...');

    // Get all organizations with customDocumentTypes
    const organizations = await prisma.organization.findMany({
      where: {
        customDocumentTypes: {
          not: null,
        },
      },
      select: {
        id: true,
        name: true,
        customDocumentTypes: true,
      },
    });

    let updatedCount = 0;
    for (const org of organizations) {
      if (Array.isArray(org.customDocumentTypes) && org.customDocumentTypes.includes('QO2')) {
        // Remove QO2 from the array
        const newDocTypes = (org.customDocumentTypes as string[]).filter(type => type !== 'QO2');

        await prisma.organization.update({
          where: { id: org.id },
          data: {
            customDocumentTypes: newDocTypes,
          },
        });

        console.log(`  ✓ Updated organization: ${org.name} (removed QO2)`);
        updatedCount++;
      }
    }

    console.log(`✅ Updated ${updatedCount} organizations\n`);

    console.log('🎉 QO2 removal completed successfully!');
    console.log('\nSummary:');
    console.log(`  - Deleted templates: ${deletedTemplates.count}`);
    console.log(`  - Updated organizations: ${updatedCount}`);

  } catch (error) {
    console.error('❌ Error removing QO2:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

removeQO2()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
