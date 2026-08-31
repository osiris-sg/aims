/**
 * Phase 0 bootstrap for the CIEL INTERIOR PTE. LTD. org (interior-design client).
 *
 * Mirrors what OrganizationsService.create() does at runtime (superadmin role,
 * default templates, canonical feature flags) and layers the CIEL-specific
 * configuration on top:
 *   - modules: DASHBOARD / SALES (quotation + invoice + CN/DN only) / CUSTOMERS /
 *     PROJECTS / ACCOUNTING / USER_MANAGEMENT / AUDIT / ADMIN enabled; every
 *     rental/inventory module explicitly disabled so catalog defaults don't leak in
 *   - roles: superadmin (all perms), Management (all perms), Designer (sales +
 *     projects + customers only, restricted allowedModules)
 *   - accounting: AccountingSetting + default chart of accounts (not GST registered)
 *   - document numbering: one "Default" variant per sales doc type
 *   - access: every superadmin of Osiris Technology gets Management on CIEL
 *
 * Dry-run by default. Idempotent — safe to re-run with --apply.
 *   npx ts-node scripts/setup-ciel-org.ts            (dry run)
 *   npx ts-node scripts/setup-ciel-org.ts --apply
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { DEFAULT_DOCUMENT_TEMPLATES } from '../src/organizations/default-templates';
import { DEFAULT_ORG_FEATURES } from '../src/organizations/default-features';
import { MODULE_CATALOG } from '../src/configuration/module-catalog';
import {
  DEFAULT_ACCOUNT_CODE_RANGES,
  DEFAULT_CONTROL_ACCOUNTS,
  DEFAULT_CHART_OF_ACCOUNTS,
  DEFAULT_NEXT_NUMBERS,
} from '../src/accounting/default-chart-of-accounts';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const log = (m: string) => console.log(`${APPLY ? '  ' : '  [dry] '}${m}`);

const ORG_NAME = 'CIEL INTERIOR PTE. LTD.';
const ORG_UEN = '202312049Z';
const SOURCE_ORG = 'd068f159-e45a-4da8-beaf-62e903f44141'; // Osiris Technology — its superadmins get access

// Modules the firm actually uses. SALES is trimmed to the documents an ID firm
// issues (no SO / DO / RDO / stock card — those are the rental flow).
const ENABLED_MODULES: Array<{ code: string; subMenus?: Array<{ key: string; label: string }> }> = [
  { code: 'DASHBOARD' },
  {
    code: 'SALES',
    subMenus: [
      { key: 'quotations', label: 'Quotation' },
      { key: 'invoices', label: 'Invoice' },
      { key: 'credit-notes', label: 'Credit Note' },
      { key: 'debit-notes', label: 'Debit Note' },
    ],
  },
  { code: 'CUSTOMERS' },
  { code: 'PROJECTS' },
  { code: 'ACCOUNTING' },
  { code: 'USER_MANAGEMENT' },
  { code: 'AUDIT' },
  { code: 'ADMIN' },
];
const ENABLED_CODES = new Set(ENABLED_MODULES.map((m) => m.code));

// Feature flags that differ from the canonical defaults for this org.
const FEATURE_OVERRIDES: Record<string, boolean> = {
  enableProjects: true,
  enableQuotationProjectLink: true, // quotations attach to the project they belong to
  enableActionLog: true, // management wanted every document edit traceable
  enableDocumentAI: true,
  enableIdQuotation: true, // sectioned Letter-of-Intent quotation editor + Work Library
};

// Designer: can raise quotations / invoices, manage their projects + customers.
// No accounting, no user management, no admin.
const DESIGNER_MODULES = ['DASHBOARD', 'SALES', 'CUSTOMERS', 'PROJECTS'];
const DESIGNER_RESOURCES = new Set([
  'dashboard',
  'documents',
  'documentTemplates',
  'document-extraction',
  'customers',
  'projects',
  'timeline-items',
  'uploads',
]);
// users read access lets the Designer pick from the user dropdowns (quotation
// editor "Designer" field, project header) — no user mutation rights.
const DESIGNER_READ_ONLY_RESOURCES = new Set(['suppliers', 'accounting', 'users']);

// Document numbering — one default variant per type the firm issues.
// Quotation numbers follow their existing contract-number series (CI25-102):
// "CI" + 2-digit year + running 3-digit serial.
const NUMBER_FORMATS = [
  { documentType: 'QUOTATION', pattern: 'CI{YY}-{###}' },
  { documentType: 'INVOICE', pattern: 'CIEL-INV-{YYYY}-{####}' },
  { documentType: 'CREDIT_NOTE', pattern: 'CIEL-CN-{YYYY}-{####}' },
  { documentType: 'DEBIT_NOTE', pattern: 'CIEL-DN-{YYYY}-{####}' },
  { documentType: 'RECEIPT', pattern: 'CIEL-RCP-{YYYY}-{####}' },
  { documentType: 'PAYMENT_VOUCHER', pattern: 'CIEL-PV-{YYYY}-{####}' },
];

async function main() {
  console.log(`\n🏢 CIEL INTERIOR org bootstrap — ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  // ── 1. Organization ────────────────────────────────────────────────────────
  let org = await prisma.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  if (org) {
    log(`org exists [${org.id}]`);
  } else if (APPLY) {
    org = await prisma.organization.create({
      data: {
        name: ORG_NAME,
        registrationNumber: ORG_UEN,
        defaultCurrency: 'SGD',
        // Not GST-registered (below the S$1M threshold per the owners) — new
        // documents default to no tax; per-doc override still available.
        taxApplicable: false,
        absorbTax: false,
        quoteRoundingStep: 0,
      },
      select: { id: true },
    });
    log(`created org [${org.id}]`);
  } else {
    log(`would create org "${ORG_NAME}" (UEN ${ORG_UEN}, SGD, tax off)`);
  }
  const orgId = org?.id;
  if (!orgId) {
    console.log('\n(dry run stops here — the remaining steps need the org id; re-run with --apply)\n');
    return;
  }

  // ── 2. Roles ───────────────────────────────────────────────────────────────
  const allPerms = await prisma.permission.findMany({ select: { id: true, resource: true, action: true } });
  const designerPerms = allPerms.filter(
    (p) =>
      DESIGNER_RESOURCES.has(p.resource) ||
      (DESIGNER_READ_ONLY_RESOURCES.has(p.resource) && /^read/.test(p.action)),
  );

  const ensureRole = async (
    name: string,
    description: string,
    allowedModules: string[],
    perms: Array<{ id: string }>,
  ) => {
    const existing = await prisma.role.findFirst({ where: { organizationId: orgId, name } });
    if (existing) {
      if (APPLY) {
        await prisma.role.update({
          where: { id: existing.id },
          data: { allowedModules, permissions: { set: perms.map((p) => ({ id: p.id })) } },
        });
      }
      log(`role "${name}" exists — permissions synced (${perms.length})`);
      return existing;
    }
    if (!APPLY) {
      log(`would create role "${name}" (${perms.length} perms, modules ${allowedModules.length ? allowedModules.join('/') : 'ALL'})`);
      return null;
    }
    const r = await prisma.role.create({
      data: {
        organizationId: orgId,
        name,
        description,
        allowedModules,
        permissions: { connect: perms.map((p) => ({ id: p.id })) },
      },
    });
    log(`created role "${name}" (${perms.length} perms)`);
    return r;
  };

  await ensureRole('superadmin', 'Platform superadmin', [], allPerms);
  const management = await ensureRole('Management', 'CIEL owners — full access', [], allPerms);
  await ensureRole(
    'Designer',
    'Interior designers — quotations, invoices, projects, customers',
    DESIGNER_MODULES,
    designerPerms,
  );

  // ── 3. Modules ─────────────────────────────────────────────────────────────
  for (const cat of MODULE_CATALOG) {
    const wanted = ENABLED_MODULES.find((m) => m.code === cat.moduleCode);
    const enabled = ENABLED_CODES.has(cat.moduleCode);
    const config = wanted?.subMenus ? { ...cat.config, subMenus: wanted.subMenus } : cat.config;
    if (APPLY) {
      await prisma.organizationModule.upsert({
        where: { organizationId_moduleCode: { organizationId: orgId, moduleCode: cat.moduleCode } },
        update: { enabled, config: config as Prisma.InputJsonValue },
        create: {
          organizationId: orgId,
          moduleCode: cat.moduleCode,
          enabled,
          displayName: cat.displayName,
          icon: cat.icon,
          sortOrder: cat.sortOrder,
          config: config as Prisma.InputJsonValue,
        },
      });
    }
    log(`module ${cat.moduleCode.padEnd(16)} ${enabled ? 'ON ' : 'off'}${wanted?.subMenus ? `  (${wanted.subMenus.map((s) => s.key).join(', ')})` : ''}`);
  }

  // ── 4. Feature flags ───────────────────────────────────────────────────────
  const uiCfg = await prisma.organizationUIConfig.findUnique({ where: { organizationId: orgId }, select: { features: true } });
  const features = { ...DEFAULT_ORG_FEATURES, ...((uiCfg?.features as Record<string, boolean>) || {}), ...FEATURE_OVERRIDES };
  if (APPLY) {
    await prisma.organizationUIConfig.upsert({
      where: { organizationId: orgId },
      update: { features },
      create: { organizationId: orgId, features, currency: 'SGD' },
    });
  }
  log(`feature flags seeded (${Object.keys(features).length}); overrides: ${Object.entries(FEATURE_OVERRIDES).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // ── 5. Document templates (same seed as runtime create) ────────────────────
  const existingTypes = new Set((await prisma.documentTemplate.findMany({ where: { organizationId: orgId }, select: { type: true } })).map((t) => t.type));
  const toCreate = DEFAULT_DOCUMENT_TEMPLATES.filter((t) => !existingTypes.has(t.type));
  if (APPLY && toCreate.length) {
    await prisma.documentTemplate.createMany({
      data: toCreate.map((t) => ({
        organizationId: orgId,
        type: t.type,
        templateVariant: t.templateVariant,
        name: t.name,
        designName: 'Default',
        description: `${t.name} document template`,
        isActive: true,
        isDefault: true,
        ...(t.config ? { config: t.config as Prisma.InputJsonValue } : {}),
      })),
    });
  }
  log(`document templates: ${toCreate.length} to seed, ${existingTypes.size} already present`);

  // ── 6. Accounting setting + chart of accounts ──────────────────────────────
  const acct = await prisma.accountingSetting.findUnique({ where: { organizationId: orgId } });
  if (!acct) {
    if (APPLY) {
      await prisma.accountingSetting.create({
        data: {
          organizationId: orgId,
          baseCurrency: 'SGD',
          nextNumbers: DEFAULT_NEXT_NUMBERS,
          numberPrefixes: {},
          activateLastSoldPrice: true,
          activateLastBuyPrice: true,
          taxDefaultPercentage: 0,
          taxReference: 'GST',
          taxRegistrationNumber: null,
          accountCodeRanges: DEFAULT_ACCOUNT_CODE_RANGES,
          controlAccounts: DEFAULT_CONTROL_ACCOUNTS,
        },
      });
    }
    log('accounting setting created (SGD, tax 0%, default ranges + control accounts)');
  } else {
    log('accounting setting exists — untouched');
  }
  const coaCount = await prisma.chartOfAccount.count({ where: { organizationId: orgId } });
  if (coaCount === 0) {
    if (APPLY) {
      await prisma.$transaction(
        DEFAULT_CHART_OF_ACCOUNTS.map((acc) =>
          prisma.chartOfAccount.create({
            data: {
              organizationId: orgId,
              code: acc.code,
              name: acc.name,
              accountType: acc.accountType,
              category: acc.category,
              normalBalance: acc.normalBalance,
              isControlAccount: acc.isControlAccount ?? false,
              isSystem: true,
            },
          }),
        ),
      );
    }
    log(`chart of accounts: seed ${DEFAULT_CHART_OF_ACCOUNTS.length} default accounts`);
  } else {
    log(`chart of accounts: ${coaCount} entries already — skipped`);
  }

  // ── 7. Document numbering ──────────────────────────────────────────────────
  for (const f of NUMBER_FORMATS) {
    const exists = await prisma.documentNumberFormat.findFirst({ where: { organizationId: orgId, documentType: f.documentType, label: 'Default' } });
    if (exists) {
      if (exists.pattern !== f.pattern) {
        if (APPLY) await prisma.documentNumberFormat.update({ where: { id: exists.id }, data: { pattern: f.pattern } });
        log(`number format ${f.documentType.padEnd(16)} pattern ${exists.pattern} → ${f.pattern}`);
      } else {
        log(`number format ${f.documentType} exists`);
      }
      continue;
    }
    if (APPLY) {
      await prisma.documentNumberFormat.create({
        data: { organizationId: orgId, documentType: f.documentType, label: 'Default', pattern: f.pattern, resetPolicy: 'yearly', nextSerial: 1, isActive: true, sortOrder: 0 },
      });
    }
    log(`number format ${f.documentType.padEnd(16)} ${f.pattern} (yearly reset)`);
  }

  // ── 8. Access: Osiris superadmins → Management on CIEL ─────────────────────
  const osirisAdmins = await prisma.userRole.findMany({
    where: { organizationId: SOURCE_ORG, isActive: true, role: { name: 'superadmin' } },
    select: { userId: true },
  });
  const userIds = [...new Set(osirisAdmins.map((r) => r.userId))];
  if (!management) {
    log(`would grant ${userIds.length} Osiris superadmin(s) Management access`);
  } else {
    for (const userId of userIds) {
      if (APPLY) {
        await prisma.userOrganization.upsert({
          where: { userId_organizationId: { userId, organizationId: orgId } },
          update: { isActive: true },
          create: { userId, organizationId: orgId, isActive: true },
        });
        await prisma.userRole.upsert({
          where: { userId_roleId_organizationId: { userId, roleId: management.id, organizationId: orgId } },
          update: { isActive: true },
          create: { userId, roleId: management.id, organizationId: orgId, isActive: true },
        });
      }
      log(`access granted: ${userId} → Management`);
    }
  }

  console.log(`\n✅ ${APPLY ? 'Done' : 'Dry run complete'} — org id ${orgId}\n`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
