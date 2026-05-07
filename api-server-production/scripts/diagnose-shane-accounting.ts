// One-shot diagnostic: figure out why Shane (chanyixuan0922@gmail.com) gets
// "User does not have sufficient permissions" when calling accounting endpoints.
//
//   1. Do the four accounting:* permissions exist in the Permission table?
//   2. Find the superadmin role(s) and check if accounting:* are connected.
//   3. Find Shane's UserOrganization rows + UserRole assignments.
//   4. Resolve everything end-to-end and print a verdict.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_EMAIL = 'chanyixuan0922@gmail.com';

async function main() {
  console.log(`\n=== 1. Accounting permissions in DB ===`);
  const accountingPerms = await prisma.permission.findMany({
    where: { resource: 'accounting' },
    orderBy: { name: 'asc' },
  });
  if (accountingPerms.length === 0) {
    console.log('   ❌ NONE FOUND. Run: npm run add-accounting-permissions');
  } else {
    accountingPerms.forEach((p) => console.log(`   • ${p.name} (id=${p.id})`));
  }

  console.log(`\n=== 2. Superadmin roles & their accounting perms ===`);
  const superadminRoles = await prisma.role.findMany({
    where: { name: 'superadmin' },
    include: {
      organization: { select: { id: true, name: true } },
      permissions: { where: { resource: 'accounting' } },
    },
  });
  for (const r of superadminRoles) {
    const have = r.permissions.map((p) => p.name).sort();
    console.log(`   • ${r.organization.name} — superadmin role id=${r.id}`);
    if (have.length === 0) {
      console.log(`     ❌ has no accounting:* permissions`);
    } else {
      console.log(`     ✅ has: ${have.join(', ')}`);
    }
  }

  console.log(`\n=== 3. Shane's user/org/role assignments ===`);

  // Shane is a Clerk user — there is no email column in our DB. Approach:
  // - dump every UserOrganization → UserRole (with role names) and let the
  //   user spot Shane by his Clerk userId. Without the userId we can't
  //   filter, so accept it as CLI arg too.
  const cliUserId = process.argv[2];

  if (cliUserId) {
    console.log(`   Filtering by userId=${cliUserId}\n`);
    const userOrgs = await prisma.userOrganization.findMany({
      where: { userId: cliUserId },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (userOrgs.length === 0) {
      console.log(`   ❌ No UserOrganization rows for ${cliUserId}`);
    } else {
      for (const uo of userOrgs) {
        console.log(`   • ${uo.organization.name} (org=${uo.organizationId}) active=${uo.isActive}`);
        const roles = await prisma.userRole.findMany({
          where: { userId: cliUserId, organizationId: uo.organizationId },
          include: {
            role: {
              include: { permissions: { where: { resource: 'accounting' } } },
            },
          },
        });
        if (roles.length === 0) {
          console.log(`     ❌ has no UserRole rows in this org`);
        } else {
          for (const ur of roles) {
            const accPerms = ur.role.permissions.map((p) => p.name).sort().join(', ') || 'NONE';
            console.log(`     • role=${ur.role.name} active=${ur.isActive} accounting:* = ${accPerms}`);
          }
        }
      }
    }
  } else {
    console.log(`   (no userId passed — pass Shane's Clerk userId as the first arg to drill in)`);
    console.log(`   Showing every superadmin assignment for cross-reference:\n`);
    const allSuperRoles = superadminRoles.map((r) => r.id);
    const userRoles = await prisma.userRole.findMany({
      where: { roleId: { in: allSuperRoles } },
      include: {
        role: { include: { organization: { select: { name: true } } } },
      },
      take: 50,
    });
    userRoles.forEach((ur) =>
      console.log(`   • userId=${ur.userId} → ${ur.role.organization.name} (active=${ur.isActive})`),
    );
  }

  console.log(`\n=== Done. ===\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
