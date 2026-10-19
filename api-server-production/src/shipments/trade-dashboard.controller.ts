import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { orgIdOf, TradeRequest } from './shipments.request';
import { TradeDashboardService } from './trade-dashboard.service';

/** Management view / staff home: pipeline grid, stock (everyone), money (ADH Manager — shipments:money). */
@Controller('trade-dashboard')
@UseGuards(ClerkAuthGuard)
export class TradeDashboardController {
  constructor(private readonly dash: TradeDashboardService) {}

  @Get('pipeline')
  @Permissions('shipments:read')
  pipeline(@Req() req: TradeRequest) {
    return this.dash.pipeline(orgIdOf(req));
  }

  @Get('stock')
  @Permissions('shipments:read')
  stock(@Req() req: TradeRequest) {
    return this.dash.stock(orgIdOf(req));
  }

  /** Cash, margin, profit and open credits — the "ADH Manager" role only. */
  @Get('money')
  @Permissions('shipments:money')
  money(@Req() req: TradeRequest) {
    return this.dash.money(orgIdOf(req));
  }
}
