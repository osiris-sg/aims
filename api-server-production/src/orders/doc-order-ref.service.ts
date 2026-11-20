import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { grossOf } from '../common/document-money';
import { isErpImported } from '../common/erp-import';
import { ensureQuotationOrder } from '../deliveries/quotation-to-delivery';
import { quotationCustomerNameOf, quotationSubjectOf } from '../deliveries/quick-job-quotation';
import { DOC_TYPES_FOR, docCustomerIdOf, holderRefusal, linkEntryOf, madeOnOrder, orderHoldersOf } from './imported-order-links';
import { IMPORTED_QUOTATION_NO_ORDER, importedMarkerOf, isCountedInvoice, isImportedOrder, isImportedOrdersEnabled } from './imported-orders';
import { isManualOrderFlow } from './manual-order-flow';
import { OrdersService } from './orders.service';
import { isWctOrdersEnabled, orderInvoiceIdsOf } from './wct-orders';
import { fillLinesOf, isAcceptedQuotation, isDraftDoc, isOpenRefOption, orderRefLabel, refBilledPct, refDocKind } from './doc-order-ref';
import { quotationStatusLabel } from './quotation-status-label';

const QUOTE_TYPES = DOC_TYPES_FOR.QUOTATION;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null);
const like = (q: unknown): string | null => {
  const t = String(q ?? '').trim().slice(0, 60);
  return t ? `%${t.replace(/[\\%_]/g, (ch) => '\\' + ch)}%` : null;
};
const NATIVE_INVOICE_MANUAL_ONLY = "This company's orders do not take linked invoices";

type Actor = { id?: string | null; name?: string | null };

/**
 * Reference = order link (round 39, WCT group; pure rules in doc-order-ref.ts). The invoice / DO editor's Reference
 * combobox: search the customer's quotations (with their order and Billed %), link a document to a quotation's order
 * (the order is made when missing, ensureQuotationOrder), read the link back for the chip, unlink it, and the lines
 * still to bill for "Fill remaining lines". Linking goes through OrdersService.linkImportedDocument, so its rules hold:
 * one document = one order, same customer, the order's status recomputed. A confirmed document is only linked: its
 * content, number, money and GL never change here; a draft also gets the Reference text (and the customer when it
 * has none), written without bumping its version so the open editor keeps saving.
 */
@Injectable()
export class DocOrderRefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  private async assertOn(organizationId: string) {
    if (!(await isWctOrdersEnabled(this.prisma as any, organizationId))) throw new NotFoundException('Not available for this company');
  }

  private async loadDoc(organizationId: string, documentId: unknown) {
    const id = uuidOf(documentId);
    const doc: any = id ? await this.prisma.document.findFirst({ where: { id, organizationId }, select: { id: true, name: true, type: true, status: true, config: true } }) : null;
    if (!doc) throw new NotFoundException('Document not found');
    const kind = refDocKind(doc.type);
    if (!kind) throw new BadRequestException('Only an invoice or a DO takes an order reference');
    return { doc, kind };
  }

  /** GET /order-refs/options?q=&customerId=&all=1: the customer's quotations, newest first (default: accepted and not fully billed). */
  async options(organizationId: string, query: { q?: string; customerId?: string; all?: string | boolean }) {
    await this.assertOn(organizationId);
    const customerId = uuidOf(query?.customerId);
    const term = like(query?.q);
    const all = query?.all === true || query?.all === '1' || query?.all === 'true';
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT d.id, d.name, d.type, d.status::text AS status, d."createdAt",
             (d.config - 'items' - 'lines' - 'logo' - 'stamp' - 'signature' - 'signatures' - 'email' - 'termsAndConditions' - 'agreementText' - 'extraction') AS config,
             cu.name AS "customerName"
      FROM "Document" d
      LEFT JOIN "Customer" cu ON cu.id::text = COALESCE(NULLIF(d.config #>> '{customer,id}', ''), NULLIF(d.config ->> 'customerId', '')) AND cu."organizationId" = d."organizationId"
      WHERE d."organizationId" = ${organizationId}
        AND d.type IN ('QUOTATION', 'QO', 'QO1', 'QO2', 'QT')
        AND COALESCE(d.config ->> 'cancelled', 'false') <> 'true'
        AND COALESCE(d.config ->> 'voided', 'false') <> 'true'
        AND (${customerId}::text IS NULL OR COALESCE(NULLIF(d.config #>> '{customer,id}', ''), NULLIF(d.config ->> 'customerId', '')) = ${customerId}::text)
        AND (
          ${term}::text IS NULL
          OR d.name ILIKE ${term} ESCAPE '\\'
          OR d.config ->> 'subject' ILIKE ${term} ESCAPE '\\'
          OR d.config #>> '{documentInfo,subject}' ILIKE ${term} ESCAPE '\\'
          OR cu.name ILIKE ${term} ESCAPE '\\'
        )
      ORDER BY d."createdAt" DESC, d.id DESC
      LIMIT 80`;
    if (!rows.length) return [];
    const orders: any[] = await this.prisma.order.findMany({
      where: { organizationId, sourceQuotationId: { in: rows.map((r) => r.id) } },
      select: { id: true, orderNumber: true, status: true, sourceQuotationId: true, invoiceDocumentId: true, linkedDocuments: true },
      orderBy: { createdAt: 'asc' },
    });
    const orderOf = new Map<string, any>();
    for (const o of orders) if (!orderOf.has(o.sourceQuotationId)) orderOf.set(o.sourceQuotationId, o);
    const billed = await this.billedByOrder(organizationId, [...orderOf.values()]);
    const importedOn = await isImportedOrdersEnabled(this.prisma as any, organizationId);
    const out = rows.map((r) => {
      const o = orderOf.get(r.id) ?? null;
      const total = grossOf(r.config);
      const m: any = o ? importedMarkerOf(o) : null;
      const billedPct = o ? (m && typeof m.billedPct === 'number' ? m.billedPct : refBilledPct(billed.get(o.id) ?? 0, m?.quoteTotal ?? total)) : 0;
      const accepted = isAcceptedQuotation(r);
      const noOrderPossible = !o && importedOn && isErpImported(r.config);
      return {
        quotationId: r.id as string,
        quotationName: (r.name ?? null) as string | null,
        subject: quotationSubjectOf(r.config),
        total,
        billedPct,
        customerId: docCustomerIdOf(r.config),
        customerName: r.customerName || quotationCustomerNameOf(r.config),
        orderId: o?.id ?? null,
        orderNumber: o?.orderNumber ?? null,
        statusLabel: quotationStatusLabel(r),
        open: isOpenRefOption({ accepted, billedPct, orderCancelled: o?.status === 'CANCELLED', noOrderPossible }),
        linkable: !noOrderPossible && o?.status !== 'CANCELLED',
      };
    });
    return (all ? out : out.filter((x) => x.open)).slice(0, 30);
  }

  /** What each order's counted invoices bill (gross): its own and linked invoices, and the ones its jobs / DOs name. */
  private async billedByOrder(organizationId: string, orders: any[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const native = orders.filter((o) => !isImportedOrder(o));
    for (const o of orders.filter((x) => isImportedOrder(x))) {
      const refs: any[] = Array.isArray(o.linkedDocuments?.invoice) ? o.linkedDocuments.invoice : [];
      const credits: any = (importedMarkerOf(o) as any)?.credits || {};
      out.set(o.id, refs.reduce((t, r) => t + Math.max(0, (Number(r?.total) || 0) - (Number(credits[r?.id]) || 0)), 0));
    }
    if (!native.length) return out;
    const ids = new Set<string>(native.flatMap((o) => orderInvoiceIdsOf(o)));
    const orderIds = native.map((o) => o.id);
    const runs: any[] = await this.prisma.delivery.findMany({ where: { organizationId, orderId: { in: orderIds }, orderInvoiceId: { not: null } }, select: { orderId: true, orderInvoiceId: true } });
    for (const r of runs) if (r.orderInvoiceId && !String(r.orderInvoiceId).startsWith('claim:')) ids.add(r.orderInvoiceId);
    const docs: any[] = await this.prisma.document.findMany({
      where: { organizationId, type: { in: DOC_TYPES_FOR.INVOICE }, OR: [{ id: { in: [...ids] } }, ...orderIds.map((id) => ({ config: { path: ['orderId'], equals: id } }))] } as any,
      select: { id: true, status: true, config: true },
    });
    for (const o of native) {
      const mine = new Set<string>([...orderInvoiceIdsOf(o), ...runs.filter((r) => r.orderId === o.id).map((r) => r.orderInvoiceId)]);
      const sum = docs.filter((d) => (mine.has(d.id) || d.config?.orderId === o.id) && isCountedInvoice(d)).reduce((t, d) => t + (grossOf(d.config) ?? 0), 0);
      out.set(o.id, sum);
    }
    return out;
  }

  /** GET /order-refs/doc/:documentId: the order a document is on (the chip), or null. */
  async docLink(organizationId: string, documentId: string) {
    await this.assertOn(organizationId);
    const { doc, kind } = await this.loadDoc(organizationId, documentId);
    return { link: await this.linkOf(organizationId, doc, kind) };
  }

  private async linkOf(organizationId: string, doc: any, kind: 'INVOICE' | 'DELIVERY_ORDER') {
    const holders = (await orderHoldersOf(this.prisma, organizationId, kind, [{ id: doc.id, config: doc.config }])).get(doc.id) ?? [];
    if (!holders.length) return null;
    const order: any = await this.prisma.order.findFirst({
      where: { id: holders[0].id, organizationId },
      select: { id: true, orderNumber: true, linkedDocuments: true, sourceQuotation: { select: { id: true, name: true } } },
    });
    if (!order) return null;
    return {
      orderId: order.id as string,
      orderNumber: order.orderNumber as string,
      quotationId: (order.sourceQuotation?.id ?? null) as string | null,
      quotationName: (order.sourceQuotation?.name ?? null) as string | null,
      label: orderRefLabel(order.orderNumber, order.sourceQuotation?.name),
      // × only on a link made with Link / this Reference (a document made on the order, or on its jobs, stays).
      unlinkable: !!linkEntryOf(order.linkedDocuments, kind, doc.id) && !madeOnOrder(doc, order.id),
    };
  }

  /**
   * POST /order-refs/link { documentId, quotationId }: the quotation's order (made when missing), then the link.
   * Checks come first, so a refused link never leaves a new order behind.
   */
  async link(organizationId: string, body: { documentId?: string; quotationId?: string }, actor: Actor) {
    await this.assertOn(organizationId);
    const { doc, kind } = await this.loadDoc(organizationId, body?.documentId);
    const qid = uuidOf(body?.quotationId);
    const quotation: any = qid ? await this.prisma.document.findFirst({ where: { id: qid, organizationId, type: { in: QUOTE_TYPES } }, select: { id: true, name: true, type: true, status: true, config: true } }) : null;
    if (!quotation || quotation.config?.voided === true || quotation.config?.cancelled === true) throw new NotFoundException('Quotation not found');
    const qName = quotation.name || 'This quotation';
    const docName = doc.name || (kind === 'INVOICE' ? 'This invoice' : 'This DO');

    // The customer: the same one, or (a draft with none yet) the quotation's.
    const docCustomer = docCustomerIdOf(doc.config);
    const qCustomer = docCustomerIdOf(quotation.config);
    if (docCustomer && qCustomer && docCustomer !== qCustomer) throw new BadRequestException(`${qName} is for another customer`);
    if (!docCustomer && !isDraftDoc(doc.status)) throw new BadRequestException(`Pick the customer of ${docName} first`);

    // One document = one order (the same order again is fine: nothing to do).
    let existing: any = await this.prisma.order.findFirst({ where: { organizationId, sourceQuotationId: quotation.id }, orderBy: { createdAt: 'asc' }, select: { id: true, orderNumber: true, status: true, linkedDocuments: true } });
    const holders = (await orderHoldersOf(this.prisma, organizationId, kind, [{ id: doc.id, config: doc.config }])).get(doc.id) ?? [];
    if (existing && holders.some((h) => h.id === existing.id)) {
      return { ...(await this.linkOf(organizationId, doc, kind))!, createdOrder: false, reference: null, customer: null, already: true };
    }
    const why = holders.length ? holderRefusal(docName, existing?.id ?? '', holders) : null;
    if (why) throw new BadRequestException(why);
    if (existing?.status === 'CANCELLED') throw new BadRequestException(`${existing.orderNumber} is cancelled`);
    if (!existing && isErpImported(quotation.config) && (await isImportedOrdersEnabled(this.prisma as any, organizationId))) throw new BadRequestException(IMPORTED_QUOTATION_NO_ORDER);
    // An AIMS order reads linked invoices only in the manual flow (the same rule as Link existing document).
    if (kind === 'INVOICE' && (!existing || !isImportedOrder(existing)) && !(await isManualOrderFlow(this.prisma as any, organizationId))) throw new BadRequestException(NATIVE_INVOICE_MANUAL_ONLY);

    // A draft with no customer takes the quotation's (written now, so the link's customer check passes).
    let customer: any = null;
    if (!docCustomer && qCustomer) {
      const c: any = await this.prisma.customer.findFirst({ where: { id: qCustomer, organizationId }, select: { id: true, name: true, address: true, email: true, customerCode: true, gstRegNo: true } });
      if (!c) throw new BadRequestException(`${qName} has no customer in this company`);
      customer = c;
      const cfg = doc.config || {};
      doc.config = {
        ...cfg,
        customerId: c.id,
        customerName: c.name,
        customer: { ...(cfg.customer || {}), id: c.id, name: c.name, address: c.address ?? '', email: c.email ?? '', customerCode: c.customerCode ?? '', gstRegNo: c.gstRegNo ?? '' },
        ...(cfg.billTo ? {} : { billTo: c.address ?? '' }),
      };
      await this.prisma.document.update({ where: { id: doc.id }, data: { config: doc.config } });
    } else if (!docCustomer) {
      throw new BadRequestException(`${qName} has no customer`);
    }

    const ensured = existing ? { orderId: existing.id as string, orderNumber: existing.orderNumber as string, created: false } : await ensureQuotationOrder(this.prisma, organizationId, quotation);
    await this.orders.linkImportedDocument(ensured.orderId, organizationId, { type: kind, id: doc.id }, actor);

    // A draft: its Reference reads the link (canonical config.referenceNo; the editor's copy follows).
    const label = orderRefLabel(ensured.orderNumber, quotation.name);
    let reference: string | null = null;
    if (isDraftDoc(doc.status)) {
      const fresh: any = await this.prisma.document.findFirst({ where: { id: doc.id, organizationId }, select: { config: true } });
      const cfg = fresh?.config || {};
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { config: { ...cfg, referenceNo: label, ...(cfg.documentInfo && typeof cfg.documentInfo === 'object' ? { documentInfo: { ...cfg.documentInfo, referenceNo: label } } : {}) } },
      });
      reference = label;
    }
    const linked = await this.linkOf(organizationId, doc, kind);
    return { ...(linked ?? { orderId: ensured.orderId, orderNumber: ensured.orderNumber, quotationId: quotation.id, quotationName: quotation.name, label, unlinkable: true }), createdOrder: ensured.created, reference, customer, docName, kind };
  }

  /** POST /order-refs/unlink { documentId }: take the document off its order; a draft's Reference that only named the link is cleared. */
  async unlink(organizationId: string, body: { documentId?: string }, actor: Actor) {
    await this.assertOn(organizationId);
    const { doc, kind } = await this.loadDoc(organizationId, body?.documentId);
    const link = await this.linkOf(organizationId, doc, kind);
    if (!link) throw new BadRequestException(`${doc.name || 'This document'} is not on an order`);
    await this.orders.unlinkImportedDocument(link.orderId, organizationId, { type: kind, id: doc.id }, actor);
    let clearedReference = false;
    if (isDraftDoc(doc.status)) {
      const cfg = doc.config || {};
      const ref = String(cfg.referenceNo ?? cfg.documentInfo?.referenceNo ?? '').trim();
      if (ref && ref === link.label) {
        await this.prisma.document.update({
          where: { id: doc.id },
          data: { config: { ...cfg, referenceNo: '', ...(cfg.documentInfo && typeof cfg.documentInfo === 'object' ? { documentInfo: { ...cfg.documentInfo, referenceNo: '' } } : {}) } },
        });
        clearedReference = true;
      }
    }
    return { orderNumber: link.orderNumber, docName: doc.name ?? null, kind, clearedReference };
  }

  /** GET /order-refs/remaining-lines/:orderId: the lines still to bill, for an empty invoice's "Fill remaining lines". */
  async remainingLines(organizationId: string, orderId: string) {
    await this.assertOn(organizationId);
    const id = uuidOf(orderId);
    if (!id) throw new NotFoundException('Order not found');
    const page: any = await this.orders.getById(id, organizationId);
    if (!page) throw new NotFoundException('Order not found');
    const billed = Number(page.imported ? page.billed : page.summary?.billed) || 0;
    const remaining = (page.imported ? page.remaining?.lines : page.summary?.remaining?.lines) ?? null;
    let quoteLines: any[] = [];
    if (page.imported) quoteLines = Array.isArray(page.invoiceLines) ? page.invoiceLines : [];
    else if (page.sourceQuotation?.id) {
      const q: any = await this.prisma.document.findFirst({ where: { id: page.sourceQuotation.id, organizationId }, select: { config: true } });
      const items: any[] = Array.isArray(q?.config?.items) ? q.config.items : [];
      quoteLines = items
        .filter((it) => it && !it.isGroupHeader && !it.isTagGroup)
        .map((it) => {
          const quantity = Number(it.quantity) || 1;
          const unitPrice = Number(it.unitPrice) || 0;
          return { description: String(it.description ?? ''), quantity, unitPrice, amount: Math.round(quantity * unitPrice * 100) / 100, priced: unitPrice > 0 };
        });
    }
    return { orderNumber: page.orderNumber ?? null, lines: fillLinesOf(remaining, quoteLines, billed) };
  }
}
