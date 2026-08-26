/**
 * DELIVERIES became a real MODULE_CATALOG entry on 2026-08-25 (it used to be a
 * hard-coded sidebar item every org saw). The catalog default is ON, so orgs
 * without a row keep seeing it — but any Role with a restrictive
 * `allowedModules` list would silently lose the menu unless DELIVERIES is
 * appended. This appends it to every such role. Idempotent.
 *
 *   npx ts-node scripts/promote-deliveries-module.ts            (dry run)
 *   npx ts-node scripts/promote-deliveries-module.ts --apply
 *
 * Run against dev (.env), then staging/prod by pointing DATABASE_URL at them.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const CODE = 'DELIVERIES';

async function main() {
  const roles = await prisma.role.findMany({
    where: { NOT: { allowedModules: { isEmpty: true } } },
    select: { id: true, name: true, allowedModules: true, organizationId: true, organization: { select: { name: true } } },
  });
  // Orgs that explicitly switched DELIVERIES off (e.g. CIEL INTERIOR) — don't
  // touch their roles at all.
  const offRows = await prisma.organizationModule.findMany({
    where: { moduleCode: CODE, enabled: false },
    select: { organizationId: true },
  });
  const orgsOff = new Set(offRows.map((r) => r.organizationId));
  let touched = 0;
  for (const role of roles) {
    if (role.allowedModules.includes(CODE)) continue;
    if (orgsOff.has(role.organizationId)) {
      console.log(`   skip ${role.organization?.name} / ${role.name} (org has ${CODE} switched off)`);
      continue;
    }
    // Orgs that were explicitly configured WITHOUT delivery-style modules (no
    // SALES / INVENTORY) shouldn't gain a delivery queue — skip them.
    const usesDeliveries = role.allowedModules.some((m) => ['SALES', 'INVENTORY', 'ORDERS'].includes(m));
    if (!usesDeliveries) {
      console.log(`   skip ${role.organization?.name} / ${role.name} (no sales/inventory modules)`);
      continue;
    }
    if (APPLY) {
      await prisma.role.update({ where: { id: role.id }, data: { allowedModules: [...role.allowedModules, CODE] } });
    }
    console.log(`${APPLY ? '🔄' : '[dry]'} ${role.organization?.name} / ${role.name}: + ${CODE}`);
    touched += 1;
  }
  console.log(`\n${APPLY ? '🎉 Done' : 'Dry run'} — ${touched} role(s) ${APPLY ? 'updated' : 'would be updated'} of ${roles.length} restrictive role(s).`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
