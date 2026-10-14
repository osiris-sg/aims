import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CreateShipmentDto, ListShipmentsQuery, UpdateShipmentDto } from './dto/shipment.dto';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { ShipmentsService } from './shipments.service';

@Controller('shipments')
@UseGuards(ClerkAuthGuard)
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get()
  @Permissions('shipments:read')
  list(@Query() query: ListShipmentsQuery, @Req() req: TradeRequest) {
    return this.shipments.list(orgIdOf(req), query);
  }

  @Post()
  @Permissions('shipments:create')
  create(@Body() dto: CreateShipmentDto, @Req() req: TradeRequest) {
    return this.shipments.create(orgIdOf(req), dto, actorOf(req));
  }

  @Get(':id')
  @Permissions('shipments:read')
  getById(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.shipments.getById(orgIdOf(req), id);
  }

  @Patch(':id')
  @Permissions('shipments:update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShipmentDto, @Req() req: TradeRequest) {
    return this.shipments.update(orgIdOf(req), id, dto);
  }

  @Delete(':id')
  @Permissions('shipments:delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.shipments.remove(orgIdOf(req), id);
  }

  @Post(':id/complete')
  @Permissions('shipments:update')
  complete(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.shipments.complete(orgIdOf(req), id);
  }

  @Post(':id/reopen')
  @Permissions('shipments:update')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.shipments.reopen(orgIdOf(req), id);
  }
}
