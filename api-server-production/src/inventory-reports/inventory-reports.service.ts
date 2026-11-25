import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  INVENTORY_DOC_TYPES, ItemRow, NO_CATEGORY, PURCHASE_TYPES, STOCK_IN_TYPES, STOCK_OUT_TYPES,
  StockRow, availableQty, docTypeLabel, isConfirmedStatus, isoDateOrNull, outstandingQty, round2, signedQty,
  stockValue, supplierOf,
} from './inventory-reports';

const MAX_ROWS = 20000;

/**
 * The ten legacy Inventory Reports. Built the way the sales report is built
 * (src/sales-report): ONE raw query per shape over the Document JSONB with
 * POSITIONAL parameters only (the tenancy client rejects Prisma.sql fragments),
 * the arithmetic in plain TypeScript, and a plain object out — the page draws
 * it, the server decides it.
 *
 * Two loaders feed all ten:
 *   headers() — one row per document  (listings, unconfirmed, summaries)
 *   items()   — one row per LINE of a document, flattened out of config.items
 *               (every stock analysis, movement and buy-price report)
 *
 * Lines are read from `config.items`, not from the DocumentItem table: the
 * junction rows are written by some paths and not others (the Biofuel SAO on
 * dev has four lines in its config and no DocumentItem rows at all), whereas
 * config.items is what the editor saves and what the printed document shows.
 * `items[].inventoryItemId` is an ASSET id — the long-standing naming trap,
 * see the memory note on Document/Asset/Inventory linkage.
 */
@Injectable()
export class InventoryReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── loaders ──────────────────────────────────────────────────────────────

  /** One row per document of `types`, within an optional date range. */
  private async headers(organizationId: string, types: string[], from: string | null, to: string | null) {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM (
         SELECT d.id::text AS "documentId", COALESCE(d.name, '') AS number, d.type, d.status::text AS status,
           COALESCE(NULLIF(d."listIssueDate", ''), LEFT(NULLIF(d.config->>'date', ''), 10),
                    LEFT(NULLIF(d.config->'documentInfo'->>'date', ''), 10), to_char(d."createdAt", 'YYYY-MM-DD')) AS date,
           COALESCE(NULLIF(d.config->'documentInfo'->>'supplierName', ''), NULLIF(d.config->>'supplierName', ''),
                    NULLIF(d.config->'supplier'->>'name', ''), '') AS supplier,
           COALESCE(NULLIF(d.config->'documentInfo'->>'supplierCode', ''), NULLIF(d.config->>'supplierCode', ''), '') AS "supplierCode",
           COALESCE(NULLIF(d.config->>'referenceNo', ''), NULLIF(d.config->'documentInfo'->>'referenceNo', ''),
                    NULLIF(d.config->>'supplierDONo', ''), '') AS reference,
           COALESCE(d.config->>'remarks', d.config->>'note', '') AS remarks,
           (SELECT COALESCE(SUM(CASE WHEN (i->>'quantity') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (i->>'quantity')::numeric ELSE 0 END), 0)
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.config->'items') = 'array' THEN d.config->'items' ELSE '[]'::jsonb END) i) AS "totalQty",
           (SELECT COALESCE(SUM(CASE WHEN (i->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (i->>'amount')::numeric ELSE 0 END), 0)
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.config->'items') = 'array' THEN d.config->'items' ELSE '[]'::jsonb END) i) AS "itemsTotal",
           CASE WHEN (d.config->>'nettTotal') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (d.config->>'nettTotal')::numeric
                WHEN (d.config->>'totalAmount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (d.config->>'totalAmount')::numeric END AS "docTotal",
           COALESCE(d.config->>'voided', '') = 'true' AS voided
         FROM "Document" d
         WHERE d."organizationId" = $1 AND d.type = ANY($2::text[])
       ) h
       WHERE h.voided = false AND ($3::text IS NULL OR h.date >= $3) AND ($4::text IS NULL OR h.date <= $4)
       ORDER BY h.date, h.number
       LIMIT ${MAX_ROWS}`,
      organizationId, types, from, to,
    );
    return rows.map((r) => ({
      ...r,
      totalQty: Number(r.totalQty) || 0,
      itemsTotal: Number(r.itemsTotal) || 0,
      // A document that carries its own total uses it; otherwise the lines add up to it.
      amount: round2(r.docTotal != null ? Number(r.docTotal) : Number(r.itemsTotal) || 0),
    }));
  }

  /** One row per LINE of every document of `types`, within an optional date range. */
  private async items(organizationId: string, types: string[], from: string | null, to: string | null, confirmedOnly = true): Promise<ItemRow[]> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM (
         SELECT d.id::text AS "documentId", COALESCE(d.name, '') AS number, d.type, d.status::text AS status,
           COALESCE(NULLIF(d."listIssueDate", ''), LEFT(NULLIF(d.config->>'date', ''), 10),
                    LEFT(NULLIF(d.config->'documentInfo'->>'date', ''), 10), to_char(d."createdAt", 'YYYY-MM-DD')) AS date,
           COALESCE(NULLIF(d.config->'documentInfo'->>'supplierName', ''), NULLIF(d.config->>'supplierName', ''),
                    NULLIF(d.config->'supplier'->>'name', ''), '') AS supplier,
           COALESCE(NULLIF(d.config->'documentInfo'->>'supplierCode', ''), NULLIF(d.config->>'supplierCode', ''), '') AS "supplierCode",
           COALESCE(NULLIF(d.config->>'referenceNo', ''), NULLIF(d.config->'documentInfo'->>'referenceNo', ''), '') AS reference,
           NULLIF(i->>'inventoryItemId', '') AS "assetId",
           COALESCE(NULLIF(i->>'itemCode', ''), '') AS code,
           COALESCE(NULLIF(i->>'description', ''), '') AS description,
           COALESCE(NULLIF(i->>'uom', ''), '') AS uom,
           CASE WHEN (i->>'quantity') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (i->>'quantity')::numeric ELSE 0 END AS quantity,
           CASE WHEN (i->>'unitPrice') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (i->>'unitPrice')::numeric ELSE 0 END AS "unitPrice",
           CASE WHEN (i->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (i->>'amount')::numeric ELSE 0 END AS amount,
           CASE WHEN (i->>'receivedQty') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (i->>'receivedQty')::numeric ELSE 0 END AS "receivedQty",
           COALESCE(d.config->>'voided', '') = 'true' AS voided
         FROM "Document" d
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.config->'items') = 'array' THEN d.config->'items' ELSE '[]'::jsonb END) i
         WHERE d."organizationId" = $1 AND d.type = ANY($2::text[])
       ) l
       WHERE l.voided = false AND ($3::text IS NULL OR l.date >= $3) AND ($4::text IS NULL OR l.date <= $4)
       ORDER BY l.date, l.number
       LIMIT ${MAX_ROWS}`,
      organizationId, types, from, to,
    );
    return rows
      .filter((r) => !confirmedOnly || isConfirmedStatus(r.status))
      .map((r) => ({
        documentId: r.documentId, number: r.number, type: r.type, status: r.status, date: r.date,
        supplier: r.supplier || '', supplierCode: r.supplierCode || '', reference: r.reference || '',
        assetId: r.assetId || null, code: r.code || '', description: r.description || '', uom: r.uom || '',
        quantity: Number(r.quantity) || 0, unitPrice: Number(r.unitPrice) || 0, amount: Number(r.amount) || 0,
        receivedQty: Number(r.receivedQty) || 0,
      }));
  }

  /**
   * Every product with what is on the shelf NOW. A tracked asset counts its
   * units by status; an untracked one carries a plain quantity. The `sold` and
   * `rental` counts are what a tracked unit's own status says — they are not
   * derived from documents, so a Stock Status run always matches the Products
   * screen a user can see.
   */
  private async stock(organizationId: string, categoryId: string | null): Promise<StockRow[]> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT a.id::text AS "assetId", COALESCE(a."skuKey", '') AS code, COALESCE(a.name, '') AS name,
         COALESCE(a.description, '') AS description, COALESCE(a.uom, 'PCS') AS uom,
         a."categoryId"::text AS "categoryId", COALESCE(c.name, '') AS category,
         COALESCE(a."costPrice", 0) AS "costPrice", COALESCE(a.price, 0) AS "sellPrice",
         a."minQuantity" AS "minQuantity", a."isTracked" AS "isTracked", COALESCE(a.quantity, 0) AS quantity,
         (SELECT COUNT(*) FROM "Inventory" v WHERE v."assetId" = a.id AND v."organizationId" = $1 AND v.status::text = 'instock') AS instock,
         (SELECT COUNT(*) FROM "Inventory" v WHERE v."assetId" = a.id AND v."organizationId" = $1 AND v.status::text = 'reserved') AS reserved,
         (SELECT COUNT(*) FROM "Inventory" v WHERE v."assetId" = a.id AND v."organizationId" = $1 AND v.status::text = 'rental') AS rental,
         (SELECT COUNT(*) FROM "Inventory" v WHERE v."assetId" = a.id AND v."organizationId" = $1 AND v.status::text = 'maintenance') AS maintenance,
         (SELECT COUNT(*) FROM "Inventory" v WHERE v."assetId" = a.id AND v."organizationId" = $1 AND v.status::text = 'sold') AS sold
       FROM "Asset" a
       LEFT JOIN "Category" c ON c.id = a."categoryId"
       WHERE a."organizationId" = $1 AND a."deletedAt" IS NULL AND ($2::text IS NULL OR a."categoryId"::text = $2)
       ORDER BY COALESCE(c.name, ''), COALESCE(a."skuKey", ''), a.name
       LIMIT ${MAX_ROWS}`,
      organizationId, categoryId,
    );
    return rows.map((r) => ({
      assetId: r.assetId, code: r.code, name: r.name, description: r.description, uom: r.uom,
      categoryId: r.categoryId, category: r.category || NO_CATEGORY,
      costPrice: Number(r.costPrice) || 0, sellPrice: Number(r.sellPrice) || 0,
      minQuantity: r.minQuantity == null ? null : Number(r.minQuantity),
      isTracked: !!r.isTracked,
      onHand: r.isTracked ? Number(r.instock) || 0 : Number(r.quantity) || 0,
      reserved: Number(r.reserved) || 0,
      rental: Number(r.rental) || 0,
      maintenance: Number(r.maintenance) || 0,
      sold: Number(r.sold) || 0,
    }));
  }

  /** The category picker for the reports that prompt for one. */
  async categories(organizationId: string) {
    const rows = await this.prisma.category.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return { categories: rows.map((c: any) => ({ id: c.id, name: c.name })) };
  }

  private range(query: { from?: string; to?: string }) {
    const from = isoDateOrNull(query.from);
    const to = isoDateOrNull(query.to);
    if (from && to && from > to) throw new BadRequestException('The From date is after the To date');
    return { from, to };
  }

  /** What is still on order per asset: confirmed PO lines not yet fully received. */
  private async onOrder(organizationId: string): Promise<Map<string, number>> {
    const lines = await this.items(organizationId, PURCHASE_TYPES, null, null);
    const out = new Map<string, number>();
    for (const l of lines) {
      if (!l.assetId) continue;
      const left = outstandingQty(l);
      if (left > 0) out.set(l.assetId, (out.get(l.assetId) || 0) + left);
    }
    return out;
  }

  // ── 1. Stock Status ──────────────────────────────────────────────────────

  async stockStatus(organizationId: string, query: { categoryId?: string; includeZero?: string }) {
    const categoryId = query.categoryId?.trim() || null;
    const [stock, onOrder] = await Promise.all([this.stock(organizationId, categoryId), this.onOrder(organizationId)]);
    const includeZero = String(query.includeZero ?? '') === 'true';
    const rows = stock
      .map((s) => ({
        assetId: s.assetId, code: s.code, description: s.description || s.name, category: s.category, uom: s.uom,
        onHand: s.onHand, onOrder: onOrder.get(s.assetId) || 0, reserved: s.reserved,
        available: availableQty(s), unitCost: s.costPrice, value: stockValue(s),
      }))
      .filter((r) => includeZero || r.onHand !== 0 || r.onOrder !== 0 || r.reserved !== 0);
    return {
      rows,
      totals: { onHand: rows.reduce((a, r) => a + r.onHand, 0), value: round2(rows.reduce((a, r) => a + r.value, 0)) },
    };
  }

  // ── 2. Unconfirn Inventory Transactions ──────────────────────────────────

  async unconfirmedTransactions(organizationId: string, query: { from?: string; to?: string }) {
    const { from, to } = this.range(query);
    const docs = await this.headers(organizationId, INVENTORY_DOC_TYPES, from, to);
    const rows = docs
      .filter((d) => !isConfirmedStatus(d.status))
      .map((d) => ({
        documentId: d.documentId, number: d.number, type: docTypeLabel(d.type), rawType: d.type, date: d.date,
        supplier: d.supplier, reference: d.reference, quantity: d.totalQty, amount: d.amount, status: d.status,
      }));
    return { rows, totals: { quantity: rows.reduce((a, r) => a + r.quantity, 0), amount: round2(rows.reduce((a, r) => a + r.amount, 0)) } };
  }

  // ── 3. Purchase Order Listing ────────────────────────────────────────────

  async purchaseOrderListing(organizationId: string, query: { from?: string; to?: string; supplier?: string }) {
    const { from, to } = this.range(query);
    const want = String(query.supplier || '').trim().toLowerCase();
    const [docs, lines] = await Promise.all([
      this.headers(organizationId, PURCHASE_TYPES, from, to),
      this.items(organizationId, PURCHASE_TYPES, from, to, false),
    ]);
    // Outstanding quantity per PO, so the listing shows what has still to arrive.
    const left = new Map<string, number>();
    for (const l of lines) left.set(l.documentId, (left.get(l.documentId) || 0) + outstandingQty(l));
    const rows = docs
      .filter((d) => !want || String(d.supplier || '').toLowerCase().includes(want))
      .map((d) => ({
        documentId: d.documentId, number: d.number, date: d.date, supplier: d.supplier, reference: d.reference,
        quantity: d.totalQty, outstanding: left.get(d.documentId) || 0, amount: d.amount, status: d.status,
      }));
    return {
      rows,
      suppliers: [...new Set(docs.map((d) => d.supplier).filter(Boolean))].sort(),
      totals: { quantity: rows.reduce((a, r) => a + r.quantity, 0), amount: round2(rows.reduce((a, r) => a + r.amount, 0)) },
    };
  }

  // ── 4. Purchase Summary By Supplier ──────────────────────────────────────

  async purchaseSummaryBySupplier(organizationId: string, query: { from?: string; to?: string }) {
    const { from, to } = this.range(query);
    const docs = (await this.headers(organizationId, PURCHASE_TYPES, from, to)).filter((d) => isConfirmedStatus(d.status));
    const by = new Map<string, { supplier: string; orders: number; quantity: number; amount: number; last: string }>();
    for (const d of docs) {
      const key = supplierOf(d as any);
      const cur = by.get(key) || { supplier: key, orders: 0, quantity: 0, amount: 0, last: '' };
      cur.orders += 1;
      cur.quantity += d.totalQty;
      cur.amount = round2(cur.amount + d.amount);
      if (d.date > cur.last) cur.last = d.date;
      by.set(key, cur);
    }
    const rows = [...by.values()].sort((a, b) => b.amount - a.amount);
    return { rows, totals: { orders: rows.reduce((a, r) => a + r.orders, 0), quantity: rows.reduce((a, r) => a + r.quantity, 0), amount: round2(rows.reduce((a, r) => a + r.amount, 0)) } };
  }

  // ── 5. Detailed Stock Analysis By Supplier / Stock ───────────────────────

  async stockAnalysisBySupplier(organizationId: string, query: { from?: string; to?: string }) {
    const { from, to } = this.range(query);
    const lines = await this.items(organizationId, [...PURCHASE_TYPES, 'PR', 'PURCHASE_RETURN'], from, to);
    const groups = new Map<string, Map<string, { code: string; description: string; uom: string; quantity: number; amount: number; last: string }>>();
    for (const l of lines) {
      const sup = supplierOf(l);
      // A purchase return gives stock back to the supplier: it nets off what was bought.
      const dir = ['PR', 'PURCHASE_RETURN'].includes(String(l.type).toUpperCase()) ? -1 : 1;
      if (!groups.has(sup)) groups.set(sup, new Map());
      const items = groups.get(sup)!;
      const key = l.assetId || l.code || l.description;
      const cur = items.get(key) || { code: l.code, description: l.description, uom: l.uom, quantity: 0, amount: 0, last: '' };
      cur.quantity += dir * Math.abs(l.quantity);
      cur.amount = round2(cur.amount + dir * Math.abs(l.amount));
      if (l.date > cur.last) cur.last = l.date;
      items.set(key, cur);
    }
    const rows = [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([supplier, items]) => {
        const list = [...items.values()].sort((a, b) => (a.code || a.description).localeCompare(b.code || b.description));
        return {
          supplier, items: list,
          subtotal: { quantity: list.reduce((a, r) => a + r.quantity, 0), amount: round2(list.reduce((a, r) => a + r.amount, 0)) },
        };
      });
    return { rows, totals: { quantity: rows.reduce((a, g) => a + g.subtotal.quantity, 0), amount: round2(rows.reduce((a, g) => a + g.subtotal.amount, 0)) } };
  }

  // ── 6. Detailed Stock Analysis By Category ───────────────────────────────

  async stockAnalysisByCategory(organizationId: string, query: { from?: string; to?: string; categoryId?: string }) {
    const { from, to } = this.range(query);
    const categoryId = query.categoryId?.trim() || null;
    const [stock, lines] = await Promise.all([
      this.stock(organizationId, categoryId),
      this.items(organizationId, [...STOCK_IN_TYPES, ...STOCK_OUT_TYPES], from, to),
    ]);
    const byAsset = new Map(stock.map((s) => [s.assetId, s]));
    const moved = new Map<string, { in: number; out: number; inAmt: number; outAmt: number }>();
    for (const l of lines) {
      if (!l.assetId || !byAsset.has(l.assetId)) continue;
      const q = signedQty(l);
      const cur = moved.get(l.assetId) || { in: 0, out: 0, inAmt: 0, outAmt: 0 };
      if (q >= 0) { cur.in += q; cur.inAmt = round2(cur.inAmt + Math.abs(l.amount)); }
      else { cur.out += Math.abs(q); cur.outAmt = round2(cur.outAmt + Math.abs(l.amount)); }
      moved.set(l.assetId, cur);
    }
    const groups = new Map<string, any[]>();
    for (const s of stock) {
      const m = moved.get(s.assetId) || { in: 0, out: 0, inAmt: 0, outAmt: 0 };
      if (!groups.has(s.category)) groups.set(s.category, []);
      groups.get(s.category)!.push({
        code: s.code, description: s.description || s.name, uom: s.uom,
        qtyIn: m.in, qtyOut: m.out, onHand: s.onHand, value: stockValue(s),
      });
    }
    const rows = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, items]) => ({
      category, items,
      subtotal: {
        qtyIn: items.reduce((a, r) => a + r.qtyIn, 0), qtyOut: items.reduce((a, r) => a + r.qtyOut, 0),
        onHand: items.reduce((a, r) => a + r.onHand, 0), value: round2(items.reduce((a, r) => a + r.value, 0)),
      },
    }));
    return {
      rows,
      totals: {
        qtyIn: rows.reduce((a, g) => a + g.subtotal.qtyIn, 0), qtyOut: rows.reduce((a, g) => a + g.subtotal.qtyOut, 0),
        onHand: rows.reduce((a, g) => a + g.subtotal.onHand, 0), value: round2(rows.reduce((a, g) => a + g.subtotal.value, 0)),
      },
    };
  }

  // ── 7. Stock Movement Analysis ───────────────────────────────────────────

  /**
   * Opening / In / Out / Closing per product for the period. Opening is every
   * confirmed movement BEFORE the From date, so the report reconciles across
   * consecutive periods on its own figures. Closing is opening + in − out —
   * the movement position, which is not the same thing as what is on the shelf
   * today when stock was set by hand on the Products screen; the page says so.
   */
  async stockMovement(organizationId: string, query: { from?: string; to?: string; assetId?: string }) {
    const { from, to } = this.range(query);
    const assetId = query.assetId?.trim() || null;
    const [stock, before, during] = await Promise.all([
      this.stock(organizationId, null),
      from ? this.items(organizationId, [...STOCK_IN_TYPES, ...STOCK_OUT_TYPES], null, this.dayBefore(from)) : Promise.resolve([] as ItemRow[]),
      this.items(organizationId, [...STOCK_IN_TYPES, ...STOCK_OUT_TYPES], from, to),
    ]);
    const byAsset = new Map(stock.map((s) => [s.assetId, s]));
    const opening = new Map<string, number>();
    for (const l of before) if (l.assetId) opening.set(l.assetId, (opening.get(l.assetId) || 0) + signedQty(l));
    const moves = new Map<string, { in: number; out: number }>();
    const detail: any[] = [];
    for (const l of during) {
      if (!l.assetId) continue;
      if (assetId && l.assetId !== assetId) continue;
      const q = signedQty(l);
      const cur = moves.get(l.assetId) || { in: 0, out: 0 };
      if (q >= 0) cur.in += q; else cur.out += Math.abs(q);
      moves.set(l.assetId, cur);
      if (assetId) {
        detail.push({
          documentId: l.documentId, date: l.date, number: l.number, type: docTypeLabel(l.type),
          party: l.supplier, qtyIn: q >= 0 ? q : 0, qtyOut: q < 0 ? Math.abs(q) : 0, unitPrice: l.unitPrice,
        });
      }
    }
    const list = (assetId ? stock.filter((s) => s.assetId === assetId) : stock).map((s) => {
      const m = moves.get(s.assetId) || { in: 0, out: 0 };
      const open = opening.get(s.assetId) || 0;
      return {
        assetId: s.assetId, code: s.code, description: s.description || s.name, uom: s.uom, category: s.category,
        opening: open, qtyIn: m.in, qtyOut: m.out, closing: open + m.in - m.out, onHand: s.onHand,
      };
    }).filter((r) => assetId || r.opening !== 0 || r.qtyIn !== 0 || r.qtyOut !== 0);
    // A drill-down runs the movements oldest first, with the balance after each one.
    let running = list[0]?.opening || 0;
    detail.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number.localeCompare(b.number)));
    for (const d of detail) { running = running + d.qtyIn - d.qtyOut; d.balance = running; }
    return {
      rows: list, detail: assetId ? detail : [],
      products: stock.map((s) => ({ assetId: s.assetId, label: `${s.code ? `${s.code} — ` : ''}${s.description || s.name}` })),
      totals: {
        opening: list.reduce((a, r) => a + r.opening, 0), qtyIn: list.reduce((a, r) => a + r.qtyIn, 0),
        qtyOut: list.reduce((a, r) => a + r.qtyOut, 0), closing: list.reduce((a, r) => a + r.closing, 0),
      },
    };
  }

  private dayBefore(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  // ── 8. Stock Take Listing ────────────────────────────────────────────────

  /** The count sheet: what the system thinks is there, and blank columns to write the count into. */
  async stockTakeListing(organizationId: string, query: { categoryId?: string; includeZero?: string }) {
    const stock = await this.stock(organizationId, query.categoryId?.trim() || null);
    const includeZero = String(query.includeZero ?? '') === 'true';
    const rows = stock
      .filter((s) => includeZero || s.onHand !== 0)
      .map((s) => ({
        code: s.code, description: s.description || s.name, category: s.category, uom: s.uom,
        location: '', systemQty: s.onHand, countedQty: null as number | null, variance: null as number | null,
      }));
    return { rows, totals: { systemQty: rows.reduce((a, r) => a + r.systemQty, 0) } };
  }

  // ── 9. Last Buy Price Report ─────────────────────────────────────────────

  async lastBuyPrice(organizationId: string, query: { categoryId?: string }) {
    const [stock, lines] = await Promise.all([
      this.stock(organizationId, query.categoryId?.trim() || null),
      this.items(organizationId, PURCHASE_TYPES, null, null),
    ]);
    const last = new Map<string, ItemRow>();
    for (const l of lines) {
      if (!l.assetId) continue;
      const cur = last.get(l.assetId);
      if (!cur || l.date > cur.date) last.set(l.assetId, l);
    }
    const rows = stock.map((s) => {
      const l = last.get(s.assetId);
      return {
        code: s.code, description: s.description || s.name, uom: s.uom, category: s.category,
        lastDate: l?.date || '', lastPo: l?.number || '', supplier: l?.supplier || '',
        lastQty: l?.quantity ?? null, lastPrice: l?.unitPrice ?? null, costPrice: s.costPrice,
        // What the standing cost on the product card is out by against the last invoice from the supplier.
        variance: l && l.unitPrice ? round2(l.unitPrice - s.costPrice) : null,
      };
    }).filter((r) => r.lastDate || r.costPrice);
    return { rows, totals: { bought: rows.filter((r) => r.lastDate).length } };
  }

  // ── 10. Reorder Level Analysis ───────────────────────────────────────────

  async reorderLevel(organizationId: string, query: { categoryId?: string; belowOnly?: string }) {
    const [stock, onOrder] = await Promise.all([this.stock(organizationId, query.categoryId?.trim() || null), this.onOrder(organizationId)]);
    const belowOnly = String(query.belowOnly ?? 'true') !== 'false';
    const rows = stock
      // A level of 0 is no level at all: "on hand 0, level 0" is not a shortage,
      // and the legacy report never prompted for one on such an item.
      .filter((s) => s.minQuantity != null && Number(s.minQuantity) > 0)
      .map((s) => {
        const level = Number(s.minQuantity) || 0;
        const avail = availableQty(s);
        const incoming = onOrder.get(s.assetId) || 0;
        return {
          code: s.code, description: s.description || s.name, category: s.category, uom: s.uom,
          onHand: s.onHand, reserved: s.reserved, available: avail, reorderLevel: level, onOrder: incoming,
          // What to buy: the gap to the level, less whatever is already on order.
          shortfall: Math.max(0, level - avail - incoming),
          below: avail <= level,
        };
      })
      .filter((r) => !belowOnly || r.below);
    return {
      rows,
      withoutLevel: stock.filter((s) => s.minQuantity == null || Number(s.minQuantity) <= 0).length,
      totals: { shortfall: rows.reduce((a, r) => a + r.shortfall, 0), below: rows.filter((r) => r.below).length },
    };
  }
}
