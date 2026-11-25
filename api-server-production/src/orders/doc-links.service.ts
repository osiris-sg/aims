import { reportNoLabel } from '../maintenance-reports/sr-number';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { grossOf } from '../common/document-money';
import { docCustomerIdOf, holderRefusal, linkEntryOf, madeOnOrder, orderHoldersOf } from './imported-order-links';
import { crossOrgInvoiceRefsOf, importedMarkerOf, isCrossPlaceholder, isNgPlaceholderMarked } from './imported-orders';
import { groupOrgIds, memberOrgIds } from '../organizations/org-group';
import { isWctOrdersEnabled, MARKED_COMPLETE, WCT_ORDER_STATUS_LABEL, WctOrderStatus } from './wct-orders';
import { MANUAL_ORDER_STATUS_LABEL, ManualOrderStatus } from './manual-order-flow';
import { OrdersService } from './orders.service';
import { DocOrderRefService } from './doc-order-ref.service';
import { isDraftDoc } from './doc-order-ref';
import {
  DirectLink,
  PageKind,
  PickKind,
  TYPES_OF,
  directLinksOf,
  docHref,
  isDeadConfig,
  likeTerm,
  pageKindOf,
  parsePickKind,
  pickerKindsFor,
  sameCustomerFirst,
  withDirectLink,
  withoutDirectLink,
} from './doc-links';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null);
const IMPORTED_STATUS_TEXT: Record<string, string> = { PAID: 'Paid', INVOICED: 'Invoiced', PART_BILLED: 'Part billed', COMPLETED: 'Complete', DO_DRAFT: 'DO draft', DO_COMPLETED: 'DO completed, invoice pending' };
const PICK_LIMIT = 60;

type Actor = { id?: string | null; name?: string | null };

export interface PickRow {
  kind: PickKind;
  id: string;
  number: string | null;
  customerId: string | null;
  customer: string | null;
  date: string | null;
  subject: string | null;
  total: number | null;
  status: string | null;
  href: string | null;
}

export interface ChainDoc {
  id: string;
  name: string | null;
  type: string;
  href: string | null;
  /** Another company's $1-or-less "(NG)" placeholder: shown greyed, not counted (2026-11-23). */
  placeholder?: boolean;
}

/**
 * Link Document + doc chain (WCT group, 2026-11-22, enableWctOrders; rules in doc-links.ts). The order links go
 * through the same paths as today (OrdersService.linkImportedDocument / unlinkImportedDocument, and for a quotation
 * picked on an invoice / DO, DocOrderRefService.link), so one document = one order, same customer and the order
 * status refresh all hold. Direct links (two documents on no order) live on both documents as config.linkedDocs.
 */
@Injectable()
export class DocLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly refs: DocOrderRefService,
  ) {}

  private async assertOn(organizationId: string) {
    if (!(await isWctOrdersEnabled(this.prisma as any, organizationId))) throw new NotFoundException('Not available for this company');
  }

  private async loadDoc(organizationId: string, documentId: unknown): Promise<{ doc: any; kind: PageKind }> {
    const id = uuidOf(documentId);
    const doc: any = id
      ? await this.prisma.document.findFirst({ where: { id, organizationId }, select: { id: true, name: true, type: true, status: true, documentTemplateId: true, config: true } })
      : null;
    if (!doc) throw new NotFoundException('Save the document first');
    const kind = pageKindOf(doc.type);
    if (!kind) throw new BadRequestException('Only a quotation, DO or invoice takes a linked document');
    return { doc, kind };
  }

  /** The order holding a document, with whether this document's link may be removed (null = on no order). */
  private async orderOf(organizationId: string, doc: any, kind: PageKind) {
    const holders = (await orderHoldersOf(this.prisma, organizationId, kind, [{ id: doc.id, config: doc.config }])).get(doc.id) ?? [];
    if (!holders.length) return null;
    const order: any = await this.prisma.order.findFirst({
      where: { id: holders[0].id, organizationId },
      select: { id: true, orderNumber: true, status: true, sourceQuotationId: true, linkedDocuments: true, attachments: true, sourceQuotation: { select: { id: true, name: true, type: true, documentTemplateId: true } } },
    });
    if (!order) return null;
    const ownQuote = kind === 'QUOTATION' && order.sourceQuotationId === doc.id;
    const unlinkable = !ownQuote && !!linkEntryOf(order.linkedDocuments, kind, doc.id) && !madeOnOrder(doc, order.id);
    return { order, unlinkable };
  }

  // ── Picker ────────────────────────────────────────────────────────────────

  /** GET /order-refs/picker?documentId=&kind=&q=: one tab of the picker, the document's customer first. */
  async picker(organizationId: string, query: { documentId?: string; kind?: string; q?: string }) {
    await this.assertOn(organizationId);
    const { doc, kind: page } = await this.loadDoc(organizationId, query.documentId);
    const kind = parsePickKind(query.kind);
    if (!kind || !pickerKindsFor(page).includes(kind)) throw new BadRequestException('Pick Order, QO, DO or Invoice');
    const customerId = docCustomerIdOf(doc.config);
    const q = likeTerm(query.q);
    const rows = kind === 'ORDER' ? await this.orderRows(organizationId, customerId, q) : await this.docRows(organizationId, kind, doc.id, customerId, q);
    return { kinds: pickerKindsFor(page), kind, rows: sameCustomerFirst(rows, customerId) };
  }

  private async orderRows(organizationId: string, customerId: string | null, q: string | null): Promise<PickRow[]> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT o.id::text AS id, o."orderNumber", o.status, o."createdAt", o."customerId"::text AS "customerId", c.name AS customer,
              COALESCE(NULLIF(o."linkedDocuments"->'imported'->>'subject', ''), NULLIF(q.config->>'subject', ''), q.config->'documentInfo'->>'subject') AS subject,
              o."linkedDocuments"->'imported'->'total' AS "importedTotal", o."linkedDocuments"->'imported'->'quoteTotal' AS "importedQuoteTotal",
              jsonb_build_object('totalWithTax', q.config->'totalWithTax', 'nettTotal', q.config->'nettTotal', 'xeroGross', q.config->'xeroGross', 'totalAmount', q.config->'totalAmount', 'documentInfo', jsonb_build_object('nettTotal', q.config->'documentInfo'->'nettTotal')) AS money
         FROM "Order" o
         LEFT JOIN "Customer" c ON c.id = o."customerId"
         LEFT JOIN "Document" q ON q.id = o."sourceQuotationId"
        WHERE o."organizationId" = $1 AND o.status <> 'CANCELLED'
          AND ($2::text IS NULL OR o."orderNumber" ILIKE $2 OR c.name ILIKE $2 OR q.name ILIKE $2
               OR o."linkedDocuments"->'imported'->>'subject' ILIKE $2 OR q.config->>'subject' ILIKE $2)
        ORDER BY (o."customerId"::text = $3) DESC NULLS LAST, o."createdAt" DESC
        LIMIT ${PICK_LIMIT}`,
      organizationId,
      q,
      customerId ?? '',
    );
    return rows.map((r) => {
      const imported = Number(r.importedTotal ?? r.importedQuoteTotal);
      const total = Number.isFinite(imported) && (r.importedTotal != null || r.importedQuoteTotal != null) ? imported : grossOf(r.money);
      const label = r.status === MARKED_COMPLETE ? 'Complete' : (WCT_ORDER_STATUS_LABEL[r.status as WctOrderStatus] ?? MANUAL_ORDER_STATUS_LABEL[r.status as ManualOrderStatus] ?? IMPORTED_STATUS_TEXT[r.status] ?? r.status);
      return {
        kind: 'ORDER' as const,
        id: r.id,
        number: r.orderNumber,
        customerId: r.customerId ?? null,
        customer: r.customer ?? null,
        date: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : null,
        subject: r.subject ?? null,
        total: total ?? null,
        status: label ?? null,
        href: `/portal/orders/${r.id}`,
      };
    });
  }

  private async docRows(organizationId: string, kind: PageKind, selfId: string, customerId: string | null, q: string | null): Promise<PickRow[]> {
    // Step 1 on the list columns (trigger-kept: listCustomerId, listIssueDate, listSearch = customer, reference...),
    // plus the subject when searching: ~0.2 s on WCT's 15,000 invoices (reading every config took 3 to 6 s).
    const picked: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT d.id::text AS id FROM "Document" d
        WHERE d."organizationId" = $1 AND d.type = ANY($2::text[]) AND d.id <> $3::uuid
          AND ($4::text IS NULL OR d.name ILIKE $4 OR d."listSearch" LIKE lower($4) OR d.config->>'subject' ILIKE $4 OR d.config->'documentInfo'->>'subject' ILIKE $4)
        ORDER BY (d."listCustomerId" = $5) DESC NULLS LAST, d."listIssueDate" DESC NULLS LAST, d."createdAt" DESC
        LIMIT ${PICK_LIMIT + 20}`,
      organizationId,
      TYPES_OF[kind],
      selfId,
      q,
      customerId ?? '',
    );
    const ids = picked.map((r) => r.id);
    if (!ids.length) return [];
    // Step 2: the details of those rows only (voided / cancelled dropped here), in step 1's order.
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT d.id::text AS id, d.name, d.type, d.status, d."documentTemplateId" AS "templateId", d."createdAt", d."listIssueDate", d."listCustomerId" AS "customerId",
              COALESCE(NULLIF(d.config->>'customerName', ''), NULLIF(d.config->'customer'->>'name', ''), c.name) AS customer,
              COALESCE(NULLIF(d.config->>'subject', ''), d.config->'documentInfo'->>'subject') AS subject,
              (COALESCE(d.config->>'voided', '') = 'true' OR COALESCE(d.config->>'cancelled', '') = 'true') AS dead,
              jsonb_build_object('totalWithTax', d.config->'totalWithTax', 'nettTotal', d.config->'nettTotal', 'xeroGross', d.config->'xeroGross', 'totalAmount', d.config->'totalAmount', 'documentInfo', jsonb_build_object('nettTotal', d.config->'documentInfo'->'nettTotal')) AS money
         FROM "Document" d
         LEFT JOIN "Customer" c ON c.id::text = d."listCustomerId"
        WHERE d."organizationId" = $1 AND d.id = ANY($2::uuid[])`,
      organizationId,
      ids,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((i) => byId.get(i))
      .filter((r) => r && !r.dead)
      .slice(0, PICK_LIMIT)
      .map((r) => ({
        kind,
        id: r.id,
        number: r.name ?? null,
        customerId: r.customerId ?? null,
        customer: r.customer ?? null,
        date: r.listIssueDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : null),
        subject: r.subject ?? null,
        total: grossOf(r.money),
        status: r.status ?? null,
        href: docHref(r.type, r.templateId, r.id),
      }));
  }

  // ── The row's pills ───────────────────────────────────────────────────────

  /** GET /order-refs/links/:documentId: the order this document is on (and its quotation), and its direct links. */
  async links(organizationId: string, documentId: string) {
    await this.assertOn(organizationId);
    const { doc, kind } = await this.loadDoc(organizationId, documentId);
    const held = await this.orderOf(organizationId, doc, kind);
    const direct = await this.freshDirect(organizationId, doc.config);
    const sq = held?.order?.sourceQuotation;
    return {
      kind,
      order: held
        ? {
            id: held.order.id,
            orderNumber: held.order.orderNumber,
            href: `/portal/orders/${held.order.id}`,
            unlinkable: held.unlinkable,
            quotation: sq && sq.id !== doc.id ? { id: sq.id, name: sq.name, href: docHref(sq.type, sq.documentTemplateId, sq.id) } : null,
          }
        : null,
      direct,
    };
  }

  /** The direct links with their current names (a voided / deleted target is left out). */
  private async freshDirect(organizationId: string, config: any): Promise<Array<DirectLink & { href: string | null }>> {
    const list = directLinksOf(config);
    if (!list.length) return [];
    const docs: any[] = await this.prisma.document.findMany({ where: { organizationId, id: { in: list.map((l) => l.id) } }, select: { id: true, name: true, type: true, documentTemplateId: true, config: true } });
    const byId = new Map(docs.map((d) => [d.id, d]));
    return list
      .map((l) => byId.get(l.id))
      .filter((d) => d && !isDeadConfig(d.config))
      .map((d) => ({ id: d.id, type: d.type, name: d.name ?? null, templateId: d.documentTemplateId ?? null, href: docHref(d.type, d.documentTemplateId, d.id) }));
  }

  // ── Link / unlink ─────────────────────────────────────────────────────────

  /** POST /order-refs/link-document { documentId, kind, id }: link this document to the picked row (rules in doc-links.ts). */
  async link(organizationId: string, body: { documentId?: string; kind?: string; id?: string }, actor: Actor) {
    await this.assertOn(organizationId);
    const { doc, kind: page } = await this.loadDoc(organizationId, body?.documentId);
    const kind = parsePickKind(body?.kind);
    const targetId = uuidOf(body?.id);
    if (!kind || !pickerKindsFor(page).includes(kind) || !targetId) throw new BadRequestException('Pick a document to link');
    const docName = doc.name || 'This document';

    if (kind === 'ORDER') return this.toOrder(organizationId, doc, page, targetId, actor);

    const target: any = await this.prisma.document.findFirst({ where: { id: targetId, organizationId, type: { in: TYPES_OF[kind] } }, select: { id: true, name: true, type: true, status: true, documentTemplateId: true, config: true } });
    if (!target || isDeadConfig(target.config)) throw new NotFoundException('That document is not available');
    const targetName = target.name || 'That document';

    // An invoice / DO picking a quotation: today's rule (the quotation's order, made when missing).
    if (kind === 'QUOTATION' && page !== 'QUOTATION') {
      const out: any = await this.refs.link(organizationId, { documentId: doc.id, quotationId: target.id }, actor);
      return { mode: 'order' as const, orderId: out.orderId, orderNumber: out.orderNumber, createdOrder: !!out.createdOrder, docName, targetName, reference: out.reference ?? null, customer: out.customer ?? null };
    }

    // A document on an order: this one goes on that same order.
    const held = await this.orderOf(organizationId, target, kind);
    if (held) return this.toOrder(organizationId, doc, page, held.order.id, actor, targetName);

    // On no order: the two documents are linked to each other.
    const a = docCustomerIdOf(doc.config);
    const b = docCustomerIdOf(target.config);
    if (a && b && a !== b) throw new BadRequestException(`${targetName} is for another customer`);
    if (directLinksOf(doc.config).some((l) => l.id === target.id)) return { mode: 'direct' as const, already: true, docName, targetName };
    const stamp = (d: any): DirectLink => ({ id: d.id, type: d.type, name: d.name ?? null, templateId: d.documentTemplateId ?? null });
    await this.prisma.$transaction(async (tx: any) => {
      const [x, y] = await Promise.all([tx.document.findFirst({ where: { id: doc.id, organizationId }, select: { config: true } }), tx.document.findFirst({ where: { id: target.id, organizationId }, select: { config: true } })]);
      await tx.document.update({ where: { id: doc.id }, data: { config: withDirectLink(x?.config, stamp(target)) } });
      await tx.document.update({ where: { id: target.id }, data: { config: withDirectLink(y?.config, stamp(doc)) } });
    });
    return { mode: 'direct' as const, docName, targetName };
  }

  /** This document onto an order (order picked, or the picked document's order). Same path as the order page's link. */
  private async toOrder(organizationId: string, doc: any, page: PageKind, orderId: string, actor: Actor, via?: string) {
    const order: any = await this.prisma.order.findFirst({ where: { id: orderId, organizationId }, select: { id: true, orderNumber: true, status: true, customerId: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'CANCELLED') throw new BadRequestException(`${order.orderNumber} is cancelled`);
    const docName = doc.name || 'This document';
    const held = await this.orderOf(organizationId, doc, page);
    if (held?.order?.id === order.id) return { mode: 'order' as const, already: true, orderId: order.id, orderNumber: order.orderNumber, docName, targetName: via ?? order.orderNumber };
    if (held) throw new BadRequestException(holderRefusal(docName, order.id, [{ id: held.order.id, orderNumber: held.order.orderNumber }]) ?? `${docName} is already on an order`);
    // A draft with no customer takes the order's (as the quotation link does), so the same-customer rule can pass.
    let customer: any = null;
    if (!docCustomerIdOf(doc.config) && order.customerId) {
      if (!isDraftDoc(doc.status)) throw new BadRequestException(`Pick the customer of ${docName} first`);
      const c: any = await this.prisma.customer.findFirst({ where: { id: order.customerId, organizationId }, select: { id: true, name: true, address: true, email: true, customerCode: true, gstRegNo: true } });
      if (c) {
        const cfg = doc.config || {};
        doc.config = {
          ...cfg,
          customerId: c.id,
          customerName: c.name,
          customer: { ...(cfg.customer || {}), id: c.id, name: c.name, address: c.address ?? '', email: c.email ?? '', customerCode: c.customerCode ?? '', gstRegNo: c.gstRegNo ?? '' },
          ...(cfg.billTo ? {} : { billTo: c.address ?? '' }),
        };
        await this.prisma.document.update({ where: { id: doc.id }, data: { config: doc.config } });
        customer = c;
      }
    }
    await this.orders.linkImportedDocument(order.id, organizationId, { type: page, id: doc.id }, actor);
    return { mode: 'order' as const, orderId: order.id, orderNumber: order.orderNumber, docName, targetName: via ?? order.orderNumber, customer };
  }

  /** POST /order-refs/unlink-document { documentId, kind: 'ORDER' | 'DIRECT', id }: take one link off. */
  async unlink(organizationId: string, body: { documentId?: string; kind?: string; id?: string }, actor: Actor) {
    await this.assertOn(organizationId);
    const { doc, kind: page } = await this.loadDoc(organizationId, body?.documentId);
    const docName = doc.name || 'This document';
    if (String(body?.kind ?? '').toUpperCase() === 'ORDER') {
      const held = await this.orderOf(organizationId, doc, page);
      if (!held) throw new BadRequestException(`${docName} is not on an order`);
      if (!held.unlinkable) throw new BadRequestException(page === 'QUOTATION' && held.order.sourceQuotationId === doc.id ? `${docName} is the order's own quotation` : `${docName} was made on ${held.order.orderNumber}: it stays on it`);
      // Invoice / DO: today's unlink (it also clears a draft's Reference that only named the link).
      if (page !== 'QUOTATION') {
        const out: any = await this.refs.unlink(organizationId, { documentId: doc.id }, actor);
        return { mode: 'order' as const, orderNumber: out.orderNumber, docName, clearedReference: !!out.clearedReference };
      }
      await this.orders.unlinkImportedDocument(held.order.id, organizationId, { type: 'QUOTATION', id: doc.id }, actor);
      return { mode: 'order' as const, orderNumber: held.order.orderNumber, docName };
    }
    const targetId = uuidOf(body?.id);
    if (!targetId || !directLinksOf(doc.config).some((l) => l.id === targetId)) throw new BadRequestException('That document is not linked here');
    let targetName: string | null = null;
    await this.prisma.$transaction(async (tx: any) => {
      const x = await tx.document.findFirst({ where: { id: doc.id, organizationId }, select: { config: true } });
      const y = await tx.document.findFirst({ where: { id: targetId, organizationId }, select: { name: true, config: true } });
      await tx.document.update({ where: { id: doc.id }, data: { config: withoutDirectLink(x?.config, targetId) } });
      if (y) {
        targetName = y.name ?? null;
        await tx.document.update({ where: { id: targetId }, data: { config: withoutDirectLink(y.config, doc.id) } });
      }
    });
    return { mode: 'direct' as const, docName, targetName };
  }

  // ── Doc chain (left panel) ────────────────────────────────────────────────

  /**
   * The order's service reports for the doc chain (UAT 2026-11-25): written on its jobs, for one of its DOs
   * (serviceData.orderId) or linked on the order; deleted ones left out; oldest first. Named by number
   * (SR202611-0001, else #5), "Draft" before it has one. A failed read = none (the panel still shows the rest).
   */
  private async chainReports(organizationId: string, o: { id: string; attachments?: unknown }): Promise<ChainDoc[]> {
    try {
      const linked = (Array.isArray(o.attachments) ? (o.attachments as any[]) : []).filter((a) => a?.kind === 'report' && typeof a.reportId === 'string' && UUID.test(a.reportId)).map((a) => a.reportId as string);
      const rows: any[] = await this.prisma.maintenanceServiceReport.findMany({
        where: {
          organizationId,
          kind: 'SERVICE',
          OR: [{ delivery: { orderId: o.id, status: { not: 'cancelled' } } }, { serviceData: { path: ['orderId'], equals: o.id } }, ...(linked.length ? [{ id: { in: linked } }] : [])],
        },
        select: { id: true, reportNumber: true, serviceData: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      return rows.filter((r) => !(r.serviceData as any)?.deletedAt).map((r) => ({ id: r.id, name: reportNoLabel(r) ?? 'Draft', type: 'SERVICE_REPORT', href: `/portal/maintenance-reports/${r.id}` }));
    } catch {
      return [];
    }
  }

  /**
   * GET /order-refs/chain/:documentId: the order's quotation(s), DO(s) and invoice(s) (live ones), each with its
   * editor link, and whether "+ Create DO" / "+ Create invoice" apply. No order: the direct links only.
   */
  async chain(organizationId: string, documentId: string, viewer?: { userId?: string | null; isAdmin?: boolean }) {
    await this.assertOn(organizationId);
    const { doc, kind } = await this.loadDoc(organizationId, documentId);
    const held = await this.orderOf(organizationId, doc, kind);
    const direct = await this.freshDirect(organizationId, doc.config);
    if (!held) return { kind, order: null, quotations: [], dos: [], invoices: [], reports: [], canCreateDo: false, canCreateInvoice: false, direct };
    const o = held.order;
    const ld: any = o.linkedDocuments || {};
    const refs = (k: string): any[] => (Array.isArray(ld[k]) ? ld[k].filter((x: any) => x && typeof x.id === 'string') : []);
    // DOs: the AIMS DOs made on the order, the DOs its jobs carry, its linked DOs (AIMS or imported ERP).
    const jobItems: any[] = await this.prisma.deliveryItem.findMany({ where: { documentId: { not: null }, delivery: { organizationId, orderId: o.id, status: { not: 'cancelled' } } }, select: { documentId: true } });
    const jobInvoices: any[] = await this.prisma.delivery.findMany({ where: { organizationId, orderId: o.id, orderInvoiceId: { not: null } }, select: { orderInvoiceId: true } });
    const madeOn: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT d.id::text AS id FROM "Document" d WHERE d."organizationId" = $1 AND d.type = ANY($2::text[]) AND d.config->>'orderId' = $3`,
      organizationId,
      [...TYPES_OF.DELIVERY_ORDER, ...TYPES_OF.INVOICE],
      o.id,
    );
    const ids = new Set<string>([
      ...(o.sourceQuotationId ? [o.sourceQuotationId] : []),
      ...refs('quotation').map((r) => r.id),
      ...refs('do').map((r) => r.id),
      ...refs('invoice').map((r) => r.id),
      ...jobItems.map((i) => i.documentId).filter(Boolean),
      ...jobInvoices.map((r) => r.orderInvoiceId).filter((v: any) => v && !String(v).startsWith('claim:')),
      ...madeOn.map((r) => r.id),
    ]);
    const docs: any[] = ids.size
      ? await this.prisma.document.findMany({ where: { organizationId, id: { in: [...ids].filter((x) => UUID.test(x)) } }, select: { id: true, name: true, type: true, documentTemplateId: true, config: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
      : [];
    const live = docs.filter((d) => !isDeadConfig(d.config));
    const view = (d: any): ChainDoc => ({ id: d.id, name: d.name ?? null, type: d.type, href: docHref(d.type, d.documentTemplateId, d.id) });
    const ofKind = (k: PageKind) => live.filter((d) => pageKindOf(d.type) === k).map(view);
    // Imported ERP DOs the order only names (no document in AIMS): shown as plain numbers.
    const erpDoNames: string[] = Array.isArray((importedMarkerOf(o) as any)?.erpDoNumbers) ? (importedMarkerOf(o) as any).erpDoNumbers.filter((x: any) => typeof x === 'string') : [];
    const dos = ofKind('DELIVERY_ORDER');
    const known = new Set(dos.map((d) => d.name));
    const erpOnly = erpDoNames.filter((n) => !known.has(n)).map((n) => ({ id: `erp:${n}`, name: n, type: 'DELIVERY_ORDER', href: null }));
    // A moved "(NG)" placeholder (config.ngPlaceholder, 2026-11-25) is greyed like a cross-company placeholder.
    const invoices = live.filter((d) => pageKindOf(d.type) === 'INVOICE').map((d) => ({ ...view(d), ...(isNgPlaceholderMarked(d) ? { placeholder: true } : {}) }));
    // Cross-company invoices (WCT group, 2026-11-23): another group company's invoices billed against this order's
    // quotation, "I-012345 · WCT (S)", read only; a link that switches company only for a viewer who belongs there.
    const cross = crossOrgInvoiceRefsOf(o);
    const crossOut: ChainDoc[] = [];
    if (cross.length) {
      const family = new Set(await groupOrgIds(this.prisma, organizationId));
      const ok = cross.filter((r) => family.has(r.orgId) && r.orgId !== organizationId);
      const orgIds = [...new Set(ok.map((r) => r.orgId))];
      const canOpen = viewer?.isAdmin ? new Set(orgIds) : await memberOrgIds(this.prisma, viewer?.userId ?? null, orgIds);
      const docsX: any[] = ok.length ? await this.prisma.document.findMany({ where: { id: { in: ok.map((r) => r.id) }, organizationId: { in: orgIds } }, select: { id: true, name: true, type: true, organizationId: true, documentTemplateId: true, config: true } }) : [];
      for (const d of docsX.filter((x) => !isDeadConfig(x.config))) {
        const r = ok.find((x) => x.id === d.id)!;
        const own = docHref(d.type, d.documentTemplateId, d.id);
        crossOut.push({ id: d.id, name: `${d.name ?? r.name ?? 'Invoice'} · ${r.orgName ?? 'other company'}`, type: d.type, href: canOpen.has(d.organizationId) && own ? `/portal/open-in-org?org=${encodeURIComponent(d.organizationId)}&to=${encodeURIComponent(own)}` : null, ...(isCrossPlaceholder(d) ? { placeholder: true } : {}) });
      }
    }
    const open = o.status !== 'CANCELLED';
    return {
      kind,
      order: { id: o.id, orderNumber: o.orderNumber, href: `/portal/orders/${o.id}` },
      quotations: ofKind('QUOTATION'),
      dos: [...dos, ...erpOnly],
      invoices: [...invoices, ...crossOut],
      reports: await this.chainReports(organizationId, o),
      canCreateDo: open && dos.length + erpOnly.length === 0,
      canCreateInvoice: open && [...invoices, ...crossOut].filter((x: any) => !x.placeholder).length === 0,
      direct,
    };
  }
}
