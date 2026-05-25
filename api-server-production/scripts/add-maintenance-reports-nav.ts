/**
 * Adds a top-level "Service Reports" module to every organization's sidebar
 * config. Idempotent — re-running just no-ops on orgs that already have it.
 *
 * The submenu uses key 'list', which the sidebar's URL resolver maps to the
 * bare `config.route` (see DynamicSidebarContent.tsx resolveSubmenuRoute).
 * So a click navigates to /portal/maintenance-reports.
 *
 * Usage: npx ts-node scripts/add-maintenance-reports-nav.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MAINTENANCE_MODULE = {
  moduleCode: 'MAINTENANCE',
  displayName: 'Service Reports',
  icon: 'Build',
  sortOrder: 5,
  enabled: true,
  config: {
    route: '/portal/maintenance-reports',
    subMenus: [{ key: 'list', label: 'All Reports' }],
  },
};

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`🏢 Found ${orgs.length} organization(s)\n`);

  let inserted = 0;
  let updated = 0;

  for (const org of orgs) {
    const existing = await prisma.organizationModule.findUnique({
      where: {
        organizationId_moduleCode: {
          organizationId: org.id,
          moduleCode: MAINTENANCE_MODULE.moduleCode,
        },
      },
    });

    if (existing) {
      // Refresh display fields in case we tweak label/icon/sortOrder over time.
      // Leaves `enabled` alone so admins who've turned it off stay off.
      await prisma.organizationModule.update({
        where: { id: existing.id },
        data: {
          displayName: MAINTENANCE_MODULE.displayName,
          icon: MAINTENANCE_MODULE.icon,
          sortOrder: MAINTENANCE_MODULE.sortOrder,
          config: MAINTENANCE_MODULE.config,
        },
      });
      console.log(`   ✏️  ${org.name}: MAINTENANCE module refreshed`);
      updated++;
    } else {
      await prisma.organizationModule.create({
        data: {
          organizationId: org.id,
          moduleCode: MAINTENANCE_MODULE.moduleCode,
          displayName: MAINTENANCE_MODULE.displayName,
          icon: MAINTENANCE_MODULE.icon,
          sortOrder: MAINTENANCE_MODULE.sortOrder,
          enabled: MAINTENANCE_MODULE.enabled,
          config: MAINTENANCE_MODULE.config,
        },
      });
      console.log(`   ➕ ${org.name}: MAINTENANCE module created`);
      inserted++;
    }
  }

  console.log(`\n🎉 Done. Inserted ${inserted}, refreshed ${updated}.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
