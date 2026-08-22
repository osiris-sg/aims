/**
 * Give the new Denzel Office org a working role set and grant guru access.
 * Membership needs BOTH UserOrganization (the guard checks it) and UserRole
 * (permissions) — one without the other silently fails.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = 'ad9127a7-cbc4-4108-b014-8b32123a5362'; // Denzel Office
const SOURCE_ORG = 'd068f159-e45a-4da8-beaf-62e903f44141'; // Osiris Technology

async function main() {
  // Whoever already administers Osiris Technology should administer this org.
  const existing = await prisma.userRole.findMany({
    where: { organizationId: SOURCE_ORG, isActive: true },
    select: { userId: true, role: { select: { name: true } } },
  });
  const admins = [...new Set(existing.filter((r) => /admin/i.test(r.role.name)).map((r) => r.userId))];
  console.log(`Admin users found on the source org: ${admins.length}`);

  // A role in the new org carrying every permission the CRM needs.
  const perms = await prisma.permission.findMany({
    where: { OR: [{ name: { startsWith: 'whatsapp:' } }, { resource: '*' }] },
    select: { id: true, name: true },
  });
  const waPerms = perms.filter((p) => p.name.startsWith('whatsapp:'));
  console.log(`WhatsApp permissions available: ${waPerms.map((p) => p.name).join(', ')}`);

  let role = await prisma.role.findFirst({ where: { organizationId: ORG, name: 'Admin' } });
  if (!role) {
    role = await prisma.role.create({
      data: {
        organizationId: ORG,
        name: 'Admin',
        description: 'Full access to Denzel Office',
        allowedModules: ['DASHBOARD', 'CRM', 'CUSTOMERS'],
        permissions: { connect: waPerms.map((p) => ({ id: p.id })) },
      },
    });
    console.log(`Created Admin role [${role.id}]`);
  } else {
    await prisma.role.update({
      where: { id: role.id },
      data: { permissions: { connect: waPerms.map((p) => ({ id: p.id })) } },
    });
    console.log(`Admin role already existed — permissions topped up`);
  }

  for (const userId of admins) {
    await prisma.userOrganization.upsert({
      where: { userId_organizationId: { userId, organizationId: ORG } },
      update: { isActive: true },
      create: { userId, organizationId: ORG, isActive: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId_organizationId: { userId, roleId: role.id, organizationId: ORG } },
      update: { isActive: true },
      create: { userId, roleId: role.id, organizationId: ORG, isActive: true },
    });
    console.log(`  granted ${userId}`);
  }

  const check = await prisma.userOrganization.count({ where: { organizationId: ORG, isActive: true } });
  console.log(`\n✅ ${check} user(s) can now switch into Denzel Office`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
