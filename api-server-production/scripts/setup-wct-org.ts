/**
 * WCT — org bootstrap (guru 2026-10-22: "create an org called WCT, they have
 * similar functions to biofuel … all of these tabs except customer
 * information, and the quotation, follow the ciel one").
 *
 * Shape = Biofuel's nav (Dashboard · Sales · Inventory · Projects · Service
 * Reports · Accounting · Deliveries · Org Settings) WITHOUT Customer
 * Information, plus the CIEL interior-design quotation editor
 * (enableIdQuotation → sectioned quotation + Work Library + ID dashboard /
 * projects pages; see the note in the recap for what that flag also changes).
 *
 * Builds the CONFIGURATION SHELL only — no stock, no documents, no users
 * beyond the Osiris superadmins. Copied from Biofuel: feature flags, modules,
 * roles + permissions, GST tax codes. Own: default SG chart of accounts,
 * default document templates, one "Default" number format per type, CIEL's
 * trade sections (A–J) as Work Library presets.
 *
 *   npx ts-node --transpile-only scripts/setup-wct-org.ts --env dev           # dry run
 *   npx ts-node --transpile-only scripts/setup-wct-org.ts --env dev --apply
 *   npx ts-node --transpile-only scripts/setup-wct-org.ts --env prod --apply  # guru runs with `!`
 *
 * Layouts (scripts/lib/tenancy-clients.ts):
 *   prod/staging → single `public` schema; source shape = Biofuel.
 *   dev          → per-org tenancy: platform rows + org_wct (schema must exist:
 *                  prisma/tenancy/orgs/wct.prisma pushed + client generated —
 *                  done 2026-10-22, incl. journal-guards apply). Source shape =
 *                  Biofuel (platform rows) and org_biofuel (roles, permissions,
 *                  tax codes, number-format types). Also registers
 *                  platform.OrgTenant.
 *
 * Idempotent: every write is keyed by the fixed ORG_ID / name, so a re-run
 * only fills what is missing. assertOrgOnly() refuses any row that is not
 * scoped to this org. Templates are checked with checkTemplatePlan() so no
 * other org's resolved template changes (templates are a cross-org pool).
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
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

export const ORG_ID = '5c700000-0000-4000-8000-5c7000000001';
export const ORG_NAME = 'WCT';
const ORG_SCHEMA = 'org_wct';
const ORG_PRISMA_FILE = 'orgs/wct.prisma';
// Biofuel — same id on dev, staging and prod.
const SOURCE_ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const SOURCE_SCHEMA = 'org_biofuel';
// Osiris Technology — its superadmins get superadmin on WCT so guru can open it.
const OSIRIS_ORG_ID = 'd068f159-e45a-4da8-beaf-62e903f44141';
const OSIRIS_SCHEMA = 'org_osiris';

// The nav in guru's screenshot: Dashboard · Sales · Inventory · Projects ·
// Service Reports (MAINTENANCE) · Accounting · Deliveries · Org Settings.
// CUSTOMERS / SUPPLIERS live under Org Settings (Master Files). Customer
// Information explicitly off; CRM / Audit / Admin Panel off as on Biofuel.
const MODULE_ENABLED: Record<string, boolean> = {
  DASHBOARD: true,
  SALES: true,
  INVENTORY: true,
  PROJECTS: true,
  MAINTENANCE: true,
  ACCOUNTING: true,
  DELIVERIES: true,
  CUSTOMERS: true,
  SUPPLIERS: true,
  CUSTOMER_INFORMATION: false,
  // Catalog defaults that would otherwise show as virtual tabs (Biofuel's prod
  // nav has none of them): legacy Orders / Documents / Invoices pages, and
  // User Management (toggle on in Admin → Modules if WCT manages its own users).
  ORDERS: false,
  DOCUMENTS: false,
  INVOICES: false,
  USER_MANAGEMENT: false,
  CRM: false,
  AUDIT: false,
  ADMIN: false,
  PAYMENTS: false,
  REPORTS: false,
};
// Feature flags forced regardless of the source org.
const FEATURE_OVERRIDES: Record<string, boolean> = {
  // 2026-10-22: OFF. "Follow the CIEL one" turned out to mean a layout of its
  // own like CIEL's — WCT's paper quotation is a flat S/No line-item table,
  // now the `layout: 'wct'` renderer (setup-wct-templates.ts) in the standard
  // editor. The ID flag would also have swapped Dashboard and Projects.
  enableIdQuotation: false,
  enableWaterSgSites: false, // Biofuel's water-sg integration
  enableXeroDocSync: false,
  enableXeroIntegration: false,
  enableXeroConfirmSync: false,
  enableActionLog: true,
  // 2026-10-26 (client call): every quotation must be ACCEPTED before a DO —
  // staff confirm button AND the customer e-sign link both count. The ORDERS
  // module is off for WCT, so confirming creates no Order (documents.service
  // skips it when the stored module row is off).
  enableConfirmQuotation: true,
  enableQuotationESign: true,
  // Accepted quotation → draft scheduled delivery → DO on confirm → field
  // completion → auto invoice (the client call's flow). Also lets WCT
  // schedule without a Project / Sale Order.
  enableQuotationToDelivery: true,
};
// Role allowedModules codes that must not carry over (modules off on WCT).
const DROP_FROM_ROLE_MODULES = new Set(['CRM', 'CUSTOMER_INFORMATION', 'AUDIT', 'ADMIN', 'USER_MANAGEMENT']);

function assertOrgOnly(rows: any[], label: string) {
  for (const r of rows) {
    if ('organizationId' in r && r.organizationId !== ORG_ID) {
      throw new Error(`REFUSED: ${label} carries organizationId=${r.organizationId}, expected ${ORG_ID}`);
    }
  }
}
const log = (label: string, msg: string) => console.log(`  ${label.padEnd(26)} ${msg}`);

const { plat, org, layout, disconnect } = clientsFor(ENV, ORG_SCHEMA);
// Source-org rows: on tenancy they sit in the source org's own schema.
const srcClients = layout === 'tenancy' ? clientsFor(ENV, SOURCE_SCHEMA) : null;
const src = srcClients ? srcClients.org : org;
const osirisClients = layout === 'tenancy' ? clientsFor(ENV, OSIRIS_SCHEMA) : null;
const osiris = osirisClients ? osirisClients.org : org;

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
        docTypeDefaults: source.docTypeDefaults ?? undefined,
      } as any,
    });
  }

  // ── 1b. Tenancy registry + Permission catalogue (dev only) ────────────────
  if (layout === 'tenancy') {
    const tenant = await plat.orgTenant.findUnique({ where: { organizationId: ORG_ID } });
    log('OrgTenant', tenant ? `exists (${tenant.schemaName}, ${tenant.status})` : `register ${ORG_SCHEMA} ← ${ORG_PRISMA_FILE}`);
    if (APPLY && !tenant) {
      await plat.orgTenant.create({ data: { organizationId: ORG_ID, schemaName: ORG_SCHEMA, prismaFile: ORG_PRISMA_FILE, status: 'ACTIVE' } });
    }
    // Same ids as the source catalogue, so role → permission links copy 1:1.
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
    // Re-runs reconcile the OVERRIDES only (flags toggled by hand in the
    // admin panel are kept).
    const stored: any = await plat.organizationUIConfig.findUnique({ where: { organizationId: ORG_ID } });
    await plat.organizationUIConfig.upsert({
      where: { organizationId: ORG_ID },
      update: { features: { ...((stored?.features as any) ?? {}), ...FEATURE_OVERRIDES } },
      create: { organizationId: ORG_ID, features, currency: srcUi?.currency ?? 'SGD', dateFormat: srcUi?.dateFormat, timeFormat: srcUi?.timeFormat },
    });
  }

  // ── 3. Modules ────────────────────────────────────────────────────────────
  // Biofuel's stored rows (they carry its Sales/Inventory sub-menus) + catalog
  // entries for the codes Biofuel never stored (DELIVERIES, CUSTOMER_INFORMATION).
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
  const enabledCodes = modRows.filter((m: any) => m.enabled).map((m: any) => m.moduleCode);
  log('OrganizationModule', `${modRows.length} rows, on: ${enabledCodes.join(', ')}`);
  if (APPLY) {
    for (const m of modRows) {
      await plat.organizationModule.upsert({
        where: { organizationId_moduleCode: { organizationId: ORG_ID, moduleCode: m.moduleCode } },
        update: { enabled: m.enabled }, // reconcile on re-run
        create: m,
      });
    }
  }

  // ── 4. Roles + permissions (Biofuel's: superadmin / Admin / Manager / User / field-tech) ──
  const roles = await src.role.findMany({ where: { organizationId: SOURCE_ORG_ID }, include: { permissions: { select: { id: true } } } });
  const roleIds: Record<string, string> = {};
  for (const r of roles) {
    // Keep the role's module list (MASTERFILES / DELIVERIES are nav codes, not
    // stored modules) minus the modules WCT does not have.
    const allowed = Array.isArray(r.allowedModules) ? r.allowedModules.filter((c: string) => !DROP_FROM_ROLE_MODULES.has(c)) : r.allowedModules;
    const have = await org.role.findFirst({ where: { organizationId: ORG_ID, name: r.name }, select: { id: true } });
    log(`Role ${r.name}`, `${have ? 'exists' : 'create'} — ${r.permissions.length} permissions${Array.isArray(allowed) && allowed.length ? `, modules ${allowed.join(',')}` : ', modules all'}`);
    if (have) {
      roleIds[r.name] = have.id;
      continue;
    }
    const id = randomUUID();
    roleIds[r.name] = id;
    if (APPLY) {
      await org.role.create({
        data: { id, organizationId: ORG_ID, name: r.name, description: r.description, allowedModules: allowed, permissions: { connect: r.permissions.map((x: any) => ({ id: x.id })) } } as any,
      });
    }
  }

  // ── 5. Accounting: settings + default SG chart + GST tax codes ────────────
  const acct = await org.accountingSetting.findUnique({ where: { organizationId: ORG_ID }, select: { id: true } });
  log('AccountingSetting', acct ? 'exists' : 'create (SGD, GST 9%, default ranges + control accounts, FYE 31 Dec)');
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

  // ── 6. Document number formats — one "Default" per type Biofuel numbers ──
  const fmtSrc = await src.documentNumberFormat.findMany({ where: { organizationId: SOURCE_ORG_ID }, orderBy: { documentType: 'asc' } });
  const seenType = new Set<string>();
  const fmtRows: any[] = [];
  for (const f of fmtSrc) {
    if (seenType.has(f.documentType)) continue;
    seenType.add(f.documentType);
    const isGeneric = f.label === 'Default' || !/^[A-Z]{2,}[A-Z-]*INV|^BI\{/.test(f.pattern);
    fmtRows.push({
      organizationId: ORG_ID,
      documentType: f.documentType,
      label: 'Default',
      pattern: isGeneric ? f.pattern : '{DOC}{YYYY}{MM}-{####}',
      nextSerial: 1,
      resetPolicy: f.resetPolicy,
      isActive: true,
      sortOrder: f.sortOrder,
    });
  }
  assertOrgOnly(fmtRows, 'DocumentNumberFormat');
  const fmtHave = await org.documentNumberFormat.count({ where: { organizationId: ORG_ID } });
  log('DocumentNumberFormat', fmtHave ? `${fmtHave} exist, skip` : `create ${fmtRows.length}: ${fmtRows.map((f) => `${f.documentType}=${f.pattern}`).join('  ')}`);
  if (APPLY && !fmtHave) await org.documentNumberFormat.createMany({ data: fmtRows });

  // ── 7. Document templates — WCT's own defaults (isDefault:false so no other org's fallback moves) ──
  const allTemplates: TemplateRow[] = (await plat.documentTemplate.findMany({ select: { id: true, organizationId: true, type: true, isActive: true, isDefault: true, createdAt: true } })) as any;
  const selections: SelectionRow[] = (await plat.organizationActiveTemplate.findMany({ select: { organizationId: true, type: true, templateId: true, isPrimary: true } })) as any;
  const orgIds: string[] = (await plat.organization.findMany({ select: { id: true } })).map((o: any) => o.id);
  const ownTypes = new Set(allTemplates.filter((t) => t.organizationId === ORG_ID).map((t) => t.type));
  const toSeed = DEFAULT_DOCUMENT_TEMPLATES.filter((t) => !ownTypes.has(t.type));
  const planned: TemplateRow[] = toSeed.map((t) => ({ id: `planned:${t.type}`, organizationId: ORG_ID, type: t.type, isActive: true, isDefault: false, createdAt: new Date() }));
  const plan = checkTemplatePlan({ ownOrgId: ORG_ID, orgIds, types: [...new Set(allTemplates.map((t) => t.type).concat(planned.map((p) => p.type)))], templates: allTemplates, selections, planned });
  if (plan.errors.length) throw new Error(`REFUSED: template plan would change other orgs:\n  ${plan.errors.join('\n  ')}`);
  log('DocumentTemplate', `${toSeed.length} to seed (${toSeed.map((t) => t.type).join(', ')}), ${ownTypes.size} present; no other org's resolution changes`);
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

  // ── 8. Work Library presets — CIEL's trade sections A–J (no items/prices) ──
  const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'ciel-work-library.json'), 'utf8'));
  const sectionsHave = await org.workSection.count({ where: { organizationId: ORG_ID } });
  log('WorkSection', sectionsHave ? `${sectionsHave} exist, skip` : `seed ${lib.sections.length} sections: ${lib.sections.map((s: any) => `${s.letter} ${s.title}`).join(' · ')}`);
  if (APPLY && !sectionsHave) {
    await org.workSection.createMany({
      data: lib.sections.map((s: any) => ({ organizationId: ORG_ID, letter: s.letter, title: s.title, defaultNotes: s.notes, sortOrder: s.sortOrder })),
    });
  }

  // ── 9. Access: Osiris superadmins → superadmin on WCT ─────────────────────
  const superRoleId = roleIds['superadmin'];
  if (!superRoleId) throw new Error('superadmin role missing on the source org');
  const osirisAdmins = await osiris.userRole.findMany({
    where: { organizationId: OSIRIS_ORG_ID, isActive: true, role: { name: 'superadmin' } },
    select: { userId: true },
  });
  const userIds = [...new Set(osirisAdmins.map((r: any) => r.userId))] as string[];
  log('Osiris superadmins', `${userIds.length} → UserOrganization + superadmin on WCT`);
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
    await osirisClients?.disconnect();
  });
