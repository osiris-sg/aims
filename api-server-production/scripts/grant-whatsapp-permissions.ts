/**
 * Create whatsapp:* permissions and grant to superadmin + Admin roles per org,
 * and append WHATSAPP to every non-empty Role.allowedModules list (restrictive
 * roles otherwise hide the new module from the sidebar).
 * Idempotent — safe to re-run.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MODULE_CODE = 'WHATSAPP';

const PERMS = [
  { resource: 'whatsapp', action: 'read', description: 'View WhatsApp connection status and message log' },
  { resource: 'whatsapp', action: 'manage', description: 'Connect/disconnect the org WhatsApp number (Embedded Signup)' },
  { resource: 'whatsapp', action: 'send', description: 'Send WhatsApp template/text messages' },
];

async function main() {
  console.log('🔐 Ensuring whatsapp:* permissions...');
  const perms = [];
  for (const { resource, action, description } of PERMS) {
    const name = `${resource}:${action}`;
    const p = await prisma.permission.upsert({
      where: { name },
      update: { description },
      create: { name, description, resource, action },
    });
    perms.push(p);
    console.log(`   • ${p.name}`);
  }

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  let granted = 0;
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
      if (toConnect.length === 0) continue;
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: toConnect } },
      });
      granted += toConnect.length;
      console.log(`   🔄 ${org.name} / ${role.name}: granted ${toConnect.length}`);
    }
  }
  console.log(`\n🎉 ${granted} permission link(s) granted.`);

  // Restrictive allowedModules lists snapshot "modules this role gets" — a new
  // catalog module must be appended or those users never see it in the sidebar.
  console.log('\n📋 Patching non-empty Role.allowedModules lists...');
  const restrictiveRoles = await prisma.role.findMany({
    where: { NOT: { allowedModules: { isEmpty: true } } },
    select: { id: true, name: true, allowedModules: true, organization: { select: { name: true } } },
  });
  let patched = 0;
  for (const role of restrictiveRoles) {
    if (role.allowedModules.includes(MODULE_CODE)) continue;
    await prisma.role.update({
      where: { id: role.id },
      data: { allowedModules: [...role.allowedModules, MODULE_CODE] },
    });
    patched++;
    console.log(`   🔄 ${role.organization?.name} / ${role.name}: + ${MODULE_CODE}`);
  }
  console.log(`\n🎉 ${patched} role allowedModules list(s) patched.`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
