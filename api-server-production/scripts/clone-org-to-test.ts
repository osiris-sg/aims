// Clone Biofuel into the "Test Org" (guru, 2026-07-22) — SELF-CONTAINED copy:
// every cloned row gets a NEW id and every reference (FKs + ids embedded in
// JSON configs) is rewritten to the cloned counterpart, so the test org never
// points into Biofuel's data. Users are NOT copied (osirisadmin is global;
// admins use "Viewing as").
//
//   npx ts-node scripts/clone-org-to-test.ts --env dev     --scope full   [--apply]
//   npx ts-node scripts/clone-org-to-test.ts --env prod    --scope config [--apply]
//
// scope=config: org + UI config/features, modules, roles(+permissions), chart
//   of accounts, accounting settings, tax codes, cost centers, number formats,
//   document templates + active-template selections.
// scope=full: config + customers(+contacts), suppliers, revenue items,
//   account memory, ALL documents, payments, bill payments, journals(+lines),
//   fixed assets(+depreciation).
//
// The Test Org uses a FIXED id in every environment so the dev→staging data
// copy can move rows verbatim.

import * as path from 'path';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';

export const TEST_ORG_ID = '7e570e60-0000-4000-8000-7e570e600001';
export const TEST_ORG_NAME = 'Test Org';

const args = process.argv.slice(2);
const argVal = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const ENV = (argVal('--env') || 'dev') as 'dev' | 'staging' | 'prod';
const SCOPE = (argVal('--scope') || 'config') as 'config' | 'full';
const APPLY = args.includes('--apply');

const envFile = ENV === 'dev' ? '.env' : ENV === 'staging' ? '.env.staging' : '.env.production';
dotenv.config({ path: path.resolve(__dirname, '..', envFile), override: true });

// Import AFTER env load so PrismaClient picks up the right DATABASE_URL.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const idMap = new Map<string, string>();
const mapId = (oldId: string) => {
  if (!idMap.has(oldId)) idMap.set(oldId, randomUUID());
  return idMap.get(oldId)!;
};

// Rewrite EVERY uuid occurrence (scalar FKs and ids buried in JSON blobs)
// that we have a mapping for; unknown uuids pass through untouched.
function rewriteRow<T>(row: T): T {
  const json = JSON.stringify(row);
  const out = json.replace(UUID_RE, (m) => idMap.get(m) ?? idMap.get(m.toLowerCase()) ?? m);
  return JSON.parse(out);
}

async function insertMany(model: any, label: string, rows: any[]) {
  if (!rows.length) return;
  if (!APPLY) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await model.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
  }
}

async function main() {
  console.log(`env=${ENV} scope=${SCOPE} ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const source = await p.organization.findFirst({ where: { name: { contains: 'Biofuel' } } });
  if (!source) throw new Error('Biofuel org not found in this environment');
  console.log(`Source: ${source.name} (${source.id})  →  ${TEST_ORG_NAME} (${TEST_ORG_ID})`);
  const SRC = source.id;

  // ---------- Organization ----------
  const orgData: any = { ...source, id: TEST_ORG_ID, name: TEST_ORG_NAME };
  delete orgData.createdAt;
  delete orgData.updatedAt;
  if (APPLY) {
    await p.organization.upsert({ where: { id: TEST_ORG_ID }, update: {}, create: orgData });
  }
  idMap.set(SRC, TEST_ORG_ID);
  console.log('Organization: upserted');

  // Generic clone helper: fetch → register new ids → rewrite → insert.
  const clone = async (model: any, label: string, rows: any[], fix?: (r: any) => any) => {
    for (const r of rows) mapId(r.id);
    let out = rows.map((r) => rewriteRow(r));
    if (fix) out = out.map(fix);
    await insertMany(model, label, out);
    console.log(`${label}: ${rows.length}`);
    return out;
  };

  // ---------- CONFIG scope ----------
  const uiConfigs = await p.organizationUIConfig.findMany({ where: { organizationId: SRC } });
  await clone(p.organizationUIConfig, 'OrganizationUIConfig', uiConfigs);

  const modules = await p.organizationModule.findMany({ where: { organizationId: SRC } });
  await clone(p.organizationModule, 'OrganizationModule', modules);

  // Roles carry an M:N to global Permission rows — clone individually so the
  // permission links come across (same DB, same permission ids).
  const roles = await p.role.findMany({ where: { organizationId: SRC }, include: { permissions: { select: { id: true } } } });
  for (const r of roles) mapId(r.id);
  if (APPLY) {
    for (const r of roles) {
      const exists = await p.role.findFirst({ where: { organizationId: TEST_ORG_ID, name: r.name }, select: { id: true } });
      if (exists) continue;
      await p.role.create({
        data: {
          id: mapId(r.id),
          name: r.name,
          description: r.description,
          allowedModules: r.allowedModules,
          organizationId: TEST_ORG_ID,
          permissions: { connect: r.permissions.map((x: any) => ({ id: x.id })) },
        },
      });
    }
  }
  console.log(`Role: ${roles.length}`);

  // xeroId is GLOBALLY unique — the clone must not steal Biofuel's Xero links.
  const accounts = await p.chartOfAccount.findMany({ where: { organizationId: SRC } });
  await clone(p.chartOfAccount, 'ChartOfAccount', accounts, (a) => ({ ...a, xeroId: null }));

  const settings = await p.accountingSetting.findMany({ where: { organizationId: SRC } });
  await clone(p.accountingSetting, 'AccountingSetting', settings);

  const taxRates = await p.taxRate.findMany({ where: { organizationId: SRC } });
  await clone(p.taxRate, 'TaxRate', taxRates);

  const costCenters = await p.costCenter.findMany({ where: { organizationId: SRC } });
  await clone(p.costCenter, 'CostCenter', costCenters);

  const numberFormats = await p.documentNumberFormat.findMany({ where: { organizationId: SRC } }).catch(() => []);
  await clone(p.documentNumberFormat, 'DocumentNumberFormat', numberFormats);

  // Documents' templates form a cross-org SHARED pool — clone every template
  // the org owns, has activated, or (full scope) that its documents use, so
  // the test org is fully self-contained (required for the dev→staging copy).
  const activations = await p.organizationActiveTemplate.findMany({ where: { organizationId: SRC } });
  const docsForTemplates =
    SCOPE === 'full'
      ? await p.document.findMany({ where: { organizationId: SRC }, select: { documentTemplateId: true } })
      : [];
  const templateIds = new Set<string>();
  for (const a of activations) templateIds.add(a.templateId);
  for (const d of docsForTemplates) if (d.documentTemplateId) templateIds.add(d.documentTemplateId);
  const ownTemplates = await p.documentTemplate.findMany({ where: { organizationId: SRC }, select: { id: true } });
  for (const t of ownTemplates) templateIds.add(t.id);
  const templates = templateIds.size
    ? await p.documentTemplate.findMany({ where: { id: { in: [...templateIds] } } })
    : [];
  await clone(p.documentTemplate, 'DocumentTemplate', templates, (t) => ({ ...t, organizationId: TEST_ORG_ID }));

  await clone(p.organizationActiveTemplate, 'OrganizationActiveTemplate', activations);

  if (SCOPE === 'full') {
    // ---------- masters ----------
    const customers = await p.customer.findMany({ where: { organizationId: SRC } });
    await clone(p.customer, 'Customer', customers, (c) => ({ ...c, xeroId: null }));

    const contacts = customers.length
      ? await p.customerContact.findMany({ where: { customerId: { in: customers.map((c: any) => c.id) } } })
      : [];
    await clone(p.customerContact, 'CustomerContact', contacts);

    const suppliers = await p.supplier.findMany({ where: { organizationId: SRC } });
    await clone(p.supplier, 'Supplier', suppliers, (s) => ({ ...s, xeroId: null }));

    const revenueItems = await p.revenueItem.findMany({ where: { organizationId: SRC } }).catch(() => []);
    await clone(p.revenueItem, 'RevenueItem', revenueItems);

    const memory = await p.accountMemory.findMany({ where: { organizationId: SRC } }).catch(() => []);
    await clone(p.accountMemory, 'AccountMemory', memory);

    // ---------- documents ----------
    const documents = await p.document.findMany({ where: { organizationId: SRC } });
    await clone(p.document, 'Document', documents, (d) => ({
      ...d,
      // Projects/deployments aren't cloned; locks don't travel.
      projectId: null,
      projectDeploymentId: null,
      editingByUserId: null,
      editingByName: null,
      editingAt: null,
      lastActivityAt: null,
    }));

    // ---------- money ----------
    const payments = await p.payment.findMany({ where: { organizationId: SRC } });
    await clone(p.payment, 'Payment', payments);

    const billPayments = await p.billPayment.findMany({ where: { organizationId: SRC } }).catch(() => []);
    await clone(p.billPayment, 'BillPayment', billPayments);

    // ---------- GL ----------
    const journals = await p.journalEntry.findMany({ where: { organizationId: SRC } });
    await clone(p.journalEntry, 'JournalEntry', journals);

    const jeIds = journals.map((j: any) => j.id);
    const CH = 5000;
    let lineCount = 0;
    for (let i = 0; i < jeIds.length; i += CH) {
      const lines = await p.journalEntryLine.findMany({ where: { journalEntryId: { in: jeIds.slice(i, i + CH) } } });
      lineCount += lines.length;
      await clone(p.journalEntryLine, `JournalEntryLine[batch ${i / CH + 1}]`, lines);
    }
    console.log(`JournalEntryLine total: ${lineCount}`);

    // ---------- fixed assets ----------
    const fixedAssets = await p.fixedAsset.findMany({ where: { organizationId: SRC } }).catch(() => []);
    await clone(p.fixedAsset, 'FixedAsset', fixedAssets);
    const depEntries = fixedAssets.length
      ? await p.depreciationEntry.findMany({ where: { fixedAssetId: { in: fixedAssets.map((f: any) => f.id) } } }).catch(() => [])
      : [];
    await clone(p.depreciationEntry, 'DepreciationEntry', depEntries);
  }

  console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE'} — ${idMap.size} ids mapped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
