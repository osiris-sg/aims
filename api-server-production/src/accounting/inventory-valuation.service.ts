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

  async closingStock(organizationId: string, asOfDate?: Date): Promise<ClosingStockResult> {
    const at = asOfDate ?? new Date();

    // Pull active assets for the org. Include the count of non-sold inventory
    // rows per asset in the same query so we don't N+1.
    const assets = await this.prisma.asset.findMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        skuKey: true,
        name: true,
        isTracked: true,
        quantity: true,
        costPrice: true,
      },
    });

    // Batch-count inventory rows per asset (tracked items only).
    const trackedAssetIds = assets.filter((a) => a.isTracked).map((a) => a.id);
    const inventoryCounts = await this.prisma.inventory.groupBy({
      by: ['assetId'],
      where: {
        organizationId,
        assetId: { in: trackedAssetIds },
        status: { not: 'sold' },
      },
      _count: { _all: true },
    });
    const countByAsset = new Map(inventoryCounts.map((c) => [c.assetId, c._count._all]));

    const items: ClosingStockItem[] = [];
    let total = 0;
    let itemsWithMissingCost = 0;

    for (const a of assets) {
      const quantity = a.isTracked
        ? countByAsset.get(a.id) ?? 0
        : a.quantity ?? 0;

      if (quantity === 0) continue; // skip rows with no on-hand stock

      const costPrice = a.costPrice ?? 0;
      const value = ROUND(quantity * costPrice);
      const missingCost = !a.costPrice || a.costPrice === 0;

      total += value;
      if (missingCost) itemsWithMissingCost += 1;

      items.push({
        assetId: a.id,
        code: a.skuKey,
        name: a.name,
        isTracked: a.isTracked,
        quantity,
        costPrice,
        value,
        missingCost,
      });
    }

    items.sort((x, y) => y.value - x.value); // highest-value first

    return {
      asOfDate: at.toISOString(),
      total: ROUND(total),
      itemCount: items.length,
      itemsWithMissingCost,
      items,
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
