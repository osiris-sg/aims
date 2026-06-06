/**
 * Create bankrec:* permissions and grant to superadmin + Admin roles per org.
 * Idempotent — safe to re-run.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERMS = [
  { resource: 'bankrec', action: 'read', description: 'View bank imports and reconciliation' },
  { resource: 'bankrec', action: 'create', description: 'Import statements, match, post-as-new, ignore' },
];

async function main() {
  console.log('🔐 Ensuring bankrec:* permissions...');
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
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
