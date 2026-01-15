import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixSalesSortOrder() {
  console.log('=== Updating Sales Module Sort Order ===\n');

  try {
    // Update SALES module to sortOrder 3 (before CUSTOMERS)
    const salesUpdate = await prisma.organizationModule.updateMany({
      where: { moduleCode: 'SALES' },
      data: { sortOrder: 3 },
    });
    console.log(`Updated ${salesUpdate.count} SALES modules to sortOrder 3`);

    // Update CUSTOMERS module to sortOrder 4 (after SALES)
    const customersUpdate = await prisma.organizationModule.updateMany({
      where: { moduleCode: 'CUSTOMERS' },
      data: { sortOrder: 4 },
    });
    console.log(`Updated ${customersUpdate.count} CUSTOMERS modules to sortOrder 4`);

    console.log('\n=== Sort Order Update Complete ===');

    // Verify the changes
    const modules = await prisma.organizationModule.findMany({
      where: { moduleCode: { in: ['SALES', 'CUSTOMERS'] } },
      select: { moduleCode: true, sortOrder: true, displayName: true },
      orderBy: { sortOrder: 'asc' },
    });

    console.log('\nCurrent sort orders:');
    modules.forEach(m => {
      console.log(`  ${m.moduleCode} (${m.displayName}): sortOrder ${m.sortOrder}`);
    });

  } catch (error) {
    console.error('Error updating sort orders:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixSalesSortOrder().catch(console.error);
