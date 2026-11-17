/**
 * Cancel order with draft invoices (manual order flow, 2026-11-17): the draft
 * invoice is now made when the quotation is signed, so "has an invoice" no
 * longer means "has started". An order whose invoices are ALL drafts can be
 * cancelled; any sent / confirmed / paid / posted / imported one blocks it.
 * The drafts are VOIDED with the order (config.voided + cancelledWithOrder),
 * never deleted: the numbers stay as gaps and aims_doc_delete_guard is never
 * involved. A voided draft cannot be confirmed, sent, split or paid.
 */
import { amountPaidOf } from '../common/document-money';
import { isErpImported } from '../common/erp-import';

const DRAFT = ['draft', 'unconfirmed'];

/** The name of the first invoice that blocks the cancel, or null when every one is a clean draft. */
export async function cancelBlockingInvoice(prisma: any, organizationId: string, invoices: Array<{ id: string; name?: string | null; status: string; config: any }>): Promise<string | null> {
  const label = (d: any) => d?.name || 'an invoice';
  const bad = invoices.find((d) => !DRAFT.includes(String(d.status).toLowerCase()) || isErpImported(d.config) || !!d.config?.xeroInvoiceId || (amountPaidOf(d.config) ?? 0) > 0);
  if (bad) return label(bad);
  if (!invoices.length) return null;
  const ids = invoices.map((d) => d.id);
  const paid = await prisma.payment.findFirst({ where: { organizationId, documentId: { in: ids } }, select: { documentId: true } });
  if (paid) return label(invoices.find((d) => d.id === paid.documentId));
  const je = await prisma.journalEntry.findFirst({ where: { organizationId, sourceDocumentId: { in: ids }, status: { not: 'VOID' } }, select: { sourceDocumentId: true } });
  if (je) return label(invoices.find((d) => d.id === je.sourceDocumentId));
  return null;
}

/** A draft invoice voided with its cancelled order. */
export function voidedWithOrderConfig(config: any, orderNumber: string, at: string) {
  return { ...(config || {}), voided: true, cancelledWithOrder: true, cancelledAt: at, cancelledReason: `Order ${orderNumber} was cancelled` };
}

/** True for an invoice voided with its order (it cannot be confirmed, sent, split or paid). */
export const isVoidedWithOrder = (config: any): boolean => config?.cancelledWithOrder === true && config?.voided === true;
