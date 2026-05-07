/**
 * Adds the ACCOUNTING sidebar module (Journal Entries / Trial Balance / General
 * Ledger) to every organization. Idempotent.
 *
 * Usage: npx ts-node scripts/add-accounting-module.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`🏢 Adding ACCOUNTING module to ${orgs.length} organization(s)\n`);

  for (const org of orgs) {
    await prisma.organizationModule.upsert({
      where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: 'ACCOUNTING' } },
      update: {
        displayName: 'Accounting',
        icon: 'AccountBalance',
        enabled: true,
        sortOrder: 7,
        config: {
          route: '/portal/accounting',
          subMenus: [
            { key: 'journal-entries', label: 'Journal Entries' },
            { key: 'trial-balance', label: 'Trial Balance' },
            { key: 'general-ledger', label: 'General Ledger' },
          ],
        },
      },
      create: {
        organizationId: org.id,
        moduleCode: 'ACCOUNTING',
        displayName: 'Accounting',
        icon: 'AccountBalance',
        enabled: true,
        sortOrder: 7,
        config: {
          route: '/portal/accounting',
          subMenus: [
            { key: 'journal-entries', label: 'Journal Entries' },
            { key: 'trial-balance', label: 'Trial Balance' },
            { key: 'general-ledger', label: 'General Ledger' },
          ],
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
