/**
 * Chong Aik International — demo account (guru 2026-10-16: "create one org now,
 * Chong Aik International demo account, +65 9382 0082 being the admin; I will
 * port over the GL and stock later").
 *
 * Builds the CONFIGURATION SHELL only — no chart of accounts, no stock, no
 * documents. Structure is copied from DEMO INDUSTRIES (the trading-company
 * shape): feature flags, modules, roles + permissions, GST tax codes, number
 * formats, accounting settings. The admin is a Clerk user identified by PHONE
 * (OTP sign-in), assigned the Admin role on this org only.
 *
 *   npx ts-node --transpile-only scripts/setup-chongaik-org.ts                 # dry run, prod
 *   npx ts-node --transpile-only scripts/setup-chongaik-org.ts --apply         # write, prod
 *   npx ts-node --transpile-only scripts/setup-chongaik-org.ts --env staging --apply
 *
 * Idempotent: every write is keyed by the fixed ORG_ID / name, so a re-run
 * only fills what is missing. assertOrgOnly() refuses any row that is not
 * scoped to this org. dev (per-org tenancy layout) is NOT supported here —
 * use the tenancy bootstrap pattern in setup-adh-org.ts for that.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'prod') || 'prod') as 'staging' | 'prod';
const APPLY = args.includes('--apply');
if (ENV !== 'prod' && ENV !== 'staging') {
  console.error('❌ --env prod|staging only (dev runs the per-org tenancy layout).');
  process.exit(1);
}
dotenv.config({ path: path.resolve(__dirname, '..', ENV === 'staging' ? '.env.staging' : '.env.production'), override: true });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

export const ORG_ID = 'ca100000-0000-4000-8000-ca1000000001';
export const ORG_NAME = 'Chong Aik International';
const SOURCE_ORG_ID = 'de300000-0000-4000-8000-de3000000001'; // DEMO INDUSTRIES — trading-company shape
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

async function main() {
  console.log(`env=${ENV}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}`);
  const src = await p.organization.findUnique({ where: { id: SOURCE_ORG_ID } });
  if (!src) throw new Error('DEMO INDUSTRIES (source shape) not found in this environment');
  console.log(`Source shape: ${src.name}\n`);

  // ── 1. Organization ───────────────────────────────────────────────────────
  const byName = await p.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  if (byName && byName.id !== ORG_ID) throw new Error(`An org named "${ORG_NAME}" already exists with id ${byName.id}`);
  const existing = await p.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } });
  log('Organization', existing ? `exists ${ORG_ID}` : `create "${ORG_NAME}" ${ORG_ID} (SGD, GST 9%, phone ${ADMIN_PHONE})`);
  if (APPLY && !existing) {
    await p.organization.create({
      data: {
        id: ORG_ID,
        name: ORG_NAME,
        phoneNumber: '+65 9382 0082',
        taxRate: 9,
        taxApplicable: true,
        absorbTax: false,
        defaultCurrency: 'SGD',
        quoteRoundingStep: 0,
        docTypeDefaults: src.docTypeDefaults ?? undefined,
      } as any,
    });
  }

  // ── 2. Feature flags ──────────────────────────────────────────────────────
  const srcUi: any = await p.organizationUIConfig.findUnique({ where: { organizationId: SOURCE_ORG_ID } });
  const features = { ...(srcUi?.features ?? {}), ...FEATURE_OVERRIDES };
  const onFlags = Object.entries(features).filter(([, v]) => v === true).map(([k]) => k);
  log('OrganizationUIConfig', `${onFlags.length} flags on: ${onFlags.join(', ')}`);
  if (APPLY) {
    await p.organizationUIConfig.upsert({
      where: { organizationId: ORG_ID },
      update: {},
      create: { organizationId: ORG_ID, features, currency: srcUi?.currency ?? 'SGD', dateFormat: srcUi?.dateFormat, timeFormat: srcUi?.timeFormat },
    });
  }

  // ── 3. Modules ────────────────────────────────────────────────────────────
  const mods = await p.organizationModule.findMany({ where: { organizationId: SOURCE_ORG_ID } });
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
      await p.organizationModule.upsert({
        where: { organizationId_moduleCode: { organizationId: ORG_ID, moduleCode: m.moduleCode } },
        update: {},
        create: m,
      });
    }
  }

  // ── 4. Roles + permissions ────────────────────────────────────────────────
  const roles = await p.role.findMany({ where: { organizationId: SOURCE_ORG_ID }, include: { permissions: { select: { id: true } } } });
  const roleIds: Record<string, string> = {};
  for (const r of roles) {
    const allowed = Array.isArray(r.allowedModules) && r.allowedModules.length ? r.allowedModules.filter((c: string) => enabledCodes.includes(c)) : r.allowedModules;
    const have = await p.role.findFirst({ where: { organizationId: ORG_ID, name: r.name }, select: { id: true } });
    log(`Role ${r.name}`, `${have ? 'exists' : 'create'} — ${r.permissions.length} permissions${Array.isArray(allowed) && allowed.length ? `, modules ${allowed.join(',')}` : ''}`);
    if (have) {
      roleIds[r.name] = have.id;
      continue;
    }
    const id = randomUUID();
    roleIds[r.name] = id;
    if (APPLY) {
      await p.role.create({
        data: { id, organizationId: ORG_ID, name: r.name, description: r.description, allowedModules: allowed, permissions: { connect: r.permissions.map((x: any) => ({ id: x.id })) } } as any,
      });
    }
  }

  // ── 5. Accounting settings + GST tax codes (no chart of accounts — ported later) ──
  const acct = await p.accountingSetting.findUnique({ where: { organizationId: ORG_ID }, select: { id: true } });
  log('AccountingSetting', acct ? 'exists' : 'create (SGD, GST 9%, accrual, quarterly, FYE 31 Dec)');
  if (APPLY && !acct) {
    await p.accountingSetting.create({ data: { organizationId: ORG_ID, baseCurrency: 'SGD', taxDefaultPercentage: 9, taxReference: 'GST' } as any });
  }
  const taxHave = await p.taxRate.count({ where: { organizationId: ORG_ID } });
  const taxSrc = await p.taxRate.findMany({ where: { organizationId: SOURCE_ORG_ID }, orderBy: { code: 'asc' } });
  const taxRows = taxSrc.map((t: any) => ({ organizationId: ORG_ID, code: t.code, name: t.name, rate: t.rate, direction: t.direction, category: t.category, isActive: t.isActive, isSystem: t.isSystem }));
  assertOrgOnly(taxRows, 'TaxRate');
  log('TaxRate', taxHave ? `${taxHave} exist, skip` : `copy ${taxRows.length} codes`);
  if (APPLY && !taxHave && taxRows.length) await p.taxRate.createMany({ data: taxRows });

  // ── 6. Document number formats — one "Default" per type ───────────────────
  const fmtSrc = await p.documentNumberFormat.findMany({ where: { organizationId: SOURCE_ORG_ID }, orderBy: { documentType: 'asc' } });
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
  const fmtHave = await p.documentNumberFormat.count({ where: { organizationId: ORG_ID } });
  log('DocumentNumberFormat', fmtHave ? `${fmtHave} exist, skip` : `create ${fmtRows.length}: ${fmtRows.map((f) => `${f.documentType}=${f.pattern}`).join('  ')}`);
  if (APPLY && !fmtHave) await p.documentNumberFormat.createMany({ data: fmtRows });

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
  if (!(await p.userOrganization.findFirst({ where: { userId, organizationId: ORG_ID }, select: { id: true } }))) {
    await p.userOrganization.create({ data: { userId, organizationId: ORG_ID } as any });
  }
  if (!(await p.userRole.findFirst({ where: { userId, organizationId: ORG_ID, roleId: adminRoleId }, select: { id: true } }))) {
    await p.userRole.create({ data: { userId, organizationId: ORG_ID, roleId: adminRoleId, isActive: true } as any });
  }
  log('Membership', `${userId} → UserOrganization + Admin`);

  // ── 8. WhatsApp agent recognition ─────────────────────────────────────────
  // AIMEE resolves a sender by OrganizationMemberProfile.whatsappNumber (digits),
  // NOT by the Clerk phone — without this row a text from the admin is ignored.
  const digits = ADMIN_PHONE.replace(/\D/g, '');
  await p.organizationMemberProfile.upsert({
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
  .finally(() => p.$disconnect());
