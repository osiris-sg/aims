/**
 * AIMS Demo Pte. Ltd. — org bootstrap for the ROLE-BASED HOME SCREEN
 * (guru 2026-11-06, from ui-roles-demo.tar.gz: "follow the UI and rough
 * structure of this … keep the core functions as AIMS, just change the
 * UI/UX").
 *
 * An ordinary AIMS org — real modules, real roles, real documents — with the
 * `enableRoleHome` flag ON, so /portal lands on the role-based home screen
 * (greeting banner → Due today / Pending → priorities → business overview →
 * quick actions → assistant, with a "Viewing as" role switcher) instead of
 * the generic dashboard. Nothing else about the org is special.
 *
 * Shape is copied from Osiris Technology: modules, roles + permissions, GST
 * codes, number formats. Own: default SG chart of accounts, own default
 * document templates. No stock, no documents, no users beyond the Osiris
 * superadmins.
 *
 *   npx ts-node --transpile-only scripts/setup-aimsdemo-org.ts --env dev           # dry run
 *   npx ts-node --transpile-only scripts/setup-aimsdemo-org.ts --env dev --apply
 *
 * Dev is per-org tenancy, so org_aimsdemo must exist first:
 *   prisma/tenancy/orgs/aimsdemo.prisma  (copy of osiris.prisma)
 *   npx prisma generate --schema prisma/tenancy/orgs/aimsdemo.prisma
 *   CREATE SCHEMA org_aimsdemo;  then scripts/tenancy-push.ts aimsdemo
 *   (the three gin_trgm_ops indexes fail on a new schema — create them by hand
 *   with SET search_path TO org_aimsdemo, public, then re-push.)
 *
 * Idempotent: every write is keyed by the fixed ORG_ID, and assertOrgOnly()
 * refuses any row not scoped to this org.
 */
import { randomUUID } from 'crypto';
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';
import { checkTemplatePlan, type SelectionRow, type TemplateRow } from './lib/template-resolution';
import { DEFAULT_DOCUMENT_TEMPLATES } from '../src/organizations/default-templates';
import { MODULE_CATALOG } from '../src/configuration/module-catalog';
import {
  DEFAULT_ACCOUNT_CODE_RANGES,
  DEFAULT_CHART_OF_ACCOUNTS,
  DEFAULT_CONTROL_ACCOUNTS,
  DEFAULT_NEXT_NUMBERS,
} from '../src/accounting/default-chart-of-accounts';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const APPLY = args.includes('--apply');
if (!['dev', 'staging', 'prod'].includes(ENV)) {
  console.error('❌ --env dev|staging|prod');
  process.exit(1);
}
loadEnv(ENV);

export const ORG_ID = 'a1115de0-0000-4000-8000-a1115de00001';
export const ORG_NAME = 'AIMS Demo Pte. Ltd.';
const ORG_SCHEMA = 'org_aimsdemo';
const ORG_PRISMA_FILE = 'orgs/aimsdemo.prisma';
// Osiris Technology — the shape to copy, and the org whose superadmins get in.
const SOURCE_ORG_ID = 'd068f159-e45a-4da8-beaf-62e903f44141';
const SOURCE_SCHEMA = 'org_osiris';

// The three demo roles each cover a slice of this nav: Business Owner sees it
// all, HR + Finance the accounting/people half, Ops the stock/jobs half.
const MODULE_ENABLED: Record<string, boolean> = {
  DASHBOARD: true,
  SALES: true,
  ACCOUNTING: true,
  INVENTORY: true,
  PROJECTS: true,
  DELIVERIES: true,
  MAINTENANCE: true,
  CUSTOMERS: true,
  SUPPLIERS: true,
  USER_MANAGEMENT: true,
  CUSTOMER_INFORMATION: false,
  ORDERS: false,
  DOCUMENTS: false,
  INVOICES: false,
  CRM: false,
  AUDIT: false,
  ADMIN: false,
  PAYMENTS: false,
  REPORTS: false,
};

const FEATURE_OVERRIDES: Record<string, boolean> = {
  // The point of this org.
  enableRoleHome: true,
  // The home screen's assistant panel opens AIMEE over the page.
  enableAimsChat: true,
  enableActionLog: true,
  // Nothing of Osiris's integrations carries over.
  enableXeroIntegration: false,
  enableXeroDocSync: false,
  enableXeroConfirmSync: false,
  enableWaterSgSites: false,
  enableIdQuotation: false,
};

function assertOrgOnly(rows: any[], label: string) {
  for (const r of rows) {
    if ('organizationId' in r && r.organizationId !== ORG_ID) {
      throw new Error(`REFUSED: ${label} carries organizationId=${r.organizationId}, expected ${ORG_ID}`);
    }
  }
}
const log = (label: string, msg: string) => console.log(`  ${label.padEnd(26)} ${msg}`);

const { plat, org, layout, disconnect } = clientsFor(ENV, ORG_SCHEMA);
const srcClients = layout === 'tenancy' ? clientsFor(ENV, SOURCE_SCHEMA) : null;
const src = srcClients ? srcClients.org : org;

async function main() {
  console.log(`env=${ENV}  layout=${layout}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}`);
  const source = await plat.organization.findUnique({ where: { id: SOURCE_ORG_ID } });
  if (!source) throw new Error(`source org ${SOURCE_ORG_ID} not found in ${ENV}`);
  console.log(`Source shape: ${source.name}\n`);

  // ── 1. Organization ───────────────────────────────────────────────────────
  const byName = await plat.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  if (byName && byName.id !== ORG_ID) throw new Error(`An org named "${ORG_NAME}" already exists with id ${byName.id}`);
  const existing = await plat.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } });
  log('Organization', existing ? `exists ${ORG_ID}` : `create "${ORG_NAME}" ${ORG_ID} (SGD, GST 9%)`);
  if (APPLY && !existing) {
    await plat.organization.create({
      data: {
        id: ORG_ID,
        name: ORG_NAME,
        taxRate: 9,
        taxApplicable: true,
        absorbTax: false,
        defaultCurrency: 'SGD',
        quoteRoundingStep: 0,
      } as any,
    });
  }

  // ── 1b. Tenancy registry + permission catalogue (dev only) ────────────────
  if (layout === 'tenancy') {
    const tenant = await plat.orgTenant.findUnique({ where: { organizationId: ORG_ID } });
    log('OrgTenant', tenant ? `exists (${tenant.schemaName}, ${tenant.status})` : `register ${ORG_SCHEMA} ← ${ORG_PRISMA_FILE}`);
    if (APPLY && !tenant) {
      await plat.orgTenant.create({ data: { organizationId: ORG_ID, schemaName: ORG_SCHEMA, prismaFile: ORG_PRISMA_FILE, status: 'ACTIVE' } });
    }
    const [{ n: have }] = await plat.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${ORG_SCHEMA}"."Permission"`);
    const [{ n: srcN }] = await plat.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${SOURCE_SCHEMA}"."Permission"`);
    log('Permission catalogue', `${have} present, ${srcN} in ${SOURCE_SCHEMA} → copy missing`);
    if (APPLY) {
      await plat.$executeRawUnsafe(
        `INSERT INTO "${ORG_SCHEMA}"."Permission" ("id","name","description","resource","action","createdAt","updatedAt")
         SELECT "id","name","description","resource","action","createdAt","updatedAt" FROM "${SOURCE_SCHEMA}"."Permission"
         ON CONFLICT DO NOTHING`,
      );
    }
  }

  // ── 2. Feature flags ──────────────────────────────────────────────────────
  const srcUi: any = await plat.organizationUIConfig.findUnique({ where: { organizationId: SOURCE_ORG_ID } });
  const features = { ...(srcUi?.features ?? {}), ...FEATURE_OVERRIDES };
  const onFlags = Object.entries(features).filter(([, v]) => v === true).map(([k]) => k);
  log('OrganizationUIConfig', `${onFlags.length} flags on: ${onFlags.join(', ')}`);
  if (APPLY) {
    const stored: any = await plat.organizationUIConfig.findUnique({ where: { organizationId: ORG_ID } });
    await plat.organizationUIConfig.upsert({
      where: { organizationId: ORG_ID },
      update: { features: { ...((stored?.features as any) ?? {}), ...FEATURE_OVERRIDES } },
      create: { organizationId: ORG_ID, features, currency: srcUi?.currency ?? 'SGD', dateFormat: srcUi?.dateFormat, timeFormat: srcUi?.timeFormat },
    });
  }

  // ── 3. Modules ────────────────────────────────────────────────────────────
  const mods = await plat.organizationModule.findMany({ where: { organizationId: SOURCE_ORG_ID } });
  const stored = new Set(mods.map((m: any) => m.moduleCode));
  const modRows = mods.map((m: any) => {
    const cfg: any = m.config ? JSON.parse(JSON.stringify(m.config)) : null;
    if (cfg?.subMenus) cfg.subMenus = cfg.subMenus.map((s: any) => (typeof s === 'object' ? (({ roles, ...rest }) => rest)(s) : s));
    return {
      organizationId: ORG_ID,
      moduleCode: m.moduleCode,
      enabled: MODULE_ENABLED[m.moduleCode] ?? false,
      displayName: m.displayName,
      icon: m.icon,
      sortOrder: m.sortOrder,
      config: cfg,
    };
  });
  for (const code of Object.keys(MODULE_ENABLED)) {
    if (stored.has(code)) continue;
    const cat = MODULE_CATALOG.find((c) => c.moduleCode === code);
    if (!cat) continue;
    modRows.push({ organizationId: ORG_ID, moduleCode: code, enabled: MODULE_ENABLED[code], displayName: cat.displayName, icon: cat.icon, sortOrder: cat.sortOrder, config: cat.config });
  }
  assertOrgOnly(modRows, 'OrganizationModule');
  log('OrganizationModule', `${modRows.length} rows, on: ${modRows.filter((m: any) => m.enabled).map((m: any) => m.moduleCode).join(', ')}`);
  if (APPLY) {
    for (const m of modRows) {
      await plat.organizationModule.upsert({
        where: { organizationId_moduleCode: { organizationId: ORG_ID, moduleCode: m.moduleCode } },
        update: { enabled: m.enabled, sortOrder: m.sortOrder },
        create: m,
      });
    }
  }

  // ── 4. Roles + permissions (the source org's set) ─────────────────────────
  const roles = await src.role.findMany({ where: { organizationId: SOURCE_ORG_ID }, include: { permissions: { select: { id: true } } } });
  const roleIds: Record<string, string> = {};
  for (const r of roles) {
    const have = await org.role.findFirst({ where: { organizationId: ORG_ID, name: r.name }, select: { id: true } });
    log(`Role ${r.name}`, `${have ? 'exists' : 'create'} — ${r.permissions.length} permissions`);
    if (have) {
      roleIds[r.name] = have.id;
      continue;
    }
    const id = randomUUID();
    roleIds[r.name] = id;
    if (APPLY) {
      await org.role.create({
        data: { id, organizationId: ORG_ID, name: r.name, description: r.description, allowedModules: r.allowedModules, permissions: { connect: r.permissions.map((x: any) => ({ id: x.id })) } } as any,
      });
    }
  }

  // ── 5. Accounting: settings + default SG chart + GST codes ────────────────
  const acct = await org.accountingSetting.findUnique({ where: { organizationId: ORG_ID }, select: { id: true } });
  log('AccountingSetting', acct ? 'exists' : 'create (SGD, GST 9%, default ranges + control accounts)');
  if (APPLY && !acct) {
    await org.accountingSetting.create({
      data: {
        organizationId: ORG_ID,
        baseCurrency: 'SGD',
        nextNumbers: DEFAULT_NEXT_NUMBERS,
        numberPrefixes: {},
        activateLastSoldPrice: true,
        activateLastBuyPrice: true,
        taxDefaultPercentage: 9,
        taxReference: 'GST',
        accountCodeRanges: DEFAULT_ACCOUNT_CODE_RANGES,
        controlAccounts: DEFAULT_CONTROL_ACCOUNTS,
      } as any,
    });
  }
  const coaCount = await org.chartOfAccount.count({ where: { organizationId: ORG_ID } });
  log('ChartOfAccount', coaCount ? `${coaCount} exist, skip` : `seed ${DEFAULT_CHART_OF_ACCOUNTS.length} default SG accounts`);
  if (APPLY && !coaCount) {
    await org.chartOfAccount.createMany({
      data: DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({
        organizationId: ORG_ID,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        category: a.category,
        normalBalance: a.normalBalance,
        isControlAccount: a.isControlAccount ?? false,
        isSystem: true,
      })),
    });
  }
  const taxHave = await org.taxRate.count({ where: { organizationId: ORG_ID } });
  const taxSrc = await src.taxRate.findMany({ where: { organizationId: SOURCE_ORG_ID }, orderBy: { code: 'asc' } });
  const taxRows = taxSrc.map((t: any) => ({ organizationId: ORG_ID, code: t.code, name: t.name, rate: t.rate, direction: t.direction, category: t.category, isActive: t.isActive, isSystem: t.isSystem }));
  assertOrgOnly(taxRows, 'TaxRate');
  log('TaxRate', taxHave ? `${taxHave} exist, skip` : `copy ${taxRows.length} codes`);
  if (APPLY && !taxHave && taxRows.length) await org.taxRate.createMany({ data: taxRows });

  // ── 6. Document number formats — one "Default" per type ───────────────────
  const fmtSrc = await src.documentNumberFormat.findMany({ where: { organizationId: SOURCE_ORG_ID }, orderBy: { documentType: 'asc' } });
  const seenType = new Set<string>();
  const fmtRows: any[] = [];
  for (const f of fmtSrc) {
    if (seenType.has(f.documentType)) continue;
    seenType.add(f.documentType);
    fmtRows.push({
      organizationId: ORG_ID,
      documentType: f.documentType,
      label: 'Default',
      pattern: '{DOC}{YYYY}{MM}-{####}',
      nextSerial: 1,
      resetPolicy: f.resetPolicy,
      isActive: true,
      sortOrder: f.sortOrder,
    });
  }
  assertOrgOnly(fmtRows, 'DocumentNumberFormat');
  const fmtHave = await org.documentNumberFormat.count({ where: { organizationId: ORG_ID } });
  log('DocumentNumberFormat', fmtHave ? `${fmtHave} exist, skip` : `create ${fmtRows.length}`);
  if (APPLY && !fmtHave && fmtRows.length) await org.documentNumberFormat.createMany({ data: fmtRows });

  // ── 7. Document templates — own defaults (isDefault:false) ────────────────
  const allTemplates: TemplateRow[] = (await plat.documentTemplate.findMany({ select: { id: true, organizationId: true, type: true, isActive: true, isDefault: true, createdAt: true } })) as any;
  const selections: SelectionRow[] = (await plat.organizationActiveTemplate.findMany({ select: { organizationId: true, type: true, templateId: true, isPrimary: true } })) as any;
  const orgIds: string[] = (await plat.organization.findMany({ select: { id: true } })).map((o: any) => o.id);
  const ownTypes = new Set(allTemplates.filter((t) => t.organizationId === ORG_ID).map((t) => t.type));
  const toSeed = DEFAULT_DOCUMENT_TEMPLATES.filter((t) => !ownTypes.has(t.type));
  const planned: TemplateRow[] = toSeed.map((t) => ({ id: `planned:${t.type}`, organizationId: ORG_ID, type: t.type, isActive: true, isDefault: false, createdAt: new Date() }));
  const plan = checkTemplatePlan({ ownOrgId: ORG_ID, orgIds, types: [...new Set(allTemplates.map((t) => t.type).concat(planned.map((p) => p.type)))], templates: allTemplates, selections, planned });
  if (plan.errors.length) throw new Error(`REFUSED: template plan would change other orgs:\n  ${plan.errors.join('\n  ')}`);
  log('DocumentTemplate', `${toSeed.length} to seed, ${ownTypes.size} present; no other org's resolution changes`);
  if (APPLY && toSeed.length) {
    await plat.documentTemplate.createMany({
      data: toSeed.map((t) => ({
        organizationId: ORG_ID,
        type: t.type,
        templateVariant: t.templateVariant,
        name: t.name,
        designName: 'Default',
        description: `${t.name} document template`,
        isActive: true,
        isDefault: false,
        ...(t.config ? { config: t.config } : {}),
      })),
    });
  }

  // ── 8. Access: Osiris superadmins → superadmin here ───────────────────────
  const superRoleId = roleIds['superadmin'];
  if (!superRoleId) throw new Error('superadmin role missing on the source org');
  const admins = await src.userRole.findMany({
    where: { organizationId: SOURCE_ORG_ID, isActive: true, role: { name: 'superadmin' } },
    select: { userId: true },
  });
  const userIds = [...new Set(admins.map((r: any) => r.userId))] as string[];
  log('Osiris superadmins', `${userIds.length} → UserOrganization + superadmin here`);
  if (APPLY) {
    for (const userId of userIds) {
      if (!(await plat.userOrganization.findFirst({ where: { userId, organizationId: ORG_ID }, select: { id: true } }))) {
        await plat.userOrganization.create({ data: { userId, organizationId: ORG_ID, isActive: true } as any });
      }
      if (!(await org.userRole.findFirst({ where: { userId, organizationId: ORG_ID, roleId: superRoleId }, select: { id: true } }))) {
        await org.userRole.create({ data: { userId, organizationId: ORG_ID, roleId: superRoleId, isActive: true } as any });
      }
    }
  }
}

main()
  .then(() => console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE'} — ${ORG_NAME} ${ORG_ID}${APPLY ? '' : '\nRe-run with --apply to write.'}`))
  .catch((e) => {
    console.error('❌', e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await disconnect();
    await srcClients?.disconnect();
  });
