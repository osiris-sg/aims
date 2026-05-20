/**
 * Adds the orders:* permissions and grants them to both the `superadmin` role
 * and any per-org `Admin` role. Idempotent — safe to re-run.
 *
 * Usage: npx ts-node scripts/add-orders-permissions.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMISSIONS: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'orders', action: 'read', description: 'Can view orders and order details' },
  { resource: 'orders', action: 'create', description: 'Can create orders (incl. auto-create from confirmed quotation)' },
  { resource: 'orders', action: 'update', description: 'Can update order status and link spawned PO/DO/Invoice docs' },
  { resource: 'orders', action: 'delete', description: 'Can delete orders' },
];

async function main() {
  console.log('🔍 Ensuring orders:* permissions exist...');

  const perms = [];
  for (const { resource, action, description } of PERMISSIONS) {
    const name = `${resource}:${action}`;
    const perm = await prisma.permission.upsert({
      where: { name },
      update: { description },
      create: { name, description, resource, action },
    });
    perms.push(perm);
    console.log(`   • ${perm.name}`);
  }

  const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`\n🏢 Found ${organizations.length} organization(s)`);

  let totalConnected = 0;
  let rolesUpdated = 0;

  for (const org of organizations) {
    const adminRoles = await prisma.role.findMany({
      where: {
        organizationId: org.id,
        OR: [
          { name: { equals: 'superadmin', mode: 'insensitive' } },
          { name: { equals: 'admin', mode: 'insensitive' } },
        ],
      },
      include: { permissions: true },
    });

    if (adminRoles.length === 0) {
      console.log(`   ⚠️  ${org.name}: no superadmin/Admin role — skipped`);
      continue;
    }

    for (const role of adminRoles) {
      const existingIds = new Set(role.permissions.map((p) => p.id));
      const toConnect = perms.filter((p) => !existingIds.has(p.id)).map((p) => ({ id: p.id }));

      if (toConnect.length === 0) {
        console.log(`   ✅ ${org.name} / ${role.name}: already has all orders permissions`);
        continue;
      }

      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: toConnect } },
      });

      totalConnected += toConnect.length;
      rolesUpdated += 1;
      console.log(`   ✅ ${org.name} / ${role.name}: granted ${toConnect.length} permission(s)`);
    }
  }

  console.log(`\n🎉 Done. Updated ${rolesUpdated} role(s), connected ${totalConnected} permission link(s).`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
