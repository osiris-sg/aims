/**
 * Setup for the new Bills (AP) feature:
 *   1. Add 'Bills (AP)' submenu under Inventory module for all existing orgs.
 *   2. Create bills:* permissions + grant to superadmin and Admin roles in
 *      every org. Mirrors the pattern from add-accounting-permissions.ts.
 *
 * Idempotent. Safe to re-run.
 *
 * Usage: npx ts-node scripts/setup-bills.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BILL_PERMISSIONS: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'bills', action: 'read', description: 'View supplier bills + AP aging' },
  { resource: 'bills', action: 'create', description: 'Create supplier bills (manual, upload, from PO)' },
  { resource: 'bills', action: 'update', description: 'Edit DRAFT/PENDING bills, void any bill' },
  { resource: 'bills', action: 'approve', description: 'Approve or reject PENDING bills' },
];

const NEW_INVENTORY_SUBMENUS = [
  { key: 'products', label: 'Products' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'purchases-return', label: 'Purchases Return' },
  { key: 'bills', label: 'Bills (AP)' },
  { key: 'adjustment-in', label: 'Stock Adjustment In' },
  { key: 'adjustment-out', label: 'Stock Adjustment Out' },
  { key: 'reports', label: 'Reports' },
  { key: 'stock-card', label: 'Stock Card' },
];

async function main() {
  // --- 1. Permissions
  console.log('🔐 Ensuring bills:* permissions...');
  const perms = [];
  for (const { resource, action, description } of BILL_PERMISSIONS) {
    const name = `${resource}:${action}`;
    const perm = await prisma.permission.upsert({
      where: { name },
      update: { description },
      create: { name, description, resource, action },
    });
    perms.push(perm);
    console.log(`   • ${perm.name}`);
  }

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`\n🏢 Found ${orgs.length} org(s)`);

  let totalGranted = 0;
  let rolesUpdated = 0;

  for (const org of orgs) {
    const roles = await prisma.role.findMany({
      where: {
        organizationId: org.id,
        OR: [
          { name: { equals: 'superadmin', mode: 'insensitive' } },
          { name: { equals: 'admin', mode: 'insensitive' } },
        ],
      },
      include: { permissions: true },
    });
    for (const role of roles) {
      const existing = new Set(role.permissions.map((p: any) => p.id));
      const toConnect = perms.filter((p) => !existing.has(p.id)).map((p) => ({ id: p.id }));
      if (toConnect.length === 0) {
        console.log(`   ✅ ${org.name} / ${role.name}: already has all bills:* perms`);
        continue;
      }
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: toConnect } },
      });
      totalGranted += toConnect.length;
      rolesUpdated += 1;
      console.log(`   🔄 ${org.name} / ${role.name}: granted ${toConnect.length}`);
    }
  }

  // --- 2. Inventory module submenu update
  console.log('\n📋 Updating Inventory module submenus...');
  let inventoryUpdated = 0;
  const invMods = await prisma.organizationModule.findMany({
    where: { moduleCode: 'INVENTORY' },
    include: { organization: { select: { name: true } } },
  });
  for (const m of invMods) {
    const cfg = (m.config as any) || {};
    const subs = cfg.subMenus || [];
    const hasBills = subs.some((s: any) => (typeof s === 'string' ? s : s.key) === 'bills');
    if (hasBills) {
      console.log(`   ✅ ${m.organization?.name}: already has Bills submenu`);
      continue;
    }
    await prisma.organizationModule.update({
      where: { id: m.id },
      data: { config: { ...cfg, subMenus: NEW_INVENTORY_SUBMENUS } },
    });
    inventoryUpdated += 1;
    console.log(`   🔄 ${m.organization?.name}: added Bills submenu`);
  }

  console.log(
    `\n🎉 Done. ${rolesUpdated} role(s) updated (${totalGranted} grants); ${inventoryUpdated} Inventory submenu(s) updated.`,
  );
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
