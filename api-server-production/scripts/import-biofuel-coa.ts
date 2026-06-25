/**
 * Import Biofuel's Chart of Accounts from the Xero export CSV.
 *
 * Input format (Xero default): *Code,*Name,*Type,*Tax Code,Description,Dashboard,
 *                              Expense Claims,Enable Payments,Balance
 *
 * Behaviour:
 *   - Parses CSV (handles quoted names with commas)
 *   - Skips rows with empty / non-numeric code (Xero header-only rows)
 *   - Skips Tracking-type pseudo-accounts (not a real GL account in Xero)
 *   - Maps Xero Type → AIMS accountType / category / normalBalance
 *   - Auto-detects control accounts:
 *       Accounts Receivable → debtorControl
 *       Accounts Payable    → creditorControl
 *       Sales Tax           → taxLiabilities
 *       Retained Earnings   → retainedProfits
 *   - Upserts into ChartOfAccount by (organizationId, code) — idempotent
 *   - Creates/updates AccountingSetting with the detected control codes
 *   - Prints a summary at the end
 *
 * Usage:
 *   npx ts-node scripts/import-biofuel-coa.ts                                # default path
 *   npx ts-node scripts/import-biofuel-coa.ts /path/to/ChartOfAccounts.csv
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

type XeroAccountType =
  | 'Bank'
  | 'Current Asset'
  | 'Fixed Asset'
  | 'Inventory'
  | 'Non-current Asset'
  | 'Prepayment'
  | 'Accounts Receivable'
  | 'Accounts Payable'
  | 'Current Liability'
  | 'Liability'
  | 'Non-current Liability'
  | 'Wages Payable'
  | 'Sales Tax'
  | 'Unpaid Expense Claims'
  | 'Equity'
  | 'Retained Earnings'
  | 'Historical Adjustment'
  | 'Revenue'
  | 'Sales'
  | 'Other Income'
  | 'Expense'
  | 'Direct Costs'
  | 'Overhead'
  | 'Depreciation'
  | 'Rounding'
  | 'Tracking';

type Mapped = {
  accountType: string;
  category: 'PNL' | 'BALANCE_SHEET';
  normalBalance: 'DEBIT' | 'CREDIT';
  isControlAccount?: boolean;
  controlRole?: 'debtorControl' | 'creditorControl' | 'taxLiabilities' | 'retainedProfits';
};

const TYPE_MAP: Record<string, Mapped | null> = {
  // ASSETS
  'Bank':                 { accountType: 'CURRENT_ASSET',     category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  'Current Asset':        { accountType: 'CURRENT_ASSET',     category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  'Prepayment':           { accountType: 'CURRENT_ASSET',     category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  'Inventory':            { accountType: 'CURRENT_ASSET',     category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  'Accounts Receivable':  { accountType: 'CURRENT_ASSET',     category: 'BALANCE_SHEET', normalBalance: 'DEBIT', isControlAccount: true, controlRole: 'debtorControl' },
  'Fixed Asset':          { accountType: 'FIXED_ASSET',       category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  'Non-current Asset':    { accountType: 'INTANGIBLE_ASSET',  category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },

  // LIABILITIES
  'Current Liability':    { accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  'Liability':            { accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  'Non-current Liability':{ accountType: 'LONG_TERM_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  'Wages Payable':        { accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  'Unpaid Expense Claims':{ accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  'Accounts Payable':     { accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT', isControlAccount: true, controlRole: 'creditorControl' },
  'Sales Tax':            { accountType: 'TAX_LIABILITY',     category: 'BALANCE_SHEET', normalBalance: 'CREDIT', isControlAccount: true, controlRole: 'taxLiabilities' },

  // EQUITY
  'Equity':               { accountType: 'SHARE_CAPITAL',     category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  'Retained Earnings':    { accountType: 'RETAINED_PROFIT',   category: 'BALANCE_SHEET', normalBalance: 'CREDIT', controlRole: 'retainedProfits' },
  'Historical Adjustment':{ accountType: 'SHARE_CAPITAL',     category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },

  // P&L — Revenue
  'Revenue':              { accountType: 'SALES',             category: 'PNL',           normalBalance: 'CREDIT' },
  'Sales':                { accountType: 'SALES',             category: 'PNL',           normalBalance: 'CREDIT' },
  'Other Income':         { accountType: 'INCOME',            category: 'PNL',           normalBalance: 'CREDIT' },

  // P&L — Expenses
  'Direct Costs':         { accountType: 'PURCHASE',          category: 'PNL',           normalBalance: 'DEBIT' },
  'Expense':              { accountType: 'EXPENSE',           category: 'PNL',           normalBalance: 'DEBIT' },
  'Overhead':             { accountType: 'EXPENSE',           category: 'PNL',           normalBalance: 'DEBIT' },
  'Depreciation':         { accountType: 'EXPENSE',           category: 'PNL',           normalBalance: 'DEBIT' },

  // Misc — Rounding lives in P&L as an Exchange/G-L style row.
  'Rounding':             { accountType: 'EXCHANGE_GAIN_LOSS', category: 'PNL',          normalBalance: 'CREDIT' },

  // Skip — Xero "Tracking" isn't a GL account, it's a dimension.
  'Tracking':             null,
};

function csvSplit(line: string, delim = ','): string[] {
  // Minimal CSV parser that handles quoted fields containing the delimiter.
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === delim && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function main() {
  const csvPath = process.argv[2] || '/Users/guru/Downloads/ChartOfAccounts.csv';
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  const org = await prisma.organization.findFirst({
    where: { name: { contains: 'Biofuel', mode: 'insensitive' } },
  });
  if (!org) throw new Error('Biofuel org not found');
  const organizationId = org.id;
  console.log(`🏢 Importing into: ${org.name} (${organizationId})`);
  console.log(`📄 Source: ${csvPath}`);

  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rows = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = csvSplit(rows[0]);
  console.log(`📋 Columns: ${header.join(' | ')}`);

  const dataRows = rows.slice(1);
  console.log(`📊 Data rows: ${dataRows.length}`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const unmappedTypes = new Set<string>();
  const skippedRows: Array<{ row: number; code: string; name: string; reason: string }> = [];
  const controlsDetected: Record<string, string> = {};

  for (const [i, line] of dataRows.entries()) {
    const cols = csvSplit(line);
    const code = (cols[0] || '').trim();
    const name = (cols[1] || '').trim();
    const xeroType = (cols[2] || '').trim();
    const description = (cols[4] || '').trim();

    if (!code) {
      skipped += 1;
      skippedRows.push({ row: i + 2, code: '(empty)', name, reason: 'no code' });
      continue;
    }
    if (!name) {
      skipped += 1;
      skippedRows.push({ row: i + 2, code, name: '(empty)', reason: 'no name' });
      continue;
    }

    const mapped = TYPE_MAP[xeroType];
    if (mapped === null) {
      skipped += 1;
      skippedRows.push({ row: i + 2, code, name, reason: `type=${xeroType} (skipped on purpose)` });
      continue;
    }
    if (!mapped) {
      skipped += 1;
      unmappedTypes.add(xeroType);
      skippedRows.push({ row: i + 2, code, name, reason: `unmapped Xero type "${xeroType}"` });
      continue;
    }

    // First account hitting a control role wins.
    if (mapped.controlRole && !controlsDetected[mapped.controlRole]) {
      controlsDetected[mapped.controlRole] = code;
    }

    const existing = await prisma.chartOfAccount.findFirst({
      where: { organizationId, code },
    });
    if (existing) {
      await prisma.chartOfAccount.update({
        where: { id: existing.id },
        data: {
          name,
          description: description || null,
          accountType: mapped.accountType,
          category: mapped.category,
          normalBalance: mapped.normalBalance,
          isControlAccount: mapped.isControlAccount ?? false,
          isActive: true,
        },
      });
      updated += 1;
    } else {
      await prisma.chartOfAccount.create({
        data: {
          organizationId,
          code,
          name,
          description: description || null,
          accountType: mapped.accountType,
          category: mapped.category,
          normalBalance: mapped.normalBalance,
          isControlAccount: mapped.isControlAccount ?? false,
          isSystem: false,
          isActive: true,
        },
      });
      created += 1;
    }
  }

  // Set up / refresh AccountingSetting with detected controls.
  const existingSetting = await prisma.accountingSetting.findUnique({
    where: { organizationId },
  });
  const settingData = {
    baseCurrency: 'SGD',
    taxDefaultPercentage: 9,
    taxReference: 'GST',
    activateLastBuyPrice: true,
    activateLastSoldPrice: true,
    enablePerpetualInventory: false,
    billApprovalThreshold: 5000,
    controlAccounts: controlsDetected as any,
  };
  if (existingSetting) {
    await prisma.accountingSetting.update({
      where: { organizationId },
      data: {
        ...settingData,
        // Merge with whatever was there before — don't blow away existing keys.
        controlAccounts: { ...(existingSetting.controlAccounts as any || {}), ...controlsDetected } as any,
      },
    });
    console.log('✅ AccountingSetting updated (controls merged)');
  } else {
    await prisma.accountingSetting.create({ data: { organizationId, ...settingData } });
    console.log('✅ AccountingSetting created');
  }

  console.log('\n📊 Summary:');
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  if (unmappedTypes.size > 0) {
    console.log(`\n⚠️  Unmapped Xero types (need to be added to TYPE_MAP):`);
    for (const t of unmappedTypes) console.log(`   - "${t}"`);
  }
  if (skippedRows.length > 0) {
    console.log(`\n📋 Skipped rows:`);
    for (const r of skippedRows.slice(0, 20)) {
      console.log(`   row ${r.row}: ${r.code} | ${r.name} → ${r.reason}`);
    }
    if (skippedRows.length > 20) console.log(`   ... +${skippedRows.length - 20} more`);
  }
  console.log(`\n🎯 Control accounts detected:`);
  for (const [role, code] of Object.entries(controlsDetected)) {
    console.log(`   ${role.padEnd(20)} → ${code}`);
  }

  // Final state
  const final = await prisma.chartOfAccount.groupBy({
    by: ['category'],
    where: { organizationId },
    _count: { _all: true },
  });
  console.log(`\n📊 Final CoA by category:`);
  for (const g of final) {
    console.log(`   ${g.category}: ${g._count._all}`);
  }
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
