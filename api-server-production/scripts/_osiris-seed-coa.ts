import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
import { DEFAULT_CHART_OF_ACCOUNTS, DEFAULT_ACCOUNT_CODE_RANGES } from '../src/accounting/default-chart-of-accounts';
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile = process.argv[2] || '.env';
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';

// Bank accounts for Osiris. CA1xx is what journal.isCashOrBankAccount() treats
// as a bank account, so bank-rec will offer these in its account picker.
const BANKS = [
  { code: 'CA101', name: 'Aspire — SGD', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
];

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ====`);
  const existing = await prisma.chartOfAccount.count({ where: { organizationId: ORG } });
  console.log(`Existing CoA rows: ${existing}`);

  const want = [...DEFAULT_CHART_OF_ACCOUNTS, ...BANKS];
  const have = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { code: true } });
  const haveCodes = new Set(have.map((h: any) => h.code));
  const toCreate = want.filter((w) => !haveCodes.has(w.code));
  console.log(`To create: ${toCreate.length}`);
  toCreate.forEach((a) => console.log(`   + ${a.code.padEnd(6)} ${a.name.padEnd(34)} ${a.accountType}`));
  if (!APPLY) return;

  for (const acc of toCreate) {
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
  }
  // Make sure Accounts Definition code ranges are set (Accounting Setup screen).
  await prisma.accountingSetting.update({
    where: { organizationId: ORG },
    data: { accountCodeRanges: DEFAULT_ACCOUNT_CODE_RANGES as any },
  });
  console.log(`Created ${toCreate.length}. Total now: ${await prisma.chartOfAccount.count({ where: { organizationId: ORG } })}`);
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
