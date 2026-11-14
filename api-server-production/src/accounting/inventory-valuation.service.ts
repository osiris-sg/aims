import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

// ---------------------------------------------------------------------------
// Inventory valuation — computes Closing Stock value at cost.
//
// For each active asset:
//   - Tracked assets (isTracked=true): on-hand qty = count of Inventory records
//     in any status EXCEPT 'sold' (rental / reserved / maintenance still count
//     as on-hand stock the org owns).
//   - Untracked assets (isTracked=false): on-hand qty = Asset.quantity.
//
//   value = qtyOnHand × Asset.costPrice (manual field, may be 0).
//
// v1 limitation: uses CURRENT quantities, not historical "qty as of asOfDate".
// For most month-end closes the cut-off is today or yesterday so this is fine.
// To support time-travel, we'd need to replay every stock movement (PO confirm,
// invoice post, SAI, SAO) up to the date — meaningful work, deferred.
// ---------------------------------------------------------------------------

const ROUND = (n: number) => Math.round(n * 100) / 100;

export type ClosingStockItem = {
  assetId: string;
  code: string;
  name: string;
  isTracked: boolean;
  quantity: number;
  costPrice: number;
  value: number;
  missingCost: boolean; // true if costPrice is null/0 — surfaces as a warning in UI
};

export type ClosingStockResult = {
  asOfDate: string;
  total: number;
  itemCount: number;
  itemsWithMissingCost: number;
  items: ClosingStockItem[];
};

@Injectable()
export class InventoryValuationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Closing stock = Σ(on-hand qty × costPrice) over the org's active assets.
   * The TOTALS are one SQL aggregate over every in-stock asset; the ITEM LIST
   * is a page (highest value first, default 200 rows) filtered by `q` on SKU
   * or name — Chong Aik's 86k items used to be walked in Node and sent whole,
   * which left the Inventory Cost tab spinning (guru 2026-11-14).
   *
   * Tracked assets count their non-sold Inventory rows; untracked ones use
   * Asset.quantity. Rows with no on-hand stock are left out, as before.
   */
  async closingStock(
    organizationId: string,
    asOfDate?: Date,
    opts: { q?: string; limit?: number } = {},
  ): Promise<ClosingStockResult & { shown: number; matchCount: number; limit: number }> {
    const at = asOfDate ?? new Date();
    const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 2000);
    const q = String(opts.q || '').trim();
    // One row per in-stock asset with its quantity and value. Positional
    // params only (the tenancy router rejects Prisma.sql fragments).
    const stockCte = `
      WITH stock AS (
        SELECT a.id, a."skuKey" AS code, a.name, a."isTracked",
               CASE WHEN a."isTracked" THEN COALESCE(i.cnt, 0) ELSE COALESCE(a.quantity, 0) END AS quantity,
               COALESCE(a."costPrice", 0) AS "costPrice"
        FROM "Asset" a
        LEFT JOIN (
          SELECT "assetId", COUNT(*)::int AS cnt FROM "Inventory"
          WHERE "organizationId" = $1 AND status <> 'sold' GROUP BY "assetId"
        ) i ON a."isTracked" AND i."assetId" = a.id
        WHERE a."organizationId" = $1 AND a."deletedAt" IS NULL
      )`;
    const empty = { asOfDate: at.toISOString(), total: 0, itemCount: 0, itemsWithMissingCost: 0, items: [], shown: 0, matchCount: 0, limit };
    let totalsRows: any[];
    try {
      totalsRows = (await this.prisma.$queryRawUnsafe(
        `${stockCte}
         SELECT COUNT(*)::int AS "itemCount",
                COALESCE(SUM(quantity * "costPrice"), 0)::float AS total,
                COUNT(*) FILTER (WHERE "costPrice" = 0)::int AS "itemsWithMissingCost"
         FROM stock WHERE quantity <> 0`,
        organizationId,
      )) as any[];
    } catch (e: any) {
      // An org without the inventory module has no Asset / Inventory tables
      // in its schema (42P01): it simply holds no stock.
      if (e?.meta?.code === '42P01' || /does not exist/.test(String(e?.message))) return empty;
      throw e;
    }
    const totals = totalsRows[0] || { itemCount: 0, total: 0, itemsWithMissingCost: 0 };

    const params: any[] = [organizationId];
    let where = 'quantity <> 0';
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (code ILIKE $${params.length} OR name ILIKE $${params.length})`;
    }
    // How many items the search matches (the grid shows the first `limit`).
    let matchCount = Number(totals.itemCount) || 0;
    if (q) {
      const m = (await this.prisma.$queryRawUnsafe(`${stockCte} SELECT COUNT(*)::int AS n FROM stock WHERE ${where}`, ...params)) as any[];
      matchCount = Number(m[0]?.n) || 0;
    }
    params.push(limit);
    const rows = (await this.prisma.$queryRawUnsafe(
      `${stockCte}
       SELECT id, code, name, "isTracked", quantity, "costPrice", (quantity * "costPrice")::float AS value
       FROM stock WHERE ${where}
       ORDER BY value DESC, code ASC
       LIMIT $${params.length}`,
      ...params,
    )) as any[];

    const items: ClosingStockItem[] = rows.map((r) => ({
      assetId: r.id,
      code: r.code,
      name: r.name,
      isTracked: !!r.isTracked,
      quantity: Number(r.quantity) || 0,
      costPrice: Number(r.costPrice) || 0,
      value: ROUND(Number(r.value) || 0),
      missingCost: !(Number(r.costPrice) || 0),
    }));

    return {
      asOfDate: at.toISOString(),
      total: ROUND(Number(totals.total) || 0),
      itemCount: Number(totals.itemCount) || 0,
      itemsWithMissingCost: Number(totals.itemsWithMissingCost) || 0,
      items,
      shown: items.length,
      matchCount,
      limit,
    };
  }

  // Bulk update — for the cost-price management grid. Accepts a list of
  // { assetId, costPrice } updates and applies in one transaction.
  async updateCostPrices(
    organizationId: string,
    updates: Array<{ assetId: string; costPrice: number }>,
  ) {
    if (updates.length === 0) return { updated: 0 };

    // Authorize: every assetId must belong to this org.
    const assetIds = updates.map((u) => u.assetId);
    const owned = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, organizationId },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((a) => a.id));
    const valid = updates.filter((u) => ownedSet.has(u.assetId));

    await this.prisma.$transaction(
      valid.map((u) =>
        this.prisma.asset.update({
          where: { id: u.assetId },
          data: { costPrice: u.costPrice },
        }),
      ),
    );

    return { updated: valid.length };
  }
}
