import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CreateOrderDto, ListOrdersQuery, MonthlyOrdersDto, UpdateOrderDto } from './dto/order.dto';
import { AddShipmentDto } from './dto/shipment.dto';
import { OrdersService } from './orders.service';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { tradeToday } from './shipments.rules';

/** Orders ("#19"): Contract → Order → Shipment. */
@Controller('trade-orders')
@UseGuards(ClerkAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Permissions('shipments:read')
  list(@Query() query: ListOrdersQuery, @Req() req: TradeRequest) {
    return this.orders.list(orgIdOf(req), query);
  }

  /** The next free order number for a year (the New Order form's default). */
  @Get('next-no')
  @Permissions('shipments:read')
  async nextNo(@Query('year') year: string | undefined, @Req() req: TradeRequest) {
    const y = Number(year) || Number(tradeToday().slice(0, 4));
    return { year: y, orderNo: await this.orders.nextOrderNo(orgIdOf(req), y) };
  }

  @Post()
  @Permissions('shipments:create')
  create(@Body() dto: CreateOrderDto, @Req() req: TradeRequest) {
    return this.orders.create(orgIdOf(req), dto, actorOf(req));
  }

  /** "+ New monthly order": one order per row (customer × grade × size × qty × contract), all shipping in the month. */
  @Post('monthly')
  @Permissions('shipments:create')
  createMonthly(@Body() dto: MonthlyOrdersDto, @Req() req: TradeRequest) {
    return this.orders.createMonthly(orgIdOf(req), dto, actorOf(req));
  }

  @Get(':id')
  @Permissions('shipments:read')
  getById(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.orders.getById(orgIdOf(req), id, actorOf(req));
  }

  @Patch(':id')
  @Permissions('shipments:update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto, @Req() req: TradeRequest) {
    return this.orders.update(orgIdOf(req), id, dto, actorOf(req));
  }

  @Delete(':id')
  @Permissions('shipments:delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.orders.remove(orgIdOf(req), id);
  }

  @Post(':id/complete')
  @Permissions('shipments:update')
  complete(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.orders.complete(orgIdOf(req), id);
  }

  @Post(':id/reopen')
  @Permissions('shipments:update')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.orders.reopen(orgIdOf(req), id, actorOf(req));
  }

  /** "Add shipment": the next B/L under the order ("#19-2"), B/L pending. */
  @Post(':id/shipments')
  @Permissions('shipments:create')
  addShipment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddShipmentDto, @Req() req: TradeRequest) {
    return this.orders.addShipment(orgIdOf(req), id, dto ?? {}, actorOf(req));
  }

  /** Step 13: the order's money in one place, with profit = d − a − b − c. */
  @Get(':id/reconciliation')
  @Permissions('shipments:read')
  reconciliation(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.orders.reconciliation(orgIdOf(req), id);
  }

  @Patch(':id/reconciliation')
  @Permissions('shipments:update')
  updateReconciliation(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: TradeRequest) {
    return this.orders.updateReconciliation(orgIdOf(req), id, body);
  }
}
