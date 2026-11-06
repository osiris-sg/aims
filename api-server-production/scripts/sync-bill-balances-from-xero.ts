/**
 * Re-stamp AIMS bill balances from Xero's AmountDue.
 * (guru 2026-11-06: "so many JP pass bills unpaid, but on xero all JP pass
 *  bills are paid".)
 *
 * READ-ONLY by default. Nothing is written without --apply.
 *
 * WHY THEY DRIFT: a bill's paid/outstanding stamp is written at import time.
 * Payments applied in Xero AFTERWARDS never reach AIMS — XeroSyncService
 * pulls bill PAYMENTS only for bills it can match, and nothing re-reads
 * AmountDue on the bill itself. So a bill paid in Xero after its import sits
 * in AIMS as pending_payment forever and inflates the creditor's balance.
 *
 * WHAT IT DOES NOT DO: post anything. The GL already holds Xero's payment
 * journals from the import, so posting again would double every payment —
 * which `aims_je_guard` exists to block. It also creates no Payment rows:
 * the balance comes straight from Xero, and a Payment row would subtract the
 * same money a second time. This re-stamps the document only.
 *
 * Usage (prod):
 *   ./node_modules/.bin/dotenv -e .env.production -- \
 *     npx ts-node --transpile-only scripts/sync-bill-balances-from-xero.ts
 *
 *   --supplier=Jurong    only suppliers whose name contains this
 *   --fix-status         instead of balances, correct bills stamped
 *                        billStatus=DRAFT that Xero has AUTHORISED or PAID.
 *                        A DRAFT bill is hidden from the Payment Voucher's
 *                        offset grid, so its money cannot be allocated.
 *   --credit-notes       do the SUPPLIER CREDIT NOTES instead of the bills
 *                        (Xero's RemainingCredit is the unused credit)
 *   --show=40            rows to list (default 20)
 *   --apply              write the stamps
 */
import { createScriptPrisma, getXeroTokens, xeroGet, BIOFUEL_ORG_ID } from './xero-migration/_common';
import { owedOf, grossOf, stampDocumentMoney } from '../src/common/document-money';

const prisma = createScriptPrisma();
const arg = (k: string, d = '') => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const ORG = arg('org', BIOFUEL_ORG_ID);
const SUPPLIER = arg('supplier', '');
const SHOW = parseInt(arg('show', '20'), 10);
/** Supplier credit notes rather than bills. Their stamp drifts the same way:
 *  AIMS shows every note fully unused while Xero has long since applied it. */
const CREDIT_NOTES = process.argv.includes('--credit-notes');
const FIX_STATUS = process.argv.includes('--fix-status');
const APPLY = process.argv.includes('--apply');
const m = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Xero's InvoiceNumber often carries a note after a separator. */
const head = (s: string) => String(s || '').trim().split(/\s*[·|(]\s*/)[0].trim().toUpperCase();

(async () => {
  const bills = await prisma.document.findMany({
    where: { organizationId: ORG, type: CREDIT_NOTES ? 'CREDIT_NOTE' : 'BILL' },
    select: { id: true, name: true, status: true, config: true },
  });
  // A bill identifies its supplier by config.supplierId; supplierName is not
  // always stamped, so resolve the name to ids first and accept either.
  let scoped = bills;
  if (SUPPLIER) {
    const sups = await prisma.supplier.findMany({
      where: { organizationId: ORG, name: { contains: SUPPLIER, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (!sups.length) throw new Error(`no supplier matching "${SUPPLIER}"`);
    console.log(`Supplier filter: ${sups.map((x) => x.name).join(', ')}`);
    const ids = new Set(sups.map((x) => x.id));
    const re = new RegExp(SUPPLIER, 'i');
    scoped = bills.filter((b) => {
      const c: any = b.config || {};
      return ids.has(String(c.supplierId)) || re.test(String(c.supplierName ?? ''));
    });
  }
  // A customer credit note has no supplierId — only the AP side is in scope.
  if (CREDIT_NOTES) scoped = scoped.filter((b) => (b.config as any)?.supplierId);
  const what = CREDIT_NOTES ? 'supplier credit notes' : 'bills';
  console.log(`AIMS ${what}${SUPPLIER ? ` for suppliers matching /${SUPPLIER}/i` : ''}: ${scoped.length}`);

  // ---- --fix-status: unhide bills the grid refuses to show ------------
  // PaymentVouchersService.openBills drops any bill with billStatus DRAFT.
  // Bills imported while still draft in Xero, and later authorised there,
  // keep the stale DRAFT here — so their money never reaches the offset grid
  // and cannot be paid off (guru 2026-11-06, Jurong Port: 67 bills, 86,839.02).
  if (FIX_STATUS) {
    const rows = scoped
      .map((b) => ({ b, c: b.config as any }))
      .filter(({ c }) => String(c?.billStatus ?? '').toUpperCase() === 'DRAFT')
      .map(({ b, c }) => ({ b, c, xs: String(c?.xeroStatus ?? '').toUpperCase() }))
      .filter(({ xs }) => xs === 'AUTHORISED' || xs === 'PAID');
    console.log(`\nStamped DRAFT in AIMS but live in Xero: ${rows.length}`);
    console.log(`  ${'Bill'.padEnd(18)}${'Xero'.padEnd(12)}${'owed'.padStart(14)}   billStatus →`);
    let owed = 0;
    for (const { b, c, xs } of rows) {
      owed += owedOf(c);
      if (rows.indexOf(rows.find((r) => r.b.id === b.id)!) < SHOW)
        console.log(`  ${String(b.name).padEnd(18)}${xs.padEnd(12)}${m(owedOf(c)).padStart(14)}   DRAFT → ${xs === 'PAID' ? 'PAID' : 'POSTED'}`);
    }
    if (rows.length > SHOW) console.log(`  … and ${rows.length - SHOW} more`);
    console.log(`  total hidden from the offset grid: ${m(owed)}`);
    if (!rows.length) { await prisma.$disconnect(); return; }
    if (!APPLY) {
      console.log('\nDRY RUN — re-run with --apply. This only corrects billStatus; no money moves.\n');
      await prisma.$disconnect();
      return;
    }
    let n = 0;
    for (const { b, c, xs } of rows) {
      await prisma.document.update({
        where: { id: b.id },
        data: { config: { ...c, billStatus: xs === 'PAID' ? 'PAID' : 'POSTED', billStatusSource: 'xero-sync' } },
      });
      n++;
    }
    console.log(`\n  ${n} bill(s) un-drafted.\n`);
    await prisma.$disconnect();
    return;
  }

  const tokens = await getXeroTokens(prisma, ORG);
  const xb: any[] = [];
  for (let page = 1; ; page++) {
    const j: any = CREDIT_NOTES
      ? await xeroGet(tokens, '/CreditNotes', { page, where: 'Type=="ACCPAYCREDIT"' })
      : await xeroGet(tokens, '/Invoices', { page, where: 'Type=="ACCPAY"', summaryOnly: 'true' });
    const list = (CREDIT_NOTES ? j?.CreditNotes : j?.Invoices) || [];
    xb.push(...list);
    process.stdout.write(`\r  Xero ${what} page ${page}: ${xb.length}   `);
    if (list.length < 100) break;
  }
  console.log('\n');
  // A credit note's "still owed" is Xero's RemainingCredit — what is left to
  // apply — which is the same idea as a bill's AmountDue.
  const dueOf = (x: any) => Number((CREDIT_NOTES ? x.RemainingCredit : x.AmountDue) ?? 0);
  const idOf = (x: any) => String(CREDIT_NOTES ? x.CreditNoteID : x.InvoiceID);
  const numOf = (x: any) => head(CREDIT_NOTES ? x.CreditNoteNumber : x.InvoiceNumber);
  const xById = new Map(xb.map((b) => [idOf(b), b]));
  const xByNum = new Map(xb.map((b) => [numOf(b), b]));

  type Fix = { id: string; name: string; gross: number; owed: number; due: number; status: string; xStatus: string };
  const fixes: Fix[] = [];
  let unmatched = 0;
  for (const b of scoped) {
    const c: any = b.config || {};
    if (c.voided) continue;
    const x =
      xById.get(String(c.xeroCreditNoteId || c.xeroBillId || c.xeroInvoiceId || '')) || xByNum.get(head(b.name || ''));
    if (!x) { unmatched++; continue; }
    if (String(x.Status) === 'DELETED' || String(x.Status) === 'VOIDED') continue;
    const owed = owedOf(c);
    const due = dueOf(x);
    if (Math.abs(owed - due) < 0.01) continue;
    fixes.push({ id: b.id, name: b.name || '', gross: grossOf(c) ?? Number(x.Total || 0), owed, due, status: b.status, xStatus: String(x.Status) });
  }

  const drift = fixes.reduce((s, f) => s + (f.owed - f.due), 0);
  console.log(`Balance disagrees with Xero on ${fixes.length} bill(s); AIMS is out by ${m(drift)}`);
  console.log(`  (not matched to any Xero bill, left alone: ${unmatched})\n`);
  const owedLabel = CREDIT_NOTES ? 'AIMS unused' : 'AIMS owed';
  const dueLabel = CREDIT_NOTES ? 'Xero left' : 'Xero due';
  console.log(`  ${'Document'.padEnd(16)}${'AIMS status'.padEnd(18)}${'gross'.padStart(12)}${owedLabel.padStart(12)}${dueLabel.padStart(12)}  Xero`);
  for (const f of fixes.slice(0, SHOW))
    console.log(`  ${f.name.padEnd(16)}${f.status.padEnd(18)}${m(f.gross).padStart(12)}${m(f.owed).padStart(12)}${m(f.due).padStart(12)}  ${f.xStatus}`);
  if (fixes.length > SHOW) console.log(`  … and ${fixes.length - SHOW} more`);

  if (!fixes.length) { await prisma.$disconnect(); return; }
  if (!APPLY) {
    console.log(`\nDRY RUN — re-run with --apply to re-stamp these ${fixes.length} bill(s).`);
    console.log('No journal is posted and no Payment row is created: the GL already holds');
    console.log("Xero's payment journals, so posting again would double every payment.\n");
    await prisma.$disconnect();
    return;
  }

  console.log(`\n*** APPLY *** re-stamping ${fixes.length} bill(s) from Xero…`);
  let done = 0;
  for (const f of fixes) {
    const cur = await prisma.document.findUnique({ where: { id: f.id }, select: { config: true } });
    const next = stampDocumentMoney(cur?.config as any, { outstanding: f.due, paid: Math.max(0, f.gross - f.due), gross: f.gross });
    next.balanceSource = 'xero-sync';
    next.balanceSyncedAt = new Date().toISOString();
    // Settled in Xero → settled here. A part-payment stays pending_payment.
    // A fully applied credit note is spent, not "paid" — but the document
    // status vocabulary has no better word, and `paid` is what the AP reports
    // read as settled. A bill behaves the same way.
    const status = f.due < 0.01 ? 'paid' : 'pending_payment';
    await prisma.document.update({ where: { id: f.id }, data: { config: next, status: status as any } });
    done++;
    if (done % 25 === 0) process.stdout.write(`\r  ${done}/${fixes.length}   `);
  }
  console.log(`\n  ${done} bill(s) re-stamped.\n`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await prisma.$disconnect().catch(() => {}); process.exit(1); });
