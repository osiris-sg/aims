/**
 * Pull each Xero ACCREC invoice's real AmountDue/AmountPaid and set the exact
 * balance + paid/unpaid status on the matching AIMS invoice, so AR ties to Xero.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { getXeroTokens, xeroGet } from './xero-migration/_common';
const prisma = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const R = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const tokens = await getXeroTokens(prisma, ORG);
  // 1) Pull all ACCREC invoice summaries (list endpoint carries AmountDue).
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const res = await xeroGet<any>(tokens, '/Invoices', { page, pageSize: 100, where: 'Type=="ACCREC"' });
    const invs = res.Invoices || [];
    all.push(...invs);
    process.stdout.write(`\r  pulled ${all.length}...`);
    if (invs.length < 100) break;
  }
  console.log(`\n  total ACCREC invoices from Xero: ${all.length}`);

  // 2) AIMS invoices by name.
  const aims = await prisma.document.findMany({ where: { organizationId: ORG, type: 'INVOICE' }, select: { id: true, name: true, config: true } });
  const byName = new Map(aims.map((d) => [d.name, d]));

  let matched = 0, notInAims = 0, arDue = 0;
  const statusN: Record<string, number> = {};
  for (const inv of all) {
    const number = (inv.InvoiceNumber || '').trim();
    const status = inv.Status;
    const due = Number(inv.AmountDue) || 0;
    const paidAmt = Number(inv.AmountPaid) || 0;
    const total = Number(inv.Total) || 0;
    const isVoid = status === 'VOIDED' || status === 'DELETED';
    if (!isVoid) arDue += due;
    statusN[status] = (statusN[status] || 0) + 1;

    const doc = byName.get(number);
    if (!doc) { notInAims++; continue; }
    const newStatus = isVoid ? 'draft' : due <= 0.005 ? 'paid' : 'pending_payment';
    const config = { ...((doc.config as any) || {}), xeroInvoiceId: inv.InvoiceID, xeroStatus: status, xeroGross: R(total), xeroBalance: R(due), xeroAmountPaid: R(paidAmt), voided: isVoid, paymentStatus: newStatus, paymentStatusSource: 'xero-api-amountdue', xeroLastSyncAt: new Date().toISOString() };
    await prisma.document.update({ where: { id: doc.id }, data: { status: newStatus as any, config: config as Prisma.InputJsonValue } });
    matched++;
  }
  console.log(`\n  updated ${matched} AIMS invoices; ${notInAims} Xero invoices not in AIMS`);
  console.log('  Xero status counts:', statusN);
  console.log(`\n  AR = sum(AmountDue) non-void = ${R(arDue).toFixed(2)}   (Xero TB 610 = 10,988,868.47)`);

  // Cross-check: AR computed from AIMS after update
  const unpaid = await prisma.document.findMany({ where: { organizationId: ORG, type: 'INVOICE', status: 'pending_payment' }, select: { config: true } });
  let aimsAr = 0;
  for (const d of unpaid) aimsAr += Number((d.config as any)?.xeroBalance || 0);
  console.log(`  AIMS AR (sum of pending-invoice balances) = ${R(aimsAr).toFixed(2)}`);
}
main().catch((e) => console.log('ERR', e.message?.slice(0, 200))).finally(() => prisma.$disconnect());
