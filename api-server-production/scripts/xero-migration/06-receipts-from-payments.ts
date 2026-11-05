/**
 * BACKFILL OFFICIAL RECEIPTS FROM XERO PAYMENTS (guru 2026-11-05).
 *
 * The Receipts Listing was empty for Biofuel although "everything" had been
 * synced. Nothing was broken: a Xero PAYMENT is not a document in Xero — it is
 * an attribute of the invoice plus a ledger entry — so the migration recorded
 * the money (AmountPaid on the invoice, the payment journal in the GL) but
 * never minted an AIMS receipt to stand for it. This writes those receipts.
 *
 * ── THE GL IS DELIBERATELY NOT TOUCHED ─────────────────────────────────────
 * Saving a receipt through ReceiptsService.save() posts Dr Bank / Cr Trade
 * Receivables. The GL sync has ALREADY imported exactly those journals from
 * Xero. Posting again would double every payment in the ledger — and
 * aims_je_guard exists to stop precisely that. So this writes the Document row
 * directly and does NOT:
 *     • post or hold any journal,
 *     • create Payment rows (invoice balances are already stamped from Xero —
 *       xeroBalance / xeroAmountPaid — and AR reads those; adding Payment rows
 *       would subtract the same money twice),
 *     • change any invoice's status.
 * Each receipt carries glSource:'xero-import' so it is obvious that its ledger
 * entry lives elsewhere and must not be reposted.
 *
 * NUMBERING. Imported receipts take their own series, ORX-YYYYMM-### in
 * payment-date order, never the org's OR-###### run. They are history, not
 * receipts this office issued, and mixing them would consume numbers that
 * AIMS's own counter believes are free.
 *
 * IDEMPOTENT. A payment whose receipt already exists (matched on
 * config.xeroPaymentId) is skipped, so a second run after new payments adds
 * only the new ones.
 *
 * SKIPPED, and counted in the summary: supplier payments (ACCPAYPAYMENT — a
 * payment voucher, not a receipt), DELETED payments, prepayments and
 * overpayments with no invoice behind them, and payments whose invoice is not
 * in AIMS.
 *
 * DRY RUN by default. Nothing is written without --apply.
 *
 *   npx ts-node --transpile-only scripts/xero-migration/06-receipts-from-payments.ts            # dry run
 *   npx ts-node --transpile-only scripts/xero-migration/06-receipts-from-payments.ts --apply
 *   …--from=2026-01-01   limit to payments on/after a date
 *   …--limit=25          stop after N receipts (a small first batch to eyeball)
 *   …--no-xero           report only what AIMS already holds and stop, without
 *                        spending a single Xero request (useful while Xero's
 *                        daily rate limit is exhausted)
 */
import { createScriptPrisma, getXeroTokens, xeroGet, withDbRetry, BIOFUEL_ORG_ID } from './_common';

const prisma = createScriptPrisma();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d);
const APPLY = process.argv.includes('--apply');
const ORG = arg('org', BIOFUEL_ORG_ID);
const FROM = arg('from') ? new Date(`${arg('from')}T00:00:00Z`) : null;
const LIMIT = Number(arg('limit', '0')) || 0;

const R = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const m = (n: number) => R(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Xero dates arrive as "/Date(1699999999999+0000)/" or ISO. */
const xdate = (s: any): Date => {
  const hit = /\/Date\((\d+)/.exec(String(s ?? ''));
  return hit ? new Date(Number(hit[1])) : new Date(String(s ?? ''));
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

(async () => {
  // Organization lives in the "platform" schema under per-org tenancy and in
  // the connection's own schema on prod, and this only needs it for a heading —
  // so never let the heading be the reason the run fails.
  let orgName = ORG;
  for (const read of [
    () => prisma.organization.findUnique({ where: { id: ORG }, select: { name: true } }),
    () => prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT name FROM platform."Organization" WHERE id = $1`, ORG).then((r) => r[0]),
  ]) {
    try { const hit: any = await read(); if (hit?.name) { orgName = hit.name; break; } } catch { /* try the next */ }
  }
  console.log(`\nReceipts from Xero payments — ${orgName}   ${APPLY ? '*** APPLY ***' : 'DRY RUN'}`);

  // ── what AIMS already has ────────────────────────────────────────────────
  const invoices = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE' },
    select: { id: true, name: true, config: true },
  });
  const invByXeroId = new Map<string, { id: string; name: string; customerId: string | null; customerName: string | null }>();
  for (const d of invoices) {
    const c: any = d.config || {};
    if (c.xeroInvoiceId) invByXeroId.set(String(c.xeroInvoiceId), {
      id: d.id, name: d.name,
      customerId: c.customerId ?? c.customer?.id ?? null,
      customerName: c.customer?.name ?? null,
    });
  }

  const existing = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'OFFICIAL_RECEIPT' },
    select: { name: true, config: true },
  });
  const done = new Set<string>();
  const takenNames = new Set<string>();
  for (const d of existing) {
    takenNames.add(d.name);
    const pid = (d.config as any)?.xeroPaymentId;
    if (pid) done.add(String(pid));
  }
  console.log(`  invoices with a Xero id: ${invByXeroId.size}   receipts already imported: ${done.size}`);

  const setting = await prisma.accountingSetting.findUnique({
    where: { organizationId: ORG }, select: { controlAccounts: true, baseCurrency: true },
  });
  const debtorControl = ((setting?.controlAccounts as any) || {}).debtorControl || 'CA001';
  const baseCurrency = setting?.baseCurrency || 'SGD';

  const bankAccounts = await prisma.chartOfAccount.findMany({
    where: { organizationId: ORG }, select: { code: true, name: true },
  });
  const knownCodes = new Set(bankAccounts.map((a) => a.code));

  if (process.argv.includes('--no-xero')) {
    console.log(`  --no-xero: stopping before any Xero request.\n`);
    await prisma.$disconnect();
    return;
  }

  // ── Xero payments ────────────────────────────────────────────────────────
  const tokens = await getXeroTokens(prisma, ORG);
  const payments: any[] = [];
  for (let page = 1; page <= 200; page++) {
    const r: any = await xeroGet(tokens, '/Payments', { page });
    const batch = r.Payments || [];
    payments.push(...batch);
    process.stdout.write(`\r  pulled ${payments.length} payments...`);
    if (batch.length < 100) break;
  }
  console.log(`\n  total payments in Xero: ${payments.length}`);

  // ── classify ─────────────────────────────────────────────────────────────
  const skip = { supplier: 0, deleted: 0, noInvoice: 0, invoiceNotInAims: 0, beforeFrom: 0, already: 0, noCustomer: 0, zero: 0 };
  type Plan = { pay: any; date: Date; amount: number; inv: { id: string; name: string; customerId: string | null; customerName: string | null }; bankCode: string | null; currency: string; rate: number };
  const plans: Plan[] = [];

  for (const p of payments) {
    if (String(p.Status).toUpperCase() === 'DELETED') { skip.deleted++; continue; }
    if (!String(p.PaymentType || '').includes('ACCRECPAYMENT')) { skip.supplier++; continue; }
    const pid = String(p.PaymentID);
    if (done.has(pid)) { skip.already++; continue; }
    const xeroInvoiceId = p.Invoice?.InvoiceID ? String(p.Invoice.InvoiceID) : null;
    if (!xeroInvoiceId) { skip.noInvoice++; continue; }     // prepayment / overpayment
    const inv = invByXeroId.get(xeroInvoiceId);
    if (!inv) { skip.invoiceNotInAims++; continue; }
    if (!inv.customerId) { skip.noCustomer++; continue; }
    const date = xdate(p.DateString || p.Date);
    if (isNaN(+date)) { skip.noInvoice++; continue; }
    if (FROM && date < FROM) { skip.beforeFrom++; continue; }
    const amount = R(p.Amount);
    if (amount <= 0) { skip.zero++; continue; }

    const code = p.Account?.Code ? String(p.Account.Code) : null;
    plans.push({
      pay: p, date, amount, inv,
      bankCode: code && knownCodes.has(code) ? code : null,
      currency: String(p.CurrencyCode || baseCurrency).toUpperCase(),
      rate: Number(p.CurrencyRate) || 1,
    });
  }

  plans.sort((a, b) => +a.date - +b.date || String(a.pay.PaymentID).localeCompare(String(b.pay.PaymentID)));
  const chosen = LIMIT ? plans.slice(0, LIMIT) : plans;

  // ── numbering: ORX-YYYYMM-### in date order, never the org's OR- series ──
  const seqByMonth = new Map<string, number>();
  for (const n of takenNames) {
    const hit = /^ORX-(\d{6})-(\d+)$/.exec(n);
    if (hit) seqByMonth.set(hit[1], Math.max(seqByMonth.get(hit[1]) || 0, parseInt(hit[2], 10)));
  }
  const nameFor = (d: Date) => {
    const key = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    let n = (seqByMonth.get(key) || 0) + 1;
    let name = `ORX-${key}-${String(n).padStart(3, '0')}`;
    while (takenNames.has(name)) { n++; name = `ORX-${key}-${String(n).padStart(3, '0')}`; }
    seqByMonth.set(key, n);
    takenNames.add(name);
    return name;
  };

  // ── report ───────────────────────────────────────────────────────────────
  const byBank = new Map<string, { n: number; amt: number }>();
  let total = 0, noBank = 0;
  for (const p of chosen) {
    total = R(total + p.amount * (p.rate || 1));
    const key = p.bankCode ?? '(bank not in chart)';
    if (!p.bankCode) noBank++;
    const e = byBank.get(key) || { n: 0, amt: 0 };
    e.n++; e.amt = R(e.amt + p.amount * (p.rate || 1));
    byBank.set(key, e);
  }
  const bankName = new Map(bankAccounts.map((a) => [a.code, a.name]));

  console.log(`\n  TO CREATE: ${chosen.length} receipt(s)${LIMIT && plans.length > LIMIT ? ` of ${plans.length} (--limit)` : ''}   ${m(total)}`);
  if (chosen.length) console.log(`  dates ${ymd(chosen[0].date)} → ${ymd(chosen[chosen.length - 1].date)}`);
  console.log(`\n  by deposit-to bank:`);
  for (const [code, e] of [...byBank.entries()].sort((a, b) => b[1].amt - a[1].amt))
    console.log(`    ${code.padEnd(26)} ${String(bankName.get(code) ?? '').slice(0, 30).padEnd(32)} ${String(e.n).padStart(5)}  ${m(e.amt).padStart(14)}`);
  if (noBank) console.log(`    ⚠ ${noBank} payment(s) name a Xero account that is not in the AIMS chart — their receipt is written with no deposit-to bank and lands under "(no bank)" in the listing.`);

  console.log(`\n  skipped:`);
  console.log(`    supplier payments (payment vouchers, not receipts) : ${skip.supplier}`);
  console.log(`    deleted in Xero                                    : ${skip.deleted}`);
  console.log(`    prepayment / overpayment with no invoice           : ${skip.noInvoice}`);
  console.log(`    invoice not in AIMS                                : ${skip.invoiceNotInAims}`);
  console.log(`    invoice has no customer                            : ${skip.noCustomer}`);
  console.log(`    already imported                                   : ${skip.already}`);
  if (skip.beforeFrom) console.log(`    before --from                                      : ${skip.beforeFrom}`);
  if (skip.zero) console.log(`    zero or negative amount                            : ${skip.zero}`);

  console.log(`\n  first 10:`);
  for (const p of chosen.slice(0, 10))
    console.log(`    ${ymd(p.date)}  ${String(p.inv.customerName ?? '').slice(0, 28).padEnd(30)} ${m(p.amount).padStart(12)} ${p.currency}  → ${p.inv.name}`);

  if (!APPLY) { console.log(`\n  DRY RUN — nothing written. Re-run with --apply.\n`); await prisma.$disconnect(); return; }

  // ── write ────────────────────────────────────────────────────────────────
  let templateId = (await prisma.documentTemplate.findFirst({
    where: { organizationId: ORG, type: 'OFFICIAL_RECEIPT' }, select: { id: true },
  }))?.id;
  if (!templateId) {
    templateId = (await prisma.documentTemplate.create({
      data: { organizationId: ORG, type: 'OFFICIAL_RECEIPT', name: 'Official Receipt', config: {} } as any,
      select: { id: true },
    })).id;
  }

  let made = 0, failed = 0;
  for (const p of chosen) {
    const name = nameFor(p.date);
    try {
      await withDbRetry(() => prisma.document.create({
        data: {
          organizationId: ORG,
          documentTemplateId: templateId!,
          type: 'OFFICIAL_RECEIPT',
          name,
          status: 'confirmed',
          config: {
            date: ymd(p.date),
            chequeNo: p.pay.Reference ? String(p.pay.Reference).slice(0, 60) : null,
            remarks: `Imported from Xero — payment against ${p.inv.name}`,
            customerId: p.inv.customerId,
            customerName: p.inv.customerName,
            creditAccountCode: debtorControl,
            debitAccountCode: p.bankCode,
            currency: p.currency,
            rate: p.rate,
            receiptAmount: p.amount,
            paymentMethod: 'transfer',
            allocations: [{ documentId: p.inv.id, amount: p.amount }],
            // Provenance. glSource says the ledger entry for this receipt was
            // imported from Xero and lives in its own journal — nothing here
            // should ever be posted again.
            xeroImported: true,
            xeroPaymentId: String(p.pay.PaymentID),
            xeroInvoiceId: String(p.pay.Invoice?.InvoiceID ?? ''),
            glSource: 'xero-import',
            importedAt: new Date().toISOString(),
          } as any,
        },
      }), `receipt ${name}`);
      made++;
      if (made % 100 === 0) process.stdout.write(`\r  created ${made}/${chosen.length}...`);
    } catch (e: any) {
      failed++;
      console.warn(`\n  ⚠ ${name} (${p.inv.name}): ${String(e?.message).slice(0, 140)}`);
    }
  }
  console.log(`\n  ✔ created ${made} receipt(s)${failed ? `, ${failed} failed` : ''}. No journals posted, no invoice statuses changed.\n`);
  await prisma.$disconnect();
})().catch((e) => { console.error('❌', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
