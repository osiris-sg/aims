/**
 * Airwallex wallet accounting — fully inside AIMS (guru's plan: verify in
 * AIMS first, port to Xero once clean).
 *
 * Reads the parsed reconciliation report (airwallex-txns.json) + the
 * topup→customer mapping (scripts/airwallex-topup-mapping.json) and builds:
 *
 *  1. Chart of accounts (idempotent):
 *       106  Airwallex Wallet            CURRENT_ASSET (bank-like)
 *       405  Airwallex Fees              EXPENSE
 *       CD000 Customer Deposits (Control) CURRENT_ASSET  ← accountant's design
 *       CD0xx Customer Deposit-<Name>     child per mapped customer
 *  2. Journal entries (idempotent by ftxId in reference):
 *       funded top-up:  Dr Wallet net + Dr Fees fee / Cr Customer Deposit-X gross
 *       failed attempt: Dr Fees 0.50 / Cr Wallet
 *       payout/sweep:   Dr UOB / Cr Wallet
 *     Unmapped (TODO) customers post to the parent control account so totals
 *     are right; rerun after filling the mapping to re-point them.
 *  3. Bank reconciliation: a BankStatementImport for the wallet account with
 *     every settled txn as a line, auto-MATCHED to its journal line.
 *
 * Usage:  npx ts-node --transpile-only scripts/import-airwallex-wallet.ts [--env=.env]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const SP = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad';
const envFile = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1] || '.env';
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Txn = { type: string; ftxId: string; created: string; settled: string | null; status: string; amount: number; fee: number; net: number; orderId: string | null; baseTopupId: string | null };

async function ensureAccount(code: string, name: string, accountType: string, opts: { parentAccountId?: string } = {}) {
  // Match by NAME first (codes may be taken by unrelated accounts, e.g. dev's
  // code 106 = Petty Cash - Dennis). If the desired code is occupied by a
  // DIFFERENT account, probe for a free one.
  let acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, name } });
  if (!acct) {
    const taken = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code }, select: { name: true } });
    if (taken) {
      let n = 1;
      let candidate = code;
      do { candidate = `${code}-${n++}`; } while (await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: candidate } }));
      console.log(`  code ${code} taken by "${taken.name}" — using ${candidate}`);
      code = candidate;
    }
    acct = await prisma.chartOfAccount.create({
      data: {
        organizationId: ORG, code, name, accountType,
        category: accountType === 'EXPENSE' ? 'PNL' : 'BALANCE_SHEET',
        normalBalance: accountType === 'EXPENSE' ? 'DEBIT' : 'DEBIT',
        isActive: true, parentAccountId: opts.parentAccountId ?? null,
      },
    });
    console.log(`  + account ${code} ${name}`);
  }
  return acct;
}

async function main() {
  const txns: Txn[] = JSON.parse(fs.readFileSync(`${SP}/airwallex-txns.json`, 'utf8'));
  const mapping: Record<string, { customerName: string }> = JSON.parse(fs.readFileSync('scripts/airwallex-topup-mapping.json', 'utf8'));

  // ---- 1. Accounts ----
  const wallet = await ensureAccount('106', 'Airwallex', 'CURRENT_ASSET');
  const fees = await ensureAccount('405', 'Airwallex Fees', 'EXPENSE');
  const control = await ensureAccount('CD000', 'Customer Deposits (Control)', 'CURRENT_ASSET');
  const uob = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, name: { contains: 'United Overseas', mode: 'insensitive' } } });
  if (!uob) throw new Error('UOB account not found in CoA');
  const depositAcct = new Map<string, string>(); // baseTopupId -> accountId
  let cd = 0;
  for (const [bid, info] of Object.entries(mapping)) {
    if (info.customerName === 'TODO') { depositAcct.set(bid, control.id); continue; }
    cd++;
    const code = `CD${String(cd).padStart(3, '0')}`;
    // find by name (stable across reruns even if code numbering shifts)
    let acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, name: `Customer Deposit-${info.customerName}` } });
    if (!acct) acct = await ensureAccount(code, `Customer Deposit-${info.customerName}`, 'CURRENT_ASSET', { parentAccountId: control.id });
    depositAcct.set(bid, acct.id);
  }
  console.log(`accounts ready: wallet/fees/control + ${cd} customer deposit accounts (${Object.values(mapping).filter(v => v.customerName === 'TODO').length} unmapped → control)`);

  // ---- 2. Journals (idempotent by ftxId) ----
  const existing = new Set(
    (await prisma.journalEntry.findMany({ where: { organizationId: ORG, reference: { startsWith: 'AWX:' } }, select: { reference: true } }))
      .map((j) => j.reference as string),
  );
  let jn = await prisma.journalEntry.count({ where: { organizationId: ORG, journalNumber: { startsWith: 'JV-AWX-' } } });
  let created = 0, skipped = 0;
  const lineIdByFtx = new Map<string, string>(); // ftxId -> wallet-side JE line id (for bank rec)

  for (const t of txns) {
    const ref = `AWX:${t.ftxId}`;
    if (existing.has(ref)) { skipped++; continue; }
    if (t.status !== 'Settled') { skipped++; continue; }
    const when = new Date((t.settled || t.created).replace(' ', 'T') + '+08:00');
    let lines: Array<{ accountId: string; lineNumber: number; description: string; debit: number; credit: number }> = [];
    let desc = '';
    if (t.type === 'Payout') {
      desc = 'Airwallex sweep to UOB';
      lines = [
        { accountId: uob.id, lineNumber: 1, description: desc, debit: R(-t.net), credit: 0 },
        { accountId: wallet.id, lineNumber: 2, description: desc, debit: 0, credit: R(-t.net) },
      ];
    } else if (t.amount === 0) {
      desc = `Airwallex failed-attempt fee (${t.baseTopupId?.slice(0, 14)}…)`;
      lines = [
        { accountId: fees.id, lineNumber: 1, description: desc, debit: R(t.fee), credit: 0 },
        { accountId: wallet.id, lineNumber: 2, description: desc, debit: 0, credit: R(t.fee) },
      ];
    } else {
      const depId = depositAcct.get(t.baseTopupId || '') || control.id;
      const custName = mapping[t.baseTopupId || '']?.customerName || 'UNMAPPED';
      desc = `PayNow top-up ${custName} $${t.amount.toFixed(2)} (fee ${t.fee.toFixed(2)})`;
      lines = [
        { accountId: wallet.id, lineNumber: 1, description: desc, debit: R(t.net), credit: 0 },
        { accountId: fees.id, lineNumber: 2, description: desc, debit: R(t.fee), credit: 0 },
        { accountId: depId, lineNumber: 3, description: desc, debit: 0, credit: R(t.amount) },
      ];
    }
    jn++;
    const je = await prisma.journalEntry.create({
      data: {
        organizationId: ORG,
        journalNumber: `JV-AWX-${String(jn).padStart(5, '0')}`,
        entryDate: when,
        type: 'ADJUSTMENT',
        status: 'POSTED',
        reference: ref,
        description: desc,
        totalDebit: R(lines.reduce((s, l) => s + l.debit, 0)),
        totalCredit: R(lines.reduce((s, l) => s + l.credit, 0)),
        currency: 'SGD',
        postedAt: when, postedBy: 'airwallex-import', createdBy: 'airwallex-import',
        lines: { create: lines },
      },
      include: { lines: true },
    });
    const walletLine = je.lines.find((l) => l.accountId === wallet.id);
    if (walletLine) lineIdByFtx.set(t.ftxId, walletLine.id);
    created++;
  }
  console.log(`journals: created=${created} skipped(existing/pending)=${skipped}`);

  // ---- 3. Bank statement + auto-reconcile ----
  const already = await prisma.bankStatementImport.findFirst({ where: { organizationId: ORG, bankAccountId: wallet.id, filename: 'Transaction_Reconciliation_Report_2026-07-20.xlsx' } });
  if (already) {
    console.log('bank statement already imported — skipping');
  } else {
    const settled = txns.filter((t) => t.status === 'Settled');
    const dates = settled.map((t) => new Date((t.settled || t.created).replace(' ', 'T') + '+08:00')).sort((a, b) => +a - +b);
    let bal = 0;
    const imp = await prisma.bankStatementImport.create({
      data: {
        organizationId: ORG, bankAccountId: wallet.id, source: 'CSV',
        filename: 'Transaction_Reconciliation_Report_2026-07-20.xlsx',
        periodStart: dates[0], periodEnd: dates[dates.length - 1],
        endingBalance: R(settled.reduce((s, t) => s + t.net, 0)),
        createdBy: 'airwallex-import',
      },
    });
    let matched = 0;
    for (const t of settled.sort((a, b) => +new Date(a.settled || a.created) - +new Date(b.settled || b.created))) {
      bal = R(bal + t.net);
      const jlId = lineIdByFtx.get(t.ftxId) || (await (async () => {
        const je = await prisma.journalEntry.findFirst({ where: { organizationId: ORG, reference: `AWX:${t.ftxId}` }, include: { lines: true } });
        return je?.lines.find((l) => l.accountId === wallet.id)?.id || null;
      })());
      await prisma.bankStatementLine.create({
        data: {
          importId: imp.id, organizationId: ORG, bankAccountId: wallet.id,
          date: new Date((t.settled || t.created).replace(' ', 'T') + '+08:00'),
          description: t.type === 'Payout' ? 'Sweep to UOB' : t.amount === 0 ? 'PayNow failed-attempt fee' : `PayNow top-up ${mapping[t.baseTopupId || '']?.customerName || 'UNMAPPED'}`,
          reference: t.ftxId, amount: R(t.net), runningBalance: bal,
          status: jlId ? 'MATCHED' : 'PENDING',
          matchedJournalLineId: jlId, matchedAt: jlId ? new Date() : null, matchedBy: jlId ? 'airwallex-import' : null,
        },
      });
      if (jlId) matched++;
    }
    console.log(`bank statement: ${settled.length} lines, ${matched} auto-matched, ending balance ${bal.toFixed(2)}`);
  }

  // ---- 4. Verify ----
  const agg = async (accountId: string) => {
    const g = await prisma.journalEntryLine.aggregate({ where: { accountId, journalEntry: { organizationId: ORG, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
    return R((g._sum.debit || 0) - (g._sum.credit || 0));
  };
  console.log('\nVERIFY:');
  console.log(`  Airwallex wallet balance : ${(await agg(wallet.id)).toFixed(2)}  (expect 13,308.00)`);
  console.log(`  Airwallex fees (expense) : ${(await agg(fees.id)).toFixed(2)}  (expect 2,014.20)`);
  for (const [bid, info] of Object.entries(mapping)) {
    if (info.customerName === 'TODO') continue;
    const id = depositAcct.get(bid)!;
    console.log(`  Deposit ${info.customerName.padEnd(20)}: ${(-(await agg(id))).toFixed(2)} funded (credit balance)`);
  }
  console.log(`  Control (unmapped)       : ${(-(await agg(control.id))).toFixed(2)}`);
}

main().catch((e) => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
