import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { TradePaymentsService } from './trade-payments.service';

/** Cash in / cash out: payments and what they paid (PIs, CIs, invoices, vendor invoices, import tax). */
@Controller('trade-payments')
@UseGuards(ClerkAuthGuard)
export class TradePaymentsController {
  constructor(private readonly payments: TradePaymentsService) {}

  @Get()
  @Permissions('shipments:read')
  list(@Query() q: Record<string, string>, @Req() req: TradeRequest) {
    return this.payments.list(orgIdOf(req), q);
  }

  /** What can be paid (for the allocation picker), with expected / already allocated. */
  @Get('targets')
  @Permissions('shipments:read')
  targets(@Query('direction') direction: string | undefined, @Query('q') q: string | undefined, @Req() req: TradeRequest) {
    return this.payments.targets(orgIdOf(req), { direction, q });
  }

  /** One order's cash out vs cash in, with each invoice's outstanding / overdue. */
  @Get('order/:orderId')
  @Permissions('shipments:read')
  forOrder(@Param('orderId', ParseUUIDPipe) orderId: string, @Req() req: TradeRequest) {
    return this.payments.forOrder(orgIdOf(req), orderId);
  }

  @Get(':id')
  @Permissions('shipments:read')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.payments.get(orgIdOf(req), id);
  }

  @Post()
  @Permissions('shipments:create')
  create(@Body() body: Record<string, unknown>, @Req() req: TradeRequest) {
    return this.payments.create(orgIdOf(req), body ?? {}, actorOf(req));
  }

  @Patch(':id')
  @Permissions('shipments:update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Req() req: TradeRequest) {
    return this.payments.update(orgIdOf(req), id, body ?? {});
  }

  @Delete(':id')
  @Permissions('shipments:delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.payments.remove(orgIdOf(req), id);
  }
}
