/**
 * Hierarchy access (guru 2026-09-19): create the 'Senior Manager' and
 * 'Junior Manager' roles in every CIEL org (permissions cloned from
 * Management; junior loses ACCOUNTING in the sidebar), and move Summer from
 * Management → Senior Manager (keeping her Designer role) to trial it.
 * Idempotent.
 *
 *   npx dotenv -e <env> -- npx ts-node --transpile-only scripts/_setup-hierarchy-roles.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SUMMER_ID = 'user_3Ig5Q439YUk1Jd8YzwtlGTkeRho';

async function main() {
  const orgs = await prisma.organization.findMany({ where: { name: { contains: 'CIEL', mode: 'insensitive' } }, select: { id: true, name: true } });
  for (const org of orgs) {
    const mgmt = await prisma.role.findFirst({
      where: { organizationId: org.id, name: 'Management' },
      include: { permissions: { select: { id: true } } },
    });
    if (!mgmt) {
      console.log(`?? ${org.name}: no Management role — skipped`);
      continue;
    }
    const permissionIds = mgmt.permissions.map((p) => ({ id: p.id }));
    const specs = [
      { name: 'Senior Manager', allowedModules: ['DASHBOARD', 'SALES', 'ACCOUNTING', 'PROJECTS', 'CUSTOMERS'] },
      { name: 'Junior Manager', allowedModules: ['DASHBOARD', 'SALES', 'CUSTOMERS', 'PROJECTS'] },
    ];
    const roleIds: Record<string, string> = {};
    for (const spec of specs) {
      let role = await prisma.role.findFirst({ where: { organizationId: org.id, name: spec.name } });
      if (!role) {
        role = await prisma.role.create({
          data: {
            organizationId: org.id,
            name: spec.name,
            description: spec.name === 'Senior Manager' ? 'Org-wide data access; distributes leads; no org administration' : 'Leads a sales team: assigns leads within the team, sees team projects, team target',
            allowedModules: spec.allowedModules,
            permissions: { connect: permissionIds },
          } as any,
        });
        console.log(`✔ ${org.name}: created ${spec.name}`);
      } else {
        console.log(`↷ ${org.name}: ${spec.name} exists`);
      }
      roleIds[spec.name] = role.id;
    }

    // Summer → Senior Manager (drop Management, keep Designer).
    const summerRoles = await prisma.userRole.findMany({
      where: { userId: SUMMER_ID, organizationId: org.id, isActive: true },
      include: { role: { select: { name: true } } },
    });
    if (!summerRoles.length) continue;
    const hasSenior = summerRoles.some((r) => r.role.name === 'Senior Manager');
    if (!hasSenior) {
      await prisma.userRole.create({ data: { userId: SUMMER_ID, organizationId: org.id, roleId: roleIds['Senior Manager'], isActive: true } as any });
      console.log(`✔ ${org.name}: Summer + Senior Manager`);
    }
    const mgmtRole = summerRoles.find((r) => r.role.name === 'Management');
    if (mgmtRole) {
      await prisma.userRole.update({ where: { id: mgmtRole.id }, data: { isActive: false } });
      console.log(`✔ ${org.name}: Summer's Management role deactivated`);
    }
  }
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
