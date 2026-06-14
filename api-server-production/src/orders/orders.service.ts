import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import {
  DocumentExtractionService,
  SupplierReconciliationData,
} from '../document-extraction/document-extraction.service';

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

  async list(organizationId: string) {
    return this.prisma.order.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        sourceQuotation: { select: { id: true, name: true, status: true, type: true, documentTemplateId: true } },
      },
    });
  }

  async getById(id: string, organizationId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, organizationId },
      include: {
        customer: { select: { id: true, name: true, customerCode: true, address: true } },
        sourceQuotation: { select: { id: true, name: true, status: true, type: true, documentTemplateId: true } },
      },
    });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);

    // Enrich each linked-document entry with its CURRENT status so the order
    // page can place items into pipeline stages (DO delivered, invoice
    // sent/paid). Stored entries only carry id/name/templateId/itemIds; the
    // live status is read fresh from the Document table here.
    const ld: any = order.linkedDocuments || {};
    const kinds = ['po', 'do', 'invoice', 'salesOrder'] as const;
    const ids: string[] = [];
    for (const k of kinds) for (const d of ld[k] || []) if (d?.id) ids.push(d.id);
    if (ids.length) {
      const docs = await this.prisma.document.findMany({
        where: { id: { in: ids }, organizationId },
        select: { id: true, status: true },
      });
      const statusById = new Map(docs.map((d) => [d.id, d.status]));
      for (const k of kinds) {
        if (Array.isArray(ld[k])) {
          ld[k] = ld[k].map((d: any) => ({ ...d, status: statusById.get(d.id) ?? d.status ?? null }));
        }
      }
      (order as any).linkedDocuments = ld;
    }
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
    return this.prisma.order.delete({
      where: { id, organizationId },
    });
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
