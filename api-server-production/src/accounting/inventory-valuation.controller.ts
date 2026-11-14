import { Body, Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { InventoryValuationService } from './inventory-valuation.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting')
@UseGuards(ClerkAuthGuard)
export class InventoryValuationController {
  constructor(private readonly service: InventoryValuationService) {}

  @Get('closing-stock')
  @Permissions('accounting:read')
  @ApiOperation({ summary: 'Closing stock valuation = Σ(currentQty × costPrice) across all active assets' })
  @ApiQuery({ name: 'asOfDate', required: false, description: 'YYYY-MM-DD; defaults to today. v1 uses CURRENT quantities regardless.' })
  @ApiQuery({ name: 'q', required: false, description: 'Filter the item list by SKU or name (the totals always cover every item)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Item rows returned, highest value first (default 200, max 2000)' })
  closingStock(
    @Req() req: RequestWithOrganization,
    @Query('asOfDate') asOfDate?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.closingStock(requireOrgId(req), asOfDate ? new Date(asOfDate) : undefined, { q, limit: limit ? Number(limit) : undefined });
  }

  @Patch('cost-prices')
  @Permissions('accounting:update')
  @ApiOperation({ summary: 'Bulk-update costPrice on assets (for the Inventory Cost grid)' })
  bulkUpdateCostPrices(
    @Req() req: RequestWithOrganization,
    @Body() body: { updates: Array<{ assetId: string; costPrice: number }> },
  ) {
    return this.service.updateCostPrices(requireOrgId(req), body.updates || []);
  }
}
