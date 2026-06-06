/**
 * One-shot migration: collapse the ACCOUNTING module's stored sub-menus from
 * the legacy 8-page list down to the new 3-entry layout (Dashboard / Reports /
 * Setup). Catalog defaults already match — this only updates orgs whose DB row
 * has the old 8-item config saved against it.
 *
 * Idempotent. Safe to re-run.
 *
 * Usage: npx ts-node scripts/migrate-accounting-submenus.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NEW_SUBMENUS = [
  { key: 'list', label: 'Dashboard' },
  { key: 'reports', label: 'Reports' },
  { key: 'setup', label: 'Setup', href: '/portal/settings/accounting-setup' },
];

const OLD_KEYS = new Set([
  'general-ledger',
  'trial-balance',
  'audit-trail',
  'gst',
  'profit-loss',
  'expense-listing',
  'bank-reconciliation',
  'foreign-bank',
]);

async function main() {
  const rows = await prisma.organizationModule.findMany({
    where: { moduleCode: 'ACCOUNTING' },
    include: { organization: { select: { name: true } } },
  });

  console.log(`🔍 Found ${rows.length} ACCOUNTING module row(s)`);

  let updated = 0;
  for (const row of rows) {
    const cfg = (row.config as any) || {};
    const subMenus = cfg.subMenus || [];

    const hasOldKey = subMenus.some((s: any) => {
      const k = typeof s === 'string' ? s : s?.key;
      return OLD_KEYS.has(k);
    });

    if (!hasOldKey) {
      console.log(`   ✅ ${row.organization?.name || row.organizationId}: already on new structure`);
      continue;
    }

    await prisma.organizationModule.update({
      where: { id: row.id },
      data: {
        displayName: 'Accounting',
        config: {
          ...cfg,
          route: '/portal/accounting',
          subMenus: NEW_SUBMENUS,
        },
      },
    });
    updated += 1;
    console.log(`   🔄 ${row.organization?.name || row.organizationId}: collapsed to 3 submenus`);
  }

  console.log(`\n🎉 Done. Updated ${updated} org(s).`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
