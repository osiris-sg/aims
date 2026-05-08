/**
 * Adds the accounting:* AND journal:* permissions and grants them to both the
 * `superadmin` role and any per-org `Admin` role. Idempotent — safe to re-run.
 *
 * Usage: npx ts-node scripts/add-accounting-permissions.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMISSIONS: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'accounting', action: 'read', description: 'Can view chart of accounts and accounting settings' },
  { resource: 'accounting', action: 'create', description: 'Can create chart-of-account entries' },
  { resource: 'accounting', action: 'update', description: 'Can update chart-of-account entries and accounting settings' },
  { resource: 'accounting', action: 'delete', description: 'Can deactivate chart-of-account entries' },
  { resource: 'journal', action: 'read', description: 'Can view journal entries, trial balance, and general ledger' },
  { resource: 'journal', action: 'create', description: 'Can create manual journal entries' },
  { resource: 'journal', action: 'post', description: 'Can post journal entries' },
  { resource: 'journal', action: 'void', description: 'Can void posted journal entries (creates reversing entry)' },
];

async function main() {
  console.log('🔍 Ensuring accounting:* and journal:* permissions exist...');

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
    // Grant to every role in this org whose name matches superadmin/Admin
    // (case-insensitive) — covers `superadmin`, `Admin`, `admin`, etc.
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
        console.log(`   ✅ ${org.name} / ${role.name}: already has all accounting/journal permissions`);
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
