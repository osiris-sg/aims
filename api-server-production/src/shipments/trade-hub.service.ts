import { onlyTestLinks, testRecordIds } from './trade-test-orders';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { documentLinkState } from './shipments.rules';
import { documentSummary, pageArgs, TradeConfigService } from './trade-config.service';
import { invoiceTotals, toInvoiceLines } from './trade-invoice';
import { entityFor } from './trade-entity';

/** Uploaded / linked documents ADH itself issues (the rest — PI, B/L, CI … — come from others: no entity). */
const ADH_ISSUED = new Set(['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE', 'CUSTOMER_PL', 'CUSTOMER_COA', 'SHIPPING_INSTRUCTIONS', 'SGJP_IV_PL']);
const entityOfType = (docType: string) => (ADH_ISSUED.has(docType) ? entityFor(docType) : null);

export type HubSource = 'UPLOADED' | 'IN_APP';

export interface HubQuery {
  category?: string;
  docType?: string;
  contractId?: string;
  shipmentId?: string;
  orderId?: string;
  customerId?: string;
  source?: string;
  /** ADH_JP | ADH_SG — the ADH company that issued it. */
  entity?: string;
  from?: string;
  to?: string;
  q?: string;
  /** "true" = include documents of test orders (round N). */
  includeTest?: string;
  page?: string;
  pageSize?: string;
}

export type HubLink = {
  contractId: string | null;
  shipmentId: string | null;
  orderId?: string | null;
  contractNo: string | null;
  blNumber: string | null;
  ref?: string | null;
  linkId?: string;
  orderOfShipment?: string | null;
};

/** A file / invoice link as the hub shows it: contract no., B/L, and the order / shipment ref ("#19", "#19-1"). */
const hubLink = (l: any, linkId?: string): HubLink => ({
  linkId,
  contractId: l.contractId ?? null,
  shipmentId: l.shipmentId ?? null,
  orderId: l.orderId ?? null,
  contractNo: l.contract?.contractNo ?? null,
  blNumber: l.shipment?.blNumber ?? null,
  ref: l.orderId ? `#${l.order?.orderNo ?? ''}` : l.shipment?.order ? `#${l.shipment.order.orderNo}${l.shipment.seqNo ? `-${l.shipment.seqNo}` : ''}` : null,
  orderOfShipment: l.shipment?.order?.id ?? null,
});
/**
 * The one place a row belongs to, for the list's "Order / shipment" and "B/L" columns (round L): the most
 * specific order / shipment link ("#27-1" over "#27"), its order id (for the link) and the shipment's REAL
 * B/L — a missing / placeholder B/L ("pending", "TBA") is null, never printed. Pure.
 */
export interface HubPlace {
  ref: string | null;
  orderId: string | null;
  shipmentId: string | null;
  bl: string | null;
  contractNo: string | null;
}
const NO_PLACE: HubPlace = { ref: null, orderId: null, shipmentId: null, bl: null, contractNo: null };
const PLACEHOLDER_BL = /^(b\/l\s*)?(pending|tba|tbc|n\/?a|-+|—)?$/i;
export const realBl = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim().replace(/^b\/l\s*(no\.?)?\s*/i, '');
  return !t || PLACEHOLDER_BL.test(t) ? null : t;
};
export function hubPlace(links: Array<HubLink & { orderOfShipment?: string | null }>): HubPlace {
  const ship = links.find((l) => l.shipmentId && l.ref) ?? links.find((l) => l.shipmentId);
  const order = links.find((l) => l.orderId && l.ref);
  const contractNo = links.find((l) => l.contractNo)?.contractNo ?? null;
  const bl = links.map((l) => realBl(l.blNumber)).find(Boolean) ?? null;
  if (ship) return { ref: ship.ref ?? order?.ref ?? null, orderId: ship.orderOfShipment ?? order?.orderId ?? null, shipmentId: ship.shipmentId, bl: realBl(ship.blNumber) ?? bl, contractNo };
  if (order) return { ref: order.ref ?? null, orderId: order.orderId ?? null, shipmentId: null, bl, contractNo };
  return { ref: null, orderId: null, shipmentId: null, bl, contractNo };
}

/** Search across the doc ID, number / file name, B/L, order no. ("#27", "27-1"), contract, customer, type. */
export function hubMatches(
  r: { name: string; docRef: string | null; customerName: string | null; recipient: string | null; docTypeLabel: string; links: HubLink[]; place: HubPlace },
  q: string,
): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const refs = [r.place.ref, ...r.links.map((l) => l.ref)].filter(Boolean).map((x) => String(x).toLowerCase());
  const bare = t.replace(/^#/, '');
  if (/^\d+(-\d+)?$/.test(bare) && refs.some((x) => x === `#${bare}` || (!bare.includes('-') && x.startsWith(`#${bare}-`)))) return true;
  const hay = [r.name, r.docRef, r.customerName, r.recipient, r.docTypeLabel, r.place.bl, ...r.links.map((l) => realBl(l.blNumber)), ...r.links.map((l) => l.contractNo)];
  return hay.some((x) => (x ?? '').toLowerCase().includes(t));
}

const linkCustomerId = (l: any) => l.order?.customerId ?? l.contract?.customerId ?? l.shipment?.customerId;
const linkCustomerName = (l: any) => l.order?.customer?.name ?? l.contract?.customer?.name ?? l.shipment?.customer?.name;

export interface HubRow {
  /** file:<id> | invoice:<documentId> | generated:<id> */
  key: string;
  kind: 'file' | 'invoice' | 'generated';
  id: string;
  category: string;
  docType: string;
  docTypeLabel: string;
  name: string;
  source: HubSource;
  /** The ADH company that issued it (ADH-made documents only; supplier documents: null). */
  issuingEntity: string | null;
  /** In-app only: Draft / Confirmed / Final (+ Voided / Deleted for invoices). */
  status: string | null;
  links: HubLink[];
  /** The one order / shipment + real B/L the list shows (round L). */
  place: HubPlace;
  customerIds: string[];
  /** The trade customer of the contract / shipment it belongs to (English name). */
  customerName: string | null;
  /** Who the document is addressed to when that is not the customer (SI → the warehouse, SG→JP → ADH Japan). */
  recipient: string | null;
  createdBy: string | null;
  date: string;
  /** Extra handles the portal needs for the row actions. */
  fileId?: string | null;
  /** Document ID ("454003255-1-CPL"); null for a Sales invoice linked from outside the trade module. */
  docRef: string | null;
  /** The file behind the row (an upload, or a generated document's final PDF): for its thumbnail. */
  mimeType?: string | null;
  hasThumb?: boolean;
  document?: { id: string; type: string; templateId: string } | null;
  shipmentId?: string | null;
}

/**
 * The trade Documents hub: every uploaded TradeFile, every in-app invoice
 * linked to a contract/shipment, and every in-app generated document, as one
 * list. Volumes are per-org and small, so the three sources are merged and
 * filtered in memory, then paged.
 */
@Injectable()
export class TradeHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
  ) {}

  async list(organizationId: string, query: HubQuery) {
    const { page, pageSize, skip } = pageArgs(query.page, query.pageSize);
    const types: Array<{ code: string; label: string; category: string }> = await this.prisma.tradeDocType.findMany({
      where: { organizationId },
      select: { code: true, label: true, category: true },
    });
    const typeOf = new Map(types.map((t) => [t.code, t]));
    const label = (c: string) => typeOf.get(c)?.label ?? c;
    const cat = (c: string) => typeOf.get(c)?.category ?? 'OTHER';

    const [files, docLinks, generated] = await Promise.all([
      this.prisma.tradeFile.findMany({
        where: { organizationId },
        select: {
          id: true,
          docType: true,
          fileName: true,
          mimeType: true,
          thumbKey: true,
          docRef: true,
          uploadedByName: true,
          createdAt: true,
          links: {
            select: {
              id: true,
              contractId: true,
              shipmentId: true,
              orderId: true,
              contract: { select: { contractNo: true, customerId: true, customer: { select: { name: true } } } },
              shipment: { select: { blNumber: true, seqNo: true, customerId: true, customer: { select: { name: true } }, order: { select: { id: true, orderNo: true } } } },
              order: { select: { orderNo: true, customerId: true, customer: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.tradeDocumentLink.findMany({
        where: { organizationId },
        select: {
          id: true,
          documentId: true,
          docType: true,
          contractId: true,
          shipmentId: true,
          orderId: true,
          createdAt: true,
          contract: { select: { contractNo: true, customerId: true, customer: { select: { name: true } } } },
          shipment: { select: { blNumber: true, seqNo: true, customerId: true, customer: { select: { name: true } }, order: { select: { id: true, orderNo: true } } } },
          order: { select: { orderNo: true, customerId: true, customer: { select: { name: true } } } },
        },
      }),
      this.prisma.tradeGeneratedDoc.findMany({
        where: { organizationId },
        select: {
          id: true,
          docType: true,
          number: true,
          docRef: true,
          status: true,
          issuingEntity: true,
          header: true,
          finalFileId: true,
          documentId: true,
          createdByName: true,
          updatedAt: true,
          rows: true,
          shipment: {
            select: {
              id: true,
              blNumber: true,
              seqNo: true,
              customerId: true,
              contractId: true,
              orderId: true,
              customer: { select: { name: true } },
              contract: { select: { contractNo: true } },
              order: { select: { orderNo: true } },
            },
          },
          // Invoice #1 belongs to an order (contract-era ones to a contract), not a shipment.
          contract: { select: { id: true, contractNo: true, customerId: true, customer: { select: { name: true } } } },
          order: { select: { id: true, orderNo: true, customerId: true, customer: { select: { name: true } } } },
          coversShipmentIds: true,
        },
      }),
    ]);

    // Shipments an Invoice #2 / single invoice covers: their "#n-seq" and B/L for the list.
    const coveredIds = [...new Set(generated.flatMap((g) => g.coversShipmentIds ?? []))];
    const covered: Array<{ id: string; blNumber: string | null; seqNo: number | null; orderId: string | null; order: { orderNo: number } | null }> = coveredIds.length
      ? await this.prisma.shipment.findMany({
          where: { organizationId, id: { in: coveredIds } },
          select: { id: true, blNumber: true, seqNo: true, orderId: true, order: { select: { orderNo: true } } },
        })
      : [];
    const coveredById = new Map(covered.map((c) => [c.id, c]));
    const finalFileIds = new Set(generated.map((g) => g.finalFileId).filter(Boolean) as string[]);
    const fileById = new Map(files.map((f) => [f.id, f]));
    const rows: HubRow[] = [];

    for (const f of files) {
      if (finalFileIds.has(f.id)) continue; // shown as its generated document
      rows.push({
        key: `file:${f.id}`,
        place: NO_PLACE, // set below
        kind: 'file',
        id: f.id,
        category: cat(f.docType),
        docType: f.docType,
        docTypeLabel: label(f.docType),
        name: f.fileName,
        source: 'UPLOADED',
        issuingEntity: entityOfType(f.docType),
        status: null,
        links: f.links.map((l) => hubLink(l, l.id)),
        customerIds: [...new Set(f.links.map(linkCustomerId).filter(Boolean) as string[])],
        customerName: f.links.map(linkCustomerName).find(Boolean) ?? null,
        recipient: null,
        createdBy: f.uploadedByName,
        date: f.createdAt.toISOString(),
        fileId: f.id,
        docRef: f.docRef ?? null,
        mimeType: f.mimeType,
        hasThumb: !!f.thumbKey,
      });
    }

    // One row per linked Document (it may be linked to several records). An
    // ADH 請求書 made in-app shows once, as its generated document.
    const generatedInvoiceDocs = new Set(generated.map((g) => g.documentId).filter(Boolean) as string[]);
    const byDoc = new Map<string, typeof docLinks>();
    for (const l of docLinks) if (!generatedInvoiceDocs.has(l.documentId)) byDoc.set(l.documentId, [...(byDoc.get(l.documentId) ?? []), l]);
    const docs: Array<{ id: string; name: string | null; type: string; status: string; config: any; createdAt: Date; documentTemplateId: string }> = byDoc.size
      ? await this.prisma.document.findMany({
          where: { organizationId, id: { in: [...byDoc.keys()] } },
          select: { id: true, name: true, type: true, status: true, config: true, createdAt: true, documentTemplateId: true },
        })
      : [];
    const docById = new Map(docs.map((d) => [d.id, d]));
    for (const [documentId, links] of byDoc) {
      const d = docById.get(documentId);
      const s = d ? documentSummary(d) : null;
      const state = documentLinkState(d);
      const docType = links[0].docType;
      rows.push({
        key: `invoice:${documentId}`,
        place: NO_PLACE, // set below
        kind: 'invoice',
        id: documentId,
        docRef: null,
        category: cat(docType),
        docType,
        docTypeLabel: label(docType),
        name: s?.number ?? '(deleted invoice)',
        source: 'IN_APP',
        issuingEntity: entityOfType(docType),
        status: state.state === 'confirmed' ? 'Confirmed' : state.state === 'draft' ? 'Draft' : state.state === 'voided' ? 'Voided' : 'Deleted',
        links: links.map((l) => hubLink(l, l.id)),
        customerIds: [...new Set(links.map(linkCustomerId).filter(Boolean) as string[])],
        customerName: links.map(linkCustomerName).find(Boolean) ?? s?.customerName ?? null,
        recipient: null,
        // The editor stamps who last worked on it (savedBy is often empty).
        createdBy: (d?.config as any)?.savedBy || (d?.config as any)?.confirmedBy || (d?.config as any)?.lastUsedBy || null,
        date: (d?.createdAt ?? links[0].createdAt).toISOString(),
        document: d ? { id: d.id, type: d.type, templateId: d.documentTemplateId } : null,
      });
    }

    for (const g of generated) {
      const header = (g.header as any) ?? {};
      const shipRef = (sh: { seqNo: number | null; order: { orderNo: number } | null } | null) => (sh?.order ? `#${sh.order.orderNo}${sh.seqNo ? `-${sh.seqNo}` : ''}` : null);
      const links: HubLink[] = g.shipment
        ? [
            ...(g.shipment.contractId ? [{ contractId: g.shipment.contractId, shipmentId: null, contractNo: g.shipment.contract?.contractNo ?? null, blNumber: null }] : []),
            ...(g.shipment.orderId ? [{ contractId: null, shipmentId: null, orderId: g.shipment.orderId, contractNo: null, blNumber: null, ref: `#${g.shipment.order?.orderNo}` }] : []),
            { contractId: null, shipmentId: g.shipment.id, contractNo: null, blNumber: g.shipment.blNumber, ref: shipRef(g.shipment), orderOfShipment: g.shipment.orderId ?? null },
          ]
        : g.order
          ? [{ contractId: null, shipmentId: null, orderId: g.order.id, contractNo: null, blNumber: null, ref: `#${g.order.orderNo}` }]
          : g.contract
            ? [{ contractId: g.contract.id, shipmentId: null, contractNo: g.contract.contractNo, blNumber: null }]
            : [];
      // An Invoice #2 / single invoice covering several shipments belongs to each.
      for (const sid of g.coversShipmentIds ?? []) {
        if (links.some((x) => x.shipmentId === sid)) continue;
        const c = coveredById.get(sid);
        links.push({ contractId: null, shipmentId: sid, contractNo: null, blNumber: c?.blNumber ?? null, ref: shipRef(c ?? null), orderOfShipment: c?.orderId ?? null });
      }
      const customerIds = new Set([g.shipment?.customerId ?? g.order?.customerId ?? g.contract?.customerId].filter(Boolean) as string[]);
      const customerNames = [g.shipment?.customer?.name ?? g.order?.customer?.name ?? g.contract?.customer?.name];
      // Invoice #1 billing several contracts belongs to each of them: the
      // finalized PDF is linked to all; a draft names them on its lines.
      const extra = new Set<string>();
      for (const l of g.finalFileId ? (fileById.get(g.finalFileId)?.links ?? []) : []) {
        if (l.contractId && !links.some((x) => x.contractId === l.contractId)) {
          links.push({ contractId: l.contractId, shipmentId: null, contractNo: l.contract?.contractNo ?? null, blNumber: null });
          if (l.contract?.customerId) customerIds.add(l.contract.customerId);
          customerNames.push(l.contract?.customer?.name);
        }
      }
      if (!g.finalFileId && g.docType === 'INVOICE_1') {
        for (const l of toInvoiceLines(g.rows)) if (l.contractId && !links.some((x) => x.contractId === l.contractId)) extra.add(l.contractId);
      }
      if (extra.size) {
        const more = await this.prisma.contract.findMany({
          where: { organizationId, id: { in: [...extra] } },
          select: { id: true, contractNo: true, customerId: true, customer: { select: { name: true } } },
        });
        for (const c of more) {
          links.push({ contractId: c.id, shipmentId: null, contractNo: c.contractNo, blNumber: null });
          if (c.customerId) customerIds.add(c.customerId);
          customerNames.push(c.customer?.name);
        }
      }
      const customerName = customerNames.find(Boolean) ?? null;
      rows.push({
        key: `generated:${g.id}`,
        place: NO_PLACE, // set below
        kind: 'generated',
        id: g.id,
        category: cat(g.docType),
        docType: g.docType,
        // A negative Invoice #2 is a credit note (falling LME) — offset on a later Invoice #1.
        docTypeLabel:
          g.docType === 'INVOICE_2' && invoiceTotals(toInvoiceLines(g.rows), Number((g.header as any)?.taxRate ?? 10), null, (g.header as any)?.variant === 'final' ? 'final' : undefined).total < 0
            ? 'Credit note'
            : label(g.docType),
        name: g.number ?? `${label(g.docType)} (draft)`,
        source: 'IN_APP',
        issuingEntity: g.issuingEntity ?? entityFor(g.docType),
        status: g.status === 'FINAL' ? 'Final' : 'Draft',
        links,
        customerIds: [...customerIds],
        customerName,
        recipient: recipientOf(g.docType, header, customerName),
        createdBy: g.createdByName,
        date: g.updatedAt.toISOString(),
        fileId: g.finalFileId,
        docRef: g.docRef ?? null,
        mimeType: g.finalFileId ? (fileById.get(g.finalFileId)?.mimeType ?? 'application/pdf') : null,
        hasThumb: g.finalFileId ? !!fileById.get(g.finalFileId)?.thumbKey : false,
        shipmentId: g.shipment?.id ?? null,
      });
    }

    for (const r of rows) r.place = hubPlace(r.links);
    // Round N: rows that belong only to test orders are hidden unless "Show test orders".
    if (query.includeTest !== 'true') {
      const test = await testRecordIds(this.prisma, organizationId);
      if (test.orderIds.size) rows.splice(0, rows.length, ...rows.filter((r) => !onlyTestLinks(test, r.links)));
    }
    const q = query.q?.trim().toLowerCase();
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(query.to) ? `${query.to}T23:59:59.999Z` : query.to) : null;
    // Every filter except the category chip itself — the chip counts follow it.
    const matchesOthers = (r: HubRow) =>
      (!query.docType || r.docType === query.docType) &&
      (!query.source || r.source === query.source) &&
      (!query.entity || r.issuingEntity === query.entity) &&
      (!query.contractId || r.links.some((l) => l.contractId === query.contractId)) &&
      (!query.shipmentId || r.links.some((l) => l.shipmentId === query.shipmentId)) &&
      (!query.orderId || r.links.some((l) => l.orderId === query.orderId)) &&
      (!query.customerId || r.customerIds.includes(query.customerId)) &&
      (!from || new Date(r.date) >= from) &&
      (!to || new Date(r.date) <= to) &&
      (!q || hubMatches(r, q));
    const visible = rows.filter(matchesOthers);
    const filtered = visible.filter((r) => !query.category || r.category === query.category);
    filtered.sort((a, b) => b.date.localeCompare(a.date));
    const counts: Record<string, number> = {};
    for (const r of visible) counts[r.category] = (counts[r.category] ?? 0) + 1;
    const total = filtered.length;
    return { items: filtered.slice(skip, skip + pageSize), total, page, pageSize, totalPages: Math.ceil(total / pageSize), categoryCounts: counts, allCount: visible.length };
  }
}

/**
 * Who a generated document is addressed to when that is not the trade
 * customer: the SI goes to the warehouse (header.toName), the SG→JP invoice /
 * PL to the buyer (ADH Japan — first line of its buyer block). Customer
 * documents (PL / COA / 請求書) go to the customer itself: null.
 */
export function recipientOf(docType: string, header: any, customerName: string | null): string | null {
  const firstLine = (v: unknown) => (typeof v === 'string' ? v.split(/\r?\n/)[0].trim() : '');
  let r = '';
  if (docType === 'SHIPPING_INSTRUCTIONS') r = String(header?.toName ?? '').trim();
  else if (docType === 'SGJP_IV_PL') r = firstLine(header?.buyerBlock) || firstLine(header?.consigneeBlock);
  if (!r) return null;
  const norm = (v: string) => v.toLowerCase().replace(/[\s.,]/g, '');
  return customerName && norm(r) === norm(customerName) ? null : r;
}
