/**
 * Adds maintenance-reports:* and field-scan:* permissions, then grants them to
 * the `superadmin` and `Admin` role in every organization. Idempotent.
 *
 * Usage: npx ts-node scripts/add-field-scan-permissions.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMISSIONS: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'maintenance-reports', action: 'create', description: 'Create maintenance service reports from the field scan PWA' },
  { resource: 'maintenance-reports', action: 'read', description: 'View maintenance service reports' },
  { resource: 'maintenance-reports', action: 'sign', description: 'Sign and finalize maintenance service reports' },
  { resource: 'field-scan', action: 'access', description: 'Access the NFC field-scan PWA and resolve scan context for an asset' },
];

async function main() {
  console.log('🔍 Ensuring maintenance-reports:* and field-scan:* permissions exist...');

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
        console.log(`   ✅ ${org.name} / ${role.name}: already has all field-scan permissions`);
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
