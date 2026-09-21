/**
 * Set up YOURWORLD PTE. LTD. in AIMS (org + modules + roles + accounting).
 *
 * Source facts (MariBank Business e-Statements Mar–Aug 2026):
 *   - YOURWORLD PTE. LTD., 467 Admiralty Drive #6-211, Singapore 750467
 *   - Ticket sales business — revenue is PayNow ("ROADSHOW") ticket receipts
 *   - Bank: MariBank Business account 293 186 789 (opened 23 Mar 2026) → CA101
 *   - GST registration unconfirmed — default tax 0% until guru says otherwise
 *
 * Dry:    npx ts-node --transpile-only scripts/_yourworld-setup.ts .env
 * Apply:  ... --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  DEFAULT_ACCOUNT_CODE_RANGES,
  DEFAULT_CONTROL_ACCOUNTS,
} from '../src/accounting/default-chart-of-accounts';
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env';
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
process.env.DATABASE_URL = m[1]; // for initialize-organization-config's own PrismaClient
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);

const OSIRIS = 'd068f159-e45a-4da8-beaf-62e903f44141'; // module rows cloned from here

// Ticket-sales-specific accounts on top of the Singapore SME defaults.
const EXTRA = [
  // bank — CA1xx is what journal.isCashOrBankAccount() recognises
  { code: 'CA101', name: 'MariBank — SGD', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  { code: 'CA102', name: 'Bank — Other Own Account (Transfers)', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  { code: 'CA900', name: 'Suspense (For Review)', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  { code: 'CL100', name: "Director's Loan", accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  // revenue
  { code: 'SS002', name: 'Ticket Sales', accountType: 'SALES', category: 'PNL', normalBalance: 'CREDIT' },
  { code: 'SS003', name: 'Event & Roadshow Income', accountType: 'SALES', category: 'PNL', normalBalance: 'CREDIT' },
  // other income
  { code: 'IC002', name: 'Bank Interest Income', accountType: 'INCOME', category: 'PNL', normalBalance: 'CREDIT' },
  // direct costs
  { code: 'CS002', name: 'Event & Show Costs', accountType: 'PURCHASE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'CS003', name: 'Ticket Refunds & Payouts', accountType: 'PURCHASE', category: 'PNL', normalBalance: 'DEBIT' },
  // expenses
  { code: 'EX020', name: 'Software & Subscriptions', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX040', name: 'Bank Charges', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX050', name: 'Marketing & Advertising', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
];

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ====`);

  let org = await prisma.organization.findFirst({ where: { name: { contains: 'YOURWORLD', mode: 'insensitive' } } });
  console.log(org ? `Org exists: ${org.name} [${org.id}]` : 'Org missing — will create YOURWORLD PTE. LTD.');

  const osirisModules = await prisma.organizationModule.findMany({ where: { organizationId: OSIRIS } });
  console.log(`Module rows to clone from Osiris: ${osirisModules.length} (${osirisModules.filter((x: any) => x.enabled).map((x: any) => x.moduleCode).join(', ')})`);
  console.log(`CoA to seed: ${DEFAULT_CHART_OF_ACCOUNTS.length} defaults + ${EXTRA.length} ticket-sales-specific`);

  if (!APPLY) { console.log('\n(dry run — nothing written; re-run with --apply)'); return; }

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'YOURWORLD PTE. LTD.',
        address: '467 Admiralty Drive #6-211, Singapore 750467',
        customDocumentTypes: [
          'QUOTATION', 'DELIVERY_ORDER', 'RETURN_DELIVERY_ORDER', 'INVOICE',
          'MAINTENANCE_SERVICE_REPORT', 'STOCK_ADJUSTMENT_IN', 'STOCK_ADJUSTMENT_OUT',
          'PURCHASE_ORDER', 'PURCHASE_RETURN', 'SALES_ORDER', 'DEBIT_NOTE', 'CREDIT_NOTE',
        ],
      },
    });
    console.log(`Created org ${org.id}`);
  }
  const ORG = org.id;

  // modules + UI config + default roles/permissions (same initializer onboarding uses)
  const { initializeOrganizationConfiguration } = require('./initialize-organization-config');
  await initializeOrganizationConfiguration({ organizationId: ORG, templateType: 'standard' });

  // clone Osiris's module set so Accounting & co. appear exactly as guru's main org has them
  for (const mod of osirisModules as any[]) {
    await prisma.organizationModule.upsert({
      where: { organizationId_moduleCode: { organizationId: ORG, moduleCode: mod.moduleCode } },
      update: { enabled: mod.enabled, displayName: mod.displayName, icon: mod.icon, sortOrder: mod.sortOrder, config: mod.config },
      create: { organizationId: ORG, moduleCode: mod.moduleCode, enabled: mod.enabled, displayName: mod.displayName, icon: mod.icon, sortOrder: mod.sortOrder, config: mod.config },
    });
  }
  console.log(`Cloned ${osirisModules.length} module rows`);

  // accounting settings — SGD, FY end 31 Dec, default tax 0% until GST status confirmed
  await prisma.accountingSetting.upsert({
    where: { organizationId: ORG },
    update: {},
    create: {
      organizationId: ORG,
      baseCurrency: 'SGD',
      taxDefaultPercentage: 0,
      taxReference: 'GST',
      taxBasis: 'CASH',
      fiscalYearEndDay: 31,
      fiscalYearEndMonth: 12,
      timeZone: 'Asia/Singapore',
      accountCodeRanges: DEFAULT_ACCOUNT_CODE_RANGES as any,
      controlAccounts: DEFAULT_CONTROL_ACCOUNTS as any,
    },
  });
  console.log('AccountingSetting ready');

  const want = [...DEFAULT_CHART_OF_ACCOUNTS, ...EXTRA];
  const have = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { code: true } });
  const haveCodes = new Set(have.map((h: any) => h.code));
  let created = 0;
  for (const acc of want) {
    if (haveCodes.has(acc.code)) continue;
    await prisma.chartOfAccount.create({
      data: {
        organizationId: ORG,
        code: acc.code,
        name: acc.name,
        accountType: acc.accountType,
        category: acc.category,
        normalBalance: acc.normalBalance,
        isControlAccount: (acc as any).isControlAccount ?? false,
        isSystem: true,
      },
    });
    created++;
  }
  console.log(`CoA: created ${created}, total ${await prisma.chartOfAccount.count({ where: { organizationId: ORG } })}`);
  console.log(`\nDONE — org id ${ORG}`);
}

main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
