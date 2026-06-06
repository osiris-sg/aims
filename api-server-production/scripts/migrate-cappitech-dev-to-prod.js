/* eslint-disable no-console */
/**
 * One-shot migration: copy Cappitech org-level + catalog from dev DB to prod DB.
 *
 *  Scope (per user choice):
 *    - Organization, OrganizationUIConfig, OrganizationModule
 *    - Role + _PermissionToRole + UserOrganization + UserRole (Cappitech only)
 *    - Category, Asset (hierarchy preserved), AssetTemplateTag
 *    - DocumentTemplate (full config)
 *  NOT scoped:
 *    - Documents (orders, quotations, POs, invoices)  ← test data, stays on dev
 *    - Inventory, Customer, Supplier  ← they have none yet
 *
 * Both DBs are read via Prisma; assumes the prod schema deltas (ALTER TABLE)
 * have already been applied. Idempotent — re-running is safe (upserts).
 */
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const path = require('path');

const ORG = '59802f75-262b-4f96-b8b2-09a9a071d882';

function clientFor(envFile) {
  const env = dotenv.config({ path: path.join(__dirname, '..', envFile), processEnv: {} }).parsed;
  if (!env?.DATABASE_URL) throw new Error('Missing DATABASE_URL in ' + envFile);
  return new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
}

(async () => {
  const dev = clientFor('.env');
  const prod = clientFor('.env.production');

  // ────────────────────────────────────────────────────────────────────────
  // 1. Organization (preserve dev id + timestamps so FKs line up cleanly)
  // ────────────────────────────────────────────────────────────────────────
  const devOrg = await dev.organization.findUnique({ where: { id: ORG } });
  if (!devOrg) throw new Error('Cappitech org not found on dev (' + ORG + ')');
  console.log('Found Cappitech on dev:', devOrg.name);

  const orgPayload = {
    id: devOrg.id,
    name: devOrg.name,
    createdAt: devOrg.createdAt,
    updatedAt: devOrg.updatedAt,
    address: devOrg.address,
    phoneNumber: devOrg.phoneNumber,
    registrationNumber: devOrg.registrationNumber,
    logo: devOrg.logo,
    defaultStamp: devOrg.defaultStamp,
    customDocumentTypes: devOrg.customDocumentTypes ?? undefined,
    taxRate: devOrg.taxRate,
    bankDetails: devOrg.bankDetails ?? undefined,
    stockDeductionTrigger: devOrg.stockDeductionTrigger,
    pointsBalance: devOrg.pointsBalance,
  };
  await prod.organization.upsert({
    where: { id: ORG },
    update: orgPayload,
    create: orgPayload,
  });
  console.log('  ✓ Organization upserted');

  // ────────────────────────────────────────────────────────────────────────
  // 2. OrganizationUIConfig (feature flags + per-template UI overrides)
  // ────────────────────────────────────────────────────────────────────────
  const ui = await dev.organizationUIConfig.findUnique({ where: { organizationId: ORG } });
  if (ui) {
    const uiPayload = {
      ...ui,
      // skip relations
      organization: undefined,
    };
    await prod.organizationUIConfig.upsert({
      where: { organizationId: ORG },
      update: uiPayload,
      create: uiPayload,
    });
    console.log('  ✓ OrganizationUIConfig');
  } else {
    console.log('  • No OrganizationUIConfig on dev — skipping');
  }

  // ────────────────────────────────────────────────────────────────────────
  // 3. OrganizationModule (module enablement)
  // ────────────────────────────────────────────────────────────────────────
  const modules = await dev.organizationModule.findMany({ where: { organizationId: ORG } });
  for (const m of modules) {
    await prod.organizationModule.upsert({
      where: { id: m.id },
      update: m,
      create: m,
    });
  }
  console.log(`  ✓ OrganizationModule (${modules.length})`);

  // ────────────────────────────────────────────────────────────────────────
  // 4. Roles + Permission links (org-scoped Role rows + their _PermissionToRole)
  // ────────────────────────────────────────────────────────────────────────
  const roles = await dev.role.findMany({
    where: { organizationId: ORG },
    include: { permissions: { select: { id: true, name: true } } },
  });
  for (const r of roles) {
    // Permission rows are global — look them up on prod by unique name (in case
    // their ids differ between envs). Keep the role's own id so user-role FKs
    // line up after migration.
    const permNamesNeeded = r.permissions.map((p) => p.name);
    const prodPerms = await prod.permission.findMany({
      where: { name: { in: permNamesNeeded } },
      select: { id: true, name: true },
    });
    const missing = permNamesNeeded.filter((n) => !prodPerms.find((p) => p.name === n));
    if (missing.length) {
      console.warn('  ⚠ Role', r.name, 'has perms missing on prod:', missing.join(', '));
    }
    const { permissions: _ignored, ...rest } = r;
    await prod.role.upsert({
      where: { id: r.id },
      update: { ...rest, permissions: { set: prodPerms.map((p) => ({ id: p.id })) } },
      create: { ...rest, permissions: { connect: prodPerms.map((p) => ({ id: p.id })) } },
    });
  }
  console.log(`  ✓ Roles (${roles.length})`);

  // ────────────────────────────────────────────────────────────────────────
  // 5. UserOrganization + UserRole (membership)
  // ────────────────────────────────────────────────────────────────────────
  const userOrgs = await dev.userOrganization.findMany({ where: { organizationId: ORG } });
  for (const uo of userOrgs) {
    await prod.userOrganization.upsert({
      where: { id: uo.id },
      update: uo,
      create: uo,
    });
  }
  console.log(`  ✓ UserOrganization (${userOrgs.length})`);

  const userRoles = await dev.userRole.findMany({ where: { organizationId: ORG } });
  for (const ur of userRoles) {
    await prod.userRole.upsert({
      where: { id: ur.id },
      update: ur,
      create: ur,
    });
  }
  console.log(`  ✓ UserRole (${userRoles.length})`);

  // ────────────────────────────────────────────────────────────────────────
  // 6. Categories (assets depend on these)
  // ────────────────────────────────────────────────────────────────────────
  const cats = await dev.category.findMany({ where: { organizationId: ORG } });
  for (const c of cats) {
    await prod.category.upsert({
      where: { id: c.id },
      update: c,
      create: c,
    });
  }
  console.log(`  ✓ Category (${cats.length})`);

  // ────────────────────────────────────────────────────────────────────────
  // 7. Assets — two passes so parents land before children (parentAssetId FK).
  //    accessoryIds / accessoryOptionIds are scalar arrays, not FKs, so they
  //    just carry over as-is.
  // ────────────────────────────────────────────────────────────────────────
  const assets = await dev.asset.findMany({ where: { organizationId: ORG } });
  console.log(`  • Assets on dev: ${assets.length}`);
  const roots = assets.filter((a) => !a.parentAssetId);
  const children = assets.filter((a) => a.parentAssetId);
  let n = 0;
  for (const a of roots) {
    await prod.asset.upsert({ where: { id: a.id }, update: a, create: a });
    n++;
    if (n % 50 === 0) console.log(`    ↳ ${n}/${assets.length} (roots)`);
  }
  for (const a of children) {
    await prod.asset.upsert({ where: { id: a.id }, update: a, create: a });
    n++;
    if (n % 50 === 0) console.log(`    ↳ ${n}/${assets.length}`);
  }
  console.log(`  ✓ Assets (${assets.length})`);

  // ────────────────────────────────────────────────────────────────────────
  // 8. DocumentTemplates (with config) — gives prod the QF template +
  //    whatever other templates this org has.
  // ────────────────────────────────────────────────────────────────────────
  const tmpls = await dev.documentTemplate.findMany({ where: { organizationId: ORG } });
  for (const t of tmpls) {
    await prod.documentTemplate.upsert({
      where: { id: t.id },
      update: t,
      create: t,
    });
  }
  console.log(`  ✓ DocumentTemplate (${tmpls.length})`);

  // ────────────────────────────────────────────────────────────────────────
  // 9. AssetTemplateTag (asset ↔ template auto-tagging join, e.g. DO/RDO)
  // ────────────────────────────────────────────────────────────────────────
  const tags = await dev.assetTemplateTag.findMany({
    where: { asset: { organizationId: ORG } },
  });
  for (const t of tags) {
    await prod.assetTemplateTag.upsert({
      where: { id: t.id },
      update: t,
      create: t,
    });
  }
  console.log(`  ✓ AssetTemplateTag (${tags.length})`);

  console.log('\nMigration complete.');
  await dev.$disconnect();
  await prod.$disconnect();
})().catch((e) => {
  console.error('MIGRATION FAILED:', e);
  process.exit(1);
});
