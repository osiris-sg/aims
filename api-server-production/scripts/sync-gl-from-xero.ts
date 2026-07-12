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
import { getXeroTokens, xeroGet, createScriptPrisma, withDbRetry } from './xero-migration/_common';

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
// WebSocket (443) Prisma — raw 5432 dies mid-run on flaky networks.
const prisma = createScriptPrisma();
// --resume: skip the wipe and keep already-inserted JV-XERO-* entries (safe:
// Xero journals are immutable; a given JournalNumber never changes content).
const RESUME = process.argv.includes('--resume');
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

// Journal pages are cached to disk as they arrive so a killed/quota-blocked
// run never re-spends API calls: on restart we reload the cache and resume the
// pull from the highest cached JournalNumber (Xero /Journals?offset= is built
// for exactly this; journals are immutable so the cache can't go stale, though
// journals of later-voided docs disappear from Xero — acceptable within a
// single sync session; delete the cache file to force a clean pull).
const CACHE_FILE = `/tmp/xero-journals-cache-${ORG}.ndjson`;

async function main() {
  const fs = require('fs') as typeof import('fs');
  const tokens = await getXeroTokens(prisma, ORG);
  console.log(`Connected to Xero tenant ${tokens.tenantId}`);

  // 1) Pull ALL journals (paginate by offset = JournalNumber), cache-backed.
  const journals: any[] = [];
  const seenJn = new Set<number>();
  if (fs.existsSync(CACHE_FILE)) {
    for (const line of fs.readFileSync(CACHE_FILE, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (!seenJn.has(j.JournalNumber)) { seenJn.add(j.JournalNumber); journals.push(j); }
      } catch { /* torn last line from a killed run — re-pulled below */ }
    }
    console.log(`  cache: loaded ${journals.length} journals from ${CACHE_FILE}`);
  }
  let offset = journals.length ? Math.max(...journals.map((j) => j.JournalNumber || 0)) : 0;
  if (RESUME) {
    // Nightly append-only mode: also skip pull pages already in the DB (the
    // /tmp cache is ephemeral on Render). JV-XERO-<n> encodes the number.
    const rows = await prisma.journalEntry.findMany({
      where: { organizationId: ORG, postedBy: 'xero-import', journalNumber: { startsWith: 'JV-XERO-' } },
      select: { journalNumber: true },
    });
    let dbMax = 0;
    for (const r of rows) {
      const n = parseInt(r.journalNumber.slice('JV-XERO-'.length), 10);
      if (Number.isFinite(n) && n > dbMax) dbMax = n;
    }
    if (dbMax > offset) {
      console.log(`  --resume: DB already holds journals up to #${dbMax}, pulling from there`);
      offset = dbMax;
    }
  }
  while (true) {
    const res = await xeroGet<any>(tokens, '/Journals', { offset });
    const batch: any[] = (res.Journals || []).filter((j: any) => !seenJn.has(j.JournalNumber));
    if (batch.length === 0) break;
    journals.push(...batch);
    for (const j of batch) seenJn.add(j.JournalNumber);
    fs.appendFileSync(CACHE_FILE, batch.map((j: any) => JSON.stringify(j)).join('\n') + '\n');
    const maxJn = Math.max(...batch.map((j) => j.JournalNumber || 0));
    process.stdout.write(`\r  pulled ${journals.length} journals (up to #${maxJn})   `);
    if (maxJn <= offset) break;
    offset = maxJn;
  }
  journals.sort((a, b) => (a.JournalNumber || 0) - (b.JournalNumber || 0));
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

  // 3) WIPE existing xero-import JEs + their lines (skipped with --resume).
  const already = new Set<string>();
  if (RESUME) {
    // Repair: drop any line-less JEs from a run killed mid-batch, so they get
    // re-inserted with their lines rather than skipped forever.
    const orphans = await prisma.journalEntry.deleteMany({ where: { organizationId: ORG, postedBy: 'xero-import', lines: { none: {} } } });
    if (orphans.count) console.log(`  --resume: removed ${orphans.count} line-less entries from a prior partial batch`);
    const rows = await prisma.journalEntry.findMany({ where: { organizationId: ORG, postedBy: 'xero-import' }, select: { journalNumber: true } });
    for (const r of rows) already.add(r.journalNumber);
    console.log(`  --resume: keeping ${already.size} already-inserted entries`);
  } else {
    const oldIds = (await prisma.journalEntry.findMany({ where: { organizationId: ORG, postedBy: 'xero-import' }, select: { id: true } })).map((j) => j.id);
    console.log(`  wiping ${oldIds.length} existing xero-import journal entries...`);
    for (let i = 0; i < oldIds.length; i += 1000) {
      const chunk = oldIds.slice(i, i + 1000);
      await withDbRetry(() => prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: chunk } } }), 'wipe lines');
      await withDbRetry(() => prisma.journalEntry.deleteMany({ where: { id: { in: chunk } } }), 'wipe entries');
    }
  }

  // 4) Insert fresh JEs — BATCHED. Per-entry nested creates cost one round
  // trip each (~30/min on a degraded link); createMany batches of 250 JEs +
  // their lines in one transaction cut ~44k round-trips to ~180.
  const { randomUUID } = require('crypto') as typeof import('crypto');
  let inserted = 0, skipped = 0, unbalanced = 0, droppedLines = 0, kept = 0;
  type Pending = { je: any; lines: any[] };
  const pending: Pending[] = [];
  for (const j of journals) {
    if (RESUME && already.has(`JV-XERO-${j.JournalNumber}`)) { kept++; continue; }
    const rawLines = j.JournalLines || [];
    const jeId = randomUUID();
    const lines = rawLines
      .map((l: any, i: number) => {
        const accountId = xidToAms.get(l.AccountID);
        if (!accountId) { droppedLines++; return null; }
        const net = Number(l.NetAmount) || 0;
        return { journalEntryId: jeId, accountId, lineNumber: i + 1, description: (l.Description || '').slice(0, 500) || null, debit: net > 0 ? R(net) : 0, credit: net < 0 ? R(-net) : 0 };
      })
      .filter(Boolean) as any[];
    if (lines.length === 0) { skipped++; continue; }
    const totalDebit = R(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = R(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      unbalanced++;
      if (unbalanced <= 5) console.log(`\n  ⚠ unbalanced journal #${j.JournalNumber} (${j.SourceType}): Dr ${totalDebit} Cr ${totalCredit}`);
    }
    pending.push({
      je: {
        id: jeId,
        organizationId: ORG,
        journalNumber: `JV-XERO-${j.JournalNumber}`,
        entryDate: xdate(j.JournalDate),
        type: sourceToType(j.SourceType),
        status: 'POSTED',
        reference: j.Reference || null,
        description: `Xero ${j.SourceType || ''} ${j.Reference || ''}`.trim().slice(0, 500) || null,
        totalDebit, totalCredit, currency: 'SGD',
        postedAt: xdate(j.JournalDate), postedBy: 'xero-import', createdBy: 'xero-import',
      },
      lines,
    });
  }
  const BATCH = 250;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    try {
      await withDbRetry(() => prisma.$transaction([
        prisma.journalEntry.createMany({ data: chunk.map((c) => c.je) }),
        prisma.journalEntryLine.createMany({ data: chunk.flatMap((c) => c.lines) }),
      ]), `batch @${i}`);
    } catch (e: any) {
      // Duplicate journalNumber (e.g. a lost-ack retry after the batch really
      // committed): fall back to inserting only the entries not yet present.
      const nums = chunk.map((c) => c.je.journalNumber);
      const exist = new Set(
        (await prisma.journalEntry.findMany({ where: { organizationId: ORG, journalNumber: { in: nums } }, select: { journalNumber: true } })).map((r) => r.journalNumber),
      );
      const rest = chunk.filter((c) => !exist.has(c.je.journalNumber));
      console.warn(`\n  ⚠ batch @${i} fell back to singles (${exist.size} already present, ${rest.length} to insert): ${(e?.message || '').slice(-120)}`);
      for (const c of rest) {
        await withDbRetry(() => prisma.$transaction([
          prisma.journalEntry.createMany({ data: [c.je] }),
          prisma.journalEntryLine.createMany({ data: c.lines }),
        ]), `single #${c.je.journalNumber}`);
      }
    }
    inserted += chunk.length;
    process.stdout.write(`\r  inserted ${inserted}/${pending.length} new   `);
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
