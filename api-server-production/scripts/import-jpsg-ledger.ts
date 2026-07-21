/**
 * Import the FULL JPSG customer ledger (ledger_entries) into AIMS so every
 * Customer Deposit-X account ties to JPSG's companies.credit_balance.
 *
 * Entry handling (idempotent by reference JPSG:<ledger_entry_id>):
 *  - topup w/ Airwallex ref + matching AWX journal  → SKIP (already booked by
 *    the Airwallex import: Dr Wallet+Fees / Cr Deposit)
 *  - topup w/ Airwallex ref, NO AWX journal (pre-report-window) →
 *      Dr "AWX Historic Clearing" / Cr Deposit (gross; exact fees need the
 *      older Airwallex reports — flagged for guru)
 *  - topup manual (no ref) → Dr "Manual Topup Clearing" / Cr Deposit
 *      (guru later reclasses each to the real receiving bank account)
 *  - charge → Dr Deposit gross / Cr Disposal Revenue net / Cr GST Output
 *      (GST from linked transactions.gst_amount; else 9/109, flagged)
 *  - adjustment → Cr Deposit (or Dr if negative) vs "JPSG Adjustments
 *      Clearing" — for guru to classify (refunds/promo/corrections)
 *
 * Verification: per-company AIMS deposit balance vs JPSG credit_balance.
 *
 * Usage: npx ts-node --transpile-only scripts/import-jpsg-ledger.ts [--env=.env]
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import { Client } from 'pg';
import * as fs from 'fs';
import ws = require('ws');

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const envFile = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1] || '.env';
const envTxt = fs.readFileSync(envFile, 'utf8');
const dbUrl = new URL(envTxt.match(/^DATABASE_URL="?([^"\n]+)"?/m)![1]);
dbUrl.searchParams.delete('pool_timeout'); dbUrl.searchParams.delete('connect_timeout');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: dbUrl.toString() }) } as any);
// JPSG_DATABASE only lives in .env — read it from there regardless of --env.
const jpsgUrl = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)![1].trim();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function ensureAccount(code: string, name: string, accountType: string, opts: { parentAccountId?: string; normalBalance?: string; category?: string } = {}) {
  let acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, name } });
  if (!acct) {
    let c = code;
    if (await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: c } })) {
      let n = 1;
      do { c = `${code}-${n++}`; } while (await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: c } }));
    }
    acct = await prisma.chartOfAccount.create({
      data: {
        organizationId: ORG, code: c, name, accountType,
        category: opts.category ?? (['EXPENSE', 'SALES', 'INCOME'].includes(accountType) ? 'PNL' : 'BALANCE_SHEET'),
        normalBalance: opts.normalBalance ?? (['SALES', 'INCOME', 'CURRENT_LIABILITY', 'TAX_LIABILITY'].includes(accountType) ? 'CREDIT' : 'DEBIT'),
        isActive: true, parentAccountId: opts.parentAccountId ?? null,
      },
    });
    console.log(`  + account ${c} ${name}`);
  }
  return acct;
}

async function main() {
  const jpsg = new Client({ connectionString: jpsgUrl });
  await jpsg.connect();

  // ---- accounts ----
  const control = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, name: 'Customer Deposits (Control)' } });
  if (!control) throw new Error('run import-airwallex-wallet.ts first (control account missing)');
  const awxHist = await ensureAccount('AWXH', 'AWX Historic Clearing (pre-Apr20 topups — needs older reports)', 'CURRENT_ASSET');
  const manualClr = await ensureAccount('MTC', 'Manual Topup Clearing (reclass to real bank)', 'CURRENT_ASSET');
  const adjClr = await ensureAccount('JPADJ', 'JPSG Adjustments Clearing (classify: refund/promo/correction)', 'CURRENT_ASSET');
  let revenue = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, name: { contains: 'disposal', mode: 'insensitive' }, accountType: { in: ['SALES', 'INCOME'] } } });
  if (!revenue) revenue = await ensureAccount('REV-JPSG', 'JPSG Disposal Revenue', 'SALES', { normalBalance: 'CREDIT', category: 'PNL' });
  let gstOut = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '820' } });
  if (!gstOut) gstOut = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, name: { contains: 'GST', mode: 'insensitive' } } });
  if (!gstOut) throw new Error('GST account not found');
  console.log(`revenue=${revenue.code} ${revenue.name} | gst=${gstOut.code} ${gstOut.name}`);

  // deposit account per JPSG company (create missing on the fly)
  const companies = (await jpsg.query(`SELECT id, name, credit_balance FROM companies`)).rows as Array<{ id: string; name: string; credit_balance: string }>;
  const depByCompany = new Map<string, string>();
  let cdMax = 0;
  for (const a of await prisma.chartOfAccount.findMany({ where: { organizationId: ORG, code: { startsWith: 'CD' } }, select: { code: true } })) {
    const n = parseInt(a.code.slice(2), 10);
    if (Number.isFinite(n)) cdMax = Math.max(cdMax, n);
  }
  for (const co of companies) {
    let acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, name: `Customer Deposit-${co.name}` } });
    if (!acct) {
      const hasLedger = (await jpsg.query(`SELECT 1 FROM ledger_entries WHERE company_id=$1 LIMIT 1`, [co.id])).rows.length > 0;
      if (!hasLedger) continue; // no activity → no account
      acct = await ensureAccount(`CD${String(++cdMax).padStart(3, '0')}`, `Customer Deposit-${co.name}`, 'CURRENT_ASSET', { parentAccountId: control.id });
    }
    depByCompany.set(co.id, acct.id);
  }
  console.log(`deposit accounts ready for ${depByCompany.size} companies`);

  // ---- ledger entries ----
  const entries = (await jpsg.query(`
    SELECT le.id, le.company_id, le.type::text AS type, le.amount::float AS amount, le.reference,
           le.created_at, le.related_transaction_id, t.gst_amount::float AS txn_gst
    FROM ledger_entries le
    LEFT JOIN transactions t ON t.id = le.related_transaction_id
    ORDER BY le.created_at`)).rows;
  console.log(`JPSG ledger entries: ${entries.length}`);

  const existing = new Set(
    (await prisma.journalEntry.findMany({ where: { organizationId: ORG, reference: { startsWith: 'JPSG:' } }, select: { reference: true } })).map((j) => j.reference as string),
  );
  // AWX journals already booked (skip matching Airwallex topups): match by intent id in AWX descriptions? AWX refs are ftx ids.
  // JPSG topup references carry "Airwallex payment: int_xxx". The AWX import keyed by ftx — different id space. Match instead on
  // (company, amount, date±3d) against existing AWX top-up journals.
  const awxTopups = await prisma.journalEntry.findMany({
    where: { organizationId: ORG, reference: { startsWith: 'AWX:' }, description: { startsWith: 'PayNow top-up' } },
    select: { id: true, entryDate: true, totalCredit: true, description: true },
  });

  let created = 0, skippedDup = 0, skippedAwx = 0, histTopup = 0, manualTopup = 0, charges = 0, adjustments = 0, gstFallback = 0;
  let jn = await prisma.journalEntry.count({ where: { organizationId: ORG, journalNumber: { startsWith: 'JV-JPSG-' } } });

  for (const e of entries) {
    const ref = `JPSG:${e.id}`;
    if (existing.has(ref)) { skippedDup++; continue; }
    const depId = depByCompany.get(e.company_id);
    if (!depId) { console.log(`  ⚠ no deposit account for company ${e.company_id} — skipped ${e.id}`); continue; }
    const when = new Date(e.created_at);
    const amt = R(Math.abs(e.amount));
    if (amt < 0.005) { skippedDup++; continue; }
    const coName = companies.find((c) => c.id === e.company_id)?.name || e.company_id;
    let lines: Array<{ accountId: string; lineNumber: number; description: string; debit: number; credit: number }> = [];
    let desc = '';

    if (e.type === 'topup') {
      const isAwx = /airwallex/i.test(e.reference || '');
      if (isAwx) {
        // already booked by the Airwallex import? (same amount, ±5 days)
        const hit = awxTopups.find((j) => Math.abs(j.totalCredit - amt) < 0.005 && Math.abs(+j.entryDate - +when) < 5 * 864e5 && j.description?.includes(coName.split(' ')[0]));
        if (hit) { skippedAwx++; continue; }
        desc = `JPSG top-up (Airwallex, pre-window) ${coName} $${amt.toFixed(2)}`;
        lines = [
          { accountId: awxHist.id, lineNumber: 1, description: desc, debit: amt, credit: 0 },
          { accountId: depId, lineNumber: 2, description: desc, debit: 0, credit: amt },
        ];
        histTopup++;
      } else {
        desc = `JPSG manual top-up ${coName} $${amt.toFixed(2)}${e.reference ? ` (${String(e.reference).slice(0, 60)})` : ''}`;
        lines = [
          { accountId: manualClr.id, lineNumber: 1, description: desc, debit: amt, credit: 0 },
          { accountId: depId, lineNumber: 2, description: desc, debit: 0, credit: amt },
        ];
        manualTopup++;
      }
    } else if (e.type === 'charge') {
      let gst = e.txn_gst != null ? R(e.txn_gst) : null;
      if (gst == null) { gst = R((amt * 9) / 109); gstFallback++; }
      const net = R(amt - gst);
      desc = `JPSG disposal charge ${coName} $${amt.toFixed(2)}${e.related_transaction_id ? '' : ' (no txn link, GST 9/109 est.)'}`;
      lines = [
        { accountId: depId, lineNumber: 1, description: desc, debit: amt, credit: 0 },
        { accountId: revenue.id, lineNumber: 2, description: desc, debit: 0, credit: net },
        ...(gst > 0 ? [{ accountId: gstOut.id, lineNumber: 3, description: desc, debit: 0, credit: gst }] : []),
      ];
      charges++;
    } else { // adjustment
      const positive = e.amount > 0; // credit to the customer
      desc = `JPSG adjustment ${coName} ${e.amount > 0 ? '+' : '-'}$${amt.toFixed(2)}${e.reference ? ` (${String(e.reference).slice(0, 60)})` : ''}`;
      lines = positive
        ? [
            { accountId: adjClr.id, lineNumber: 1, description: desc, debit: amt, credit: 0 },
            { accountId: depId, lineNumber: 2, description: desc, debit: 0, credit: amt },
          ]
        : [
            { accountId: depId, lineNumber: 1, description: desc, debit: amt, credit: 0 },
            { accountId: adjClr.id, lineNumber: 2, description: desc, debit: 0, credit: amt },
          ];
      adjustments++;
    }

    jn++;
    await prisma.journalEntry.create({
      data: {
        organizationId: ORG, journalNumber: `JV-JPSG-${String(jn).padStart(5, '0')}`,
        entryDate: when, type: 'ADJUSTMENT', status: 'POSTED', reference: ref, description: desc,
        totalDebit: R(lines.reduce((s, l) => s + l.debit, 0)), totalCredit: R(lines.reduce((s, l) => s + l.credit, 0)),
        currency: 'SGD', postedAt: when, postedBy: 'jpsg-import', createdBy: 'jpsg-import',
        lines: { create: lines },
      },
    });
    created++;
    if (created % 200 === 0) console.log(`  ...${created}`);
  }
  console.log(`\njournals: created=${created} (hist-awx=${histTopup} manual=${manualTopup} charges=${charges} adj=${adjustments}) skipped: dup=${skippedDup} awx-already-booked=${skippedAwx} | gst-estimated=${gstFallback}`);

  // ---- verify vs JPSG credit_balance ----
  console.log('\nVERIFY (AIMS deposit balance vs JPSG credit_balance):');
  let ok = 0, off = 0;
  for (const co of companies) {
    const depId = depByCompany.get(co.id);
    if (!depId) continue;
    const g = await prisma.journalEntryLine.aggregate({ where: { accountId: depId, journalEntry: { organizationId: ORG, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
    const aims = R((g._sum.credit || 0) - (g._sum.debit || 0)); // credit balance = what we owe/hold
    const jpsgBal = R(Number(co.credit_balance));
    const match = Math.abs(aims - jpsgBal) < 0.01;
    if (match) ok++;
    else { off++; console.log(`  ✗ ${co.name.slice(0, 42).padEnd(42)} AIMS=${aims.toFixed(2)}  JPSG=${jpsgBal.toFixed(2)}  Δ=${R(aims - jpsgBal).toFixed(2)}`); }
  }
  console.log(`  ✓ matching: ${ok}  ✗ off: ${off}`);
  await jpsg.end();
}
main().catch((e) => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
