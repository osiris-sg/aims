// Copy the "Test Org" (cloned Biofuel set) VERBATIM from the dev DB to the
// staging DB (guru, 2026-07-22). The test org is fully self-contained (see
// clone-org-to-test.ts), so rows move with their ids intact — no remapping.
// Roles are the one exception: their M:N Permission links are re-connected by
// permission NAME in staging (permission ids differ per environment).
//
//   npx ts-node scripts/copy-test-org-dev-to-staging.ts [--apply]

import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const TEST_ORG_ID = '7e570e60-0000-4000-8000-7e570e600001';
const APPLY = process.argv.includes('--apply');

const devEnv = dotenv.parse(require('fs').readFileSync(path.resolve(__dirname, '..', '.env')));
const stgEnv = dotenv.parse(require('fs').readFileSync(path.resolve(__dirname, '..', '.env.staging')));
const dev = new PrismaClient({ datasources: { db: { url: devEnv.DATABASE_URL } } });
const stg = new PrismaClient({ datasources: { db: { url: stgEnv.DATABASE_URL } } });

async function copyRows(label: string, rows: any[], target: any) {
  console.log(`${label}: ${rows.length}`);
  if (!APPLY || !rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await target.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
  }
}

async function main() {
  console.log(`dev → staging for Test Org (${TEST_ORG_ID})  ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const org = await dev.organization.findUnique({ where: { id: TEST_ORG_ID } });
  if (!org) throw new Error('Test Org not found on dev — run clone-org-to-test.ts first');
  if (APPLY) {
    const { createdAt, updatedAt, ...orgData } = org as any;
    await stg.organization.upsert({ where: { id: TEST_ORG_ID }, update: {}, create: orgData });
  }
  console.log('Organization: upserted');

  const byOrg = { where: { organizationId: TEST_ORG_ID } };

  // ---------- config ----------
  await copyRows('OrganizationUIConfig', await dev.organizationUIConfig.findMany(byOrg), stg.organizationUIConfig);
  await copyRows('OrganizationModule', await dev.organizationModule.findMany(byOrg), stg.organizationModule);
  await copyRows('ChartOfAccount', await dev.chartOfAccount.findMany(byOrg), stg.chartOfAccount);
  await copyRows('AccountingSetting', await dev.accountingSetting.findMany(byOrg), stg.accountingSetting);
  await copyRows('TaxRate', await dev.taxRate.findMany(byOrg), stg.taxRate);
  await copyRows('CostCenter', await dev.costCenter.findMany(byOrg), stg.costCenter);
  await copyRows('DocumentNumberFormat', await dev.documentNumberFormat.findMany(byOrg), stg.documentNumberFormat);
  await copyRows('DocumentTemplate', await dev.documentTemplate.findMany(byOrg), stg.documentTemplate);
  await copyRows('OrganizationActiveTemplate', await dev.organizationActiveTemplate.findMany(byOrg), stg.organizationActiveTemplate);

  // Roles — re-link permissions by NAME on staging (ids differ per env).
  const roles = await dev.role.findMany({ ...byOrg, include: { permissions: { select: { name: true, resource: true, action: true, description: true } } } });
  console.log(`Role: ${roles.length}`);
  if (APPLY) {
    for (const r of roles) {
      const exists = await stg.role.findFirst({ where: { organizationId: TEST_ORG_ID, name: r.name }, select: { id: true } });
      if (exists) continue;
      const permIds: { id: string }[] = [];
      for (const perm of r.permissions) {
        const found = await stg.permission.upsert({
          where: { name: perm.name },
          update: {},
          create: { name: perm.name, resource: perm.resource, action: perm.action, description: perm.description },
          select: { id: true },
        });
        permIds.push({ id: found.id });
      }
      await stg.role.create({
        data: {
          id: r.id,
          name: r.name,
          description: r.description,
          allowedModules: r.allowedModules,
          organizationId: TEST_ORG_ID,
          permissions: { connect: permIds },
        },
      });
    }
  }

  // ---------- masters ----------
  const customers = await dev.customer.findMany(byOrg);
  await copyRows('Customer', customers, stg.customer);
  const contacts = customers.length
    ? await dev.customerContact.findMany({ where: { customerId: { in: customers.map((c) => c.id) } } })
    : [];
  await copyRows('CustomerContact', contacts, stg.customerContact);
  await copyRows('Supplier', await dev.supplier.findMany(byOrg), stg.supplier);
  await copyRows('RevenueItem', await dev.revenueItem.findMany(byOrg), stg.revenueItem);
  await copyRows('AccountMemory', await dev.accountMemory.findMany(byOrg), stg.accountMemory);

  // ---------- documents / money / GL ----------
  await copyRows('Document', await dev.document.findMany(byOrg), stg.document);
  await copyRows('Payment', await dev.payment.findMany(byOrg), stg.payment);
  await copyRows('BillPayment', await dev.billPayment.findMany(byOrg), stg.billPayment);

  const journals = await dev.journalEntry.findMany(byOrg);
  await copyRows('JournalEntry', journals, stg.journalEntry);
  const jeIds = journals.map((j) => j.id);
  const CH = 5000;
  let lineTotal = 0;
  for (let i = 0; i < jeIds.length; i += CH) {
    const lines = await dev.journalEntryLine.findMany({ where: { journalEntryId: { in: jeIds.slice(i, i + CH) } } });
    lineTotal += lines.length;
    await copyRows(`JournalEntryLine[batch ${i / CH + 1}]`, lines, stg.journalEntryLine);
  }
  console.log(`JournalEntryLine total: ${lineTotal}`);

  const fixedAssets = await dev.fixedAsset.findMany(byOrg);
  await copyRows('FixedAsset', fixedAssets, stg.fixedAsset);
  if (fixedAssets.length) {
    const deps = await dev.depreciationEntry.findMany({ where: { fixedAssetId: { in: fixedAssets.map((f) => f.id) } } });
    await copyRows('DepreciationEntry', deps, stg.depreciationEntry);
  }

  console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await dev.$disconnect();
    await stg.$disconnect();
  });
