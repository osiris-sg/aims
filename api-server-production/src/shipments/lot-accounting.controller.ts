import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { LotAccountingService } from './lot-accounting.service';

/**
 * Round BW — ADH's books (money): FX rates, the provisional chart and the per-order Accounting preview. ADH Admin and
 * ADH Manager only (shipments:money); ADH Sales sees none of it. Nothing here posts a journal.
 */
@RequiresModule('SHIPMENTS')
@Controller('trade-books')
@UseGuards(ClerkAuthGuard)
export class LotAccountingController {
  constructor(private readonly books: LotAccountingService) {}

  @Get('fx-rates')
  @Permissions('shipments:money')
  fxRates(@Req() req: TradeRequest) {
    return this.books.fxRates(orgIdOf(req));
  }

  /** { month: "YYYY-MM", currency: "USD" | "JPY", rate, note? } — the rate of the 1st of the month (1 SGD = rate). */
  @Post('fx-rates')
  @Permissions('shipments:money')
  saveFxRate(@Body() body: { month?: string; currency?: string; rate?: unknown; note?: string | null }, @Req() req: TradeRequest) {
    const a = actorOf(req);
    return this.books.saveFxRate(orgIdOf(req), body ?? {}, { id: a.id, name: a.name });
  }

  @Get('chart')
  @Permissions('shipments:money')
  chart(@Req() req: TradeRequest) {
    return this.books.chart(orgIdOf(req));
  }

  @Patch('chart/:id')
  @Permissions('shipments:money')
  updateAccount(@Param('id', ParseUUIDPipe) id: string, @Body() body: { code?: string; name?: string }, @Req() req: TradeRequest) {
    return this.books.updateAccount(orgIdOf(req), id, body ?? {});
  }

  @Get('orders/:id/preview')
  @Permissions('shipments:money')
  preview(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.books.preview(orgIdOf(req), id);
  }
}
