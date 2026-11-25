import { memberOrgIds } from '../organizations/org-group';
import { randomUUID } from 'crypto';
import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import {
  DocumentExtractionService,
  SupplierReconciliationData,
} from '../document-extraction/document-extraction.service';
import { invoiceSplitOf, withSplitPartIds } from '../documents/invoice-split';
import { doDateOrCreated } from '../documents/do-date';
import { orgTimeZoneFor } from '../common/org-today';
import { AuditService } from '../common/audit.service';
import { cancelBlockingInvoice, voidedWithOrderConfig } from './order-cancel';
import { MARKED_COMPLETE, ensureOrderNumberFormat, invoiceRowsWithSplitParts, isWctOrdersEnabled, issueOrderNumberInTx, linkedDoEntriesOf, linkedDoIdsOf, liveInvoiceIds, nativeCompletionOf, orderInvoiceIdsOf, refreshOrderStatus, remainderInvoiceIdsOf, WCT_ORDER_INVOICE_FLAG, WCT_ORDER_STATUS_LABEL, WctOrderStatus } from './wct-orders';
import { orderNumberPrefixOf } from '../document-numbering/document-numbering.service';
import { retryOnNumberConflict } from '../document-numbering/locked-number';
import { MANUAL_ORDER_STATUS_LABEL, isManualOrderFlow, type ManualOrderStatus } from './manual-order-flow';
import { isVerifiedJob } from '../deliveries/finish-modes';
import { SOFT_DELETED_TYPE, isOrgFeatureEnabled } from '../common/org-features';
import { doStatusTag } from '../deliveries/do-number';
import { assetKey, descKey, remainingAllowance, remainingQuoteLines } from './order-billing';
import { photosFileOf } from '../maintenance-reports/uploaded-report';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { taggedSinsView } from '../bills/bill-quotation';
import { bySchedule, dueBy } from '../deliveries/all-day';
import {
  IMPORTED_INVOICE_STATE_LABEL,
  IMPORTED_QUOTATION_NO_ORDER,
  assertImportedOrderOpen,
  assertNotImportedOrder,
  billedPercent,
  creditOfImportedInvoice,
  hasAimsLinks,
  importedCompletionOf,
  importedDoDone,
  importedDosOf,
  importedInvoiceMoney,
  importedMarkerOf,
  importedOrderDraftInvoice,
  importedStatusFrom,
  importedTracker,
  isCountedInvoice,
  isImportedOrder,
  isImportedOrdersEnabled,
  linkedQuotationRefsOf,
  loadImportedOrderInputs,
  orderDosByOrder,
  aimsDoNamesFrom,
  refreshImportedOrderStatus,
} from './imported-orders';
import { IMPORTED_ORDER_SOURCE } from './imported-orders';
import { OrderSource, PAGE_SIZE, compareRows, importedSortSql, importedStatusOfTab, mergePage, nativeMatchesSearch, nativeMatchesTab, orderTabs, parseSort, sortValue } from './orders-page';
import {
  DOC_TYPES_FOR,
  LINK_TYPE_LABEL,
  docCustomerIdOf,
  holderRefusal,
  isDeadDoc,
  linkEntryOf,
  madeOnOrder,
  orderHoldersOf,
  parseLinkType,
  reportNumberOf,
  searchTerm,
  withLinkedDocument,
  withoutLinkedDocument,
  type ImportedLinkType,
  type LinkStamp,
} from './imported-order-links';
import { isErpImported } from '../common/erp-import';
import { billingSteps, importedInvoicePrefill, remainingForOrder } from './imported-remaining';
import { amountPaidOf, grossOf } from '../common/document-money';
import { nativeInvoiceMoney, nativeOrderSummary, nativeRemainderOf } from './order-page-summary';
import { importedDoNumbers, importedListAdd, nativeListAdd } from './order-list-add';
import { quotationStatusLabel } from './quotation-status-label';

/** Imported orders are numbered ORD-<quotation no.> (imported-orders.ts); no native number starts so. */
const IMPORTED_NUMBER_PREFIX = 'ORD-Q-';
const NOT_IMPORTED_NUMBER = { NOT: { orderNumber: { startsWith: IMPORTED_NUMBER_PREFIX } } };
/** Round 24: what an AIMS (native) order answers to Link existing document for a quotation / invoice / DO. */
export const NATIVE_LINK_INVOICE_MANUAL_ONLY =
  'An invoice can be linked to an order made in AIMS on the manual order flow only.';
/** Imported order status codes as words (imported-orders.ts ImportedOrderStatusCode). */
const IMPORTED_STATUS_TEXT: Record<string, string> = { PAID: 'Paid', INVOICED: 'Invoiced', PART_BILLED: 'Part billed', COMPLETED: 'Complete', DO_DRAFT: 'DO draft', DO_COMPLETED: 'DO completed, invoice pending' };

/**
 * Orders are auto-created when a quotation is confirmed (gated by the
 * enableConfirmQuotation flag on the org). Each order holds a snapshot of the
 * quotation's items and acts as the parent container from which POs, DOs and
 * Invoices are spun off later. Status is intentionally free-form for v1 — no
 * auto-advance based on linked-doc states yet.
 */
/** The last signed / stamped DO file on a DO's attachments (label "Stamped DO"), or null. */
export function stampedDoKeyOf(attachments: unknown): string | null {
  const list = Array.isArray(attachments) ? attachments : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const a: any = list[i];
    if (a && typeof a.fileKey === 'string' && a.fileKey && String(a.label ?? '') === 'Stamped DO') return a.fileKey;
  }
  return null;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: DocumentExtractionService,
    private readonly s3: S3Service,
    // Names for the order's "added / linked by" lines when the session token
    // carries no name claims (the production tokens don't). Optional so the
    // specs' hand-built services still construct.
    @Optional() private readonly identity?: ClerkIdentityService,
    // Document history rows for invoices voided with a cancelled order (optional for the specs).
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * Auto-create an Order from a confirmed quotation. Idempotent — if an order
   * already exists for this quotation we return the existing one instead of
   * making a duplicate. Items are deep-copied so later quotation edits don't
   * mutate the order's snapshot.
   */
  async createFromQuotation(quotationDocId: string, organizationId: string) {
    const existing = await this.prisma.order.findFirst({
      where: { sourceQuotationId: quotationDocId, organizationId },
    });
    if (existing) return existing;

    const quotation = await this.prisma.document.findFirst({
      where: { id: quotationDocId, organizationId },
      select: { id: true, name: true, config: true },
    });
    if (!quotation) {
      throw new HttpException('Source quotation not found', HttpStatus.NOT_FOUND);
    }
    // Imported orders on: an old-ERP quotation is history; its order (if any) comes from its ERP-linked invoices only.
    if (isErpImported(quotation.config) && (await isImportedOrdersEnabled(this.prisma, organizationId))) {
      throw new HttpException(IMPORTED_QUOTATION_NO_ORDER, HttpStatus.BAD_REQUEST);
    }

    const config: any = quotation.config || {};
    const rawItems = Array.isArray(config.items) ? config.items : [];
    const customerId: string | null = config?.customer?.id ?? config?.customerId ?? null;
    // QF quotation's "Type" (Project / Route Order) carried onto the order.
    // The document save flattens documentInfo.* to the top level of config, so
    // the value lands at config.orderType; check both to be safe.
    const orderType: string | null = config?.orderType ?? config?.documentInfo?.orderType ?? null;

    // FCU-CU (QF) rows bundle a CU + FCU(s) + accessories into one combined line.
    // Explode each into individual product line items (real SKUs) so the order —
    // and the POs/DOs/invoices spun off it — list the actual products. Each line
    // uses its product's list price; PO conversion swaps to cost downstream.
    const items = await this.itemizeQfRows(rawItems, organizationId);

    // Project quotations carry a document-level discount. Spread it onto every
    // order line as a per-item discount % (so the order — and the Project PO
    // spun off it — show the discount per item, not just netted into a total).
    // A $-amount discount is expressed as a uniform % of the gross. Route Order
    // quotations discount via points instead, so they're left untouched.
    if (orderType === 'Project') {
      const discType = config?.discountType ?? config?.documentInfo?.discountType ?? 'percent';
      const discVal = Number(config?.discountPercent ?? config?.documentInfo?.discountPercent) || 0;
      if (discVal > 0) {
        const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
        const grossList = items.reduce(
          (s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0),
          0,
        );
        const pct =
          discType === 'amount'
            ? grossList > 0
              ? (Math.min(discVal, grossList) / grossList) * 100
              : 0
            : discVal;
        for (const it of items) {
          const q = Number(it.quantity) || 0;
          const unit = Number(it.unitPrice) || 0;
          it.discount = r2(pct);
          it.amount = r2(q * unit * (1 - pct / 100));
        }
      }
    }

    const data = {
      organizationId,
      customerId,
      sourceQuotationId: quotation.id,
      orderType,
      status: 'DRAFT',
      items: items as Prisma.InputJsonValue,
      linkedDocuments: { po: [], do: [], invoice: [], salesOrder: [] } as Prisma.InputJsonValue,
      notes: `Auto-created from quotation ${quotation.name}`,
    };
    // Round 36: an org with a company order prefix (WCT group, orderNumberPrefix) numbers this order from its ORDER
    // counter too (locked, in the transaction that writes it; ORDW202611-001), retried on a clash. Others unchanged.
    if (await orderNumberPrefixOf(this.prisma, organizationId)) {
      const format = await ensureOrderNumberFormat(this.prisma, organizationId);
      return retryOnNumberConflict(
        () => this.prisma.$transaction(async (tx: any) => tx.order.create({ data: { ...data, orderNumber: await issueOrderNumberInTx(this.prisma, tx, organizationId, format.id) } })),
        { what: 'order' },
      );
    }

    const orderNumber = await this.nextOrderNumber(organizationId);

    return await this.prisma.order.create({
      data: { orderNumber, ...data },
    });
  }

  /**
   * Explode FCU-CU (QF) quotation rows into individual product line items.
   * A QF row carries { cuAssetId, cuCode, fcus:[{assetId,code,name,qty}],
   * accessories:[{assetId,code,name,qty}] }; we emit one line per CU / FCU /
   * accessory at that asset's list price. Non-QF rows pass through untouched.
   */
  private async itemizeQfRows(rawItems: any[], organizationId: string): Promise<any[]> {
    const ids = new Set<string>();
    for (const it of rawItems) {
      if (it?.cuAssetId) ids.add(it.cuAssetId);
      (it?.fcus || []).forEach((f: any) => f?.assetId && ids.add(f.assetId));
      (it?.accessories || []).forEach((a: any) => a?.assetId && ids.add(a.assetId));
    }
    const assets = ids.size
      ? await this.prisma.asset.findMany({
          where: { id: { in: [...ids] }, organizationId },
          select: { id: true, skuKey: true, name: true, price: true, points: true, customPrices: true },
        })
      : [];
    const byId: Record<string, any> = Object.fromEntries(assets.map((a) => [a.id, a]));

    // Dealer ("Discount Price") tier from an asset's customPrices.
    const dealerOf = (a: any): number => {
      const cps = a?.customPrices;
      if (!Array.isArray(cps)) return 0;
      const hit = cps.find((cp: any) => cp && String(cp.label).toLowerCase() === 'discount price');
      return Number(hit?.value) || 0;
    };

    const out: any[] = [];
    let n = 0;
    const push = (assetId: string, code: string, name: string, qty: any, extra: any = {}) => {
      const a = byId[assetId] || {};
      const price = Number(a.price) || 0;
      const q = Number(qty) || 1;
      out.push({
        id: Date.now() + n++,
        itemCode: code || a.skuKey || '',
        inventoryItemId: assetId || '',
        description: name || a.name || code || '',
        uom: 'UNIT',
        quantity: q,
        unitPrice: price,
        dealerPrice: dealerOf(a), // used by Route Order POs
        discount: 0,
        amount: q * price,
        points: Number(a.points) || 0,
        ...extra,
      });
    };

    for (const it of rawItems) {
      const isQf = it && (it.cuAssetId || Array.isArray(it.fcus) || Array.isArray(it.accessories));
      if (!isQf) {
        out.push(it);
        continue;
      }
      // Grouping hierarchy: CU (head) -> FCU (tagged to CU) -> accessory (tagged
      // to the FCU, since the panel/remote belong to the indoor unit).
      const tagGroupId = `tg_${Date.now()}_${n}`;
      const cuTag = it.cuAssetId
        ? { tagGroupId, taggedAssetId: it.cuAssetId, taggedAssetCode: it.cuCode, taggedAssetName: it.cuName }
        : { tagGroupId };
      const firstFcu = (it.fcus || [])[0];
      const fcuTag = firstFcu
        ? { tagGroupId, taggedAssetId: firstFcu.assetId, taggedAssetCode: firstFcu.code, taggedAssetName: firstFcu.name }
        : cuTag; // FCU-only fallback: tag accessories to the CU
      // Set Qty multiplies every line: CU = m, FCU = FCU Qty × m, accessory = Accessory Qty × m.
      const m = Number(it.masterQty) || 1;
      if (it.cuAssetId) push(it.cuAssetId, it.cuCode, it.cuName, m, { tagGroupId, category: 'CU' });
      (it.fcus || []).forEach((f: any) => push(f.assetId, f.code, f.name, (Number(f.qty) || 1) * m, { ...cuTag, category: 'FCU' }));
      (it.accessories || []).forEach((a: any) => push(a.assetId, a.code, a.name, (Number(a.qty) || 1) * m, { ...fcuTag, category: 'Accessory' }));
    }

    // Lump duplicate models into a single line (sum the quantities) so the order
    // shows each model once, even if it was added across multiple quotation rows.
    // Category is kept (it's per-model); the tag is cleared if the model spans
    // different parents (i.e. it's no longer tied to one CU/FCU).
    const merged: any[] = [];
    const byKey: Record<string, any> = {};
    for (const line of out) {
      const key = line.inventoryItemId || line.itemCode;
      if (!key) { merged.push(line); continue; }
      const existing = byKey[key];
      if (existing) {
        existing.quantity = (Number(existing.quantity) || 0) + (Number(line.quantity) || 0);
        existing.amount = (Number(existing.unitPrice) || 0) * existing.quantity;
        if (existing.taggedAssetCode !== line.taggedAssetCode) {
          existing.taggedAssetId = '';
          existing.taggedAssetCode = '';
          existing.taggedAssetName = '';
        }
      } else {
        byKey[key] = { ...line };
        merged.push(byKey[key]);
      }
    }
    return merged;
  }

  /**
   * Enrich each order's linkedDocuments entries with the linked Document's
   * CURRENT status, so the order/list UI can place items into pipeline stages
   * (DO delivered, invoice sent/paid). Stored entries only carry
   * id/name/templateId/itemIds; live status is read fresh from the Document
   * table here. Batched: ONE document.findMany across ALL passed orders (not
   * N queries). Mutates the order object(s) in place. Accepts a single order
   * or an array.
   */
  private async enrichLinkedDocStatuses<T extends { linkedDocuments?: any }>(
    input: T | T[],
    organizationId: string,
  ): Promise<void> {
    const orders = Array.isArray(input) ? input : [input];
    const kinds = ['po', 'do', 'invoice', 'salesOrder'] as const;
    const ids: string[] = [];
    for (const order of orders) {
      const ld: any = order.linkedDocuments;
      if (!ld) continue;
      for (const k of kinds) for (const d of ld[k] || []) if (d?.id) ids.push(d.id);
    }
    if (!ids.length) return;
    const docs = await this.prisma.document.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, status: true },
    });
    const statusById = new Map(docs.map((d) => [d.id, d.status]));
    for (const order of orders) {
      const ld: any = order.linkedDocuments;
      if (!ld) continue;
      for (const k of kinds) {
        if (Array.isArray(ld[k])) {
          ld[k] = ld[k].map((d: any) => ({ ...d, status: statusById.get(d.id) ?? d.status ?? null }));
        }
      }
      (order as any).linkedDocuments = ld;
    }
  }

  async list(organizationId: string, part?: 'native' | 'imported') {
    if (await isWctOrdersEnabled(this.prisma, organizationId)) return this.listWct(organizationId, part);
    const orders = await this.prisma.order.findMany({
      where: { organizationId, ...NOT_IMPORTED_NUMBER },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        // project reached via the source quotation's projectId (Order has no
        // direct project link). Null when the quotation wasn't project-linked.
        sourceQuotation: {
          select: {
            id: true,
            name: true,
            status: true,
            type: true,
            documentTemplateId: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
    });
    // List now enriches linked-doc statuses too, so the slim board can filter
    // DO/Invoice pipeline stages client-side without an extra round-trip.
    await this.enrichLinkedDocStatuses(orders, organizationId);
    return orders;
  }

  async getById(id: string, organizationId: string, viewer?: { userId?: string | null; isAdmin?: boolean }) {
    const imported = await this.importedOrderView(id, organizationId, viewer);
    if (imported) return imported;
    if (await isWctOrdersEnabled(this.prisma, organizationId)) return this.getWctById(id, organizationId);
    const order = await this.prisma.order.findFirst({
      where: { id, organizationId },
      include: {
        customer: { select: { id: true, name: true, customerCode: true, address: true } },
        sourceQuotation: { select: { id: true, name: true, status: true, type: true, documentTemplateId: true } },
      },
    });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);

    // Enrich linked-document entries with their CURRENT status (see helper).
    await this.enrichLinkedDocStatuses(order, organizationId);
    return order;
  }

  async updateStatus(id: string, organizationId: string, status: string) {
    await assertNotImportedOrder(this.prisma, organizationId, id);
    return this.prisma.order.update({
      where: { id, organizationId },
      data: { status },
    });
  }

  /**
   * Replace the order's items snapshot. Used by the order page to persist
   * per-item discount edits (Project orders let the user re-distribute the
   * quotation discount across lines while keeping the total discount fixed).
   */
  async updateItems(id: string, organizationId: string, items: any[]) {
    await assertNotImportedOrder(this.prisma, organizationId, id);
    const order = await this.prisma.order.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    return this.prisma.order.update({
      where: { id, organizationId },
      data: { items: (items || []) as Prisma.InputJsonValue },
    });
  }

  /**
   * Append a linked document reference to the order's linkedDocuments bucket.
   * docKind is one of 'po' / 'do' / 'invoice' / 'salesOrder'. Idempotent on
   * the docId. Buckets initialise lazily so older orders without a salesOrder
   * key still accept SO links.
   */
  async linkDocument(
    orderId: string,
    organizationId: string,
    docKind: 'po' | 'do' | 'invoice' | 'salesOrder',
    docRef: { id: string; name: string; templateId?: string; itemIds?: number[] },
  ) {
    await assertNotImportedOrder(this.prisma, organizationId, orderId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      select: { linkedDocuments: true },
    });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    const bucket: any = (order.linkedDocuments as any) || { po: [], do: [], invoice: [], salesOrder: [] };
    const list: any[] = Array.isArray(bucket[docKind]) ? bucket[docKind] : [];
    if (!list.some((d) => d.id === docRef.id)) list.push(docRef);
    bucket[docKind] = list;
    return this.prisma.order.update({
      where: { id: orderId, organizationId },
      data: { linkedDocuments: bucket as Prisma.InputJsonValue },
    });
  }

  async delete(id: string, organizationId: string) {
    await assertNotImportedOrder(this.prisma, organizationId, id);
    // WCT orders: an order with jobs is never deleted from under them (the
    // jobs would lose their order silently). No other org's order has jobs.
    const jobs = await this.prisma.delivery.count({ where: { organizationId, orderId: id } });
    if (jobs > 0) throw new HttpException('This order has jobs. Cancel or delete its jobs first.', HttpStatus.BAD_REQUEST);
    return this.prisma.order.delete({
      where: { id, organizationId },
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // WCT orders (enableWctOrders, 2026-11-01): one order per accepted quotation,
  // its jobs are Delivery runs (Delivery.orderId). The order is made by the
  // quotation→delivery hook; jobs are added with POST /deliveries/scheduled
  // { orderId }. These reads add the jobs and keep the stored status in step.
  // ────────────────────────────────────────────────────────────────────────

  /** Store the status the jobs + invoices say, where it drifted (best-effort). Mutates the rows. */
  private async syncWctStatuses(organizationId: string, orders: Array<{ id: string; status: string }>, orderDos?: Map<string, any[]>) {
    // Eight at a time (2026-11-20): one after another this was ~0.4s per order, so the Orders list of
    // 100 orders took ~40s on dev and timed out in the portal. Same refresh, same result per order.
    const BATCH = 8;
    for (let i = 0; i < orders.length; i += BATCH) {
      await Promise.all(
        orders.slice(i, i + BATCH).map(async (o) => {
          o.status = (await refreshOrderStatus(this.prisma, organizationId, o.id, orderDos ? { orderDos } : undefined)) ?? o.status;
        }),
      );
    }
  }

  /**
   * GET /orders/page (WCT orders list, 2026-11-23; rules in orders-page.ts): one page of the list with its filter,
   * search, sort and counts done here. AIMS orders are built in full (with their status sync, first page only);
   * imported orders are filtered, counted and sorted in SQL and only the page's ones are built.
   */
  async listPage(organizationId: string, q: { source?: string; tab?: string; q?: string; sort?: string; dir?: string; offset?: string | number; limit?: string | number }) {
    if (!(await isWctOrdersEnabled(this.prisma, organizationId))) throw new HttpException('Not available for this company', HttpStatus.NOT_FOUND);
    const importedOn = await isImportedOrdersEnabled(this.prisma, organizationId);
    const flow = await isOrgFeatureEnabled(this.prisma as any, organizationId, 'enableWctStatusFlow');
    const source: OrderSource = q.source === 'aims' || q.source === 'imported' ? q.source : importedOn ? 'all' : 'aims';
    const tab = String(q.tab || 'all');
    const search = String(q.q || '').trim().slice(0, 80);
    const offset = Math.max(0, Math.min(100000, Number(q.offset) || 0));
    const limit = Math.max(1, Math.min(200, Number(q.limit) || PAGE_SIZE));
    const { key, desc } = parseSort(q.sort, q.dir);

    const wantNative = source !== 'imported';
    const wantImported = importedOn && source !== 'aims';
    const like = search ? `%${search.replace(/[\\%_]/g, (ch) => '\\' + ch)}%` : null;
    const impStatus = importedStatusOfTab(tab);
    const IMP_WHERE = `o."organizationId" = $1 AND o."orderNumber" LIKE 'ORD-Q-%' AND o."linkedDocuments"->'imported'->>'source' = '${IMPORTED_ORDER_SOURCE}'`;
    const SEARCH = `($2::text IS NULL OR o."orderNumber" ILIKE $2 OR c.name ILIKE $2 OR c."customerCode" ILIKE $2 OR q.name ILIKE $2
      OR o."linkedDocuments"->'imported'->>'subject' ILIKE $2 OR o."linkedDocuments"->'imported'->>'site' ILIKE $2)`;
    const FROM = `FROM "Order" o LEFT JOIN "Customer" c ON c.id = o."customerId" LEFT JOIN "Document" q ON q.id = o."sourceQuotationId"`;
    const numericKey = key !== 'orderNumber' && key !== 'customer';
    const orderExpr = importedSortSql(key);

    // One DO scan for the whole request (the AIMS rows and the page's imported rows share it).
    const nativeIds = (await this.prisma.order.findMany({ where: { organizationId, ...NOT_IMPORTED_NUMBER }, select: { id: true } })).map((o: any) => o.id);
    const orderDosP = orderDosByOrder(this.prisma, organizationId, nativeIds).catch(() => undefined);
    const [nativeAll, importedCounts, importedPage, nativeCount] = await Promise.all([
      wantNative ? orderDosP.then((orderDos) => this.listWct(organizationId, 'native', { sync: offset === 0, orderDos }) as Promise<any[]>) : Promise.resolve([] as any[]),
      importedOn
        ? (this.prisma as any).$queryRawUnsafe(`SELECT o.status, count(*)::int AS n FROM "Order" o WHERE ${IMP_WHERE} GROUP BY o.status`, organizationId)
        : Promise.resolve([]),
      wantImported && impStatus !== undefined
        ? (this.prisma as any).$queryRawUnsafe(
            `SELECT o.id::text AS id, ${orderExpr}${numericKey ? '::float8' : ''} AS v, count(*) OVER ()::int AS total ${FROM}
              WHERE ${IMP_WHERE} AND ${SEARCH} AND ($3::text IS NULL OR o.status = $3)
              ORDER BY v ${desc ? 'DESC' : 'ASC'}, o.id::text ASC LIMIT ${offset + limit}`,
            organizationId,
            like,
            impStatus,
          )
        : Promise.resolve([]),
      // The AIMS count for the source picker when the AIMS rows are not built (Imported view).
      Promise.resolve(nativeIds.length),
    ]);
    const counts: Record<string, number> = {};
    for (const r of importedCounts as any[]) counts[String(r.status)] = Number(r.n) || 0;
    const importedTotalAll = Object.values(counts).reduce((t, n) => t + n, 0);

    const nativeShown = nativeAll.filter((o) => nativeMatchesTab(o, tab) && nativeMatchesSearch(o, search));
    const nativeSorted = nativeShown.map((row) => ({ row, v: sortValue(row, key) })).sort((a, b) => compareRows({ v: a.v, id: a.row.id }, { v: b.v, id: b.row.id }, desc));
    const imp = (importedPage as any[]).map((r) => ({ id: r.id, v: numericKey ? Number(r.v) : String(r.v ?? '') }));
    const importedTotal = (importedPage as any[])[0]?.total ?? 0;
    const slice = mergePage(nativeSorted, imp, desc, offset, limit);

    // Build only the page's imported rows, in the page's order.
    const pageIds = slice.filter((x): x is { kind: 'imported'; id: string } => x.kind === 'imported').map((x) => x.id);
    const built = pageIds.length ? await this.importedListRows(organizationId, await orderDosP, pageIds) : [];
    const byId = new Map(built.map((r: any) => [r.id, r]));
    const rows = slice.map((x) => (x.kind === 'native' ? x.row : byId.get(x.id))).filter(Boolean);

    const sourceNative = wantNative ? nativeAll.length : 0;
    return {
      rows,
      offset,
      limit,
      total: nativeShown.length + importedTotal,
      hasMore: offset + rows.length < nativeShown.length + importedTotal,
      source,
      tab,
      sort: { key, dir: desc ? 'desc' : 'asc' },
      tabs: orderTabs(wantNative ? nativeAll : [], wantImported ? counts : {}, { flow, source }),
      sources: { aims: wantNative ? sourceNative : Number(nativeCount) || 0, imported: importedOn ? importedTotalAll : 0 },
    };
  }

  private async listWct(organizationId: string, part?: 'native' | 'imported', opts: { sync?: boolean; orderDos?: Map<string, any[]> } = {}) {
    if (part === 'imported') return this.importedListRows(organizationId, await orderDosByOrder(this.prisma, organizationId).catch(() => undefined));
    const rows = await this.prisma.order.findMany({
      where: { organizationId, ...NOT_IMPORTED_NUMBER },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        sourceQuotation: { select: { id: true, name: true, status: true, type: true, documentTemplateId: true, config: true } },
        deliveries: {
          select: { id: true, deliveryNumber: true, status: true, isDraft: true, scheduledFor: true, scheduledAllDay: true, verificationState: true, siteAddress: true, orderInvoiceId: true, items: { select: { documentId: true } } },
          orderBy: { deliveryNumber: 'asc' },
        },
      },
    });
    const orders = rows.map(({ deliveries, ...o }: any) => ({ ...o, jobs: deliveries as any[] }));
    // 2026-11-22: the org's DOs on orders, read once (lean) for the status sync, the imported orders and their DO cells.
    const orderDos = opts.orderDos ?? (await orderDosByOrder(this.prisma, organizationId, orders.map((o: any) => o.id)).catch(() => undefined));
    // The paged list syncs on its first page only (Load more reads the stored statuses).
    if (opts.sync !== false) await this.syncWctStatuses(organizationId, orders, orderDos);
    const hub = await this.wctListHub(organizationId, orders);
    const now = Date.now();
    const imported = part === 'native' ? [] : await this.importedListRows(organizationId, orderDos);
    const native = orders.map(({ jobs, ...o }) => {
      const live = jobs.filter((j) => j.status !== 'cancelled');
      // An all-day job (2026-11-10) stays upcoming until the end of its day, and
      // sorts after the timed jobs of that day.
      const next = live
        .filter((j) => !j.isDraft && j.status === 'scheduled' && j.scheduledFor && dueBy(j)!.getTime() >= now)
        .sort(bySchedule())[0];
      const upcoming = next ? new Date(next.scheduledFor).toISOString() : undefined;
      return {
        ...o,
        statusLabel: o.status === MARKED_COMPLETE ? 'Complete' : WCT_ORDER_STATUS_LABEL[o.status as WctOrderStatus] ?? MANUAL_ORDER_STATUS_LABEL[o.status as ManualOrderStatus] ?? o.status,
        jobCounts: {
          total: live.length,
          drafts: live.filter((j) => j.isDraft).length,
          completed: live.filter((j) => !j.isDraft && j.status === 'completed').length,
          awaitingVerification: live.filter((j) => j.status === 'completed' && (j.verificationState === 'pending' || j.verificationState === 'rejected')).length,
          cancelled: jobs.length - live.length,
        },
        nextJobAt: upcoming ?? null,
        nextJobAllDay: !!next?.scheduledAllDay,
        ...hub(o, jobs),
        sourceQuotation: o.sourceQuotation ? { id: o.sourceQuotation.id, name: o.sourceQuotation.name, status: o.sourceQuotation.status, type: o.sourceQuotation.type, documentTemplateId: o.sourceQuotation.documentTemplateId } : null,
      };
    });
    return imported.length ? [...native, ...imported] : native;
  }

  // ── Imported orders (enableImportedOrders, 2026-11-18; imported-orders.ts) ──
  // Rows made by scripts/wct-imported-orders.ts from the old ERP's own quotation
  // <-> invoice links. Read-only; listed and opened only while the setting is on.

  /** The imported orders' list rows (setting on), after the native ones. Status re-read from the invoices' money where not yet Paid. */
  private async importedListRows(organizationId: string, orderDos?: Map<string, any[]>, onlyIds?: string[]): Promise<any[]> {
    if (!(await isImportedOrdersEnabled(this.prisma, organizationId))) return [];
    if (onlyIds && !onlyIds.length) return [];
    const rows: any[] = (
      await this.prisma.order.findMany({
        // onlyIds (the paged list, 2026-11-23): just the page's imported orders.
        where: { organizationId, orderNumber: { startsWith: IMPORTED_NUMBER_PREFIX }, ...(onlyIds ? { id: { in: onlyIds } } : {}) },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          createdAt: true,
          linkedDocuments: true,
          customer: { select: { id: true, name: true, customerCode: true } },
          sourceQuotation: { select: { id: true, name: true, status: true, type: true, documentTemplateId: true } },
        },
      })
    ).filter((o: any) => isImportedOrder(o));
    // Payments can still land on an open imported invoice: re-read those orders' invoices (Paid ones stay Paid).
    // Paid and Complete orders keep their status (a completion wins over the money; Reopen re-reads it), unless the
    // order holds AIMS documents or links (round 19): those can change without the import, so they are re-read too.
    const open = rows.filter((o) => (o.status !== 'PAID' && o.status !== 'COMPLETED') || hasAimsLinks(o));
    const inputs = await loadImportedOrderInputs(this.prisma, organizationId, open.map((o) => ({ id: o.id, sourceQuotationId: o.sourceQuotation?.id ?? null, linkedDocuments: o.linkedDocuments })), { orderDos, lean: true });
    const labels = new Map<string, string>();
    const pcts = new Map<string, number | null>();
    for (const o of open) {
      const st = importedStatusFrom(o, inputs.get(o.id)!);
      labels.set(o.id, st.label);
      pcts.set(o.id, st.billedPct);
      if (st.status !== o.status) {
        await this.prisma.order.update({ where: { id: o.id }, data: { status: st.status } });
        o.status = st.status;
      }
    }
    // Round 38: the DO(s) cell also lists the order's linked DOs (the old ERP DOs) and the AIMS DOs made on it, and
    // the "+" cells follow the order page (Add DO in the manual flow, Create invoice with the quotation).
    const manualFlow = await isManualOrderFlow(this.prisma, organizationId);
    const aimsDos = orderDos ? aimsDoNamesFrom(orderDos) : await this.aimsDoNamesByOrder(organizationId);
    return rows.map((o) => {
      const m: any = importedMarkerOf(o);
      const doNumbers = importedDoNumbers(m?.erpDoNumbers, (o.linkedDocuments as any)?.do, aimsDos.get(o.id) ?? []);
      const invoiceRefs = this.importedInvoiceRefs(o);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        statusLabel: labels.get(o.id) ?? IMPORTED_STATUS_TEXT[o.status] ?? 'Invoiced',
        // Billed % (imported only): billed / quotation total, from the order's own links when not re-read above.
        billedPct: pcts.has(o.id) ? pcts.get(o.id) : this.importedBilledPctFromLinks(o),
        imported: true,
        createdAt: o.createdAt,
        customer: o.customer ?? null,
        sourceQuotation: o.sourceQuotation ?? null,
        subject: m?.subject ?? null,
        site: m?.site ?? null,
        deliveryOrders: [],
        erpDoNumbers: Array.isArray(m?.erpDoNumbers) ? m.erpDoNumbers : [],
        doNumbers,
        invoices: invoiceRefs.map((r) => ({ id: r.id, name: r.name, type: 'INVOICE', status: '', templateId: r.templateId ?? null, total: Number(r.total) || 0 })),
        add: importedListAdd({ hasQuotation: !!o.sourceQuotation, doCount: doNumbers.length, invoiceCount: invoiceRefs.length }, { manualFlow }),
        amount: Number.isFinite(Number(m?.total)) ? Number(m.total) : null,
        jobCounts: { total: 0, drafts: 0, completed: 0, awaitingVerification: 0, cancelled: 0 },
        nextJobAt: null,
        nextJobAllDay: false,
        actionJobs: { draft: null, scheduled: null, completed: null },
        actionDos: { draft: null, open: null, awaiting: null, completed: null },
        serviceReportReady: false,
      };
    });
  }

  /** Round 38: the names of the AIMS DOs made on an order (config.orderId; not the imported ERP DOs, not cancelled), per order id. */
  private async aimsDoNamesByOrder(organizationId: string): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    // A failed read leaves the cells as before (ERP DO numbers and linked DOs only); the list itself still loads.
    try {
      const rows: Array<{ name: string | null; orderId: string | null }> = await (this.prisma as any).$queryRawUnsafe(
        `SELECT d.name, d.config->>'orderId' AS "orderId" FROM "Document" d
          WHERE d."organizationId" = $1 AND d.type IN ('DELIVERY_ORDER', 'DO') AND d.config->>'orderId' IS NOT NULL AND d.config->'erpImport' IS NULL
            AND COALESCE(d.config->>'cancelled', '') <> 'true' AND COALESCE(d.config->>'voided', '') <> 'true'`,
        organizationId,
      );
      for (const r of rows ?? []) if (r.orderId && r.name) out.set(r.orderId, [...(out.get(r.orderId) ?? []), r.name]);
    } catch (e: any) {
      console.warn(`aimsDoNamesByOrder ${organizationId}: ${e?.message}`);
    }
    return out;
  }

  /** Billed % from the order's stored links (invoice totals, credits, quotation total), no document read. */
  private importedBilledPctFromLinks(order: { linkedDocuments?: unknown }): number | null {
    const m: any = importedMarkerOf(order) || {};
    if (typeof m.billedPct === 'number') return m.billedPct;
    const billed = this.importedInvoiceRefs(order).reduce((t, r) => t + Math.max(0, (Number(r.total) || 0) - (Number(m.credits?.[r.id]) || 0)), 0);
    return billedPercent(Math.round(billed * 100) / 100, m.quoteTotal ?? null);
  }

  private importedInvoiceRefs(order: { linkedDocuments?: unknown }): Array<{ id: string; name: string | null; templateId?: string | null; total?: number }> {
    const list = (order.linkedDocuments as any)?.invoice;
    return Array.isArray(list) ? list.filter((x: any) => x && typeof x.id === 'string') : [];
  }

  /**
   * Imported orders (2026-11-19): "Mark complete" (a reason is required) and "Reopen", on any imported order. The
   * mark is stored on the order's imported marker (linkedDocuments.imported.completed) and wins over the
   * money-based status; Reopen removes it and the status is read from the invoices again. The quotation and the
   * imported invoices are not touched. Activity Log: the HTTP rows (mark-complete / reopen).
   */
  async markImportedComplete(id: string, organizationId: string, body: any, actor: { id?: string | null; name?: string | null }) {
    const reason = String(body?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!reason) throw new HttpException('Give a reason for marking this order complete', HttpStatus.BAD_REQUEST);
    // Round 29: an AIMS order of a WCT org takes the same mark (linkedDocuments.completed, wct-orders.ts).
    const native = await this.nativeOrderForMark(id, organizationId);
    if (native) {
      if (native.status === 'CANCELLED') throw new HttpException('This order is cancelled', HttpStatus.BAD_REQUEST);
      const ld: any = native.linkedDocuments && typeof native.linkedDocuments === 'object' ? native.linkedDocuments : {};
      const completed = { at: new Date().toISOString(), by: actor.id ?? null, byName: actor.name ?? null, reason, underlying: native.status };
      await this.prisma.order.update({ where: { id: native.id }, data: { linkedDocuments: { ...ld, completed } } });
      const status = await refreshOrderStatus(this.prisma, organizationId, native.id);
      return { id: native.id, orderNumber: native.orderNumber, status: status ?? MARKED_COMPLETE, reason };
    }
    const row = await this.importedOrderRow(id, organizationId);
    const ld: any = row.linkedDocuments || {};
    const completed = { at: new Date().toISOString(), by: actor.id ?? null, byName: actor.name ?? null, reason, auto: false };
    await this.prisma.order.update({ where: { id: row.id }, data: { linkedDocuments: { ...ld, imported: { ...ld.imported, completed } } } });
    await refreshImportedOrderStatus(this.prisma, organizationId, row.id);
    return this.importedOrderView(row.id, organizationId);
  }

  async reopenImported(id: string, organizationId: string) {
    const native = await this.nativeOrderForMark(id, organizationId);
    if (native) {
      if (!nativeCompletionOf(native)) throw new HttpException('This order is not marked complete', HttpStatus.BAD_REQUEST);
      const { completed: _c, ...ld } = (native.linkedDocuments as any) || {};
      await this.prisma.order.update({ where: { id: native.id }, data: { linkedDocuments: ld } });
      // The status is worked out from the order's documents again.
      const status = await refreshOrderStatus(this.prisma, organizationId, native.id);
      return { id: native.id, orderNumber: native.orderNumber, status };
    }
    const row = await this.importedOrderRow(id, organizationId);
    const ld: any = row.linkedDocuments || {};
    if (!importedCompletionOf(row)) throw new HttpException('This order is not marked complete', HttpStatus.BAD_REQUEST);
    const { completed: _c, ...imported } = ld.imported || {};
    await this.prisma.order.update({ where: { id: row.id }, data: { linkedDocuments: { ...ld, imported } } });
    await refreshImportedOrderStatus(this.prisma, organizationId, row.id);
    return this.importedOrderView(row.id, organizationId);
  }

  /** An AIMS order of a WCT org, for Mark complete / Reopen (round 29); null for an imported order or another org (unchanged path). */
  private async nativeOrderForMark(id: string, organizationId: string) {
    const row: any = await this.prisma.order.findFirst({ where: { id, organizationId }, select: { id: true, orderNumber: true, status: true, linkedDocuments: true } });
    if (!row || isImportedOrder(row) || !(await isWctOrdersEnabled(this.prisma, organizationId))) return null;
    return row as { id: string; orderNumber: string; status: string; linkedDocuments: any };
  }

  private async importedOrderRow(id: string, organizationId: string) {
    const row = await this.prisma.order.findFirst({ where: { id, organizationId }, select: { id: true, linkedDocuments: true } });
    if (!row) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    if (!isImportedOrder(row)) throw new HttpException('Only an order imported from the old ERP can be marked complete or reopened', HttpStatus.BAD_REQUEST);
    if (!(await isImportedOrdersEnabled(this.prisma, organizationId))) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    return row;
  }

  // ── Imported orders: "Link existing document" / "Unlink" (round 19, 2026-11-19; imported-order-links.ts) ──
  // The link lives on the order only; the linked document is never written. One order per document.
  // Activity Log: the HTTP rows (link-document LINK / unlink-document UNLINK) with req.actionLogResult naming both.

  /**
   * The order a link / unlink works on, with its customer (the order's, else its quotation's): an imported order
   * (setting on), or (round 24, 2026-11-19, one order page for both) an AIMS WCT order. An AIMS order LINKS a service
   * report, and on the manual order flow an INVOICE (Elroy 2026-11-19, ORD202611-011: an invoice made from the
   * quotation in the editor that never went on the order): it goes on linkedDocuments.invoice (+ invoiceDocumentId
   * when empty) and the status is read again, exactly as the order's own invoices; the invoice itself is never
   * written. Round 29: an AIMS order also links a QUOTATION (adds to its quotation total / summary; it gets no order
   * of its own when accepted) and a DO (linkedDocuments.do: one of the order's DOs in its status and on its page,
   * the DO itself never written).
   * UNLINK takes any linked document of either kind by the same rules (never the order's own quotation, never a
   * document made on the order, never an invoice a job / DO of the order is billed on).
   */
  private async importedLinkOrder(id: string, organizationId: string, type: ImportedLinkType, mode: 'link' | 'unlink' = 'link') {
    const row: any = await this.prisma.order.findFirst({
      where: { id, organizationId },
      select: { id: true, orderNumber: true, customerId: true, sourceQuotationId: true, invoiceDocumentId: true, linkedDocuments: true, attachments: true },
    });
    if (!row) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    const native = !isImportedOrder(row);
    if (native) {
      if (!(await isWctOrdersEnabled(this.prisma, organizationId))) throw new HttpException('Link existing document is for orders imported from the old ERP', HttpStatus.BAD_REQUEST);
      // Round 29: quotations, DOs and service reports on every WCT AIMS order. Round 40 (Elroy 2026-11-20): invoices on
      // every WCT order too (Racking's order reads its linked invoices: wct-orders remainderInvoiceIdsOf).
    } else if (!(await isImportedOrdersEnabled(this.prisma, organizationId))) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    let customerId: string | null = row.customerId ?? null;
    if (!customerId && row.sourceQuotationId) {
      const q = await this.prisma.document.findFirst({ where: { id: row.sourceQuotationId, organizationId }, select: { config: true } });
      customerId = docCustomerIdOf(q?.config);
    }
    return { ...row, customerId, native } as { id: string; orderNumber: string; customerId: string | null; sourceQuotationId: string | null; invoiceDocumentId: string | null; linkedDocuments: any; attachments: any; native: boolean };
  }

  /**
   * GET /orders/:id/link-options?type=&q=: the order customer's documents of that type whose number contains q
   * (a service report: its number), newest first, 20 at most, each with the order it is already on.
   */
  async importedLinkOptions(id: string, organizationId: string, query: { type?: string; q?: string }) {
    const type = parseLinkType(query?.type);
    const order = await this.importedLinkOrder(id, organizationId, type);
    if (!order.customerId) return [];
    const q = searchTerm(query?.q);
    const where = (holders: Array<{ id: string; orderNumber: string }> | undefined) => {
      const other = (holders ?? []).find((h) => h.id !== order.id);
      return { onOrder: other ? { id: other.id, orderNumber: other.orderNumber } : null, onThisOrder: (holders ?? []).some((h) => h.id === order.id) };
    };
    if (type === 'SERVICE_REPORT') {
      const n = q ? reportNumberOf(q) : null;
      if (q && n == null) return [];
      const rows: any[] = await this.prisma.maintenanceServiceReport.findMany({
        where: {
          organizationId,
          kind: 'SERVICE',
          ...(n != null ? { reportNumber: n } : {}),
          OR: [{ serviceData: { path: ['customerId'], equals: order.customerId } }, { delivery: { customerId: order.customerId } }],
        } as any,
        select: { id: true, reportNumber: true, status: true, createdAt: true, deliveryId: true, serviceData: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      const live = rows.filter((r) => !(r.serviceData as any)?.deletedAt);
      const holders = await orderHoldersOf(this.prisma, organizationId, type, live.map((r) => ({ id: r.id, serviceData: r.serviceData, deliveryId: r.deliveryId })));
      return live.map((r) => ({
        id: r.id,
        type,
        name: r.reportNumber ? `Service report #${r.reportNumber}` : 'Service report (draft)',
        date: (r.serviceData as any)?.serviceDate ?? r.createdAt,
        status: r.status === 'completed' ? 'Completed' : 'Draft',
        total: null,
        imported: false,
        ...where(holders.get(r.id)),
      }));
    }
    const rows: any[] = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: { in: DOC_TYPES_FOR[type] },
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        OR: [{ config: { path: ['customerId'], equals: order.customerId } }, { config: { path: ['customer', 'id'], equals: order.customerId } }],
      } as any,
      select: { id: true, name: true, type: true, status: true, documentTemplateId: true, config: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const live = rows.filter((d) => !isDeadDoc(d));
    const holders = await orderHoldersOf(this.prisma, organizationId, type, live.map((d) => ({ id: d.id, config: d.config })));
    return live.map((d) => ({
      id: d.id,
      type,
      name: d.name,
      date: d.config?.date ?? d.createdAt,
      status: d.status,
      total: grossOf(d.config),
      imported: isErpImported(d.config),
      ...where(holders.get(d.id)),
    }));
  }

  /**
   * POST /orders/:id/link-document { type, id }: put an existing quotation / invoice / DO / service report of the
   * same customer on this imported order. Refused when it is on another order (named) or already on this one.
   */
  async linkImportedDocument(id: string, organizationId: string, body: { type?: string; id?: string }, actor: { id?: string | null; name?: string | null }) {
    const type = parseLinkType(body?.type);
    const order = await this.importedLinkOrder(id, organizationId, type);
    const docId = String(body?.id ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(docId)) throw new HttpException('Pick the document to link', HttpStatus.BAD_REQUEST);
    if (!order.customerId) throw new HttpException('This order has no customer, so nothing can be linked to it', HttpStatus.BAD_REQUEST);
    const stamp: LinkStamp = { at: new Date().toISOString(), by: actor.id ?? null, byName: actor.name ?? null };
    if (type === 'SERVICE_REPORT') {
      const r: any = await this.prisma.maintenanceServiceReport.findFirst({
        where: { id: docId, organizationId, kind: 'SERVICE' },
        select: { id: true, reportNumber: true, deliveryId: true, serviceData: true, delivery: { select: { customerId: true } } },
      });
      if (!r || (r.serviceData as any)?.deletedAt) throw new HttpException('Service report not found', HttpStatus.NOT_FOUND);
      const name = r.reportNumber ? `Service report #${r.reportNumber}` : 'This service report';
      const cust = (r.serviceData as any)?.customerId ?? r.delivery?.customerId ?? null;
      if (cust !== order.customerId) throw new HttpException(`${name} is for another customer`, HttpStatus.BAD_REQUEST);
      const holders = (await orderHoldersOf(this.prisma, organizationId, type, [{ id: r.id, serviceData: r.serviceData, deliveryId: r.deliveryId }])).get(r.id) ?? [];
      const why = holderRefusal(name, order.id, holders);
      if (why) throw new HttpException(why, HttpStatus.BAD_REQUEST);
      // The order's own "link a service report" (an attachment of kind report), as on a native order.
      await this.addOrderAttachment(order.id, organizationId, { kind: 'report', reportId: r.id, label: 'Service report' }, { id: actor.id ?? undefined, name: actor.name ?? undefined });
      return { type, id: r.id, name, orderNumber: order.orderNumber };
    }
    const doc: any = await this.prisma.document.findFirst({ where: { id: docId, organizationId }, select: { id: true, name: true, type: true, status: true, documentTemplateId: true, config: true } });
    if (!doc || !DOC_TYPES_FOR[type].includes(String(doc.type).toUpperCase())) throw new HttpException(`${LINK_TYPE_LABEL[type]} not found`, HttpStatus.NOT_FOUND);
    const name = doc.name || `This ${LINK_TYPE_LABEL[type].toLowerCase()}`;
    if (isDeadDoc(doc)) throw new HttpException(`${name} is voided or cancelled`, HttpStatus.BAD_REQUEST);
    if (docCustomerIdOf(doc.config) !== order.customerId) throw new HttpException(`${name} is for another customer`, HttpStatus.BAD_REQUEST);
    const linkType = type as Exclude<ImportedLinkType, 'SERVICE_REPORT'>;
    const manualFlow = order.native && linkType === 'INVOICE' ? await isManualOrderFlow(this.prisma, organizationId) : false;
    await this.prisma.$transaction(
      async (tx: any) => {
        // One document at a time (two orders linking it at once), then the order's links (same lock as its invoices).
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-link-doc:${doc.id}`);
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${order.id}`);
        const holders = (await orderHoldersOf(tx, organizationId, type, [{ id: doc.id, config: doc.config }])).get(doc.id) ?? [];
        const why = holderRefusal(name, order.id, holders);
        if (why) throw new HttpException(why, HttpStatus.BAD_REQUEST);
        const fresh = await tx.order.findFirst({ where: { id: order.id, organizationId }, select: { linkedDocuments: true, invoiceDocumentId: true } });
        await tx.order.update({
          where: { id: order.id },
          data: {
            linkedDocuments: withLinkedDocument(fresh?.linkedDocuments, linkType, doc, stamp),
            // An AIMS order's invoice (round 24): also its order invoice when it has none yet, as the order's own.
            // Round 40: only on the manual flow (another WCT order lists a linked invoice through its link entry).
            ...(order.native && linkType === 'INVOICE' && !fresh?.invoiceDocumentId && manualFlow ? { invoiceDocumentId: doc.id } : {}),
          },
        });
      },
      { timeout: 30000 },
    );
    await refreshOrderStatus(this.prisma, organizationId, order.id);
    return { type, id: doc.id, name: doc.name ?? null, orderNumber: order.orderNumber };
  }

  /**
   * POST /orders/:id/unlink-document { type, id }: take a linked document off this imported order. Never the order's
   * own quotation, never a document made on the order (void / cancel that instead), never a report written for it.
   */
  async unlinkImportedDocument(id: string, organizationId: string, body: { type?: string; id?: string }, actor: { id?: string | null; name?: string | null }) {
    const type = parseLinkType(body?.type);
    const order = await this.importedLinkOrder(id, organizationId, type, 'unlink');
    const docId = String(body?.id ?? '').trim();
    if (!docId) throw new HttpException('Pick the document to unlink', HttpStatus.BAD_REQUEST);
    const stamp: LinkStamp = { at: new Date().toISOString(), by: actor.id ?? null, byName: actor.name ?? null };
    if (type === 'SERVICE_REPORT') {
      const att = (Array.isArray(order.attachments) ? (order.attachments as any[]) : []).find((a) => a?.kind === 'report' && a.reportId === docId);
      if (!att) throw new HttpException('This service report is not linked on this order (a report written for its DO or job stays with it)', HttpStatus.BAD_REQUEST);
      await this.removeOrderAttachment(order.id, organizationId, att.id);
      return { type, id: docId, name: att.reportNumber ? `Service report #${att.reportNumber}` : 'Service report', orderNumber: order.orderNumber };
    }
    if (type === 'QUOTATION' && docId === order.sourceQuotationId) throw new HttpException("The order's own quotation cannot be unlinked", HttpStatus.BAD_REQUEST);
    const doc: any = await this.prisma.document.findFirst({ where: { id: docId, organizationId }, select: { id: true, name: true, type: true, config: true } });
    const linkType = type as Exclude<ImportedLinkType, 'SERVICE_REPORT'>;
    const entry = linkEntryOf(order.linkedDocuments, linkType, docId);
    const name = doc?.name ?? entry?.name ?? 'This document';
    if (!entry) throw new HttpException(`${name} is not linked on this order`, HttpStatus.BAD_REQUEST);
    if (madeOnOrder(doc, order.id)) throw new HttpException(`${name} was made on this order: ${type === 'INVOICE' ? 'void' : 'cancel'} it instead of unlinking it`, HttpStatus.BAD_REQUEST);
    // Round 24: never an invoice a job or a DO of this order is billed on, never a DO a job of this order carries
    // (that link lives on the job / DO, so unlinking only the order's entry would leave them pointing at it).
    const why = await this.billedOnOrderWork(organizationId, order.id, type, docId, name, order.linkedDocuments);
    if (why) throw new HttpException(why, HttpStatus.BAD_REQUEST);
    await this.prisma.$transaction(
      async (tx: any) => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${order.id}`);
        const fresh = await tx.order.findFirst({ where: { id: order.id, organizationId }, select: { linkedDocuments: true } });
        const ld: any = fresh?.linkedDocuments || {};
        if (!linkEntryOf(ld, linkType, docId)) throw new HttpException(`${name} is not linked on this order`, HttpStatus.BAD_REQUEST);
        // An invoice takes its credit notes off the order with it.
        const cnRefs: string[] = type === 'INVOICE' && Array.isArray(ld.creditNote) ? ld.creditNote.map((x: any) => x?.id).filter(Boolean) : [];
        const cnIds = cnRefs.length
          ? (await tx.document.findMany({ where: { organizationId, id: { in: cnRefs } }, select: { id: true, config: true } })).filter((c: any) => c.config?.sourceDocumentId === docId).map((c: any) => c.id)
          : [];
        const erp = isErpImported(doc?.config) || entry.imported === true;
        const head: any = await tx.order.findFirst({ where: { id: order.id, organizationId }, select: { invoiceDocumentId: true } });
        await tx.order.update({
          where: { id: order.id },
          data: {
            linkedDocuments: withoutLinkedDocument(ld, linkType, docId, { erp, creditNoteIds: cnIds, stamp }),
            // The order invoice goes with it (else the order would still read it as its invoice).
            ...(linkType === 'INVOICE' && head?.invoiceDocumentId === docId ? { invoiceDocumentId: null } : {}),
          },
        });
      },
      { timeout: 30000 },
    );
    await refreshOrderStatus(this.prisma, organizationId, order.id);
    return { type, id: docId, name, orderNumber: order.orderNumber };
  }

  /** Why a document cannot be unlinked because the order's jobs / DOs point at it (null = free). */
  private async billedOnOrderWork(organizationId: string, orderId: string, type: ImportedLinkType, docId: string, name: string, linkedDocuments?: unknown): Promise<string | null> {
    if (type === 'INVOICE') {
      const job = await this.prisma.delivery.findFirst({ where: { organizationId, orderId, orderInvoiceId: docId }, select: { deliveryNumber: true } });
      if (job) return `${name} bills job #${job.deliveryNumber} of this order: void it instead of unlinking it`;
      const d: any = await this.prisma.document.findFirst({ where: { organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] }, AND: [{ config: { path: ['orderId'], equals: orderId } }, { config: { path: ['orderInvoiceId'], equals: docId } }] } as any, select: { name: true } });
      if (d) return `${name} bills ${d.name ?? 'a DO'} of this order: void it instead of unlinking it`;
    }
    if (type === 'DELIVERY_ORDER') {
      const it: any = await this.prisma.deliveryItem.findFirst({ where: { documentId: docId, delivery: { organizationId, orderId, status: { not: 'cancelled' } } } as any, select: { delivery: { select: { deliveryNumber: true } } } });
      if (it) return `${name} is the DO of job #${it.delivery?.deliveryNumber ?? ''} of this order: cancel the job instead of unlinking it`;
      // Round 33: a linked DO billed by Create invoice stays while that invoice is live (void it, and the DO is free again).
      const e = linkedDoEntriesOf({ linkedDocuments }).find((x) => x.id === docId);
      if (e?.orderInvoiceId && String(e.orderInvoiceId).startsWith('claim:')) return `${name} is being invoiced right now: try again in a moment`;
      if (e?.orderInvoiceId && (await liveInvoiceIds(this.prisma, organizationId, [e.orderInvoiceId])).has(e.orderInvoiceId)) {
        const inv = await this.prisma.document.findFirst({ where: { id: e.orderInvoiceId, organizationId }, select: { name: true } });
        return `${name} is billed on ${inv?.name ?? 'an invoice'} of this order: void that invoice first`;
      }
    }
    return null;
  }

  /**
   * The order page for an imported order, or null when the order is not imported.
   * Setting off: the order is not shown (404), as if it were not there.
   * Round 19 (2026-11-19): the order takes the native manual-flow work (its DOs, jobs, service reports and
   * attachments come from the native order page, getWctById) and "Link existing document"; every row says whether
   * it can be unlinked.
   */
  private async importedOrderView(id: string, organizationId: string, viewer?: { userId?: string | null; isAdmin?: boolean }): Promise<any | null> {
    let row: any = null;
    try {
      row = await this.prisma.order.findFirst({
        where: { id, organizationId, orderNumber: { startsWith: IMPORTED_NUMBER_PREFIX } },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          createdAt: true,
          linkedDocuments: true,
          customer: { select: { id: true, name: true, customerCode: true, address: true, email: true } },
          sourceQuotation: { select: { id: true, name: true, status: true, type: true, documentTemplateId: true, config: true } },
        },
      });
    } catch {
      return null;
    }
    if (!row || !isImportedOrder(row)) return null;
    if (!(await isImportedOrdersEnabled(this.prisma, organizationId))) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    // The native order page's parts (DOs, jobs, service reports, files); the status is stored once, below.
    const native: any = await this.importedNativeParts(row.id, organizationId);
    const m: any = importedMarkerOf(row);
    const srcCfg = new Map<string, any>(row.sourceQuotation ? [[row.sourceQuotation.id, row.sourceQuotation.config]] : []);
    const inputs = (await loadImportedOrderInputs(this.prisma, organizationId, [{ id: row.id, sourceQuotationId: row.sourceQuotation?.id ?? null, linkedDocuments: row.linkedDocuments }], { sourceQuotationConfigs: srcCfg })).get(row.id)!;
    const invDocs = inputs.invoiceDocs;
    const st = importedStatusFrom(row, inputs);
    if (st.status !== row.status) {
      await this.prisma.order.update({ where: { id: row.id }, data: { status: st.status } });
      row.status = st.status;
    }
    const qc: any = row.sourceQuotation?.config || {};
    // Linked quotations add their lines to what the order bills (round 19).
    const allQuoteItems = [...(Array.isArray(qc.items) ? qc.items : []), ...inputs.linkedQuotations.flatMap((d: any) => (Array.isArray(d.config?.items) ? d.config.items : []))];
    const quoteNames = [row.sourceQuotation?.name, ...inputs.linkedQuotations.map((d: any) => d.name)].filter(Boolean).join(', ');
    // What is left to bill (2026-11-19): the quotations' lines minus what the counted, not fully credited invoices billed.
    const remaining = remainingForOrder({ marker: m, invoiceDocs: invDocs, quotation: row.sourceQuotation ? { name: quoteNames, config: { ...qc, items: allQuoteItems } } : null, quoteTotal: st.quoteTotal, billed: st.billed });
    // "1 of 2 Paid · 2 of 2 Draft": imported invoices by date, then AIMS ones (drafts last).
    const stateOf = (d: any) => (!isErpImported(d.config) && !isCountedInvoice(d) ? 'Draft' : IMPORTED_INVOICE_STATE_LABEL[importedInvoiceMoney(d, Number(m?.credits?.[d.id]) || creditOfImportedInvoice(d.config)).state]);
    const ordered = [...invDocs].sort((a: any, b: any) => (isCountedInvoice(a) ? 0 : 1) - (isCountedInvoice(b) ? 0 : 1) || String(a.config?.date ?? '').localeCompare(String(b.config?.date ?? '')));
    const steps = billingSteps(allQuoteItems, ordered.map((d: any) => ({ items: Array.isArray(d.config?.items) ? d.config.items : [], state: stateOf(d) })));
    // Round 36: Create invoice takes the org's next INV number (no suggested -02 number any more).
    // A new AIMS invoice made on the order that is still a draft: open it instead of making a second one.
    const draft = importedOrderDraftInvoice(invDocs, row.id);
    const completed = importedCompletionOf(row);
    const ld: any = row.linkedDocuments || {};
    const stampOf = (e: any) => (e?.linked ? { at: e.linked.at ?? null, byName: e.linked.byName ?? null } : null);
    const invEntry = new Map<string, any>(this.importedInvoiceRefs(row).map((r: any) => [r.id, r]));
    // The order's own AIMS DOs (Add DO; not the imported ERP DOs, listed from the order's links below).
    const ownDos: any[] = (native?.deliveryOrders ?? []).filter((d: any) => d.imported !== true && !d.linkedOnly);
    const ownDoIds = new Set(ownDos.map((d: any) => d.id));
    const linkedDoRefs: any[] = (Array.isArray(ld.do) ? ld.do : []).filter((x: any) => x && typeof x.id === 'string');
    const linkedNativeDoIds = linkedDoRefs.filter((x: any) => x.imported !== true && !ownDoIds.has(x.id)).map((x: any) => x.id);
    const linkedNativeDos: any[] = linkedNativeDoIds.length
      ? await this.prisma.document.findMany({ where: { organizationId, id: { in: linkedNativeDoIds } }, select: { id: true, name: true, status: true, documentTemplateId: true, config: true } })
      : [];
    const erpDos = importedDosOf(row) as any[];
    const linkedDos = [
      ...erpDos.map((d: any) => ({ id: d.id ?? null, name: d.name ?? null, templateId: d.templateId ?? null, date: d.date ?? null, done: importedDoDone(d), imported: true, unlinkable: !!d.id, linked: stampOf(d) })),
      ...linkedNativeDos.map((d: any) => ({
        id: d.id,
        name: d.name,
        templateId: d.documentTemplateId,
        date: d.config?.date ?? null,
        done: String(d.status).startsWith('delivered'),
        status: d.status,
        imported: false,
        unlinkable: true,
        linked: stampOf(linkedDoRefs.find((x: any) => x.id === d.id)),
      })),
    ];
    // Cross-company invoices (2026-11-23): a link only for a viewer who belongs to that company; else plain text.
    const placeholders: any[] = inputs.crossPlaceholderDocs ?? [];
    const crossOrgIds = [...new Set([...invDocs, ...placeholders].filter((d: any) => d.crossOrg).map((d: any) => d.crossOrg.orgId))];
    const canOpen = crossOrgIds.length ? (viewer?.isAdmin ? new Set(crossOrgIds) : await memberOrgIds(this.prisma, viewer?.userId ?? null, crossOrgIds)) : new Set<string>();
    const jobReports: any[] = native?.jobReports ?? [];
    const attachments: any[] = native?.attachments ?? [];
    const reportsForTracker = [...jobReports, ...attachments.filter((a: any) => a?.kind === 'report' && a.report && !jobReports.some((r: any) => r.id === a.reportId)).map((a: any) => a.report)];
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      status: st.status,
      statusLabel: st.label,
      imported: true,
      readOnly: false,
      completed: completed ? { reason: completed.reason, at: completed.at, byName: completed.byName, auto: completed.auto } : null,
      remaining: st.status === 'PART_BILLED' || (completed && remaining.remainingGross > 0) ? remaining : null,
      progress: remaining.progress,
      billingSteps: steps,
      // Create invoice's lines: what is left; on an order billed in full the quotations' lines; else one empty line.
      invoiceLines: importedInvoicePrefill(remaining, allQuoteItems),
      dos: erpDos,
      draftInvoice: draft ? { id: draft.id, name: draft.name, templateId: draft.documentTemplateId } : null,
      canInvoice: !draft && !!row.sourceQuotation,
      canComplete: st.status !== 'COMPLETED',
      canReopen: st.status === 'COMPLETED',
      canLink: true,
      billed: st.billed,
      billedPct: st.billedPct,
      quoteTotal: st.quoteTotal,
      credited: st.credited,
      createdAt: row.createdAt,
      customer: row.customer ?? null,
      customerMismatch: Array.isArray(m?.customerMismatch) ? m.customerMismatch : [],
      sourceQuotation: row.sourceQuotation
        ? { id: row.sourceQuotation.id, name: row.sourceQuotation.name, status: row.sourceQuotation.status, type: row.sourceQuotation.type, documentTemplateId: row.sourceQuotation.documentTemplateId, date: qc.date ?? null, total: grossOf(qc), statusLabel: quotationStatusLabel(row.sourceQuotation) }
        : null,
      quotations: inputs.linkedQuotations.map((d: any) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        status: d.status,
        templateId: d.documentTemplateId,
        date: d.config?.date ?? null,
        total: grossOf(d.config),
        unlinkable: true,
        linked: stampOf(linkedQuotationRefsOf(row).find((x: any) => x.id === d.id)),
      })),
      subject: m?.subject ?? (qc.subject || null),
      site: m?.site ?? null,
      erpDoNumbers: Array.isArray(m?.erpDoNumbers) ? m.erpDoNumbers : [],
      tracker: importedTracker(
        {
          erpDoNumbers: m?.erpDoNumbers,
          dos: [
            ...erpDos,
            ...ownDos.map((d: any) => ({ id: d.id, templateId: d.templateId ?? null, name: d.name, done: !!d.completed })),
            ...linkedNativeDos.map((d: any) => ({ id: d.id, templateId: d.documentTemplateId ?? null, name: d.name, done: String(d.status).startsWith('delivered') })),
          ] as any,
          reports: reportsForTracker,
        },
        st,
      ),
      invoices: invDocs.map((d: any) => {
        const money = importedInvoiceMoney(d, Number(m?.credits?.[d.id]) || creditOfImportedInvoice(d.config));
        const own = madeOnOrder(d, row.id);
        const split = invoiceSplitOf(d.config);
        return {
          id: d.id,
          name: d.name,
          type: d.type,
          status: d.status,
          templateId: d.documentTemplateId,
          date: d.config?.date ?? null,
          total: money.gross,
          owed: money.owed,
          credit: money.credit,
          state: money.state,
          stateLabel: !isErpImported(d.config) && !isCountedInvoice(d) ? 'Draft' : IMPORTED_INVOICE_STATE_LABEL[money.state],
          native: !isErpImported(d.config),
          linkSource: m?.linkSources?.[d.id] ?? null,
          erpDoNumber: d.config?.erpImport?.ourDoNo ?? d.config?.erpImport?.doNo ?? null,
          // Unlink: an invoice on the order's link list that was not made on this order (round 19).
          unlinkable: invEntry.has(d.id) && !own,
          // Round 24: Delete is offered only on an AIMS draft with nothing paid (the server decides).
          paid: amountPaidOf(d.config) ?? 0,
          linked: stampOf(invEntry.get(d.id)),
          ...(split ? { split: { part: Number(split.part), of: Number(split.of) } } : {}),
          // Another group company's invoice (read-only here): its company, and whether this viewer may open it there.
          ...(d.crossOrg ? { crossOrg: { orgId: d.crossOrg.orgId, orgName: d.crossOrg.orgName, canOpen: canOpen.has(d.crossOrg.orgId) }, unlinkable: false } : {}),
        };
      }),
      // Another company's $1-or-less "(NG)" placeholders: greyed pills, not counted in Billed / Left to bill / status.
      crossPlaceholders: placeholders.map((d: any) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        templateId: d.documentTemplateId,
        date: d.config?.date ?? null,
        total: grossOf(d.config),
        crossOrg: { orgId: d.crossOrg.orgId, orgName: d.crossOrg.orgName, canOpen: canOpen.has(d.crossOrg.orgId) },
      })),
      creditNotes: inputs.creditNoteDocs.map((d: any) => ({ id: d.id, name: d.name, type: d.type, status: d.status, templateId: d.documentTemplateId, total: grossOf(d.config) })),
      total: st.total,
      owed: st.owed,
      // The native order page's parts (round 19): DOs made on the order, jobs, service reports, files.
      jobs: native?.jobs ?? [],
      deliveryOrders: ownDos,
      linkedDos,
      jobReports,
      attachments,
      manualFlow: native?.manualFlow ?? false,
      prefill: native?.prefill ?? null,
      statusDates: native?.statusDates ?? null,
      // Round 24: the supplier invoices tagged to its quotation, as on an AIMS order (read-only).
      supplierInvoices: native?.supplierInvoices ?? null,
    };
  }

  /** The native order page's parts for an imported order (round 19), or null without WCT orders. Never throws. */
  private async importedNativeParts(id: string, organizationId: string): Promise<any | null> {
    try {
      if (!(await isWctOrdersEnabled(this.prisma, organizationId))) return null;
      return await this.getWctById(id, organizationId, { skipStatusSync: true });
    } catch {
      return null;
    }
  }

  /**
   * WCT orders list as the hub (2026-11-13): per order its subject / site, DO
   * numbers, invoices, amount, the jobs each row action works on, and whether a
   * service report is ready to send. Read-only; two batched queries.
   */
  private async wctListHub(organizationId: string, orders: Array<{ id: string; jobs: any[] }>) {
    const allJobs = orders.flatMap((o) => o.jobs);
    const doIds = [...new Set(allJobs.flatMap((j) => (j.items ?? []).map((i: any) => i.documentId)).filter(Boolean))] as string[];
    // Manual flow: an invoice made first (from the quotation) is on the order before any DO / job points at it.
    const manual = await isManualOrderFlow(this.prisma, organizationId);
    // Round 38: the list's "+" Invoice follows the page's Create invoice, which needs invoicing per order.
    const invoicing = await isOrgFeatureEnabled(this.prisma, organizationId, WCT_ORDER_INVOICE_FLAG);
    // Round 38: DOs linked to an order (Link existing document) are its DOs too: listed, and no "+" DO then.
    const linkedIds = [...new Set(orders.flatMap((o: any) => linkedDoIdsOf(o)))];
    // Round 36: any WCT order lists the invoices made with Create invoice for what is left (remainder: true).
    const orderInv = (o: any): string[] => (manual ? orderInvoiceIdsOf(o) : remainderInvoiceIdsOf(o));
    const invIds = [...new Set([...allJobs.map((j) => j.orderInvoiceId), ...orders.flatMap((o) => orderInv(o))].filter((v) => v && !String(v).startsWith('claim:')))] as string[];
    // DO first (2026-11-13): an order's DOs also include those with no job (config.orderId).
    // Their ids come from ONE query (2026-11-20): the old filter was an OR of one JSON-path test
    // per order, which took ~40s for 100 orders on dev and timed the Orders list out.
    const orderIds = orders.map((o) => o.id);
    const orderDoIds: string[] = orderIds.length
      ? (
          await this.prisma.$queryRaw<Array<{ id: string }>>`
            SELECT d.id FROM "Document" d
            WHERE d."organizationId" = ${organizationId}
              AND d.type::text IN ('DELIVERY_ORDER', 'DO')
              AND d.config ->> 'orderId' = ANY(${orderIds})`
        ).map((r) => r.id)
      : [];
    const wantedIds = [...new Set([...doIds, ...invIds, ...linkedIds, ...orderDoIds])];
    const docs = wantedIds.length
      ? await this.prisma.document.findMany({
          where: { organizationId, id: { in: wantedIds } } as any,
          select: { id: true, name: true, type: true, status: true, documentTemplateId: true, config: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const isDo = (d: any) => d.type === 'DELIVERY_ORDER' || d.type === 'DO';
    const byId = new Map(docs.map((d: any) => [d.id, d]));
    // DO first: invoices that bill a DO with no job are named on the DO (config.orderInvoiceId).
    const doInvIds = [...new Set(docs.filter((d: any) => isDo(d)).map((d: any) => (d.config as any)?.orderInvoiceId).filter((v: any) => v && !String(v).startsWith('claim:') && !byId.has(v)))] as string[];
    if (doInvIds.length) {
      for (const d of await this.prisma.document.findMany({ where: { organizationId, id: { in: doInvIds } }, select: { id: true, name: true, type: true, status: true, documentTemplateId: true, config: true } })) byId.set(d.id, d);
    }
    // Split payment (2026-11-17): the other parts of a split invoice, so the row lists and totals every part.
    const partIds = withSplitPartIds([], [...byId.values()] as any[]).filter((id) => !byId.has(id));
    if (partIds.length) {
      for (const d of await this.prisma.document.findMany({ where: { organizationId, id: { in: partIds } }, select: { id: true, name: true, type: true, status: true, documentTemplateId: true, config: true } })) byId.set(d.id, d);
    }
    const reports = allJobs.length
      ? await this.prisma.maintenanceServiceReport.findMany({
          where: { organizationId, kind: 'SERVICE', deliveryId: { in: allJobs.map((j) => j.id) } },
          select: { deliveryId: true, status: true, serviceData: true },
        })
      : [];
    const readyJobs = new Set(reports.filter((r: any) => !(r.serviceData as any)?.deletedAt && (r.status === 'completed' || (r.serviceData as any)?.uploaded === true)).map((r: any) => r.deliveryId));
    const docView = (d: any) => ({ id: d.id, name: d.name, type: d.type, status: d.status, templateId: d.documentTemplateId });
    return (o: any, jobs: any[]) => {
      const live = jobs.filter((j) => j.status !== 'cancelled');
      const qc: any = o.sourceQuotation?.config || {};
      const di: any = qc.documentInfo || {};
      const jobDoIds = new Set(live.flatMap((j) => (j.items ?? []).map((i: any) => i.documentId)).filter(Boolean));
      const dos = [
        ...[...jobDoIds].map((id) => byId.get(id as string)).filter(Boolean),
        ...docs.filter((d: any) => isDo(d) && (d.config as any)?.orderId === o.id && !jobDoIds.has(d.id)),
      ].filter((d: any) => (d.config as any)?.cancelled !== true);
      const joblessDos = dos.filter((d: any) => !jobDoIds.has(d.id));
      const doDone = (d: any) => String(d.status).startsWith('delivered');
      // Linked DOs (round 29), shown in the DO(s) cell; the row actions keep to the DOs made on the order.
      const linkedDos = linkedDoEntriesOf(o)
        .map((e: any) => ({ e, d: byId.get(e.id) as any }))
        .filter(({ d }) => d && isDo(d) && (d.config as any)?.cancelled !== true && !dos.some((x: any) => x.id === d.id));
      const realInvoice = (v: unknown) => !!v && !String(v).startsWith('claim:');
      const own = [...new Set([...live.map((j) => j.orderInvoiceId), ...joblessDos.map((d: any) => (d.config as any)?.orderInvoiceId), ...orderInv(o)].filter((v) => v && !String(v).startsWith('claim:')))] as string[];
      const invoices = withSplitPartIds(own, own.map((id) => byId.get(id)).filter(Boolean) as any[])
        .map((id) => byId.get(id))
        .filter((d: any) => !!d && d.type === 'INVOICE')
        .map((d: any) => ({ ...docView(d), total: Number(d.config?.grandTotal ?? d.config?.documentInfo?.grandTotal ?? d.config?.nettTotal ?? 0) || 0 }));
      const quoted = Number(qc.nettTotal ?? di.nettTotal ?? qc.grandTotal ?? di.grandTotal);
      // The earliest date among the order's DOs still open (not delivered, not cancelled): the list's "DO date".
      const OPEN_DO = new Set(['draft', 'unconfirmed', 'confirmed', 'pending_delivery']);
      const doDates = dos
        .filter((d: any) => OPEN_DO.has(String(d.status)) && d.config?.cancelled !== true)
        .map((d: any) => String(d.config?.date ?? d.config?.documentInfo?.date ?? '').slice(0, 10))
        .filter((v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v))
        .sort();
      const firstOf = (f: (j: any) => boolean) => live.find(f)?.id ?? null;
      return {
        subject: String(qc.subject ?? di.subject ?? '').trim() || null,
        site: String([...live].reverse().find((j) => j.siteAddress)?.siteAddress ?? di.jobLocation ?? di.location ?? '').split('\n')[0].trim() || null,
        deliveryOrders: [...dos, ...linkedDos.map((x) => x.d)].map(docView),
        doDate: doDates[0] ?? null,
        invoices,
        // Round 38: which empty cells show a "+" (order-list-add.ts; the order page's own rules).
        add: nativeListAdd(
          {
            cancelled: o.status === 'CANCELLED',
            hasQuotation: !!o.sourceQuotation || (Array.isArray((o.linkedDocuments as any)?.quotation) && (o.linkedDocuments as any).quotation.length > 0),
            doCount: dos.length + linkedDos.length,
            invoiceCount: invoices.length,
            toInvoiceJobs: live.filter((j) => isVerifiedJob(j) && !j.orderInvoiceId).length,
            toInvoiceDos:
              joblessDos.filter((d: any) => doDone(d) && !realInvoice((d.config as any)?.orderInvoiceId)).length +
              linkedDos.filter(({ e, d }) => doDone(d) && !isErpImported(d.config) && !realInvoice(e.orderInvoiceId)).length,
          },
          { manualFlow: manual, invoicing },
        ),
        amount: invoices.length ? invoices.reduce((t: number, i: any) => t + i.total, 0) : Number.isFinite(quoted) ? quoted : null,
        actionJobs: {
          draft: firstOf((j) => j.isDraft),
          scheduled: firstOf((j) => !j.isDraft && j.status !== 'completed'),
          completed: [...live].reverse().find((j) => j.status === 'completed')?.id ?? null,
        },
        serviceReportReady: live.some((j) => readyJobs.has(j.id)),
        // DO first: the DOs the row actions work on (a draft DO with no job, an open one, the last completed one).
        actionDos: {
          draft: joblessDos.find((d: any) => !doDone(d) && !(d.config as any)?.awaitingSignature)?.id ?? null,
          open: joblessDos.find((d: any) => !doDone(d))?.id ?? null,
          awaiting: joblessDos.find((d: any) => !doDone(d) && (d.config as any)?.awaitingSignature)?.id ?? null,
          completed: [...dos].reverse().find((d: any) => doDone(d))?.id ?? null,
        },
      };
    };
  }

  private async getWctById(id: string, organizationId: string, opts: { skipStatusSync?: boolean } = {}) {
    const row: any = await this.prisma.order.findFirst({
      where: { id, organizationId },
      include: {
        customer: { select: { id: true, name: true, customerCode: true, address: true, email: true } },
        sourceQuotation: { select: { id: true, name: true, status: true, type: true, documentTemplateId: true, config: true } },
        deliveries: {
          orderBy: { deliveryNumber: 'asc' },
          select: {
            id: true,
            deliveryNumber: true,
            status: true,
            isDraft: true,
            scheduledFor: true,
            scheduledAllDay: true,
            startedAt: true,
            completedAt: true,
            siteAddress: true,
            riderUserId: true,
            riderName: true,
            completionMode: true,
            verificationState: true,
            verificationNote: true,
            orderInvoiceId: true,
            items: { select: { documentId: true, description: true, quantity: true, assetId: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
          },
        },
      },
    });
    if (!row) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    const { deliveries, sourceQuotation, ...order } = row;
    const jobsRaw: any[] = deliveries;
    const holder = [{ id: order.id, status: order.status, jobs: jobsRaw }];
    // An imported order's page (round 19) stores its own status once, after reading this.
    if (!opts.skipStatusSync) await this.syncWctStatuses(organizationId, holder);
    order.status = holder[0].status;

    // Each job's DO (first DO its lines point at) and its SiteClock worker.
    const docIds = [...new Set(jobsRaw.flatMap((j) => j.items.map((i: any) => i.documentId)).filter(Boolean))] as string[];
    const [docs, links] = await Promise.all([
      docIds.length
        ? this.prisma.document.findMany({
            where: { id: { in: docIds }, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } },
            select: { id: true, name: true, status: true, documentTemplateId: true, config: true, createdAt: true, attachments: true },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([] as any[]),
      jobsRaw.length
        ? this.prisma.deliverySiteClockJob.findMany({
            where: { organizationId, deliveryId: { in: jobsRaw.map((j) => j.id) } },
            select: { deliveryId: true, workerId: true, workerName: true, durationMin: true, syncState: true, lastError: true },
          })
        : Promise.resolve([] as any[]),
    ]);
    const linkBy = new Map(links.map((l: any) => [l.deliveryId, l]));
    const jobs = jobsRaw.map((j) => {
      const own = new Set(j.items.map((i: any) => i.documentId).filter(Boolean));
      const d: any = docs.find((x: any) => own.has(x.id));
      const l: any = linkBy.get(j.id);
      return {
        id: j.id,
        deliveryNumber: j.deliveryNumber,
        status: j.status,
        isDraft: j.isDraft,
        scheduledFor: j.scheduledFor,
        scheduledAllDay: !!j.scheduledAllDay,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        siteAddress: j.siteAddress,
        rider: j.riderUserId ? j.riderName || null : null,
        // WCT finish modes: how it was finished and the office check (null before the flag).
        completionMode: j.completionMode ?? null,
        verificationState: j.verificationState ?? null,
        verificationNote: j.verificationNote ?? null,
        // WCT invoice per order: the order invoice this job is billed on (null = not yet).
        invoiceId: j.orderInvoiceId && !String(j.orderInvoiceId).startsWith('claim:') ? j.orderInvoiceId : null,
        worker: l ? { id: l.workerId, name: l.workerName, durationMin: l.durationMin, syncState: l.syncState, lastError: l.lastError } : null,
        deliveryOrder: d
          ? { id: d.id, name: d.name, status: d.status, templateId: d.documentTemplateId, tag: doStatusTag({ status: d.status, config: d.config }) }
          : null,
        lineCount: j.items.length,
      };
    });

    // DO first (2026-11-13): the order's DOs, with or without a job, each with its state and its jobs.
    const jobDocIds = new Set(docs.map((d: any) => d.id));
    // Round 29: DOs linked to the order (Link existing document) are its DOs too; marked so the page can unlink them.
    const linkedDoIds = isImportedOrder(order) ? [] : linkedDoIdsOf(order);
    const ownDos = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: { in: ['DELIVERY_ORDER', 'DO'] },
        OR: [{ config: { path: ['orderId'], equals: order.id } }, ...(linkedDoIds.length ? [{ id: { in: linkedDoIds } }] : [])],
      },
      select: { id: true, name: true, status: true, documentTemplateId: true, config: true, createdAt: true, attachments: true },
      orderBy: { createdAt: 'asc' },
    });
    const linkStamp = (id: string) => {
      const e = ((order.linkedDocuments as any)?.do ?? []).find((x: any) => x?.id === id);
      return e?.linked ? { at: e.linked.at ?? null, byName: e.linked.byName ?? null } : null;
    };
    // Round 33: a linked DO's invoice is on its link entry (the DO is never written), while that invoice is live.
    const linkedEntries = new Map(linkedDoEntriesOf(order).map((e) => [e.id, e]));
    const liveLinked = await liveInvoiceIds(this.prisma, organizationId, [...linkedEntries.values()].map((e) => e.orderInvoiceId));
    const linkedInvoiceOf = (id: string): string | null => {
      const v = linkedEntries.get(id)?.orderInvoiceId;
      return v && liveLinked.has(v) ? v : null;
    };
    const doTz = await orgTimeZoneFor(this.prisma as any, organizationId).catch(() => 'Asia/Singapore');
    const allDos = [...docs, ...ownDos.filter((d: any) => !jobDocIds.has(d.id))].sort((a: any, b: any) => +new Date(a.createdAt) - +new Date(b.createdAt));
    const deliveryOrders = allDos
      .filter((d: any) => d.config?.cancelled !== true)
      .map((d: any) => {
        const c: any = d.config || {};
        const onJobs = jobs.filter((j) => j.status !== 'cancelled' && j.deliveryOrder?.id === d.id);
        const completed = String(d.status).startsWith('delivered');
        return {
          id: d.id,
          name: d.name,
          status: d.status,
          templateId: d.documentTemplateId,
          tag: doStatusTag({ status: d.status, config: c }),
          // UAT 2026-11-25: a DO with no date shows its created day in the org's time zone (do-date.ts), not blank.
          date: doDateOrCreated(c, d.createdAt, doTz),
          completed,
          awaitingSignature: !completed && c.awaitingSignature === true,
          // 2026-11-25: saved by a person in the editor (config.savedAt), so the order page words a DO like the DO list:
          // Draft = made by the system, Pending = saved by someone.
          saved: !!c.savedAt,
          // 2026-11-23: the signed / stamped DO uploaded on completion (Complete DO, Upload signed DO): the FILE column opens it.
          stampedFileKey: completed ? stampedDoKeyOf(d.attachments) : null,
          invoiceId: c.orderInvoiceId && !String(c.orderInvoiceId).startsWith('claim:') ? c.orderInvoiceId : null,
          hasProducts: (Array.isArray(c.items) ? c.items : []).some((it: any) => it?.assetId),
          // Product rows still without a unit (one per unit): Complete DO picks them.
          products: (Array.isArray(c.items) ? c.items : [])
            .filter((it: any) => it?.assetId && !it.inventoryItemId)
            .map((it: any) => ({ assetId: it.assetId as string, name: String(it.description || it.itemCode || 'Product') })),
          jobs: onJobs.map((j) => ({ id: j.id, deliveryNumber: j.deliveryNumber, status: j.status, isDraft: j.isDraft, scheduledFor: j.scheduledFor, verificationState: j.verificationState })),
          // Round 29: on the order only through Link existing document (not made on it, no job): Unlink takes it off.
          ...(linkedDoIds.includes(d.id) && c.orderId !== order.id && !onJobs.length ? { linkedOnly: true, linked: linkStamp(d.id), invoiceId: linkedInvoiceOf(d.id), ...(isErpImported(c) ? { imported: true } : {}) } : {}),
          // An imported ERP DO (only ever on an imported order; key absent otherwise): its page lists it from the order's links.
          ...(isErpImported(c) ? { imported: true } : {}),
        };
      });
    const joblessInvoiceIds = deliveryOrders.filter((d) => !d.jobs.length && d.invoiceId).map((d) => d.invoiceId as string);
    // Completed DOs with no job and no invoice yet (Invoice now bills them too).
    // A linked DO is not billed by Create invoice (it was not made on the order): not listed as waiting for it.
    // Round 33: a completed linked DO (not ERP-imported) waits for Create invoice too, which bills it.
    const toInvoiceDos = deliveryOrders.filter((d: any) => !d.jobs.length && d.completed && !d.invoiceId && !(d.linkedOnly && d.imported)).map((d) => d.name);
    const toInvoiceLinkedDos = deliveryOrders.filter((d: any) => d.linkedOnly && !d.imported && d.completed && !d.invoiceId).map((d) => d.name);

    // "Add job" prefill: the quotation's billable lines and where the work is.
    const qcfg: any = sourceQuotation?.config || {};
    const di: any = qcfg.documentInfo || {};
    const { quotationLinesForJob } = await import('../deliveries/quotation-to-delivery');
    const quotedLines = sourceQuotation ? await quotationLinesForJob(this.prisma, organizationId, qcfg) : [];
    // Only what is still to deliver (2026-11-13): quoted minus the order's live DOs and its jobs with no DO.
    const used = [
      ...allDos.filter((d: any) => d.config?.cancelled !== true).flatMap((d: any) => (Array.isArray(d.config?.items) ? d.config.items : []).map((it: any) => ({ key: assetKey(it?.assetId) ?? descKey(it?.description), quantity: Number(it?.quantity) || 1 }))),
      ...jobsRaw.filter((j: any) => j.status !== 'cancelled').flatMap((j: any) => j.items.filter((i: any) => !i.documentId).map((i: any) => ({ key: assetKey(i.assetId) ?? descKey(i.description), quantity: Number(i.quantity) || 1 }))),
    ];
    const keyed = quotedLines.map((l) => ({ line: l, key: l.asset ? assetKey(l.asset.id) : descKey(l.description), quantity: l.quantity }));
    const quotationLines = remainingQuoteLines(keyed, remainingAllowance(keyed, used)).map(({ line, quantity }) => ({ ...line, quantity }));
    const prefillNote = quotedLines.length && !quotationLines.length ? 'Everything quoted is already on a DO or a job.' : null;
    const lastSite = [...jobsRaw].reverse().find((j) => j.siteAddress)?.siteAddress;
    const siteAddress = String(lastSite || di.location || di.jobLocation || qcfg.location || qcfg.deliveryTo || order.customer?.address || '').trim() || null;

    // Round 29: quotations linked to the order (Link existing document): on its page, its quotation total and summary.
    const linkedQuoteRefs: any[] = isImportedOrder(order) ? [] : (Array.isArray((order.linkedDocuments as any)?.quotation) ? (order.linkedDocuments as any).quotation : []).filter((x: any) => x && typeof x.id === 'string');
    const linkedQuoteDocs: any[] = linkedQuoteRefs.length
      ? (await this.prisma.document.findMany({ where: { organizationId, id: { in: linkedQuoteRefs.map((x: any) => x.id) } }, select: { id: true, name: true, type: true, status: true, documentTemplateId: true, config: true } })).filter(
          (d: any) => d.config?.voided !== true && d.config?.cancelled !== true,
        )
      : [];
    const completedMark = nativeCompletionOf(order);
    return {
      ...order,
      statusLabel: order.status === MARKED_COMPLETE ? 'Complete' : WCT_ORDER_STATUS_LABEL[order.status as WctOrderStatus] ?? MANUAL_ORDER_STATUS_LABEL[order.status as ManualOrderStatus] ?? order.status,
      // Round 29: marked complete (reason, who, when) and the status its documents give underneath.
      completed: completedMark ? { reason: completedMark.reason, at: completedMark.at, byName: completedMark.byName ?? null, auto: false, underlying: completedMark.underlying ?? null } : null,
      quotations: linkedQuoteDocs.map((d: any) => {
        const ref = linkedQuoteRefs.find((x: any) => x.id === d.id);
        return {
          id: d.id,
          name: d.name,
          type: d.type,
          status: d.status,
          templateId: d.documentTemplateId,
          date: d.config?.date ?? null,
          total: grossOf(d.config),
          unlinkable: true,
          linked: ref?.linked ? { at: ref.linked.at ?? null, byName: ref.linked.byName ?? null } : null,
        };
      }),
      // Manual order flow: the page offers "Send service report" and "Complete job".
      manualFlow: await isManualOrderFlow(this.prisma, organizationId),
      // The service reports on the order's jobs (drafts too), for the page's Service report section.
      jobReports: await this.orderJobReports(organizationId, jobsRaw, order.id),
      // Round 24 (one order page for AIMS and imported orders): the quotation's date and total, for display.
      sourceQuotation: sourceQuotation
        ? {
            id: sourceQuotation.id,
            name: sourceQuotation.name,
            status: sourceQuotation.status,
            type: sourceQuotation.type,
            documentTemplateId: sourceQuotation.documentTemplateId,
            date: typeof (qcfg.date ?? di.date) === 'string' ? qcfg.date ?? di.date : null,
            total: grossOf(qcfg),
            // Round 39: the jobs calendar side panel's quotation chip (quotation-status-label.ts).
            statusLabel: quotationStatusLabel(sourceQuotation),
          }
        : null,
      subject: String(qcfg.subject || di.subject || '').trim() || null,
      jobs,
      deliveryOrders,
      prefill: { siteAddress, lines: quotationLines, note: prefillNote },
      ...(await this.wctBilling(organizationId, jobsRaw, [...joblessInvoiceIds, ...((await isManualOrderFlow(this.prisma, organizationId)) ? orderInvoiceIdsOf(order as any) : remainderInvoiceIdsOf(order as any))], sourceQuotation, order as any, linkedQuoteDocs)),
      toInvoiceDos,
      toInvoiceLinkedDos,
      attachments: await this.orderAttachmentsView(organizationId, Array.isArray(order.attachments) ? (order.attachments as any[]) : []),
      // The supplier invoices tagged to this order's quotation (job costs, read-only).
      supplierInvoices: await this.wctSupplierInvoices(organizationId, order.sourceQuotationId),
    };
  }

  /**
   * WCT: the SINs with a line on this quotation (bills/bill-quotation.ts; 2026-11-04 the quotation is per line —
   * config.quotationIds — or, for a SIN saved before, the old header tag), each with that quotation's line amount.
   */
  private async wctSupplierInvoices(organizationId: string, quotationId: string | null | undefined) {
    if (!quotationId) return { rows: [], total: 0 };
    const docs = await this.prisma.document.findMany({
      where: { organizationId, type: 'BILL', OR: [{ config: { path: ['quotationIds'], array_contains: [quotationId] } }, { config: { path: ['quotationId'], equals: quotationId } }] },
      select: { id: true, name: true, status: true, config: true },
    });
    const sids = [...new Set(docs.map((d: any) => d.config?.supplierId || d.config?.supplier?.id).filter(Boolean))] as string[];
    const sups = sids.length ? await this.prisma.supplier.findMany({ where: { organizationId, id: { in: sids } }, select: { id: true, name: true } }) : [];
    return taggedSinsView(docs as any, new Map(sups.map((x) => [x.id, x.name])), quotationId);
  }

  // ── WCT service report on the order (enableWctOrders, 2026-11-01, Phase 5) ──
  // Order.attachments holds the order's files, same shape as Document.attachments
  // plus a kind: { id, kind: 'file', fileKey, fileName, mimeType?, label?, … }
  // for an uploaded file (S3, uploaded first through POST /uploads/image), or
  // { id, kind: 'report', reportId, reportNumber, label, … } for an AIMS service
  // report linked to it. Either one counts as "the service report is on the
  // order" (a paid order then reads Closed).

  private async wctOrderOrThrow(id: string, organizationId: string) {
    // Round 19: an imported order takes service reports and files too (setting on); cancel stays refused (cancelWctOrder).
    await assertImportedOrderOpen(this.prisma, organizationId, id);
    if (!(await isWctOrdersEnabled(this.prisma, organizationId))) throw new HttpException('Orders with jobs are not enabled for this organisation', HttpStatus.BAD_REQUEST);
    const order = await this.prisma.order.findFirst({ where: { id, organizationId }, select: { id: true, orderNumber: true, attachments: true } });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    return order;
  }

  /**
   * WCT orders hub (2026-11-13): "Cancel order" from the list's row menu. Only
   * an order that has not started: its jobs are drafts or scheduled, none
   * started or finished, nothing invoiced. Each job is cancelled the way a job
   * cancel does it: its DO keeps its number and is tagged Cancelled, the
   * unwritten scheduled service report goes. The order reads Cancelled and
   * keeps that status. Counters are never touched.
   */
  async cancelWctOrder(id: string, organizationId: string) {
    await assertNotImportedOrder(this.prisma, organizationId, id);
    await this.wctOrderOrThrow(id, organizationId);
    const order = await this.prisma.order.findFirst({ where: { id, organizationId }, select: { id: true, orderNumber: true, status: true, statusDates: true, linkedDocuments: true, invoiceDocumentId: true } });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    if (order.status === 'CANCELLED') return { id, status: 'CANCELLED' };
    // Invoice first (2026-11-16): an order with an invoice has started, even before its DO.
    // Manual flow (2026-11-17, the draft invoice is made at signing): an order whose invoices are ALL
    // drafts (incl. split parts; not sent, not in the ledger, no payment) can still be cancelled, and
    // those drafts are voided with it (kept, number stays as a gap). Any other org: unchanged.
    const orderInvoiceIds = orderInvoiceIdsOf(order);
    const manual = await isManualOrderFlow(this.prisma, organizationId);
    let draftInvoices: Array<{ id: string; name: string | null; config: any }> = [];
    if (manual && orderInvoiceIds.length) {
      const rows = (await invoiceRowsWithSplitParts(this.prisma, organizationId, orderInvoiceIds, { type: { in: ['INVOICE', 'TI', 'TI2'] } })).filter((r: any) => r.config?.voided !== true);
      const blocking = await cancelBlockingInvoice(this.prisma, organizationId, rows as any);
      if (blocking) throw new HttpException(`Only an order whose invoices are all drafts can be cancelled (${blocking} is sent, paid or in the ledger).`, HttpStatus.BAD_REQUEST);
      draftInvoices = rows as any;
    } else {
      const liveInvoice = orderInvoiceIds.length ? await this.prisma.document.findFirst({ where: { organizationId, id: { in: orderInvoiceIds }, type: 'INVOICE' }, select: { name: true } }) : null;
      if (liveInvoice) throw new HttpException(`Only an order that has not started can be cancelled (${liveInvoice.name ?? 'an invoice'} is already made on it).`, HttpStatus.BAD_REQUEST);
    }
    const jobs = await this.prisma.delivery.findMany({
      where: { organizationId, orderId: id, status: { not: 'cancelled' } },
      select: { id: true, deliveryNumber: true, status: true, isDraft: true, orderInvoiceId: true, items: { select: { documentId: true, deliveringAt: true, deliveredAt: true, completedAt: true } } },
    });
    const started = jobs.filter((j) => (!j.isDraft && j.status !== 'scheduled') || j.orderInvoiceId || j.items.some((i) => i.deliveringAt || i.deliveredAt || i.completedAt));
    if (started.length) {
      throw new HttpException(`Only an order that has not started can be cancelled (job #${started.map((j) => j.deliveryNumber).join(', #')} has started, finished or is invoiced). Cancel its jobs one by one instead.`, HttpStatus.BAD_REQUEST);
    }
    // DO first: the order's DOs with no job must not have started either.
    const jobDocs = new Set(jobs.flatMap((j) => j.items.map((i) => i.documentId)).filter(Boolean) as string[]);
    const ownDos = (
      await this.prisma.document.findMany({
        where: { organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] }, config: { path: ['orderId'], equals: id } },
        select: { id: true, name: true, status: true, config: true },
      })
    ).filter((d) => !jobDocs.has(d.id) && (d.config as any)?.cancelled !== true);
    const doneDos = ownDos.filter((d) => String(d.status).startsWith('delivered') || (d.config as any)?.awaitingSignature || (d.config as any)?.orderInvoiceId);
    if (doneDos.length) {
      throw new HttpException(`Only an order that has not started can be cancelled (${doneDos.map((d) => d.name ?? 'a DO').join(', ')} is completed, waiting for a signature or invoiced).`, HttpStatus.BAD_REQUEST);
    }
    const { cancelledDoConfig } = await import('../deliveries/do-number');
    const { withStatusDate } = await import('./manual-order-flow');
    await this.prisma.$transaction(async (tx) => {
      for (const d of ownDos) {
        await tx.document.update({ where: { id: d.id }, data: { config: { ...((d.config as any) ?? {}), cancelled: true, cancelledAt: new Date().toISOString(), cancelledReason: 'The order was cancelled' } } });
      }
      for (const j of jobs) {
        const docIds = [...new Set(j.items.map((i) => i.documentId).filter(Boolean))] as string[];
        for (const docId of docIds) {
          const doc = await tx.document.findFirst({ where: { id: docId, organizationId }, select: { id: true, config: true } });
          if (doc) await tx.document.update({ where: { id: doc.id }, data: { config: cancelledDoConfig(doc.config, j.deliveryNumber) as any } });
        }
        await tx.maintenanceServiceReport.deleteMany({
          where: { deliveryId: j.id, kind: 'SERVICE', status: 'draft', reportNumber: null, serviceData: { path: ['scheduled'], equals: true } },
        });
        await tx.delivery.update({ where: { id: j.id }, data: { status: 'cancelled' } });
      }
      // The order's draft invoices: voided, never deleted (numbers stay as gaps; no journal exists on a draft).
      const at = new Date().toISOString();
      for (const inv of draftInvoices) {
        await tx.document.update({ where: { id: inv.id }, data: { config: voidedWithOrderConfig(inv.config, order.orderNumber, at) as any } });
      }
      await tx.order.update({ where: { id }, data: { status: 'CANCELLED', statusDates: withStatusDate(order.statusDates, 'CANCELLED') as any } });
    });
    for (const inv of draftInvoices) {
      await this.audit?.logAction({
        userId: 'system',
        action: 'STATUS_CHANGED',
        resource: 'document',
        resourceId: inv.id,
        resourceName: inv.name ?? undefined,
        organizationId,
        details: { detail: `${inv.name ?? 'Invoice'} voided: order ${order.orderNumber} was cancelled` },
      } as any);
    }
    return { id, status: 'CANCELLED', jobsCancelled: jobs.length, dosCancelled: ownDos.length, ...(draftInvoices.length ? { invoicesVoided: draftInvoices.map((i) => i.name) } : {}) };
  }

  /** Add an uploaded file, or link an AIMS service report, to the order. */
  async addOrderAttachment(
    id: string,
    organizationId: string,
    body: { kind?: string; fileKey?: string; fileName?: string; mimeType?: string; label?: string; reportId?: string },
    actor: { id?: string; name?: string },
  ) {
    const order = await this.wctOrderOrThrow(id, organizationId);
    const list: any[] = Array.isArray(order.attachments) ? [...(order.attachments as any[])] : [];
    const addedByName = actor.name || (actor.id ? (await this.userNames([actor.id])).get(actor.id) : null) || null;
    const stamp = { id: randomUUID(), addedAt: new Date().toISOString(), addedBy: actor.id ?? null, addedByName };
    let entry: any;
    if (body.kind === 'report') {
      if (!body.reportId) throw new HttpException('Pick a service report', HttpStatus.BAD_REQUEST);
      const report = await this.prisma.maintenanceServiceReport.findFirst({
        where: { id: body.reportId, organizationId, kind: 'SERVICE' },
        select: { id: true, reportNumber: true, status: true },
      });
      if (!report) throw new HttpException('Service report not found', HttpStatus.NOT_FOUND);
      if (list.some((a) => a.kind === 'report' && a.reportId === report.id)) return this.orderAttachmentsView(organizationId, list);
      entry = { ...stamp, kind: 'report', reportId: report.id, reportNumber: report.reportNumber ?? null, label: body.label?.trim() || 'Service report' };
    } else {
      const key = String(body.fileKey || '').trim();
      if (!key || !body.fileName) throw new HttpException('Upload the file first', HttpStatus.BAD_REQUEST);
      if (list.some((a) => a.kind === 'file' && a.fileKey === key)) return this.orderAttachmentsView(organizationId, list);
      entry = { ...stamp, kind: 'file', fileKey: key, fileName: body.fileName, ...(body.mimeType ? { mimeType: body.mimeType } : {}), label: body.label?.trim() || 'Service report' };
    }
    list.push(entry);
    await this.prisma.order.update({ where: { id, organizationId }, data: { attachments: list as Prisma.InputJsonValue } });
    await refreshOrderStatus(this.prisma, organizationId, id);
    return this.orderAttachmentsView(organizationId, list);
  }

  async removeOrderAttachment(id: string, organizationId: string, attachmentId: string) {
    const order = await this.wctOrderOrThrow(id, organizationId);
    const list: any[] = Array.isArray(order.attachments) ? (order.attachments as any[]) : [];
    const next = list.filter((a) => a?.id !== attachmentId);
    if (next.length === list.length) throw new HttpException('Attachment not found on this order', HttpStatus.NOT_FOUND);
    await this.prisma.order.update({ where: { id, organizationId }, data: { attachments: next as Prisma.InputJsonValue } });
    await refreshOrderStatus(this.prisma, organizationId, id);
    return this.orderAttachmentsView(organizationId, next);
  }

  /**
   * Reports the order page offers to link: the service reports of the order's
   * own jobs first, then (with ?number=) any service report by its number.
   */
  async orderReportOptions(id: string, organizationId: string, number?: string) {
    await this.wctOrderOrThrow(id, organizationId);
    const jobs = await this.prisma.delivery.findMany({ where: { organizationId, orderId: id }, select: { id: true, deliveryNumber: true } });
    const jobNo = new Map(jobs.map((j) => [j.id, j.deliveryNumber]));
    const n = number && /^\d+$/.test(number.trim()) ? parseInt(number.trim(), 10) : null;
    const reports = await this.prisma.maintenanceServiceReport.findMany({
      where: { organizationId, kind: 'SERVICE', OR: [{ deliveryId: { in: jobs.map((j) => j.id) } }, ...(n !== null ? [{ reportNumber: n }] : [])] },
      select: { id: true, reportNumber: true, status: true, deliveryId: true, createdAt: true, technicianName: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reports.map((r) => ({ ...r, jobNumber: r.deliveryId ? jobNo.get(r.deliveryId) ?? null : null, ofThisOrder: !!(r.deliveryId && jobNo.has(r.deliveryId)) }));
  }

  /** Service reports on the order's jobs, oldest job first: number, status, draft / uploaded, job number. */
  private async orderJobReports(organizationId: string, jobs: Array<{ id: string; deliveryNumber?: number | null; status?: string }>, orderId?: string) {
    const live = jobs.filter((j) => j.status !== 'cancelled');
    // DO first: reports written for one of the order's DOs without a job (serviceData.orderId).
    const doReports = orderId
      ? await this.prisma.maintenanceServiceReport.findMany({
          where: { organizationId, kind: 'SERVICE', deliveryId: null, serviceData: { path: ['orderId'], equals: orderId } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, reportNumber: true, status: true, deliveryId: true, serviceData: true, createdAt: true },
        })
      : [];
    if (!live.length && !doReports.length) return [];
    const jobNo = new Map(live.map((j) => [j.id, j.deliveryNumber ?? null]));
    const rows = [
      ...(live.length
        ? await this.prisma.maintenanceServiceReport.findMany({
            where: { organizationId, kind: 'SERVICE', deliveryId: { in: live.map((j) => j.id) } },
            orderBy: { createdAt: 'asc' },
            select: { id: true, reportNumber: true, status: true, deliveryId: true, serviceData: true, createdAt: true },
          })
        : []),
      ...doReports,
    ].filter((r) => !(r.serviceData as any)?.deletedAt);
    return rows.map((r) => {
      const sd = (r.serviceData as Record<string, any> | null) ?? {};
      return {
        id: r.id,
        reportNumber: r.reportNumber,
        status: r.status,
        jobNumber: r.deliveryId ? jobNo.get(r.deliveryId) ?? null : null,
        uploaded: sd.uploaded === true,
        scheduled: sd.scheduled === true,
        sentAt: sd.customerSentAt ?? null,
        // The report's photos file (PhotosFileControls), for the order page's "Photos" link.
        photosFile: !!photosFileOf(sd),
        // Round 24: the order page's Documents date (the service date, else when it was made).
        date: (typeof sd.serviceDate === 'string' && sd.serviceDate) || ((r as any).createdAt ? new Date((r as any).createdAt).toISOString() : null),
      };
    });
  }

  /** The attachments with each linked report's current number + status. */
  private async orderAttachmentsView(organizationId: string, list: any[]) {
    const ids = list.filter((a) => a?.kind === 'report' && a.reportId).map((a) => a.reportId);
    const reports = ids.length
      ? await this.prisma.maintenanceServiceReport.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, reportNumber: true, status: true } })
      : [];
    const byId = new Map(reports.map((r) => [r.id, r]));
    // An entry saved without a name (before names were looked up) gets one now, for display only.
    const names = await this.userNames(list.filter((a) => a && !a.addedByName && a.addedBy).map((a) => a.addedBy));
    return list.map((a) => {
      const named = a && !a.addedByName && a.addedBy && names.get(a.addedBy) ? { ...a, addedByName: names.get(a.addedBy) } : a;
      return named?.kind === 'report' ? { ...named, report: byId.get(named.reportId) ?? null } : named;
    });
  }

  /** Display names (first + last, else the email) for AIMS user ids, from Clerk. Never throws; unknown ids are absent. */
  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ids.length || !this.identity) return out;
    try {
      const users = await this.identity.toClerkUsers(ids);
      for (const [id, u] of users) {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.emailAddresses?.[0]?.emailAddress || '';
        if (name) out.set(id, name);
      }
    } catch {
      /* the line shows the date without a name */
    }
    return out;
  }

  /**
   * WCT invoice per order: the order's invoices (oldest first) and whether
   * "Invoice now" has anything to bill (completed + verified jobs not on an
   * invoice yet). invoicing = enableWctOrderInvoice.
   */
  private async wctBilling(
    organizationId: string,
    jobs: any[],
    extraInvoiceIds: string[] = [],
    quotation: { name?: string | null; config?: any } | null = null,
    order: { id: string; linkedDocuments?: unknown; status?: string } | null = null,
    linkedQuotations: Array<{ name?: string | null; config?: any }> = [],
  ) {
    const invoicing = await isOrgFeatureEnabled(this.prisma, organizationId, WCT_ORDER_INVOICE_FLAG);
    const ids = [...new Set([...jobs.map((j) => j.orderInvoiceId), ...extraInvoiceIds].filter((v) => v && !String(v).startsWith('claim:')))] as string[];
    const docs = ids.length
      ? await this.prisma.document.findMany({
          // A soft-deleted draft (enableSoftDeleteDrafts) is gone from the order page even while a job / the order still names it.
          where: { id: { in: ids }, organizationId, type: { not: SOFT_DELETED_TYPE } },
          select: { id: true, name: true, status: true, type: true, documentTemplateId: true, config: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    // Split payment (2026-11-17): every part of a split invoice, in part order after their original.
    const more = withSplitPartIds(ids, docs).filter((id) => !ids.includes(id));
    if (more.length) {
      docs.push(...(await this.prisma.document.findMany({ where: { id: { in: more }, organizationId, type: { not: SOFT_DELETED_TYPE } }, select: { id: true, name: true, status: true, type: true, documentTemplateId: true, config: true, createdAt: true } })));
      const key = (d: any) => {
        const s = invoiceSplitOf(d.config);
        const head = s ? docs.find((x: any) => x.id === s.groupId) ?? d : d;
        return [+new Date(head.createdAt), s ? s.part : 0] as const;
      };
      docs.sort((a: any, b: any) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
    }
    // Actually emailed (a SENT history event): "Confirmed" alone is not "Sent".
    const sent = docs.length
      ? new Set(
          (
            await this.prisma.auditLog.findMany({
              where: { organizationId, resource: 'document', action: 'SENT', resourceId: { in: docs.map((d: any) => d.id) } },
              select: { resourceId: true },
            })
          ).map((a) => a.resourceId),
        )
      : new Set<string | null>();
    const invoices = docs.map((d: any) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      emailed: sent.has(d.id),
      // Somebody has saved it in the editor (the server strips savedAt from the invoices it
      // makes itself): the WCT status wording reads Draft before, Pending after (2026-11-19).
      edited: !!d.config?.savedAt,
      href: `/portal/documents/${d.type}/${d.documentTemplateId}/${d.id}`,
      total: Number(d.config?.grandTotal ?? d.config?.documentInfo?.grandTotal ?? d.config?.nettTotal ?? 0) || 0,
      jobNumbers: jobs.filter((j) => j.orderInvoiceId === d.id).map((j) => j.deliveryNumber),
      createdAt: d.createdAt,
      // Bills only lines added to a DO / job on top of the quotation (the quote is on another invoice).
      extra: d.config?.orderBillsQuote === false,
      // Made from the quotation before any DO was done (invoice first, 2026-11-16).
      fromQuotation: d.config?.orderInvoicedFirst === true,
      // Voided with the cancelled order (order-cancel.ts; key absent otherwise).
      ...(d.config?.cancelledWithOrder === true && d.config?.voided === true ? { cancelled: true } : {}),
      // Split payment: this invoice is part n of m (key absent when not split).
      ...((x) => (x ? { split: { groupId: x.groupId, part: Number(x.part), of: Number(x.of) } } : {}))(invoiceSplitOf(d.config)),
      // Round 24: the order page's Documents row (date, gross with GST, owed once confirmed, paid; display only).
      ...nativeInvoiceMoney(d),
      paid: amountPaidOf(d.config) ?? 0,
      // Unlink from order: only an invoice on the order's link list that was not made on it (unlink-document's rules).
      ...(order ? { unlinkable: !!linkEntryOf(order.linkedDocuments, 'INVOICE', d.id) && !madeOnOrder(d, order.id) && !jobs.some((j) => j.orderInvoiceId === d.id) } : {}),
    }));
    const toInvoice = jobs.filter((j) => isVerifiedJob(j) && !j.orderInvoiceId).map((j) => j.deliveryNumber);
    // Round 24: Quotation total, Billed, Billed %, Billed qty, Left to bill, Owed (display only, never the status).
    // Round 36: credit notes on the order's invoices count against what they billed (a fully credited one bills nothing).
    const credits = await this.invoiceCredits(organizationId, docs.map((d: any) => d.id));
    const summary = nativeOrderSummary({ quotation, invoices: docs as any[], linkedQuotations, credits });
    // Round 36: Create invoice stays available while the order is billed below its quotation total (what is left, prefilled).
    const quoteItems = [quotation, ...linkedQuotations].flatMap((q: any) => (Array.isArray(q?.config?.items) ? q.config.items : []));
    const { canInvoiceRemaining, invoiceLines } = nativeRemainderOf({ invoicing, cancelled: order?.status === 'CANCELLED', hasQuotation: !!quotation, invoices: docs as any[], summary, quoteItems });
    return { invoicing, invoices, toInvoice, summary, canInvoiceRemaining, invoiceLines };
  }

  /** Credit notes per invoice (gross; confirmed, not voided; config.sourceDocumentId = the invoice), as the WCT statuses read them. */
  private async invoiceCredits(organizationId: string, invoiceIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!invoiceIds.length) return out;
    const rows: any[] = await this.prisma.document.findMany({
      where: { organizationId, type: { in: ['CREDIT_NOTE', 'CN'] }, status: { notIn: ['draft', 'unconfirmed'] }, OR: invoiceIds.map((id) => ({ config: { path: ['sourceDocumentId'], equals: id } })) } as any,
      select: { config: true },
    });
    for (const r of rows) {
      const to = r.config?.sourceDocumentId;
      if (typeof to !== 'string' || r.config?.voided === true) continue;
      out.set(to, Math.round(((out.get(to) ?? 0) + (grossOf(r.config) ?? 0)) * 100) / 100);
    }
    return out;
  }

  /**
   * Round 36: what "Create invoice" bills on an AIMS order of a WCT org, read the way the order page reads it
   * (getWctById), for DocumentsService.invoiceNativeOrderRemainder: whether it is offered, the prefilled lines, and
   * the order's draft invoice (one at a time).
   */
  async nativeInvoiceRemainder(id: string, organizationId: string) {
    const page: any = await this.getWctById(id, organizationId, { skipStatusSync: true });
    const draft = (page.invoices ?? []).find((i: any) => ['draft', 'unconfirmed'].includes(String(i.status)) && !i.cancelled) ?? null;
    return {
      canInvoiceRemaining: page.canInvoiceRemaining === true,
      invoiceLines: (page.invoiceLines ?? []) as Array<{ description: string; quantity: number; unitPrice: number; amount: number; priced: boolean }>,
      draft: draft ? { id: draft.id as string, name: (draft.name ?? null) as string | null } : null,
      summary: page.summary ?? null,
      deliveryOrders: (page.deliveryOrders ?? []) as Array<{ id: string; name: string | null }>,
    };
  }

  /**
   * Compute the next ORD-prefix number for this org. Mirrors the document
   * numbering scheme: ORD{YYYY}{MM}-{NNN}.
   */
  private async nextOrderNumber(organizationId: string): Promise<string> {
    const now = new Date();
    const prefix = `ORD${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
    const last = await this.prisma.order.findFirst({
      where: { organizationId, orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });
    let serial = 1;
    if (last?.orderNumber) {
      const match = last.orderNumber.match(/-(\d+)$/);
      if (match) serial = parseInt(match[1], 10) + 1;
    }
    return `${prefix}${String(serial).padStart(3, '0')}`;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Supplier-doc reconciliation: user uploads a Daikin (or other supplier)
  // Delivery Order / Tax Invoice on the orders page, we extract it, find the
  // PO it belongs to, and report whether items / qtys / prices / totals /
  // points (Route Order) all line up.
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Return a short-lived signed URL for a previously-uploaded supplier doc.
   * The fileKey must live under this org's supplier-uploads path; we refuse
   * anything else so admins can't sniff other orgs' uploads via this endpoint.
   */
  async getSupplierDocDownloadUrl(organizationId: string, fileKey: string) {
    if (!fileKey || typeof fileKey !== 'string') {
      throw new HttpException('fileKey is required', HttpStatus.BAD_REQUEST);
    }
    const expectedPrefix = `supplier-uploads/${organizationId}/`;
    if (!fileKey.startsWith(expectedPrefix)) {
      throw new HttpException('fileKey not in this organization', HttpStatus.FORBIDDEN);
    }
    const url = await this.s3.getSignedUrl(fileKey, 3600);
    return { url };
  }

  async verifySupplierUpload(
    organizationId: string,
    file: Express.Multer.File,
  ) {
    if (!file) throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);

    const extracted = await this.extraction.extractForReconciliation(file);

    // Resolve the PO this supplier doc belongs to. Try the buyer's PO ref
    // first; fall back to SKU-overlap scoring across recent POs in the org.
    const match = await this.findMatchingPo(organizationId, extracted);

    if (!match) {
      return {
        matched: false,
        extracted,
        match: null,
        checks: [],
        summary: { allOk: false, issueCount: 0, reason: 'No matching PO found' },
      };
    }

    const checks = this.runReconciliationChecks(match.poItems, extracted, match.orderType);
    const issueCount = checks.reduce((s, c) => s + (c.status === 'ok' ? 0 : 1), 0);

    // Stamp the source order's items with a per-line verifiedDo/verifiedInv
    // record (so the order page can render a ✓ column per item). We only
    // stamp lines whose items-check came back ok — partial verification is
    // intentional, mismatched lines stay unstamped. PO items carry the same
    // itemCode as the source order items, so lookup is by SKU.
    const stampKey = extracted.docKind === 'DELIVERY_ORDER'
      ? 'verifiedDo'
      : extracted.docKind === 'INVOICE'
        ? 'verifiedInv'
        : null;
    let stampedCount = 0;
    let supplierFile: { url: string | null; key: string | null; originalName: string | null; mimeType: string | null } | null = null;
    if (stampKey && match.orderId) {
      try {
        const norm = (s?: string) => (s || '').replace(/\s+/g, '').toUpperCase();
        const itemsCheck = checks.find((c) => c.kind === 'items');
        // Stamp on a *softer* rule than the strict items-check: any PO line
        // whose SKU appears on the supplier doc at the same qty gets the
        // ✓ — price/amount differences are shown in the dialog but should
        // not block the per-item verification mark (supplier prices reflect
        // *their* selling figures, which often differ from what's stored on
        // our PO line). Status 'ok' obviously qualifies too.
        const lines: any[] = ((itemsCheck?.details as any)?.lines) || [];
        // Build a SKU → per-line metadata index so each stamped order item can
        // carry the supplier's actual figures + the per-line match status
        // (ok / mismatch). The order page uses this to colour the chip green
        // when the line was a clean match, amber when the qty matched but
        // price/amount diverged.
        const stampMetaByCode = new Map<string, any>();
        for (const l of lines) {
          if (!l.code) continue;
          if (l.status === 'ok') {
            stampMetaByCode.set(norm(l.code), { lineStatus: 'ok', notes: null, supplier: l.supplier ?? null });
            continue;
          }
          if (l.status !== 'mismatch') continue;
          if (!l.po || !l.supplier) continue;
          if (Number(l.po.qty) !== Number(l.supplier.qty)) continue;
          stampMetaByCode.set(norm(l.code), {
            lineStatus: 'mismatch',
            notes: l.notes ?? null,
            supplier: l.supplier,
          });
        }
        const okCodes = new Set(stampMetaByCode.keys());
        if (okCodes.size > 0) {
          const ord = await this.prisma.order.findFirst({
            where: { id: match.orderId, organizationId },
            select: { id: true, items: true },
          });
          if (ord) {
            // Persist the uploaded file to S3 so the order page can offer a
            // download later. Best-effort — a storage hiccup mustn't sink the
            // verification stamping, which is the user-visible operation.
            let fileUrl: string | null = null;
            let fileKey: string | null = null;
            try {
              const safeName = (file.originalname || 'supplier-doc')
                .replace(/[^a-zA-Z0-9._-]/g, '_')
                .slice(0, 80);
              const ts = new Date().toISOString().replace(/[:.]/g, '-');
              const kindFolder = stampKey === 'verifiedDo' ? 'do' : 'invoice';
              fileKey = `supplier-uploads/${organizationId}/${ord.id}/${kindFolder}/${ts}_${safeName}`;
              fileUrl = await this.s3.uploadFile(fileKey, file.buffer, file.mimetype || 'application/pdf');
            } catch (e) {
              console.warn('S3 upload of supplier doc failed (stamp will lack fileUrl):', (e as Error).message);
            }
            // Common fields are the same for every stamped item; the per-line
            // status / supplier figures vary so they're merged in below.
            const stampBase = {
              docNumber: extracted.docNumber ?? null,
              date: extracted.docDate ?? null,
              supplier: extracted.supplier?.name ?? null,
              at: new Date().toISOString(),
              fileUrl,
              fileKey,
              originalName: file.originalname ?? null,
              mimeType: file.mimetype ?? null,
            };
            // Surface the file pointer at the top of the response too so the
            // batch-verify dialog can offer a Download without re-walking the
            // updated order's items.
            supplierFile = {
              url: fileUrl,
              key: fileKey,
              originalName: file.originalname ?? null,
              mimeType: file.mimetype ?? null,
            };
            const items = (ord.items as any[] || []).map((it: any) => {
              const code = norm(it.itemCode);
              const meta = stampMetaByCode.get(code);
              if (!meta) return it;
              return {
                ...it,
                [stampKey]: {
                  ...stampBase,
                  // 'ok' = strict match (qty + price + amount). 'mismatch' =
                  // soft match (qty matched, price/amount did not). The chip
                  // colours off this.
                  lineStatus: meta.lineStatus,
                  // Verbose deltas like "unit 2632 → 1885; amount 7896.00 → 5655.00"
                  // — surfaced in the verified-cell tooltip so the user knows
                  // exactly what diverged.
                  mismatchNotes: meta.notes,
                  supplierQty: meta.supplier?.qty ?? null,
                  supplierUnitPrice: meta.supplier?.unitPrice ?? null,
                  supplierAmount: meta.supplier?.amount ?? null,
                },
              };
            });
            await this.prisma.order.update({
              where: { id: ord.id, organizationId },
              data: { items: items as Prisma.InputJsonValue },
            });
            stampedCount = okCodes.size;
          }
        }
      } catch (e) {
        console.warn('Failed to stamp verifiedDo/Inv on order items:', (e as Error).message);
      }
    }

    return {
      matched: true,
      extracted,
      match: {
        orderId: match.orderId,
        orderNumber: match.orderNumber,
        orderType: match.orderType,
        poDocId: match.poDocId,
        poDocName: match.poDocName,
        confidence: match.confidence,
        reason: match.reason,
      },
      stamped: stampKey, // 'verifiedDo' | 'verifiedInv' | null — what we wrote
      stampedCount, // how many order lines actually got the ✓
      supplierFile, // { url, key, originalName, mimeType } — null if upload failed
      checks,
      summary: { allOk: issueCount === 0, issueCount },
    };
  }

  /**
   * Look up the PO Document this supplier doc is reconciling against. Strategy:
   *   1) Exact-name match on Document.name vs the supplier doc's PO No.
   *   2) SKU-overlap scoring across the org's last 90 days of POs.
   * Returns null if nothing scores above a confidence threshold.
   */
  private async findMatchingPo(
    organizationId: string,
    extracted: SupplierReconciliationData,
  ): Promise<null | {
    orderId: string;
    orderNumber: string;
    orderType: string | null;
    poDocId: string;
    poDocName: string;
    poItems: any[];
    confidence: number;
    reason: string;
  }> {
    const norm = (s?: string) => (s || '').replace(/\s+/g, '').toUpperCase();
    const poRef = norm(extracted.customerPoNumber);

    // The user-editable "Purchase Order No." on a PO is stored in
    // config.documentNumber (NOT Document.name, which is the auto-generated
    // serial). Check both so a deliberately matching label hits even when the
    // serial doesn't.
    const docNumberOf = (d: { config: any }) => norm((d.config as any)?.documentNumber);

    // Try exact (case/space-insensitive) match on PO number first — either the
    // serial (Document.name) or the editable Purchase Order No.
    // (config.documentNumber). Tested in that order so an explicit serial match
    // wins if both exist on different docs.
    if (poRef) {
      const candidates = await this.prisma.document.findMany({
        where: {
          organizationId,
          type: { in: ['PO', 'PURCHASE_ORDER'] },
        },
        select: { id: true, name: true, config: true },
      });
      let hit = candidates.find((d) => norm(d.name) === poRef);
      let reason = 'PO number match (serial)';
      if (!hit) {
        hit = candidates.find((d) => docNumberOf(d) === poRef);
        reason = 'PO number match (Purchase Order No.)';
      }
      if (hit) {
        const enriched = await this.poDocToMatch(organizationId, hit, 1, reason);
        if (enriched) return enriched;
      }
    }

    // Fall back to SKU-overlap scoring on the org's last 90 days of POs.
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const recent = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: { in: ['PO', 'PURCHASE_ORDER'] },
        createdAt: { gte: since },
      },
      select: { id: true, name: true, config: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Some suppliers (or weaker extractions) cram the SKU into description
    // (e.g. "MKM85ZVMG Daikin iSmile Eco+ Multi CU"). Use code when present,
    // otherwise sniff the first code-like token off description.
    const codeFromDesc = (desc?: string): string | undefined => {
      if (!desc) return undefined;
      // First alphanumeric run of length >= 4 with at least one letter and
      // at least one digit — typical SKU shape (MKM85ZVMG, CTKM25ZVMG, …).
      const m = desc.trim().match(/[A-Za-z][A-Za-z0-9\-]{3,}/);
      if (!m) return undefined;
      const tok = m[0];
      return /[A-Za-z]/.test(tok) && /[0-9]/.test(tok) ? tok : undefined;
    };
    const supplierCodes = new Set(
      (extracted.items || [])
        .map((it) => norm(it.code) || norm(codeFromDesc(it.description)))
        .filter((c): c is string => !!c),
    );
    if (supplierCodes.size === 0) return null;

    let best: { doc: typeof recent[number]; score: number; overlap: number; poCount: number } | null = null;
    for (const doc of recent) {
      const poItems = ((doc.config as any)?.items || []) as any[];
      const poCodes = new Set(poItems.map((it) => norm(it?.itemCode)).filter((c): c is string => !!c));
      if (poCodes.size === 0) continue;
      let overlap = 0;
      for (const c of supplierCodes) if (poCodes.has(c)) overlap++;
      const score = overlap / Math.max(poCodes.size, supplierCodes.size);
      if (!best || score > best.score) best = { doc, score, overlap, poCount: poCodes.size };
    }

    if (!best || best.score < 0.5) return null;
    return this.poDocToMatch(
      organizationId,
      best.doc,
      best.score,
      `Item overlap (${best.overlap}/${best.poCount} SKUs)`,
    );
  }

  /**
   * Resolve a PO Document into the match shape — looking up the source Order
   * (PO config carries sourceOrderId from the order's flat-builder) so the
   * report can surface order type / order number alongside.
   */
  private async poDocToMatch(
    organizationId: string,
    doc: { id: string; name: string; config: any },
    confidence: number,
    reason: string,
  ) {
    const cfg = (doc.config as any) || {};
    const poItems = (cfg.items || []) as any[];
    const sourceOrderId: string | undefined = cfg.sourceOrderId;
    let orderId = sourceOrderId || '';
    let orderNumber = cfg.sourceOrderNumber || '';
    let orderType: string | null = cfg.orderType || null;
    if (sourceOrderId) {
      const ord = await this.prisma.order.findFirst({
        where: { id: sourceOrderId, organizationId },
        select: { id: true, orderNumber: true, orderType: true },
      });
      if (ord) {
        orderId = ord.id;
        orderNumber = ord.orderNumber;
        orderType = ord.orderType ?? orderType;
      }
    }
    return {
      orderId,
      orderNumber,
      orderType,
      poDocId: doc.id,
      poDocName: doc.name,
      poItems,
      confidence,
      reason,
    };
  }

  /**
   * Run every check the user asked for: items+qty (every PO line present, qty
   * exact), unit prices & line amounts (within 1¢), document totals (subtotal
   * / GST / total within $1 tolerance), and Points Issued for Route Order.
   * Each check returns ok | warn | fail along with the side-by-side details.
   */
  private runReconciliationChecks(
    poItems: any[],
    extracted: SupplierReconciliationData,
    orderType: string | null,
  ): Array<{ kind: string; status: 'ok' | 'warn' | 'fail'; label: string; details: any }> {
    const norm = (s?: string) => (s || '').replace(/\s+/g, '').toUpperCase();
    const close = (a: number | undefined, b: number | undefined, tol: number) =>
      a != null && b != null && Math.abs(a - b) <= tol;
    const checks: Array<{ kind: string; status: 'ok' | 'warn' | 'fail'; label: string; details: any }> = [];

    // Delivery Orders carry items + qty only — no unit prices, no totals, no
    // reward points. So we suppress those checks for DOs (otherwise the report
    // flags every line as a price "mismatch" against an empty/zero supplier
    // value). Invoices stay fully strict.
    const isDo = extracted.docKind === 'DELIVERY_ORDER';

    // Build a fast SKU → extracted item index.
    const supByCode = new Map<string, any>();
    for (const it of extracted.items || []) {
      const c = norm(it.code);
      if (c && !supByCode.has(c)) supByCode.set(c, it);
    }

    // 1) Items + Quantities + (2) Unit prices + line amounts — all per-line.
    const lineDetails = poItems.map((pi) => {
      const code = norm(pi.itemCode);
      const sup = supByCode.get(code);
      const poQty = Number(pi.quantity) || 0;
      const poPrice = Number(pi.unitPrice) || 0;
      const poAmount = Number(pi.amount) || poQty * poPrice;
      if (!sup) {
        return {
          code: pi.itemCode,
          description: pi.description,
          po: { qty: poQty, unitPrice: poPrice, amount: poAmount },
          supplier: null,
          status: 'missing' as const,
          notes: 'Not found on supplier doc',
        };
      }
      const supQty = Number(sup.quantity) || 0;
      // For DOs (or any line with no/zero supplier price) we don't compare
      // prices — only items + qty matter.
      const supPrice =
        !isDo && sup.unitPrice != null && Number(sup.unitPrice) > 0 ? Number(sup.unitPrice) : undefined;
      const supAmount =
        !isDo && sup.amount != null && Number(sup.amount) > 0
          ? Number(sup.amount)
          : supPrice != null
            ? supQty * supPrice
            : undefined;
      const issues: string[] = [];
      if (poQty !== supQty) issues.push(`qty ${poQty} → ${supQty}`);
      if (supPrice != null && !close(poPrice, supPrice, 0.01)) issues.push(`unit ${poPrice} → ${supPrice}`);
      if (supAmount != null && !close(poAmount, supAmount, 0.02)) issues.push(`amount ${poAmount.toFixed(2)} → ${supAmount.toFixed(2)}`);
      return {
        code: pi.itemCode,
        description: pi.description,
        po: { qty: poQty, unitPrice: poPrice, amount: poAmount },
        supplier: { qty: supQty, unitPrice: supPrice, amount: supAmount },
        status: issues.length === 0 ? ('ok' as const) : ('mismatch' as const),
        notes: issues.join('; ') || undefined,
      };
    });

    // Any supplier line whose code isn't on the PO at all (extras).
    const poCodeSet = new Set(poItems.map((pi) => norm(pi.itemCode)).filter(Boolean));
    const extras = (extracted.items || [])
      .filter((it) => {
        const c = norm(it.code);
        return c && !poCodeSet.has(c);
      })
      .map((it) => ({
        code: it.code,
        description: it.description,
        po: null,
        supplier: { qty: Number(it.quantity) || 0, unitPrice: it.unitPrice, amount: it.amount },
        status: 'extra' as const,
        notes: 'On supplier doc but not on PO',
      }));

    const lineRows = [...lineDetails, ...extras];
    const itemsStatus: 'ok' | 'fail' = lineRows.every((r) => r.status === 'ok') ? 'ok' : 'fail';
    checks.push({
      kind: 'items',
      status: itemsStatus,
      label: isDo
        ? 'Items & quantities'
        : 'Items, quantities, unit prices & line amounts',
      details: { lines: lineRows },
    });

    // 3) Document totals — only meaningful when the supplier doc carries them
    // (Invoice). DOs typically don't, so we skip silently.
    const supT = extracted.totals;
    if (!isDo && supT && (supT.subtotal != null || supT.total != null)) {
      const poSubtotal = poItems.reduce(
        (s, it) => s + (Number(it.amount) || Number(it.quantity) * Number(it.unitPrice) || 0),
        0,
      );
      // Route Order POs net points off before tax — match what the editor
      // footer / clean preview do.
      const isRoute = orderType === 'Route Order';
      const points = isRoute
        ? poItems.reduce(
            (s, it) => s + (Number(it.points) || 0) * (Number(it.quantity) || 0),
            0,
          )
        : 0;
      const afterPoints = poSubtotal - points;
      const taxPct = Number(supT.taxPercent) || 9;
      const poGst = afterPoints * (taxPct / 100);
      const poTotal = afterPoints + poGst;
      const subOk = close(poSubtotal, supT.subtotal, 1);
      const taxOk = supT.tax == null || close(poGst, supT.tax, 1);
      const totOk = supT.total == null || close(poTotal, supT.total, 1);
      checks.push({
        kind: 'totals',
        status: subOk && taxOk && totOk ? 'ok' : 'fail',
        label: 'Document totals (subtotal / GST / total)',
        details: {
          po: { subtotal: round2(poSubtotal), lessPoints: round2(points), gst: round2(poGst), total: round2(poTotal) },
          supplier: { subtotal: supT.subtotal, gst: supT.tax, taxPercent: supT.taxPercent, total: supT.total },
        },
      });
    }

    // 4) Points Issued — only on Invoices (Daikin prints "Points Issued" /
    // "Reward Points" on the tax invoice, not the DO) and only when the
    // source order is a Route Order.
    if (!isDo && orderType === 'Route Order') {
      const poPoints = poItems.reduce(
        (s, it) => s + (Number(it.points) || 0) * (Number(it.quantity) || 0),
        0,
      );
      const supPoints = extracted.points?.issued;
      const ok = supPoints != null && close(poPoints, supPoints, 0.5);
      checks.push({
        kind: 'points',
        status: ok ? 'ok' : 'fail',
        label: 'Reward Points Issued',
        details: {
          po: poPoints,
          supplier: supPoints ?? null,
          diff: supPoints != null ? round2(poPoints - supPoints) : null,
        },
      });
    }

    return checks;
  }
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

