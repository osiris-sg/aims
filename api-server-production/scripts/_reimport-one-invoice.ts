/** Targeted repair: re-import a single ACCREC invoice by number from Xero,
 *  restoring the full imported config (overwrites editor-clobbered state). */
import { Prisma } from '@prisma/client';
import { createScriptPrisma, BIOFUEL_ORG_ID, getXeroTokens, xeroGet } from './xero-migration/_common';
const prisma = createScriptPrisma();
const NUM = process.argv[2] || 'BI202607046';
const R = (n: number) => Math.round(n * 100) / 100;
function xd(s?: string): Date | null { const m = (s || '').match(/\((\d+)/); return m ? new Date(+m[1]) : s ? new Date(s) : null; }
async function main() {
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  const res = await xeroGet<any>(tokens, '/Invoices', { where: `InvoiceNumber=="${NUM}" && Type=="ACCREC"` });
  const inv = (res.Invoices || [])[0];
  if (!inv) throw new Error(`${NUM} not found in Xero`);
  const customers = await prisma.customer.findMany({ where: { organizationId: BIOFUEL_ORG_ID, xeroId: { not: null } }, select: { id: true, name: true, xeroId: true } });
  const cust = inv.Contact ? customers.find((c) => c.xeroId === inv.Contact.ContactID) : null;
  const date = xd(inv.Date || inv.DateString) || new Date();
  const dueDate = xd(inv.DueDate || inv.DueDateString);
  const items = (inv.LineItems || []).map((li: any, idx: number) => ({
    lineNumber: idx + 1, description: li.Description || '', quantity: li.Quantity ?? 1,
    unitPrice: li.UnitAmount ?? 0, amount: li.LineAmount ?? 0, taxAmount: li.TaxAmount ?? 0,
    accountCode: li.AccountCode || null, itemCode: li.ItemCode || null, taxType: li.TaxType || null, discount: li.DiscountRate ?? 0,
  }));
  const config = {
    date: date.toISOString(), dueDate: dueDate?.toISOString() || null,
    subTotal: inv.SubTotal ?? 0, gstAmount: inv.TotalTax ?? 0, nettTotal: inv.Total ?? 0, items,
    customer: cust ? { id: cust.id, name: cust.name } : { id: null, name: inv.Contact?.Name || '(unknown)' },
    customerId: cust?.id || null,
    xeroImported: true, xeroInvoiceId: inv.InvoiceID, xeroInvoiceNumber: NUM, xeroStatus: inv.Status,
    xeroReference: inv.Reference || null, xeroSubtotal: inv.SubTotal ?? 0, xeroTax: inv.TotalTax ?? 0,
    xeroGross: inv.Total ?? 0, xeroBalance: inv.AmountDue ?? 0, xeroAmountPaid: inv.AmountPaid ?? 0,
    documentInfo: { currency: inv.CurrencyCode || 'SGD', gstPercent: inv.SubTotal && inv.TotalTax ? Math.round((inv.TotalTax / inv.SubTotal) * 100) : 9 },
    xeroLastSyncAt: new Date().toISOString(),
  };
  const status = ['DRAFT', 'SUBMITTED'].includes(inv.Status) ? 'draft' : ['VOIDED', 'DELETED'].includes(inv.Status) ? 'draft' : (inv.AmountDue ?? 0) <= 0.005 ? 'paid' : 'pending_payment';
  const doc = await prisma.document.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, type: 'INVOICE', name: NUM }, select: { id: true } });
  if (!doc) throw new Error(`${NUM} not in AIMS`);
  await prisma.document.update({ where: { id: doc.id }, data: { status: status as any, createdAt: date, config: config as unknown as Prisma.InputJsonValue } });
  console.log(`✓ ${NUM} restored from Xero: gross=${R(inv.Total)} due=${R(inv.AmountDue)} status=${inv.Status}→${status}`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
