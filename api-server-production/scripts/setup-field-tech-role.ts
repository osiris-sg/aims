/**
 * Creates a `field-tech` role in every organization with the minimal set of
 * permissions needed to operate the NFC field-scan PWA — and nothing else.
 *
 * Users assigned ONLY this role get redirected to /scan when they sign in
 * (see FieldOnlyGuard on the portal layout). Idempotent.
 *
 * Usage: npx ts-node scripts/setup-field-tech-role.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMISSIONS_NEEDED = [
  // PWA access
  { resource: 'field-scan', action: 'access', description: 'Access the NFC field-scan PWA' },
  // Maintenance reports
  { resource: 'maintenance-reports', action: 'create', description: 'Create maintenance service reports' },
  { resource: 'maintenance-reports', action: 'read', description: 'View maintenance service reports' },
  { resource: 'maintenance-reports', action: 'sign', description: 'Sign maintenance service reports' },
  // Asset lookup + tag binding
  { resource: 'assets', action: 'read-id', description: 'Read an asset by id' },
  { resource: 'assets', action: 'read-sku', description: 'Read an asset by SKU key' },
  { resource: 'assets', action: 'check-sku', description: 'Check if a SKU key exists' },
  { resource: 'assets', action: 'bind-nfc-tag', description: 'Bind an NFC tag UID to an asset' },
  // Photo upload (proof-of-service / DO-ack photos)
  { resource: 'uploads', action: 'upload-image', description: 'Upload proof-of-service and DO-ack photos to S3' },
  // Customer lookup — used by the revamped 5-page MSR form to search for the
  // company name on page 1. Read-only paginated list; no PII writes.
  { resource: 'customers', action: 'read', description: 'List and search customers' },
];

async function main() {
  console.log('🔍 Ensuring permissions exist...');
  const perms = [];
  for (const p of PERMISSIONS_NEEDED) {
    const name = `${p.resource}:${p.action}`;
    const perm = await prisma.permission.upsert({
      where: { name },
      update: { description: p.description },
      create: { name, description: p.description, resource: p.resource, action: p.action },
    });
    perms.push(perm);
    console.log(`   • ${name}`);
  }

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`\n🏢 Found ${orgs.length} organization(s)`);

  for (const org of orgs) {
    const role = await prisma.role.upsert({
      where: { name_organizationId: { name: 'field-tech', organizationId: org.id } },
      update: {},
      create: {
        name: 'field-tech',
        description: 'Restricted role for field technicians — locked to the NFC scan PWA',
        organizationId: org.id,
      },
      include: { permissions: true },
    });

    const existingIds = new Set(role.permissions.map((p) => p.id));
    const toConnect = perms.filter((p) => !existingIds.has(p.id)).map((p) => ({ id: p.id }));

    if (toConnect.length > 0) {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: toConnect } },
      });
      console.log(`   ✅ ${org.name}: field-tech role ready, granted ${toConnect.length} new permission(s)`);
    } else {
      console.log(`   ✅ ${org.name}: field-tech role already complete`);
    }
  }

  // Also grant assets:bind-nfc-tag to existing superadmin/Admin so they can provision tags too
  const bindPerm = perms.find((p) => p.name === 'assets:bind-nfc-tag')!;
  for (const org of orgs) {
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
    for (const role of adminRoles) {
      if (role.permissions.some((p) => p.id === bindPerm.id)) continue;
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: [{ id: bindPerm.id }] } },
      });
      console.log(`   ➕ ${org.name} / ${role.name}: granted assets:bind-nfc-tag`);
    }
  }

  console.log('\n🎉 Done.');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
