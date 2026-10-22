import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { orgIdOf, TradeRequest } from './shipments.request';
import { TradePriceCheckService } from './trade-price-check.service';

/** Price check panels: expected unit price from the contract vs the PI / CI / invoice (read-only). */
@RequiresModule('SHIPMENTS')
@Controller('trade-price-check')
@UseGuards(ClerkAuthGuard)
export class TradePriceCheckController {
  constructor(private readonly check: TradePriceCheckService) {}

  @Get('supplier-order/:id')
  @Permissions('shipments:read')
  supplierOrder(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.check.forSupplierOrder(orgIdOf(req), id);
  }

  /** The order's PI (round H: the PI is on the order). */
  @Get('order/:id')
  @Permissions('shipments:read')
  order(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.check.forOrder(orgIdOf(req), id);
  }

  @Get('shipment/:id')
  @Permissions('shipments:read')
  shipment(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.check.forShipment(orgIdOf(req), id);
  }

  @Get('generated/:id')
  @Permissions('shipments:read')
  generated(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.check.forGeneratedDoc(orgIdOf(req), id);
  }
}
