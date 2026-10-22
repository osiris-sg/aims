import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { orgIdOf, TradeRequest } from './shipments.request';
import { TradeAlertsService } from './trade-alerts.service';

/** Alerts and reminders (tax funding, A/N, free time, due dates, stuck steps) and "My tasks today". */
@RequiresModule('SHIPMENTS')
@Controller('trade-alerts')
@UseGuards(ClerkAuthGuard)
export class TradeAlertsController {
  constructor(private readonly alerts: TradeAlertsService) {}

  @Get()
  @Permissions('shipments:read')
  list(@Query() q: { status?: string; shipmentId?: string; orderId?: string }, @Req() req: TradeRequest) {
    return this.alerts.list(orgIdOf(req), q);
  }

  /** Due now and the next 3 days. */
  @Get('my-tasks')
  @Permissions('shipments:read')
  myTasks(@Req() req: TradeRequest) {
    return this.alerts.myTasks(orgIdOf(req));
  }

  /** Re-plan now (after editing dates). */
  @Post('refresh')
  @Permissions('shipments:read')
  refresh(@Req() req: TradeRequest) {
    return this.alerts.sweep(orgIdOf(req));
  }

  @Post(':id/done')
  @Permissions('shipments:update')
  done(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.alerts.setStatus(orgIdOf(req), id, 'DONE');
  }

  @Post(':id/dismiss')
  @Permissions('shipments:update')
  dismiss(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.alerts.setStatus(orgIdOf(req), id, 'DISMISSED');
  }
}
