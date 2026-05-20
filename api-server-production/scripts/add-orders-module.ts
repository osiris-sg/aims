/**
 * Adds the ORDERS sidebar module to every organization. Idempotent.
 *
 * Usage: npx ts-node scripts/add-orders-module.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`🏢 Adding ORDERS module to ${orgs.length} organization(s)\n`);

  for (const org of orgs) {
    await prisma.organizationModule.upsert({
      where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: 'ORDERS' } },
      update: {
        displayName: 'Orders',
        icon: 'Receipt',
        enabled: true,
        sortOrder: 5,
        config: {
          route: '/portal/orders',
        },
      },
      create: {
        organizationId: org.id,
        moduleCode: 'ORDERS',
        displayName: 'Orders',
        icon: 'Receipt',
        enabled: true,
        sortOrder: 5,
        config: {
          route: '/portal/orders',
        },
      },
    });
    console.log(`   ✅ ${org.name}`);
  }

  console.log(`\n🎉 Done.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
