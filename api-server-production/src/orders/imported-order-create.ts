import { ConflictException } from '@nestjs/common';
import { grossOf } from '../common/document-money';
import { IMPORTED_ORDER_SOURCE, importedOrderNumber } from './imported-orders';
import { lockQuotation } from './wct-orders';

/** The marker's batch for orders made from an invoice / DO Reference (not by the import script). */
export const REFERENCE_LINK_BATCH = 'reference-link';

const isoDay = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/**
 * Round 40 (Elroy 2026-11-20): an old ERP quotation picked in an invoice / DO Reference that has no order yet gets
 * its imported order, made as scripts/wct-imported-orders.ts makes them: ORD-<quotation no.>, the import marker
 * (source erp-import, batch reference-link, no invoices yet, the 19 Nov billing rule), the quotation's customer, the
 * quotation date as the order date. The link then adds the document and the status is read from it. Under the
 * same per-quotation lock as the order flow; an order made at the same moment is returned instead.
 */
export async function ensureImportedQuotationOrder(
  prisma: any,
  organizationId: string,
  quotation: { id: string; name: string | null; config: any },
  customerId: string | null,
): Promise<{ orderId: string; orderNumber: string; created: boolean }> {
  const find = (db: any) => db.order.findFirst({ where: { organizationId, sourceQuotationId: quotation.id }, orderBy: { createdAt: 'asc' }, select: { id: true, orderNumber: true } });
  const found: any = await find(prisma);
  if (found) return { orderId: found.id, orderNumber: found.orderNumber, created: false };
  const qc: any = quotation.config || {};
  const orderNumber = importedOrderNumber(quotation.name || '');
  const now = new Date().toISOString();
  const day = isoDay(qc.date) ?? isoDay(qc.documentInfo?.date);
  const marker = {
    source: IMPORTED_ORDER_SOURCE,
    batch: REFERENCE_LINK_BATCH,
    quotationNo: quotation.name,
    linkSources: {},
    erpDoNumbers: [],
    subject: String(qc.subject ?? '').trim() || null,
    site: String(qc.erpImport?.clientSite ?? qc.location ?? '').trim() || null,
    total: 0,
    quoteTotal: grossOf(qc) ?? null,
    billed: 0,
    billedPct: 0,
    credits: {},
    partBilledRule: true,
    at: now,
  };
  const out: any = await prisma.$transaction(
    async (tx: any) => {
      await lockQuotation(tx, quotation.id);
      const again = await find(tx);
      if (again) return { ...again, created: false };
      const clash = await tx.order.findFirst({ where: { organizationId, orderNumber }, select: { id: true } });
      if (clash) throw new ConflictException(`${orderNumber} already exists for another quotation`);
      const row = await tx.order.create({
        data: {
          orderNumber,
          organizationId,
          customerId,
          sourceQuotationId: quotation.id,
          status: 'PART_BILLED',
          items: [],
          linkedDocuments: { po: [], do: [], salesOrder: [], invoice: [], creditNote: [], imported: marker },
          notes: `Imported from the old ERP: quotation ${quotation.name} (made when a document was linked to it)`,
          ...(day ? { createdAt: new Date(`${day}T01:00:00.000Z`) } : {}),
        },
        select: { id: true, orderNumber: true },
      });
      return { ...row, created: true };
    },
    { timeout: 30000 },
  );
  return { orderId: out.id, orderNumber: out.orderNumber, created: !!out.created };
}
