import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { documentLinkState } from './shipments.rules';
import { documentSummary, pageArgs, TradeConfigService } from './trade-config.service';
import { toInvoiceLines } from './trade-invoice';

export type HubSource = 'UPLOADED' | 'IN_APP';

export interface HubQuery {
  category?: string;
  docType?: string;
  contractId?: string;
  shipmentId?: string;
  customerId?: string;
  source?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
  pageSize?: string;
}

type HubLink = { contractId: string | null; shipmentId: string | null; contractNo: string | null; blNumber: string | null; linkId?: string };

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
  /** In-app only: Draft / Confirmed / Final (+ Voided / Deleted for invoices). */
  status: string | null;
  links: HubLink[];
  customerIds: string[];
  /** The trade customer of the contract / shipment it belongs to (English name). */
  customerName: string | null;
  /** Who the document is addressed to when that is not the customer (SI → the warehouse, SG→JP → ADH Japan). */
  recipient: string | null;
  createdBy: string | null;
  date: string;
  /** Extra handles the portal needs for the row actions. */
  fileId?: string | null;
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
          uploadedByName: true,
          createdAt: true,
          links: {
            select: {
              id: true,
              contractId: true,
              shipmentId: true,
              contract: { select: { contractNo: true, customerId: true, customer: { select: { name: true } } } },
              shipment: { select: { blNumber: true, customerId: true, customer: { select: { name: true } } } },
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
          createdAt: true,
          contract: { select: { contractNo: true, customerId: true, customer: { select: { name: true } } } },
          shipment: { select: { blNumber: true, customerId: true, customer: { select: { name: true } } } },
        },
      }),
      this.prisma.tradeGeneratedDoc.findMany({
        where: { organizationId },
        select: {
          id: true,
          docType: true,
          number: true,
          status: true,
          header: true,
          finalFileId: true,
          documentId: true,
          createdByName: true,
          updatedAt: true,
          rows: true,
          shipment: { select: { id: true, blNumber: true, customerId: true, contractId: true, customer: { select: { name: true } }, contract: { select: { contractNo: true } } } },
          // Invoice #1 belongs to a contract, not a shipment.
          contract: { select: { id: true, contractNo: true, customerId: true, customer: { select: { name: true } } } },
        },
      }),
    ]);

    const finalFileIds = new Set(generated.map((g) => g.finalFileId).filter(Boolean) as string[]);
    const fileById = new Map(files.map((f) => [f.id, f]));
    const rows: HubRow[] = [];

    for (const f of files) {
      if (finalFileIds.has(f.id)) continue; // shown as its generated document
      rows.push({
        key: `file:${f.id}`,
        kind: 'file',
        id: f.id,
        category: cat(f.docType),
        docType: f.docType,
        docTypeLabel: label(f.docType),
        name: f.fileName,
        source: 'UPLOADED',
        status: null,
        links: f.links.map((l) => ({ linkId: l.id, contractId: l.contractId, shipmentId: l.shipmentId, contractNo: l.contract?.contractNo ?? null, blNumber: l.shipment?.blNumber ?? null })),
        customerIds: [...new Set(f.links.map((l) => l.contract?.customerId ?? l.shipment?.customerId).filter(Boolean) as string[])],
        customerName: f.links.map((l) => l.contract?.customer?.name ?? l.shipment?.customer?.name).find(Boolean) ?? null,
        recipient: null,
        createdBy: f.uploadedByName,
        date: f.createdAt.toISOString(),
        fileId: f.id,
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
        kind: 'invoice',
        id: documentId,
        category: cat(docType),
        docType,
        docTypeLabel: label(docType),
        name: s?.number ?? '(deleted invoice)',
        source: 'IN_APP',
        status: state.state === 'confirmed' ? 'Confirmed' : state.state === 'draft' ? 'Draft' : state.state === 'voided' ? 'Voided' : 'Deleted',
        links: links.map((l) => ({ linkId: l.id, contractId: l.contractId, shipmentId: l.shipmentId, contractNo: l.contract?.contractNo ?? null, blNumber: l.shipment?.blNumber ?? null })),
        customerIds: [...new Set(links.map((l) => l.contract?.customerId ?? l.shipment?.customerId).filter(Boolean) as string[])],
        customerName: links.map((l) => l.contract?.customer?.name ?? l.shipment?.customer?.name).find(Boolean) ?? s?.customerName ?? null,
        recipient: null,
        // The editor stamps who last worked on it (savedBy is often empty).
        createdBy: (d?.config as any)?.savedBy || (d?.config as any)?.confirmedBy || (d?.config as any)?.lastUsedBy || null,
        date: (d?.createdAt ?? links[0].createdAt).toISOString(),
        document: d ? { id: d.id, type: d.type, templateId: d.documentTemplateId } : null,
      });
    }

    for (const g of generated) {
      const header = (g.header as any) ?? {};
      const links: HubLink[] = g.shipment
        ? [
            { contractId: g.shipment.contractId, shipmentId: null, contractNo: g.shipment.contract?.contractNo ?? null, blNumber: null },
            { contractId: null, shipmentId: g.shipment.id, contractNo: null, blNumber: g.shipment.blNumber },
          ]
        : g.contract
          ? [{ contractId: g.contract.id, shipmentId: null, contractNo: g.contract.contractNo, blNumber: null }]
          : [];
      const customerIds = new Set([g.shipment?.customerId ?? g.contract?.customerId].filter(Boolean) as string[]);
      const customerNames = [g.shipment?.customer?.name ?? g.contract?.customer?.name];
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
        kind: 'generated',
        id: g.id,
        category: cat(g.docType),
        docType: g.docType,
        docTypeLabel: label(g.docType),
        name: g.number ?? `${label(g.docType)} (draft)`,
        source: 'IN_APP',
        status: g.status === 'FINAL' ? 'Final' : 'Draft',
        links,
        customerIds: [...customerIds],
        customerName,
        recipient: recipientOf(g.docType, header, customerName),
        createdBy: g.createdByName,
        date: g.updatedAt.toISOString(),
        fileId: g.finalFileId,
        shipmentId: g.shipment?.id ?? null,
      });
    }

    const q = query.q?.trim().toLowerCase();
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(query.to) ? `${query.to}T23:59:59.999Z` : query.to) : null;
    // Every filter except the category chip itself — the chip counts follow it.
    const matchesOthers = (r: HubRow) =>
      (!query.docType || r.docType === query.docType) &&
      (!query.source || r.source === query.source) &&
      (!query.contractId || r.links.some((l) => l.contractId === query.contractId)) &&
      (!query.shipmentId || r.links.some((l) => l.shipmentId === query.shipmentId)) &&
      (!query.customerId || r.customerIds.includes(query.customerId)) &&
      (!from || new Date(r.date) >= from) &&
      (!to || new Date(r.date) <= to) &&
      (!q || r.name.toLowerCase().includes(q) || (r.customerName ?? '').toLowerCase().includes(q) || (r.recipient ?? '').toLowerCase().includes(q) || r.docTypeLabel.toLowerCase().includes(q));
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
