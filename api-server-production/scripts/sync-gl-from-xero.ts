/**
 * Phase 1 of the Xero-takeover sync: pull the FULL general ledger from Xero's
 * Journals API and load it into JournalEntry + JournalEntryLine.
 *
 * WIPE-AND-RELOAD: deletes all existing postedBy='xero-import' JEs (Biofuel has
 * no hand-entered journals) then recreates from the current Xero journals, so
 * the GL exactly matches Xero (handles new / changed / removed).
 *
 * Convention (verified against live data): JournalLine.NetAmount > 0 = DEBIT,
 * < 0 = CREDIT.  Idempotent — re-run any time.
 */
import { PrismaClient } from '@prisma/client';
import { getXeroTokens, xeroGet } from './xero-migration/_common';

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const prisma = new PrismaClient();
const R = (n: number) => Math.round(n * 100) / 100;

// Xero "/Date(1627689600000+0000)/" → Date
function xdate(s: string): Date {
  const m = /\/Date\((\d+)/.exec(s || '');
  return m ? new Date(parseInt(m[1], 10)) : new Date();
}

// Map a Xero AccountType → AIMS { category, accountType, normalBalance } so
// auto-created accounts land on the correct side (else BS accounts get swept
// into Retained Earnings by the P&L rollover).
function mapXeroAccountType(t: string): { category: string; accountType: string; normalBalance: string } {
  switch ((t || '').toUpperCase()) {
    case 'BANK': return { category: 'BALANCE_SHEET', accountType: 'CURRENT_ASSET', normalBalance: 'DEBIT' };
    case 'CURRENT': case 'PREPAYMENT': case 'INVENTORY': return { category: 'BALANCE_SHEET', accountType: 'CURRENT_ASSET', normalBalance: 'DEBIT' };
    case 'FIXED': case 'NONCURRENT': return { category: 'BALANCE_SHEET', accountType: 'FIXED_ASSET', normalBalance: 'DEBIT' };
    case 'CURRLIAB': return { category: 'BALANCE_SHEET', accountType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' };
    case 'LIABILITY': case 'TERMLIAB': return { category: 'BALANCE_SHEET', accountType: 'LONG_TERM_LIABILITY', normalBalance: 'CREDIT' };
    case 'EQUITY': return { category: 'BALANCE_SHEET', accountType: 'SHARE_CAPITAL', normalBalance: 'CREDIT' };
    case 'SALES': case 'REVENUE': return { category: 'PNL', accountType: 'SALES', normalBalance: 'CREDIT' };
    case 'OTHERINCOME': return { category: 'PNL', accountType: 'INCOME', normalBalance: 'CREDIT' };
    case 'DIRECTCOSTS': return { category: 'PNL', accountType: 'PURCHASE', normalBalance: 'DEBIT' };
    case 'EXPENSE': case 'OVERHEADS': case 'DEPRECIATN': return { category: 'PNL', accountType: 'EXPENSE', normalBalance: 'DEBIT' };
    default: return { category: 'BALANCE_SHEET', accountType: 'CURRENT_ASSET', normalBalance: 'DEBIT' };
  }
}

function sourceToType(src: string): string {
  switch (src) {
    case 'ACCREC': return 'INVOICE';
    case 'ACCPAY': return 'BILL';
    case 'ACCRECCREDIT': return 'CREDIT_NOTE';
    case 'ACCPAYCREDIT': return 'DEBIT_NOTE';
    case 'MANJOURNAL': return 'MANUAL';
    case 'TRANSFER': return 'ADJUSTMENT';
    case 'ACCRECPAYMENT': case 'ACCPAYPAYMENT':
    case 'ARCREDITPAYMENT': case 'APCREDITPAYMENT':
    case 'CASHREC': case 'CASHPAID': return 'PAYMENT';
    default: return 'MANUAL';
  }
}

async function main() {
  const tokens = await getXeroTokens(prisma, ORG);
  console.log(`Connected to Xero tenant ${tokens.tenantId}`);

  // 1) Pull ALL journals (paginate by offset = JournalNumber).
  const journals: any[] = [];
  let offset = 0;
  while (true) {
    const res = await xeroGet<any>(tokens, '/Journals', { offset });
    const batch: any[] = res.Journals || [];
    if (batch.length === 0) break;
    journals.push(...batch);
    const maxJn = Math.max(...batch.map((j) => j.JournalNumber || 0));
    process.stdout.write(`\r  pulled ${journals.length} journals (up to #${maxJn})   `);
    if (maxJn <= offset) break;
    offset = maxJn;
    if (batch.length < 100) break;
  }
  console.log(`\n  total journals from Xero: ${journals.length}`);

  // 2) Map every Xero AccountID → an AIMS ChartOfAccount id. Resolve by code
  // when present, else by exact name (matches code-less accounts like the
  // "Contra (AP & AR)" bank account), else create. Keying by AccountID means a
  // blank AccountCode never drops the line (which would unbalance the journal).
  const xeroAccts = new Map<string, { code: string; name: string; type: string }>();
  for (const j of journals) for (const l of j.JournalLines || []) {
    if (l.AccountID) xeroAccts.set(l.AccountID, { code: (l.AccountCode || '').trim(), name: (l.AccountName || '').trim(), type: l.AccountType || '' });
  }
  const existing = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true, name: true } });
  const codeToId = new Map(existing.map((a) => [a.code, a.id]));
  const nameToId = new Map(existing.map((a) => [a.name.trim().toLowerCase(), a.id]));
  const xidToAms = new Map<string, string>();
  let acctCreated = 0;
  for (const [xid, info] of xeroAccts) {
    let amsId = info.code && codeToId.has(info.code) ? codeToId.get(info.code) : undefined;
    if (!amsId && info.name) amsId = nameToId.get(info.name.toLowerCase());
    if (!amsId) {
      const code = info.code || `X-${xid.slice(0, 8)}`;
      const m = mapXeroAccountType(info.type);
      const a = await prisma.chartOfAccount.create({
        data: { organizationId: ORG, code, name: info.name || code, accountType: m.accountType, category: m.category, normalBalance: m.normalBalance, isActive: true },
      });
      amsId = a.id;
      codeToId.set(code, amsId);
      if (info.name) nameToId.set(info.name.toLowerCase(), amsId);
      acctCreated++;
    }
    xidToAms.set(xid, amsId);
  }
  if (acctCreated) console.log(`  created ${acctCreated} accounts to cover all Xero journal accounts`);

  // 3) WIPE existing xero-import JEs + their lines.
  const oldIds = (await prisma.journalEntry.findMany({ where: { organizationId: ORG, postedBy: 'xero-import' }, select: { id: true } })).map((j) => j.id);
  console.log(`  wiping ${oldIds.length} existing xero-import journal entries...`);
  for (let i = 0; i < oldIds.length; i += 1000) {
    const chunk = oldIds.slice(i, i + 1000);
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: chunk } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: chunk } } });
  }

  // 4) Insert fresh JEs.
  let inserted = 0, skipped = 0, unbalanced = 0, droppedLines = 0;
  for (const j of journals) {
    const rawLines = j.JournalLines || [];
    const lines = rawLines
      .map((l: any, i: number) => {
        const accountId = xidToAms.get(l.AccountID);
        if (!accountId) { droppedLines++; return null; }
        const net = Number(l.NetAmount) || 0;
        return { accountId, lineNumber: i + 1, description: (l.Description || '').slice(0, 500) || null, debit: net > 0 ? R(net) : 0, credit: net < 0 ? R(-net) : 0 };
      })
      .filter(Boolean) as any[];
    if (lines.length === 0) { skipped++; continue; }
    const totalDebit = R(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = R(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      unbalanced++;
      if (unbalanced <= 5) console.log(`\n  ⚠ unbalanced journal #${j.JournalNumber} (${j.SourceType}): Dr ${totalDebit} Cr ${totalCredit}`);
    }
    await prisma.journalEntry.create({
      data: {
        organizationId: ORG,
        journalNumber: `JV-XERO-${j.JournalNumber}`,
        entryDate: xdate(j.JournalDate),
        type: sourceToType(j.SourceType),
        status: 'POSTED',
        reference: j.Reference || null,
        description: `Xero ${j.SourceType || ''} ${j.Reference || ''}`.trim().slice(0, 500) || null,
        totalDebit, totalCredit, currency: 'SGD',
        postedAt: xdate(j.JournalDate), postedBy: 'xero-import', createdBy: 'xero-import',
        lines: { create: lines },
      },
    });
    inserted++;
    if (inserted % 500 === 0) process.stdout.write(`\r  inserted ${inserted}/${journals.length}   `);
  }
  console.log(`\n  inserted ${inserted} JEs (skipped ${skipped} empty, ${unbalanced} unbalanced journals, ${droppedLines} lines dropped)`);

  // 5) Verify — gross balance + net trial-balance (vs Xero TB).
  const agg = await prisma.journalEntryLine.aggregate({ where: { journalEntry: { organizationId: ORG, postedBy: 'xero-import' } }, _sum: { debit: true, credit: true } });
  const dr = R(agg._sum.debit || 0), cr = R(agg._sum.credit || 0);
  console.log(`\n✓ GL synced. JE=${inserted}  Dr=${dr.toFixed(2)}  Cr=${cr.toFixed(2)}  ${Math.abs(dr - cr) < 0.02 ? 'BALANCED ✅' : '*** OUT OF BALANCE ***'}`);

  const byAcct = await prisma.journalEntryLine.groupBy({ by: ['accountId'], where: { journalEntry: { organizationId: ORG, postedBy: 'xero-import' } }, _sum: { debit: true, credit: true } });
  let tbDr = 0, tbCr = 0;
  for (const g of byAcct) { const net = (g._sum.debit || 0) - (g._sum.credit || 0); if (net > 0) tbDr += net; else tbCr += -net; }
  console.log(`  Net trial balance: Dr ${R(tbDr).toFixed(2)}  Cr ${R(tbCr).toFixed(2)}   (Xero TB as-at today = 21,801,168.59)`);
}
main().catch((e) => { console.error('\nFATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
