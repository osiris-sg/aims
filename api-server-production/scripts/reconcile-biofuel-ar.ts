/**
 * Reconcile Biofuel AR with the Xero invoice data that's already on each
 * invoice's config (xeroGross / xeroBalance / xeroStatus).
 *
 *  1. Document.status + config.amountPaid per invoice:
 *       paid = xeroGross - xeroBalance
 *       status = 'paid'  when xeroBalance <= 0, else 'pending_payment'
 *  2. Rebuild Transaction + CustomerBalance so the net outstanding per invoice =
 *     xeroBalance (the original backfill only credited FULLY-paid invoices, so
 *     partial payments were never applied — overstating AR).
 *
 * Idempotent. Does NOT touch the GL — this only fixes the AR sub-ledger so the
 * paid/unpaid display and aging match the real per-invoice balances (~$7.5M).
 * The separate ~$4.3M GL-vs-AR gap (stale/missing invoices) needs a fresh
 * Receivable Invoice re-import and is out of scope here.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const EPS = 0.005;

async function main() {
  const invoices = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', config: { path: ['xeroImported'], equals: true } },
    select: { id: true, name: true, status: true, createdAt: true, config: true },
  });
  console.log(`[Reconcile AR] ${invoices.length} Xero-imported invoices`);

  // ---- 1. Update Document.status + config.amountPaid ----
  let toPaid = 0, toOpen = 0, statusUnchanged = 0;
  for (const inv of invoices) {
    const c: any = inv.config || {};
    const gross = Number(c.xeroGross ?? c.totalAmount ?? 0);
    const balance = Number(c.xeroBalance ?? 0);
    if (gross <= 0) continue;
    const paid = Math.max(0, Math.round((gross - balance) * 100) / 100);
    const newStatus = balance <= EPS ? 'paid' : 'pending_payment';

    if (inv.status === newStatus && Math.abs(Number(c.amountPaid ?? -1) - paid) < EPS) {
      statusUnchanged++;
      continue;
    }
    await prisma.document.update({
      where: { id: inv.id },
      data: { status: newStatus, config: { ...c, amountPaid: paid } },
    });
    if (newStatus === 'paid') toPaid++; else toOpen++;
  }
  console.log(`[Reconcile AR] status → paid: ${toPaid}, → pending_payment: ${toOpen}, unchanged: ${statusUnchanged}`);

  // ---- 2. Rebuild Transactions + CustomerBalance (net = xeroBalance) ----
  const wiped = await prisma.transaction.deleteMany({
    where: { organizationId: ORG, description: { startsWith: '[xero] ' } },
  });
  console.log(`[Reconcile AR] wiped ${wiped.count} prior xero-sourced transactions`);

  type Row = { customerId: string; documentId: string; ref: string; date: Date; gross: number; balance: number };
  const rows: Row[] = [];
  for (const inv of invoices) {
    const c: any = inv.config || {};
    const customerId = c.customerId || c.customer?.id;
    if (!customerId) continue;
    const gross = Number(c.xeroGross ?? 0);
    const balance = Number(c.xeroBalance ?? 0);
    if (gross <= 0) continue;
    rows.push({ customerId, documentId: inv.id, ref: inv.name || '(no #)', date: c.date ? new Date(c.date) : inv.createdAt, gross, balance });
  }
  rows.sort((a, b) => (a.customerId !== b.customerId ? (a.customerId < b.customerId ? -1 : 1) : a.date.getTime() - b.date.getTime()));

  const txs: any[] = [];
  const running = new Map<string, number>();
  for (const r of rows) {
    const prev = running.get(r.customerId) || 0;
    const afterInv = Math.round((prev + r.gross) * 100) / 100;
    txs.push({ organizationId: ORG, customerId: r.customerId, transactionType: 'INVOICE', documentId: r.documentId, transactionDate: r.date, reference: r.ref, description: `[xero] Invoice ${r.ref}`.trim(), debit: r.gross, credit: 0, balance: afterInv });
    running.set(r.customerId, afterInv);

    const paid = Math.round((r.gross - r.balance) * 100) / 100;
    if (paid > EPS) {
      const afterPay = Math.round((afterInv - paid) * 100) / 100;
      txs.push({ organizationId: ORG, customerId: r.customerId, transactionType: 'PAYMENT', documentId: r.documentId, transactionDate: r.date, reference: r.ref, description: `[xero] Payment for ${r.ref}`, debit: 0, credit: paid, balance: afterPay });
      running.set(r.customerId, afterPay);
    }
  }
  console.log(`[Reconcile AR] prepared ${txs.length} transaction rows`);

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < txs.length; i += CHUNK) {
    const res = await prisma.transaction.createMany({ data: txs.slice(i, i + CHUNK) });
    inserted += res.count;
  }
  console.log(`[Reconcile AR] inserted ${inserted} transactions`);

  let balUpdated = 0;
  for (const [customerId, currentBalance] of running) {
    await prisma.customerBalance.upsert({
      where: { customerId_organizationId: { customerId, organizationId: ORG } },
      create: { customerId, organizationId: ORG, currentBalance, lastTransactionDate: new Date() },
      update: { currentBalance, lastTransactionDate: new Date() },
    });
    balUpdated++;
  }
  console.log(`[Reconcile AR] updated ${balUpdated} CustomerBalance rows`);

  const cb = await prisma.customerBalance.aggregate({ where: { organizationId: ORG }, _sum: { currentBalance: true } });
  console.log(`\n[Reconcile AR] ✓ done. CustomerBalance total outstanding: ${(cb._sum.currentBalance || 0).toFixed(2)}`);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
