import { randomUUID } from 'crypto';
import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import {
  DocumentExtractionService,
  SupplierReconciliationData,
} from '../document-extraction/document-extraction.service';
import { isWctOrdersEnabled, refreshOrderStatus, WCT_ORDER_INVOICE_FLAG, WCT_ORDER_STATUS_LABEL, WctOrderStatus } from './wct-orders';
import { MANUAL_ORDER_STATUS_LABEL, isManualOrderFlow, type ManualOrderStatus } from './manual-order-flow';
import { isVerifiedJob } from '../deliveries/finish-modes';
import { isOrgFeatureEnabled } from '../common/org-features';
import { doStatusTag } from '../deliveries/do-number';
import { assetKey, descKey, remainingAllowance, remainingQuoteLines } from './order-billing';
import { photosFileOf } from '../maintenance-reports/uploaded-report';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { taggedSinsView } from '../bills/bill-quotation';
import { bySchedule, dueBy } from '../deliveries/all-day';

/**
 * Orders are auto-created when a quotation is confirmed (gated by the
 * enableConfirmQuotation flag on the org). Each order holds a snapshot of the
 * quotation's items and acts as the parent container from which POs, DOs and
 * Invoices are spun off later. Status is intentionally free-form for v1 — no
 * auto-advance based on linked-doc states yet.
 */
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

    const orderNumber = await this.nextOrderNumber(organizationId);

    return await this.prisma.order.create({
      data: {
        orderNumber,
        organizationId,
        customerId,
        sourceQuotationId: quotation.id,
        orderType,
        status: 'DRAFT',
        items: items as Prisma.InputJsonValue,
        linkedDocuments: { po: [], do: [], invoice: [], salesOrder: [] } as Prisma.InputJsonValue,
        notes: `Auto-created from quotation ${quotation.name}`,
      },
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

  async list(organizationId: string) {
    if (await isWctOrdersEnabled(this.prisma, organizationId)) return this.listWct(organizationId);
    const orders = await this.prisma.order.findMany({
      where: { organizationId },
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

  async getById(id: string, organizationId: string) {
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
  private async syncWctStatuses(organizationId: string, orders: Array<{ id: string; status: string }>) {
    for (const o of orders) o.status = (await refreshOrderStatus(this.prisma, organizationId, o.id)) ?? o.status;
  }

  private async listWct(organizationId: string) {
    const rows = await this.prisma.order.findMany({
      where: { organizationId },
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
    await this.syncWctStatuses(organizationId, orders);
    const hub = await this.wctListHub(organizationId, orders);
    const now = Date.now();
    return orders.map(({ jobs, ...o }) => {
      const live = jobs.filter((j) => j.status !== 'cancelled');
      // An all-day job (2026-11-10) stays upcoming until the end of its day, and
      // sorts after the timed jobs of that day.
      const next = live
        .filter((j) => !j.isDraft && j.status === 'scheduled' && j.scheduledFor && dueBy(j)!.getTime() >= now)
        .sort(bySchedule())[0];
      const upcoming = next ? new Date(next.scheduledFor).toISOString() : undefined;
      return {
        ...o,
        statusLabel: WCT_ORDER_STATUS_LABEL[o.status as WctOrderStatus] ?? MANUAL_ORDER_STATUS_LABEL[o.status as ManualOrderStatus] ?? o.status,
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
  }

  /**
   * WCT orders list as the hub (2026-11-13): per order its subject / site, DO
   * numbers, invoices, amount, the jobs each row action works on, and whether a
   * service report is ready to send. Read-only; two batched queries.
   */
  private async wctListHub(organizationId: string, orders: Array<{ id: string; jobs: any[] }>) {
    const allJobs = orders.flatMap((o) => o.jobs);
    const doIds = [...new Set(allJobs.flatMap((j) => (j.items ?? []).map((i: any) => i.documentId)).filter(Boolean))] as string[];
    const invIds = [...new Set(allJobs.map((j) => j.orderInvoiceId).filter((v) => v && !String(v).startsWith('claim:')))] as string[];
    // DO first (2026-11-13): an order's DOs also include those with no job (config.orderId).
    const docs = doIds.length || invIds.length || orders.length
      ? await this.prisma.document.findMany({
          where: {
            organizationId,
            OR: [
              { id: { in: [...doIds, ...invIds] } },
              ...(orders.length ? [{ type: { in: ['DELIVERY_ORDER', 'DO'] }, OR: orders.map((o) => ({ config: { path: ['orderId'], equals: o.id } })) }] : []),
            ],
          } as any,
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
      const invoices = [...new Set([...live.map((j) => j.orderInvoiceId), ...joblessDos.map((d: any) => (d.config as any)?.orderInvoiceId)].filter((v) => v && !String(v).startsWith('claim:')))]
        .map((id) => byId.get(id))
        .filter(Boolean)
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
        deliveryOrders: dos.map(docView),
        doDate: doDates[0] ?? null,
        invoices,
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

  private async getWctById(id: string, organizationId: string) {
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
    await this.syncWctStatuses(organizationId, holder);
    order.status = holder[0].status;

    // Each job's DO (first DO its lines point at) and its SiteClock worker.
    const docIds = [...new Set(jobsRaw.flatMap((j) => j.items.map((i: any) => i.documentId)).filter(Boolean))] as string[];
    const [docs, links] = await Promise.all([
      docIds.length
        ? this.prisma.document.findMany({
            where: { id: { in: docIds }, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } },
            select: { id: true, name: true, status: true, documentTemplateId: true, config: true, createdAt: true },
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
    const ownDos = await this.prisma.document.findMany({
      where: { organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] }, config: { path: ['orderId'], equals: order.id } },
      select: { id: true, name: true, status: true, documentTemplateId: true, config: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
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
          date: c.date ?? c.documentInfo?.date ?? null,
          completed,
          awaitingSignature: !completed && c.awaitingSignature === true,
          invoiceId: c.orderInvoiceId && !String(c.orderInvoiceId).startsWith('claim:') ? c.orderInvoiceId : null,
          hasProducts: (Array.isArray(c.items) ? c.items : []).some((it: any) => it?.assetId),
          // Product rows still without a unit (one per unit): Complete DO picks them.
          products: (Array.isArray(c.items) ? c.items : [])
            .filter((it: any) => it?.assetId && !it.inventoryItemId)
            .map((it: any) => ({ assetId: it.assetId as string, name: String(it.description || it.itemCode || 'Product') })),
          jobs: onJobs.map((j) => ({ id: j.id, deliveryNumber: j.deliveryNumber, status: j.status, isDraft: j.isDraft, scheduledFor: j.scheduledFor, verificationState: j.verificationState })),
        };
      });
    const joblessInvoiceIds = deliveryOrders.filter((d) => !d.jobs.length && d.invoiceId).map((d) => d.invoiceId as string);
    // Completed DOs with no job and no invoice yet (Invoice now bills them too).
    const toInvoiceDos = deliveryOrders.filter((d) => !d.jobs.length && d.completed && !d.invoiceId).map((d) => d.name);

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

    return {
      ...order,
      statusLabel: WCT_ORDER_STATUS_LABEL[order.status as WctOrderStatus] ?? MANUAL_ORDER_STATUS_LABEL[order.status as ManualOrderStatus] ?? order.status,
      // Manual order flow: the page offers "Send service report" and "Complete job".
      manualFlow: await isManualOrderFlow(this.prisma, organizationId),
      // The service reports on the order's jobs (drafts too), for the page's Service report section.
      jobReports: await this.orderJobReports(organizationId, jobsRaw, order.id),
      sourceQuotation: sourceQuotation
        ? { id: sourceQuotation.id, name: sourceQuotation.name, status: sourceQuotation.status, type: sourceQuotation.type, documentTemplateId: sourceQuotation.documentTemplateId }
        : null,
      jobs,
      deliveryOrders,
      prefill: { siteAddress, lines: quotationLines, note: prefillNote },
      ...(await this.wctBilling(organizationId, jobsRaw, joblessInvoiceIds)),
      toInvoiceDos,
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
    await this.wctOrderOrThrow(id, organizationId);
    const order = await this.prisma.order.findFirst({ where: { id, organizationId }, select: { id: true, orderNumber: true, status: true, statusDates: true } });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    if (order.status === 'CANCELLED') return { id, status: 'CANCELLED' };
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
      await tx.order.update({ where: { id }, data: { status: 'CANCELLED', statusDates: withStatusDate(order.statusDates, 'CANCELLED') as any } });
    });
    return { id, status: 'CANCELLED', jobsCancelled: jobs.length, dosCancelled: ownDos.length };
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
          select: { id: true, reportNumber: true, status: true, deliveryId: true, serviceData: true },
        })
      : [];
    if (!live.length && !doReports.length) return [];
    const jobNo = new Map(live.map((j) => [j.id, j.deliveryNumber ?? null]));
    const rows = [
      ...(live.length
        ? await this.prisma.maintenanceServiceReport.findMany({
            where: { organizationId, kind: 'SERVICE', deliveryId: { in: live.map((j) => j.id) } },
            orderBy: { createdAt: 'asc' },
            select: { id: true, reportNumber: true, status: true, deliveryId: true, serviceData: true },
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
  private async wctBilling(organizationId: string, jobs: any[], extraInvoiceIds: string[] = []) {
    const invoicing = await isOrgFeatureEnabled(this.prisma, organizationId, WCT_ORDER_INVOICE_FLAG);
    const ids = [...new Set([...jobs.map((j) => j.orderInvoiceId), ...extraInvoiceIds].filter((v) => v && !String(v).startsWith('claim:')))] as string[];
    const docs = ids.length
      ? await this.prisma.document.findMany({
          where: { id: { in: ids }, organizationId },
          select: { id: true, name: true, status: true, type: true, documentTemplateId: true, config: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
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
      href: `/portal/documents/${d.type}/${d.documentTemplateId}/${d.id}`,
      total: Number(d.config?.grandTotal ?? d.config?.documentInfo?.grandTotal ?? d.config?.nettTotal ?? 0) || 0,
      jobNumbers: jobs.filter((j) => j.orderInvoiceId === d.id).map((j) => j.deliveryNumber),
      createdAt: d.createdAt,
    }));
    const toInvoice = jobs.filter((j) => isVerifiedJob(j) && !j.orderInvoiceId).map((j) => j.deliveryNumber);
    return { invoicing, invoices, toInvoice };
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

