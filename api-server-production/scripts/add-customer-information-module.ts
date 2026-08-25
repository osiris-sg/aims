/**
 * Nav backfill: give every organization a CUSTOMER_INFORMATION top-level nav
 * entry (route /portal/customer-information, sortOrder 90 — bottom, just above
 * Admin Panel). Mirrors add-accounting-module.ts but DRY by default so the plan
 * can be reviewed first.
 *
 * The module IS in MODULE_CATALOG (defaultEnabled:false), so it already surfaces
 * DISABLED in every org's admin panel via mergeModulesWithCatalog. This backfill
 * writes a persisted, ENABLED OrganizationModule row per org so it appears in the
 * live sidebar and holds its order. Idempotent.
 *
 * Usage (run once PER environment — dev, staging, prod — by pointing
 * DATABASE_URL at that env):
 *   DRY (default):   npx ts-node scripts/add-customer-information-module.ts
 *   APPLY:           APPLY=1 npx ts-node scripts/add-customer-information-module.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === '1';

const MODULE_CODE = 'CUSTOMER_INFORMATION';
const DISPLAY_NAME = 'Customer Information';
const ICON = 'FolderCopy';
const SORT_ORDER = 90;
const CONFIG = { route: '/portal/customer-information' };

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').hostname || '(unknown)';
  } catch {
    return '(unparseable)';
  }
}

async function main() {
  console.log(`HOST: ${dbHost()}  ${APPLY ? '(APPLYING)' : '(DRY RUN — no writes)'}`);
  console.log(`Module: ${MODULE_CODE}  route=${CONFIG.route}  sortOrder=${SORT_ORDER}\n`);

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Found ${orgs.length} organization(s):\n`);

  let toCreate = 0;
  let toUpdate = 0;
  let unchanged = 0;

  for (const org of orgs) {
    const existing = await prisma.organizationModule.findUnique({
      where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: MODULE_CODE } },
      select: { enabled: true, sortOrder: true },
    });
    // Show where the new entry lands relative to the org's current stored order.
    const siblings = await prisma.organizationModule.findMany({
      where: { organizationId: org.id },
      orderBy: [{ sortOrder: 'asc' }, { moduleCode: 'asc' }],
      select: { moduleCode: true, sortOrder: true },
    });
    const before = siblings.filter((s) => (s.sortOrder ?? 0) <= SORT_ORDER).slice(-1)[0];
    const after = siblings.find((s) => (s.sortOrder ?? 0) > SORT_ORDER);
    const place = `after ${before ? `${before.moduleCode}(${before.sortOrder})` : 'START'}, before ${after ? `${after.moduleCode}(${after.sortOrder})` : 'END'}`;

    if (!existing) {
      toCreate++;
      console.log(`  + ${org.name}: CREATE enabled row @ sortOrder ${SORT_ORDER}  [${place}]`);
    } else if (existing.enabled !== true || existing.sortOrder !== SORT_ORDER) {
      toUpdate++;
      console.log(`  ~ ${org.name}: UPDATE (was enabled=${existing.enabled}, sortOrder=${existing.sortOrder}) -> enabled=true, sortOrder=${SORT_ORDER}`);
    } else {
      unchanged++;
      console.log(`  = ${org.name}: already present + enabled @ ${SORT_ORDER}`);
    }

    if (APPLY) {
      await prisma.organizationModule.upsert({
        where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: MODULE_CODE } },
        update: { displayName: DISPLAY_NAME, icon: ICON, enabled: true, sortOrder: SORT_ORDER, config: CONFIG },
        create: {
          organizationId: org.id,
          moduleCode: MODULE_CODE,
          displayName: DISPLAY_NAME,
          icon: ICON,
          enabled: true,
          sortOrder: SORT_ORDER,
          config: CONFIG,
        },
      });
    }
  }

  console.log(`\nPlan: create ${toCreate}, update ${toUpdate}, unchanged ${unchanged}.`);
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
