/**
 * Pushes the default Accounts Definition (account code ranges + control accounts)
 * to every existing organization, and seeds the default chart of accounts for any
 * organization that has none yet.
 *
 * - Updates `accountCodeRanges` and `controlAccounts` on every org's AccountingSetting
 *   (creates the row with full defaults if it does not exist yet).
 * - Does NOT touch tax / numbering / opening-balance fields.
 * - Seeds the default ChartOfAccount rows only for orgs whose CoA is empty.
 *
 * Usage: npx ts-node scripts/apply-accounting-defaults-all-orgs.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_ACCOUNT_CODE_RANGES,
  DEFAULT_CONTROL_ACCOUNTS,
  DEFAULT_CHART_OF_ACCOUNTS,
  DEFAULT_NEXT_NUMBERS,
} from '../src/accounting/default-chart-of-accounts';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`🏢 Applying accounting defaults to ${orgs.length} organization(s)\n`);

  let settingsUpdated = 0;
  let settingsCreated = 0;
  let coaSeeded = 0;
  let coaSkipped = 0;

  for (const org of orgs) {
    // 1. Settings — upsert the ranges + control accounts. Other fields preserved.
    const existing = await prisma.accountingSetting.findUnique({ where: { organizationId: org.id } });

    if (existing) {
      await prisma.accountingSetting.update({
        where: { organizationId: org.id },
        data: {
          accountCodeRanges: DEFAULT_ACCOUNT_CODE_RANGES,
          controlAccounts: DEFAULT_CONTROL_ACCOUNTS,
        },
      });
      settingsUpdated += 1;
      console.log(`   ✏️  ${org.name}: updated accountCodeRanges + controlAccounts`);
    } else {
      await prisma.accountingSetting.create({
        data: {
          organizationId: org.id,
          baseCurrency: 'SGD',
          nextNumbers: DEFAULT_NEXT_NUMBERS,
          numberPrefixes: {},
          activateLastSoldPrice: true,
          activateLastBuyPrice: true,
          taxDefaultPercentage: 9,
          taxReference: 'GST',
          accountCodeRanges: DEFAULT_ACCOUNT_CODE_RANGES,
          controlAccounts: DEFAULT_CONTROL_ACCOUNTS,
        },
      });
      settingsCreated += 1;
      console.log(`   🆕 ${org.name}: created accounting setting with defaults`);
    }

    // 2. Chart of Accounts — seed only if empty.
    const coaCount = await prisma.chartOfAccount.count({ where: { organizationId: org.id } });
    if (coaCount > 0) {
      coaSkipped += 1;
      console.log(`       ↳ chart of accounts already has ${coaCount} entries — skipped seeding`);
      continue;
    }

    await prisma.$transaction(
      DEFAULT_CHART_OF_ACCOUNTS.map((acc) =>
        prisma.chartOfAccount.create({
          data: {
            organizationId: org.id,
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
    coaSeeded += 1;
    console.log(`       ↳ seeded ${DEFAULT_CHART_OF_ACCOUNTS.length} default chart-of-account entries`);
  }

  console.log('\n🎉 Done.');
  console.log(`   • Settings updated: ${settingsUpdated}`);
  console.log(`   • Settings created: ${settingsCreated}`);
  console.log(`   • Orgs CoA seeded: ${coaSeeded}`);
  console.log(`   • Orgs CoA skipped (already had entries): ${coaSkipped}`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
