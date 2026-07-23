/**
 * reconcile-xero-biofuel.ts — Xero → AIMS parity check (READ-ONLY).
 *
 * Verifies that the AIMS database faithfully mirrors Xero for the Biofuel org.
 * Xero is the source of truth; this script never writes AIMS data. (It may
 * refresh the stored Xero access token via getXeroTokens — that's the only
 * write, into XeroConnection, and is expected.)
 *
 * Three reconciliations, each reported as a per-line diff + totals:
 *   1. GENERAL LEDGER / TRIAL BALANCE — per account code, Σ signed balance.
 *        Xero  = Σ JournalLine.NetAmount grouped by AccountCode (>0 Dr, <0 Cr).
 *        AIMS  = Σ(debit − credit) over POSTED lines grouped by ChartOfAccount.code.
 *   2. ACCOUNTS RECEIVABLE — total outstanding.
 *        Xero  = Σ AmountDue over ACCREC invoices.
 *        AIMS  = Σ Document(INVOICE).config.xeroBalance (unpaid, non-voided).
 *        + internal check vs AIMS GL debtorControl (CA001) balance.
 *   3. ACCOUNTS PAYABLE — total outstanding.
 *        Xero  = Σ AmountDue over ACCPAY invoices (bills).
 *        AIMS  = Σ Document(BILL) (totalAmount − amountPaid), POSTED/PAID.
 *        + internal check vs AIMS GL creditorControl (CL001) balance.
 *
 * Usage (target PROD explicitly — the whole point):
 *   dotenv -e .env.production -- npx ts-node scripts/reconcile-xero-biofuel.ts
 * Optional flags:
 *   --asof=YYYY-MM-DD   cut-off date for both sides (default: today, all activity)
 *   --tol=0.01          per-line tolerance in dollars (default 0.01)
 *   --show-ok           also print accounts/sections that match
 *
 * Exit code 0 = everything within tolerance; 1 = drift found; 2 = fatal error.
 */

import { getXeroTokens, xeroGet, BIOFUEL_ORG_ID, createScriptPrisma } from './xero-migration/_common';

const prisma = createScriptPrisma();

// ---- args ----
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
};
const ORG = getArg('org') || BIOFUEL_ORG_ID;
const TOL = Number(getArg('tol') ?? '0.01');
const SHOW_OK = args.includes('--show-ok');
const ASOF = getArg('asof') ? new Date(getArg('asof') + 'T23:59:59.999Z') : new Date();

const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) =>
  (n < 0 ? '-' : ' ') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(14);
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

let anyDrift = false;

// ------------------------------------------------------------------
// 1. GENERAL LEDGER / TRIAL BALANCE
// ------------------------------------------------------------------
async function reconcileGL(tokens: Awaited<ReturnType<typeof getXeroTokens>>) {
  console.log('\n' + '='.repeat(78));
  console.log('1. GENERAL LEDGER / TRIAL BALANCE  (signed balance = debit − credit)');
  console.log('='.repeat(78));

  // --- Xero side: aggregate all /Journals by AccountCode ---
  const xeroByCode = new Map<string, { name: string; net: number }>();
  let offset = 0;
  let page = 0;
  const asofMs = ASOF.getTime();
  for (;;) {
    const j = await xeroGet<any>(tokens, '/Journals', { offset });
    const js: any[] = j.Journals || [];
    if (js.length === 0) break;
    page++;
    for (const jrnl of js) {
      const jdate = new Date(jrnl.JournalDate);
      if (jdate.getTime() > asofMs) continue; // respect as-of cut-off
      for (const l of jrnl.JournalLines || []) {
        // Xero bank accounts (Customer Deposits, Airwallex) and some CoA rows
        // have no Code — key those by normalized name so each keeps its own
        // row instead of collapsing into one '(none)' bucket.
        const rawCode = (l.AccountCode ?? '').toString().trim();
        const code = rawCode || '~' + (l.AccountName || '(unnamed)').toLowerCase().replace(/\s+/g, ' ').trim();
        const cur = xeroByCode.get(code) || { name: l.AccountName || '', net: 0 };
        cur.net += Number(l.NetAmount) || 0;
        if (!cur.name && l.AccountName) cur.name = l.AccountName;
        xeroByCode.set(code, cur);
      }
    }
    offset = Math.max(...js.map((x: any) => x.JournalNumber || 0));
    if (js.length < 100) break;
  }
  console.log(`  Xero: pulled ${page} page(s) of journals, ${xeroByCode.size} distinct account codes.`);

  // --- AIMS side: groupBy accountId over POSTED lines up to as-of ---
  const grouped = await prisma.journalEntryLine.groupBy({
    by: ['accountId'],
    where: { journalEntry: { organizationId: ORG, status: 'POSTED', entryDate: { lte: ASOF } } },
    _sum: { debit: true, credit: true },
  });
  const accts = await prisma.chartOfAccount.findMany({
    where: { organizationId: ORG },
    select: { id: true, code: true, name: true },
  });
  const acctById = new Map(accts.map((a) => [a.id, a]));
  const aimsByCode = new Map<string, { name: string; net: number }>();
  for (const g of grouped) {
    const a = acctById.get(g.accountId);
    const code = a?.code ?? '(unknown)';
    const net = (g._sum.debit || 0) - (g._sum.credit || 0);
    const cur = aimsByCode.get(code) || { name: a?.name || '', net: 0 };
    cur.net += net;
    aimsByCode.set(code, cur);
  }

  // Pair accounts the two systems code differently: any AIMS code with no Xero
  // counterpart is re-keyed onto the Xero account with the same normalized name
  // (covers code-less Xero bank accounts → AIMS X-…/CD… codes, and code clashes
  // like Airwallex Fees 403 in Xero vs 405 in AIMS).
  const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const xeroByName = new Map<string, string>(); // norm(name) -> xero key (codes unmatched in AIMS only)
  for (const [code, v] of xeroByCode)
    if (!aimsByCode.has(code)) {
      const k = normName(v.name);
      xeroByName.set(k, xeroByName.has(k) ? '(ambiguous)' : code);
    }
  for (const [code, v] of Array.from(aimsByCode)) {
    if (xeroByCode.has(code)) continue;
    const target = xeroByName.get(normName(v.name));
    if (!target || target === '(ambiguous)') continue;
    const cur = aimsByCode.get(target) || { name: v.name, net: 0 };
    cur.net += v.net;
    aimsByCode.set(target, cur);
    aimsByCode.delete(code);
  }

  // how much of AIMS GL is NOT from the Xero import (i.e. live AIMS activity)?
  const nonImport = await prisma.journalEntry.count({
    where: { organizationId: ORG, status: 'POSTED', entryDate: { lte: ASOF }, postedBy: { not: 'xero-import' } },
  });
  if (nonImport > 0)
    console.log(`  AIMS: ⚠ ${nonImport} POSTED entries are NOT postedBy='xero-import' (live AIMS activity — may explain diffs below).`);

  // --- diff ---
  const codes = Array.from(new Set([...xeroByCode.keys(), ...aimsByCode.keys()])).sort();
  console.log('\n  ' + pad('Code', 10) + pad('Account', 30) + 'Xero'.padStart(15) + 'AIMS'.padStart(15) + 'Δ (Xero−AIMS)'.padStart(16));
  console.log('  ' + '-'.repeat(84));
  let xTotal = 0,
    aTotal = 0,
    driftCount = 0,
    driftSum = 0;
  for (const code of codes) {
    const x = R(xeroByCode.get(code)?.net || 0);
    const a = R(aimsByCode.get(code)?.net || 0);
    const d = R(x - a);
    xTotal += x;
    aTotal += a;
    const name = xeroByCode.get(code)?.name || aimsByCode.get(code)?.name || '';
    const off = Math.abs(d) > TOL;
    if (off) {
      driftCount++;
      driftSum += Math.abs(d);
    }
    if (off || SHOW_OK) {
      const flag = off ? ' ✗' : '  ';
      console.log('  ' + pad(code, 10) + pad(name, 30) + money(x) + money(a) + money(d) + flag);
    }
  }
  console.log('  ' + '-'.repeat(84));
  console.log('  ' + pad('TOTAL', 40) + money(R(xTotal)) + money(R(aTotal)) + money(R(xTotal - aTotal)));
  console.log(
    `\n  → ${driftCount} account(s) out of tolerance (±$${TOL}); total absolute drift $${R(driftSum).toFixed(2)}.` +
      (driftCount === 0 ? '  ✓ GL MATCHES' : '  ✗ GL DRIFT'),
  );
  if (driftCount > 0) anyDrift = true;

  return { aimsByCode };
}

// AIMS-side GL balances by account code (shared by GL diff + control tie-outs).
async function aimsBalancesByCode(): Promise<Map<string, { name: string; net: number }>> {
  const grouped = await prisma.journalEntryLine.groupBy({
    by: ['accountId'],
    where: { journalEntry: { organizationId: ORG, status: 'POSTED', entryDate: { lte: ASOF } } },
    _sum: { debit: true, credit: true },
  });
  const accts = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true, name: true } });
  const acctById = new Map(accts.map((a) => [a.id, a]));
  const out = new Map<string, { name: string; net: number }>();
  for (const g of grouped) {
    const a = acctById.get(g.accountId);
    const code = a?.code ?? '(unknown)';
    const net = (g._sum.debit || 0) - (g._sum.credit || 0);
    const cur = out.get(code) || { name: a?.name || '', net: 0 };
    cur.net += net;
    out.set(code, cur);
  }
  return out;
}

// ------------------------------------------------------------------
// Xero invoice puller (summaryOnly, paginated) for AR/AP
// ------------------------------------------------------------------
async function pullXeroAmountDue(tokens: Awaited<ReturnType<typeof getXeroTokens>>, type: 'ACCREC' | 'ACCPAY') {
  let total = 0;
  let count = 0;
  const asofMs = ASOF.getTime();
  for (let page = 1; ; page++) {
    const res = await xeroGet<any>(tokens, '/Invoices', {
      where: `Type=="${type}"`,
      page,
      summaryOnly: 'true',
    });
    const invs: any[] = res.Invoices || [];
    if (invs.length === 0) break;
    for (const inv of invs) {
      // Drafts aren't AR/AP yet (Xero's own aged reports exclude them too).
      if (['VOIDED', 'DELETED', 'DRAFT', 'SUBMITTED'].includes(inv.Status)) continue;
      // Respect as-of: only count invoices dated on/before the cut-off.
      if (inv.DateString && new Date(inv.DateString).getTime() > asofMs) continue;
      const due = Number(inv.AmountDue) || 0;
      if (due <= 0.005) continue;
      total += due;
      count++;
    }
    if (invs.length < 100) break;
  }
  return { total: R(total), count };
}

// ------------------------------------------------------------------
// 2. ACCOUNTS RECEIVABLE
// ------------------------------------------------------------------
async function reconcileAR(tokens: Awaited<ReturnType<typeof getXeroTokens>>, aimsByCode: Map<string, { net: number }>) {
  console.log('\n' + '='.repeat(78));
  console.log('2. ACCOUNTS RECEIVABLE  (total outstanding)');
  console.log('='.repeat(78));

  const xero = await pullXeroAmountDue(tokens, 'ACCREC');

  const invoices = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE' },
    select: { config: true },
  });
  let aimsAR = 0;
  let aimsCount = 0;
  const asofMs = ASOF.getTime();
  for (const inv of invoices) {
    const c: any = inv.config || {};
    if (c.voided) continue;
    // Symmetric with the Xero side: drafts aren't AR yet.
    if (['DRAFT', 'SUBMITTED'].includes((c.xeroStatus || '').toUpperCase())) continue;
    // Same as-of cut as the Xero side (post-dated invoices excluded equally).
    if (c.date && new Date(c.date).getTime() > asofMs) continue;
    const owed = Number(c.xeroBalance ?? 0);
    if (owed <= 0.005) continue;
    aimsAR += owed;
    aimsCount++;
  }
  aimsAR = R(aimsAR);

  const controls = await getControlCodes();
  const glDebtor = R(aimsByCode.get(controls.debtor)?.net || 0);

  console.log(`  Xero  ACCREC AmountDue      : ${money(xero.total)}  (${xero.count} invoices)`);
  console.log(`  AIMS  Σ INVOICE.xeroBalance : ${money(aimsAR)}  (${aimsCount} invoices)`);
  console.log(`  Δ (Xero − AIMS)            : ${money(R(xero.total - aimsAR))}` + (Math.abs(xero.total - aimsAR) > TOL ? '  ✗' : '  ✓'));
  console.log(`  ─ internal: AIMS GL debtorControl (${controls.debtor}) balance = ${money(glDebtor)}` +
    (Math.abs(glDebtor - aimsAR) > TOL ? `  ✗ sub-ledger≠GL (Δ ${R(glDebtor - aimsAR)})` : '  ✓ ties to GL'));

  if (Math.abs(xero.total - aimsAR) > TOL) anyDrift = true;
}

// ------------------------------------------------------------------
// 3. ACCOUNTS PAYABLE
// ------------------------------------------------------------------
async function reconcileAP(tokens: Awaited<ReturnType<typeof getXeroTokens>>, aimsByCode: Map<string, { net: number }>) {
  console.log('\n' + '='.repeat(78));
  console.log('3. ACCOUNTS PAYABLE  (total outstanding)');
  console.log('='.repeat(78));

  const xero = await pullXeroAmountDue(tokens, 'ACCPAY');

  const bills = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'BILL' },
    select: { config: true, status: true },
  });
  let aimsAP = 0;
  let aimsCount = 0;
  const asofMs = ASOF.getTime();
  for (const b of bills) {
    const c: any = b.config || {};
    // Same as-of cut as the Xero side (post-dated bills excluded equally).
    const bdate = c.billDate || c.date;
    if (bdate && new Date(bdate).getTime() > asofMs) continue;
    // Mirror bills.service toBill(): AIMS-native bills carry billStatus;
    // Xero-imported ones derive status from xeroStatus and balance from
    // xeroBalance (AmountDue at import) / xeroGross.
    let billStatus = (c.billStatus || '').toUpperCase();
    if (!billStatus) {
      const xs = c.xeroStatus;
      if (xs === 'Paid' || xs === 'PAID') billStatus = 'PAID';
      else if (xs === 'Voided' || xs === 'VOIDED' || xs === 'Deleted' || xs === 'DELETED') billStatus = 'VOID';
      else if (xs === 'Draft' || xs === 'DRAFT') billStatus = 'DRAFT';
      else billStatus = 'POSTED';
    }
    if (!['POSTED', 'PAID'].includes(billStatus)) continue;
    const totalAmount = Number(c.totalAmount ?? c.xeroGross ?? 0);
    const amountPaid =
      c.amountPaid !== undefined
        ? Number(c.amountPaid)
        : c.xeroBalance !== undefined
          ? R(totalAmount - Number(c.xeroBalance))
          : Number(c.xeroAmountPaid ?? 0);
    const outstanding = R(totalAmount - amountPaid);
    if (outstanding <= 0.005) continue;
    aimsAP += outstanding;
    aimsCount++;
  }
  aimsAP = R(aimsAP);

  const controls = await getControlCodes();
  // creditorControl is a CREDIT-normal account: outstanding = credit − debit = −signed
  const glCreditor = R(-(aimsByCode.get(controls.creditor)?.net || 0));

  console.log(`  Xero  ACCPAY AmountDue        : ${money(xero.total)}  (${xero.count} bills)`);
  console.log(`  AIMS  Σ BILL (total − paid)   : ${money(aimsAP)}  (${aimsCount} bills)`);
  console.log(`  Δ (Xero − AIMS)              : ${money(R(xero.total - aimsAP))}` + (Math.abs(xero.total - aimsAP) > TOL ? '  ✗' : '  ✓'));
  console.log(`  ─ internal: AIMS GL creditorControl (${controls.creditor}) balance = ${money(glCreditor)}` +
    (Math.abs(glCreditor - aimsAP) > TOL ? `  ✗ sub-ledger≠GL (Δ ${R(glCreditor - aimsAP)})` : '  ✓ ties to GL'));

  if (Math.abs(xero.total - aimsAP) > TOL) anyDrift = true;
}

// resolve control-account codes from AccountingSetting (fallback to defaults)
let _controls: { debtor: string; creditor: string } | null = null;
async function getControlCodes() {
  if (_controls) return _controls;
  const setting = await prisma.accountingSetting.findUnique({ where: { organizationId: ORG }, select: { controlAccounts: true } });
  const ca: any = setting?.controlAccounts || {};
  _controls = { debtor: ca.debtorControl || 'CA001', creditor: ca.creditorControl || 'CL001' };
  return _controls;
}

async function main() {
  console.log(`Xero → AIMS reconciliation  |  org=${ORG}  |  as-of=${ASOF.toISOString().slice(0, 10)}  |  tol=$${TOL}`);
  const tokens = await getXeroTokens(prisma, ORG);
  console.log(`Connected to Xero tenant ${tokens.tenantId}`);

  let aimsByCode: Map<string, { name: string; net: number }>;
  if (args.includes('--skip-gl')) {
    // AR/AP-only iteration mode — skip the ~239-page Xero journal pull and
    // compute only the AIMS side (needed for the internal control tie-outs).
    console.log('  --skip-gl: GL diff skipped; computing AIMS balances only');
    aimsByCode = await aimsBalancesByCode();
  } else {
    ({ aimsByCode } = await reconcileGL(tokens));
  }
  await reconcileAR(tokens, aimsByCode);
  await reconcileAP(tokens, aimsByCode);

  console.log('\n' + '='.repeat(78));
  console.log(anyDrift ? '✗ RECONCILIATION FOUND DRIFT — see ✗ lines above.' : '✓ ALL RECONCILIATIONS WITHIN TOLERANCE.');
  console.log('='.repeat(78));
  process.exit(anyDrift ? 1 : 0);
}

main()
  .catch((e) => {
    console.error('FATAL', e?.message || e);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
