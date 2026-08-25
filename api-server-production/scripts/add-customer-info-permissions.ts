/**
 * Adds the customer-info:read and customer-info:create permissions and grants
 * them to every org's `superadmin` and `Admin` roles (case-insensitive).
 * Mirrors add-accounting-permissions.ts but DRY by default. Idempotent.
 *
 * customer-info:read  gates the office list + detail.
 * customer-info:create gates mint / revoke / regenerate.
 * (The public token routes are @Public() and need no permission.)
 *
 * Usage (run once PER environment by pointing DATABASE_URL at that env):
 *   DRY (default):  npx ts-node scripts/add-customer-info-permissions.ts
 *   APPLY:          APPLY=1 npx ts-node scripts/add-customer-info-permissions.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === '1';

const PERMISSIONS: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'customer-info', action: 'read', description: 'Can view Customer Information collection requests and their contacts' },
  { resource: 'customer-info', action: 'create', description: 'Can mint, revoke, and regenerate Customer Information collection links' },
];

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').hostname || '(unknown)';
  } catch {
    return '(unparseable)';
  }
}

async function main() {
  console.log(`HOST: ${dbHost()}  ${APPLY ? '(APPLYING)' : '(DRY RUN — no writes)'}\n`);

  // Ensure the Permission rows exist (global table, name-unique).
  const perms = [];
  for (const { resource, action, description } of PERMISSIONS) {
    const name = `${resource}:${action}`;
    if (APPLY) {
      const perm = await prisma.permission.upsert({
        where: { name },
        update: { description },
        create: { name, description, resource, action },
      });
      perms.push(perm);
    } else {
      const existing = await prisma.permission.findUnique({ where: { name } });
      perms.push(existing ?? { id: `(new) ${name}`, name });
      console.log(`  permission ${name}: ${existing ? 'exists' : 'WILL CREATE'}`);
    }
  }

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`\nFound ${orgs.length} organization(s)\n`);

  let rolesToUpdate = 0;
  for (const org of orgs) {
    const adminRoles = await prisma.role.findMany({
      where: {
        organizationId: org.id,
        OR: [
          { name: { equals: 'superadmin', mode: 'insensitive' } },
          { name: { equals: 'admin', mode: 'insensitive' } },
        ],
      },
      include: { permissions: { select: { id: true, name: true } } },
    });
    if (adminRoles.length === 0) {
      console.log(`  ! ${org.name}: no superadmin/Admin role — skipped`);
      continue;
    }
    for (const role of adminRoles) {
      const have = new Set(role.permissions.map((p) => p.name));
      const missing = PERMISSIONS.map((p) => `${p.resource}:${p.action}`).filter((n) => !have.has(n));
      if (missing.length === 0) {
        console.log(`  = ${org.name} / ${role.name}: already has customer-info permissions`);
        continue;
      }
      rolesToUpdate++;
      console.log(`  + ${org.name} / ${role.name}: grant ${missing.join(', ')}`);
      if (APPLY) {
        await prisma.role.update({
          where: { id: role.id },
          data: { permissions: { connect: (perms as Array<{ id: string }>).map((p) => ({ id: p.id })) } },
        });
      }
    }
  }

  console.log(`\nPlan: ${rolesToUpdate} role(s) to update.`);
  console.log(APPLY ? 'APPLIED.' : 'DRY RUN complete — re-run with APPLY=1 to write.');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
