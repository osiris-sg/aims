import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CreateSupplierOrderDto, DeclarationDto, LinkOrdersDto, ListSupplierOrdersQuery, UpdateSupplierOrderDto } from './dto/supplier-order.dto';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { SupplierOrdersService } from './supplier-orders.service';

/** Supplier orders (Vedanta's PI per contract / customer / month) and the monthly declaration. */
@RequiresModule('SHIPMENTS')
@Controller('supplier-orders')
@UseGuards(ClerkAuthGuard)
export class SupplierOrdersController {
  constructor(private readonly sos: SupplierOrdersService) {}

  @Get()
  @Permissions('shipments:read')
  list(@Query() query: ListSupplierOrdersQuery, @Req() req: TradeRequest) {
    return this.sos.list(orgIdOf(req), query);
  }

  /** "Create orders" on the Declaration page: a supplier order + a customer order per row. */
  @Post('declaration')
  @Permissions('shipments:create')
  declare(@Body() dto: DeclarationDto, @Req() req: TradeRequest) {
    return this.sos.declare(orgIdOf(req), dto, actorOf(req));
  }

  @Post()
  @Permissions('shipments:create')
  create(@Body() dto: CreateSupplierOrderDto, @Req() req: TradeRequest) {
    return this.sos.create(orgIdOf(req), dto, actorOf(req));
  }

  @Get(':id')
  @Permissions('shipments:read')
  getById(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.sos.getById(orgIdOf(req), id, actorOf(req));
  }

  @Patch(':id')
  @Permissions('shipments:update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierOrderDto, @Req() req: TradeRequest) {
    return this.sos.update(orgIdOf(req), id, dto, actorOf(req));
  }

  @Delete(':id')
  @Permissions('shipments:delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.sos.remove(orgIdOf(req), id);
  }

  @Post(':id/link')
  @Permissions('shipments:update')
  link(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkOrdersDto, @Req() req: TradeRequest) {
    return this.sos.link(orgIdOf(req), id, dto.orderIds);
  }

  @Delete(':id/link/:orderId')
  @Permissions('shipments:update')
  unlink(@Param('id', ParseUUIDPipe) id: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Req() req: TradeRequest) {
    return this.sos.unlink(orgIdOf(req), id, orderId);
  }

  @Post(':id/complete')
  @Permissions('shipments:update')
  complete(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.sos.complete(orgIdOf(req), id);
  }

  @Post(':id/reopen')
  @Permissions('shipments:update')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.sos.reopen(orgIdOf(req), id, actorOf(req));
  }
}
