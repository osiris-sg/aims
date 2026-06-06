/**
 * Ensures `statements:read` permission exists and is granted to every
 * org's `superadmin` and `Admin` roles. Idempotent.
 *
 * Usage: npx ts-node scripts/grant-statements-permission.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const perm = await prisma.permission.upsert({
    where: { name: 'statements:read' },
    update: { description: 'Can view customer statements + AR aging' },
    create: {
      name: 'statements:read',
      description: 'Can view customer statements + AR aging',
      resource: 'statements',
      action: 'read',
    },
  });
  console.log(`✅ Permission ensured: ${perm.name}`);

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  let updated = 0;
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
      const hasIt = role.permissions.some((p: { id: string }) => p.id === perm.id);
      if (hasIt) {
        console.log(`   ✅ ${org.name} / ${role.name}: already has`);
        continue;
      }
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: [{ id: perm.id }] } },
      });
      updated += 1;
      console.log(`   🔄 ${org.name} / ${role.name}: granted`);
    }
  }
  console.log(`\nUpdated ${updated} role(s).`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
