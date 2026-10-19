/**
 * Chong Aik International — demo account (guru 2026-10-16: "create one org now,
 * Chong Aik International demo account, +65 9382 0082 being the admin; I will
 * port over the GL and stock later").
 *
 * Builds the CONFIGURATION SHELL only — no chart of accounts, no stock, no
 * documents. Structure is copied from a trading-company source org: feature
 * flags, modules, roles + permissions, GST tax codes, number formats,
 * accounting settings. The admin is a Clerk user identified by PHONE (OTP
 * sign-in), assigned the Admin role on this org only.
 *
 *   npx ts-node --transpile-only scripts/setup-chongaik-org.ts                 # dry run, prod
 *   npx ts-node --transpile-only scripts/setup-chongaik-org.ts --apply         # write, prod
 *   npx ts-node --transpile-only scripts/setup-chongaik-org.ts --env dev --apply
 *
 * Layouts (scripts/lib/tenancy-clients.ts):
 *   prod/staging → single `public` schema; source shape = DEMO INDUSTRIES.
 *   dev          → per-org tenancy: platform rows + org_chongaik (schema must
 *                  exist: prisma/tenancy/orgs/chongaik.prisma pushed + client
 *                  generated); source shape = Biofuel (platform rows) and
 *                  org_biofuel (roles, permissions, tax codes, formats).
 *                  Also registers platform.OrgTenant.
 *
 * Idempotent: every write is keyed by the fixed ORG_ID / name, so a re-run
 * only fills what is missing. assertOrgOnly() refuses any row that is not
 * scoped to this org.
 */
import { randomUUID } from 'crypto';
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'prod') || 'prod') as Env;
const APPLY = args.includes('--apply');
if (!['dev', 'staging', 'prod'].includes(ENV)) {
  console.error('❌ --env dev|staging|prod');
  process.exit(1);
}
loadEnv(ENV);

export const ORG_ID = 'ca100000-0000-4000-8000-ca1000000001';
export const ORG_NAME = 'Chong Aik International';
const ORG_SCHEMA = 'org_chongaik';
const ORG_PRISMA_FILE = 'orgs/chongaik.prisma';
// Trading-company shape to copy. DEMO INDUSTRIES exists on prod only; dev uses Biofuel.
const SOURCE_ORG_ID = ENV === 'dev' ? '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1' : 'de300000-0000-4000-8000-de3000000001';
const SOURCE_SCHEMA = 'org_biofuel'; // dev: where the source org's Role/Permission/TaxRate/… live
const ADMIN_PHONE = '+6593820082';
const ADMIN_NAME = { firstName: 'Chong Aik', lastName: 'Admin' };
// The Clerk instance requires a password on every user (createUser without one
// fails with "password data doesn't match user requirements"). Demo logins use a
// trivial one on purpose (see _demo-set-password.ts); override with --password.
const ADMIN_PASSWORD = argVal('--password', 'password')!;

// Bicycle-parts trading: stock, sales, purchases, accounting. Biofuel-flavoured
// modules (service reports, projects, site information) stay off; Audit on so
// the Activity Log is visible.
const MODULE_ENABLED: Record<string, boolean> = {
  DASHBOARD: true,
  INVENTORY: true,
  SALES: true,
  CUSTOMERS: true,
  SUPPLIERS: true,
  ACCOUNTING: true,
  USER_MANAGEMENT: true,
  AUDIT: true,
  PROJECTS: false,
  MAINTENANCE: false,
  CUSTOMER_INFORMATION: false,
  PAYMENTS: false,
  REPORTS: false,
  ADMIN: false,
};
// Feature flags forced off regardless of the source org.
const FEATURE_OVERRIDES: Record<string, boolean> = {
  enableXeroDocSync: false,
  enableProjects: false,
  enableOpsDashboard: false,
  enableWaterSgSites: false,
  enableActionLog: true,
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
// Source-org rows: on tenancy they sit in the source org's own schema.
const src = layout === 'tenancy' ? clientsFor(ENV, SOURCE_SCHEMA).org : org;

async function main() {
  console.log(`env=${ENV}  layout=${layout}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}`);
  const source = await plat.organization.findUnique({ where: { id: SOURCE_ORG_ID } });
  if (!source) throw new Error(`source org ${SOURCE_ORG_ID} not found in ${ENV}`);
  console.log(`Source shape: ${source.name}\n`);

  // ── 1. Organization ───────────────────────────────────────────────────────
  const byName = await plat.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  if (byName && byName.id !== ORG_ID) throw new Error(`An org named "${ORG_NAME}" already exists with id ${byName.id}`);
  const existing = await plat.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } });
  log('Organization', existing ? `exists ${ORG_ID}` : `create "${ORG_NAME}" ${ORG_ID} (SGD, GST 9%, phone ${ADMIN_PHONE})`);
  if (APPLY && !existing) {
    await plat.organization.create({
      data: {
        id: ORG_ID,
        name: ORG_NAME,
        phoneNumber: '+65 9382 0082',
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
    await plat.organizationUIConfig.upsert({
      where: { organizationId: ORG_ID },
      update: {},
      create: { organizationId: ORG_ID, features, currency: srcUi?.currency ?? 'SGD', dateFormat: srcUi?.dateFormat, timeFormat: srcUi?.timeFormat },
    });
  }

  // ── 3. Modules ────────────────────────────────────────────────────────────
  const mods = await plat.organizationModule.findMany({ where: { organizationId: SOURCE_ORG_ID } });
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
  assertOrgOnly(modRows, 'OrganizationModule');
  const enabledCodes = modRows.filter((m: any) => m.enabled).map((m: any) => m.moduleCode);
  log('OrganizationModule', `${modRows.length} rows, on: ${enabledCodes.join(', ')}`);
  if (APPLY) {
    for (const m of modRows) {
      await plat.organizationModule.upsert({
        where: { organizationId_moduleCode: { organizationId: ORG_ID, moduleCode: m.moduleCode } },
        update: {},
        create: m,
      });
    }
  }

  // ── 4. Roles + permissions ────────────────────────────────────────────────
  const roles = await src.role.findMany({ where: { organizationId: SOURCE_ORG_ID }, include: { permissions: { select: { id: true } } } });
  const roleIds: Record<string, string> = {};
  for (const r of roles) {
    const allowed = Array.isArray(r.allowedModules) && r.allowedModules.length ? r.allowedModules.filter((c: string) => enabledCodes.includes(c)) : r.allowedModules;
    const have = await org.role.findFirst({ where: { organizationId: ORG_ID, name: r.name }, select: { id: true } });
    log(`Role ${r.name}`, `${have ? 'exists' : 'create'} — ${r.permissions.length} permissions${Array.isArray(allowed) && allowed.length ? `, modules ${allowed.join(',')}` : ''}`);
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

  // ── 5. Accounting settings + GST tax codes (no chart of accounts — ported later) ──
  const acct = await org.accountingSetting.findUnique({ where: { organizationId: ORG_ID }, select: { id: true } });
  log('AccountingSetting', acct ? 'exists' : 'create (SGD, GST 9%, accrual, quarterly, FYE 31 Dec)');
  if (APPLY && !acct) {
    await org.accountingSetting.create({ data: { organizationId: ORG_ID, baseCurrency: 'SGD', taxDefaultPercentage: 9, taxReference: 'GST' } as any });
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

  // Templates: none activated — the resolver falls back to the seeded defaults
  // (primary → selected → own → cross-org isDefault). Activate per type from
  // Admin → Manage Templates when the Chong Aik layouts are decided.
  log('DocumentTemplate', 'none — resolver falls back to seeded defaults');

  // ── 7. Admin login (Clerk user by phone) + membership + role ──────────────
  const adminRoleId = roleIds['Admin'];
  if (!adminRoleId) throw new Error('Admin role missing on the source org');
  log('Admin', `${ADMIN_PHONE} → Clerk user (phone OTP sign-in), Admin on this org only`);
  if (!APPLY) return;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClerkClient } = require('@clerk/backend');
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const found = await clerk.users.getUserList({ phoneNumber: [ADMIN_PHONE] });
  let userId: string;
  if (found.data.length) {
    userId = found.data[0].id;
    log('Clerk user', `exists ${userId}`);
  } else {
    const u = await clerk.users.createUser({ phoneNumber: [ADMIN_PHONE], password: ADMIN_PASSWORD, skipPasswordChecks: true, ...ADMIN_NAME } as any);
    userId = u.id;
    log('Clerk user', `created ${userId} (password "${ADMIN_PASSWORD}")`);
  }
  if (!(await plat.userOrganization.findFirst({ where: { userId, organizationId: ORG_ID }, select: { id: true } }))) {
    await plat.userOrganization.create({ data: { userId, organizationId: ORG_ID } as any });
  }
  if (!(await org.userRole.findFirst({ where: { userId, organizationId: ORG_ID, roleId: adminRoleId }, select: { id: true } }))) {
    await org.userRole.create({ data: { userId, organizationId: ORG_ID, roleId: adminRoleId, isActive: true } as any });
  }
  log('Membership', `${userId} → UserOrganization + Admin`);

  // ── 8. WhatsApp agent recognition ─────────────────────────────────────────
  // AIMEE resolves a sender by OrganizationMemberProfile.whatsappNumber (digits),
  // NOT by the Clerk phone — without this row a text from the admin is ignored.
  const digits = ADMIN_PHONE.replace(/\D/g, '');
  await plat.organizationMemberProfile.upsert({
    where: { organizationId_userId: { organizationId: ORG_ID, userId } },
    update: { whatsappNumber: digits },
    create: { organizationId: ORG_ID, userId, whatsappNumber: digits },
  });
  log('Member profile', `whatsappNumber ${digits} → AIMEE recognises this sender as Chong Aik Admin`);
}

main()
  .then(() => console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE'} — ${ORG_NAME} ${ORG_ID}${APPLY ? '' : '\nRe-run with --apply to write.'}`))
  .catch((e) => {
    console.error('❌', e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e.message || e);
    process.exit(1);
  })
  .finally(() => disconnect());
