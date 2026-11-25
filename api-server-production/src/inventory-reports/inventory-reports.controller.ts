import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { InventoryReportsService } from './inventory-reports.service';

/**
 * Inventory → Reports: the ten legacy Inventory Reports (guru 2026-11-25).
 * Read-only, every one of them gated by `inventories:read` — the permission
 * the Inventory module already grants in every org, so no role needs touching
 * for these to work (a brand-new resource would have 403'd everywhere until
 * each org's Admin role was regranted).
 */
@Controller('inventory-reports')
@UseGuards(ClerkAuthGuard)
export class InventoryReportsController {
  constructor(private readonly service: InventoryReportsService) {}

  /** Categories for the reports that prompt for one. */
  @Get('categories')
  @Permissions('inventories:read')
  categories(@UserOrganization() org: { id: string }) {
    return this.service.categories(org.id);
  }

  @Get('stock-status')
  @Permissions('inventories:read')
  stockStatus(@UserOrganization() org: { id: string }, @Query() q: { categoryId?: string; includeZero?: string }) {
    return this.service.stockStatus(org.id, q || {});
  }

  @Get('unconfirmed-transactions')
  @Permissions('inventories:read')
  unconfirmed(@UserOrganization() org: { id: string }, @Query() q: { from?: string; to?: string }) {
    return this.service.unconfirmedTransactions(org.id, q || {});
  }

  @Get('purchase-order-listing')
  @Permissions('inventories:read')
  purchaseOrders(@UserOrganization() org: { id: string }, @Query() q: { from?: string; to?: string; supplier?: string }) {
    return this.service.purchaseOrderListing(org.id, q || {});
  }

  @Get('purchase-summary-by-supplier')
  @Permissions('inventories:read')
  purchaseSummary(@UserOrganization() org: { id: string }, @Query() q: { from?: string; to?: string }) {
    return this.service.purchaseSummaryBySupplier(org.id, q || {});
  }

  @Get('stock-analysis-by-supplier')
  @Permissions('inventories:read')
  bySupplier(@UserOrganization() org: { id: string }, @Query() q: { from?: string; to?: string }) {
    return this.service.stockAnalysisBySupplier(org.id, q || {});
  }

  @Get('stock-analysis-by-category')
  @Permissions('inventories:read')
  byCategory(@UserOrganization() org: { id: string }, @Query() q: { from?: string; to?: string; categoryId?: string }) {
    return this.service.stockAnalysisByCategory(org.id, q || {});
  }

  @Get('stock-movement')
  @Permissions('inventories:read')
  movement(@UserOrganization() org: { id: string }, @Query() q: { from?: string; to?: string; assetId?: string }) {
    return this.service.stockMovement(org.id, q || {});
  }

  @Get('stock-take-listing')
  @Permissions('inventories:read')
  stockTake(@UserOrganization() org: { id: string }, @Query() q: { categoryId?: string; includeZero?: string }) {
    return this.service.stockTakeListing(org.id, q || {});
  }

  @Get('last-buy-price')
  @Permissions('inventories:read')
  lastBuyPrice(@UserOrganization() org: { id: string }, @Query() q: { categoryId?: string }) {
    return this.service.lastBuyPrice(org.id, q || {});
  }

  @Get('reorder-level')
  @Permissions('inventories:read')
  reorderLevel(@UserOrganization() org: { id: string }, @Query() q: { categoryId?: string; belowOnly?: string }) {
    return this.service.reorderLevel(org.id, q || {});
  }
}
