/**
 * Seed Osiris Technology's chart of accounts — the 27 stock defaults plus the
 * accounts its ACTUAL Aspire data needs (derived from classifying all 653
 * bank transactions + 50 invoices).
 *
 * Idempotent: only creates codes that are missing, never edits or deletes.
 *
 * Dry:    npx ts-node --transpile-only scripts/_osiris-seed-coa-full.ts .env.production
 * Apply:  ... .env.production --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
import { DEFAULT_CHART_OF_ACCOUNTS, DEFAULT_ACCOUNT_CODE_RANGES } from '../src/accounting/default-chart-of-accounts';
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env.production';
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';

type Acc = { code: string; name: string; accountType: string; category: 'PNL' | 'BALANCE_SHEET'; normalBalance: 'DEBIT' | 'CREDIT'; note?: string };

// Osiris-specific accounts. Every one is justified by real volume in the data.
const OSIRIS: Acc[] = [
  // ---------- BANK ----------
  // CA1xx is what journal.isCashOrBankAccount() recognises, so bank-rec offers it.
  { code: 'CA101', name: 'Aspire — SGD', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT', note: 'a/c 885215591474' },

  // ---------- REVENUE ----------
  { code: 'SS002', name: 'Maintenance & Support Income', accountType: 'SALES', category: 'PNL', normalBalance: 'CREDIT', note: 'ESS/SIDS/ECM + Water-sg monthly' },
  { code: 'SS003', name: 'Software & Development Income', accountType: 'SALES', category: 'PNL', normalBalance: 'CREDIT', note: 'e.g. Jurong Port staging ground 50k' },
  { code: 'SS004', name: 'Hardware Sales & Recharges', accountType: 'SALES', category: 'PNL', normalBalance: 'CREDIT', note: 'SD cards, Raspberry Pi, cabling' },
  { code: 'SS005', name: 'Consulting & Project Income', accountType: 'SALES', category: 'PNL', normalBalance: 'CREDIT' },

  // ---------- COST OF SALES ----------
  { code: 'CS002', name: 'Hardware & Components', accountType: 'PURCHASE', category: 'PNL', normalBalance: 'DEBIT', note: 'Waveshare, Mouser, Element14, RS' },
  { code: 'CS003', name: 'Subcontractor & Freelance Costs', accountType: 'PURCHASE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'CS004', name: 'Hosting & Infrastructure', accountType: 'PURCHASE', category: 'PNL', normalBalance: 'DEBIT', note: 'Neon, Vercel, Render, AWS, DO, Cloudflare' },

  // ---------- EXPENSES ----------
  { code: 'EX010', name: "Directors' Remuneration", accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX011', name: 'Salaries & Wages', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX012', name: 'CPF Contributions', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT', note: 'CPF Board, 15,385 to date' },
  { code: 'EX020', name: 'Software Subscriptions', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT', note: 'Anthropic, OpenAI, Cursor, Google, Canva' },
  { code: 'EX030', name: 'Professional Fees', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT', note: 'audit, corp sec, legal' },
  { code: 'EX040', name: 'Bank Charges', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT', note: 'Aspire fees + payroll GIRO' },
  { code: 'EX050', name: 'Government Fees & Licences', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT', note: 'ACRA / IRAS' },
  { code: 'EX060', name: 'Travel & Transport', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX080', name: 'Marketing & Advertising', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX090', name: 'Office & Administration', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX100', name: 'Incubator & Programme Fees', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT', note: 'Pollinate / Ngee Ann Poly — pending confirmation' },
  { code: 'EX110', name: 'Insurance', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX120', name: 'Staff Welfare & Entertainment', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX130', name: 'Training & Development', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },

  // ---------- BALANCE SHEET ----------
  { code: 'CA010', name: 'Prepayments', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  { code: 'CA020', name: 'Deposits', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  { code: 'CA500', name: 'Work In Progress', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT', note: 'controlAccounts.workInProgress already points here' },
  { code: 'CL010', name: 'Accruals', accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  { code: 'CL020', name: "Director's Account — Kumaraguru", accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT', note: 'funds in/out from the director' },
  { code: 'CL030', name: 'Provision for Income Tax', accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  { code: 'FA010', name: 'Computer Equipment', accountType: 'FIXED_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT', note: 'e.g. Aftershock PC 1,880.75' },
];

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ====`);
  const have = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { code: true } });
  const haveCodes = new Set(have.map((h: any) => h.code));
  console.log(`existing accounts: ${haveCodes.size}`);

  const want: Acc[] = [...(DEFAULT_CHART_OF_ACCOUNTS as any as Acc[]), ...OSIRIS];
  const toCreate = want.filter((w) => !haveCodes.has(w.code));
  console.log(`to create: ${toCreate.length}\n`);
  for (const a of toCreate) {
    console.log(`  + ${a.code.padEnd(6)} ${a.name.padEnd(36)} ${a.accountType.padEnd(22)} ${a.note ?? ''}`);
  }
  if (!APPLY) {
    console.log('\n(dry run — nothing written; re-run with --apply)');
    return;
  }

  for (const a of toCreate) {
    await prisma.chartOfAccount.create({
      data: {
        organizationId: ORG,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        category: a.category,
        normalBalance: a.normalBalance,
        description: a.note,
        isControlAccount: (a as any).isControlAccount ?? false,
        isSystem: true,
      },
    });
  }
  await prisma.accountingSetting.update({
    where: { organizationId: ORG },
    data: { accountCodeRanges: DEFAULT_ACCOUNT_CODE_RANGES as any },
  });
  const total = await prisma.chartOfAccount.count({ where: { organizationId: ORG } });
  console.log(`\ncreated ${toCreate.length} — chart of accounts now has ${total} accounts`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
