import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ContractsService } from './contracts.service';
import { CreateContractDto, ListContractsQuery, UpdateContractDto } from './dto/contract.dto';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';

@Controller('contracts')
@UseGuards(ClerkAuthGuard)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @Permissions('shipments:read')
  list(@Query() query: ListContractsQuery, @Req() req: TradeRequest) {
    return this.contracts.list(orgIdOf(req), query);
  }

  @Post()
  @Permissions('shipments:create')
  create(@Body() dto: CreateContractDto, @Req() req: TradeRequest) {
    return this.contracts.create(orgIdOf(req), dto, actorOf(req));
  }

  /** Deposit due date for a PI date + term (business days skip Japanese bank holidays), for the contract form. */
  @Get('deposit-due')
  @Permissions('shipments:read')
  depositDue(@Query('piDate') piDate: string, @Query('days') days: string, @Query('unit') unit: string) {
    return this.contracts.depositDue(piDate, days, unit);
  }

  @Get(':id')
  @Permissions('shipments:read')
  getById(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.contracts.getById(orgIdOf(req), id, actorOf(req));
  }

  @Patch(':id')
  @Permissions('shipments:update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto, @Req() req: TradeRequest) {
    return this.contracts.update(orgIdOf(req), id, dto, actorOf(req));
  }

  @Delete(':id')
  @Permissions('shipments:delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.contracts.remove(orgIdOf(req), id);
  }

  @Post(':id/complete')
  @Permissions('shipments:update')
  complete(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.contracts.complete(orgIdOf(req), id);
  }

  @Post(':id/reopen')
  @Permissions('shipments:update')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.contracts.reopen(orgIdOf(req), id, actorOf(req));
  }
}
