import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { IssueInput, TradeIssuesService } from './trade-issues.service';
import { TradeCastIndexService } from './trade-cast-index';

/** Round AR — general issues on a customer / supplier / order (Clients profile, the order, the step banner). */
@ApiTags('trade-issues')
@RequiresModule('SHIPMENTS')
@Controller('trade-issues')
@UseGuards(ClerkAuthGuard)
export class TradeIssuesController {
  constructor(
    private readonly issues: TradeIssuesService,
    private readonly casts: TradeCastIndexService,
  ) {}

  @Get()
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Issues of a customer / supplier / order / shipment (open first).' })
  list(@Query() q: { customerId?: string; supplierId?: string; orderId?: string; shipmentId?: string; status?: string }, @Req() req: TradeRequest) {
    return this.issues.list(orgIdOf(req), q ?? {});
  }

  @Get('shipment/:shipmentId')
  @Permissions('shipments:read')
  @ApiOperation({ summary: "The open issues that apply to a shipment (the step banner); ?docType= narrows to one step's document." })
  forShipment(@Param('shipmentId', ParseUUIDPipe) shipmentId: string, @Query('docType') docType: string | undefined, @Req() req: TradeRequest) {
    return this.issues.forShipment(orgIdOf(req), shipmentId, docType && /^[A-Z0-9_]{2,40}$/.test(docType) ? docType : null);
  }

  @Get('casts')
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Shipments whose packing list / COA carries this exact cast (265C1186) or bundle no. (265C118614).' })
  castSearch(@Query('q') q: string | undefined, @Req() req: TradeRequest) {
    return this.casts.search(orgIdOf(req), q ?? '');
  }

  @Post()
  @Permissions('shipments:update')
  @ApiOperation({ summary: 'Add an issue (title, summary EN / JA, customer / supplier, optional orders / shipments / emails, effective from).' })
  create(@Body() body: IssueInput, @Req() req: TradeRequest) {
    return this.issues.create(orgIdOf(req), body ?? {}, actorOf(req));
  }

  @Patch(':id')
  @Permissions('shipments:update')
  @ApiOperation({ summary: 'Edit an issue or set it Open / Resolved (issues are never deleted).' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: IssueInput, @Req() req: TradeRequest) {
    return this.issues.update(orgIdOf(req), id, body ?? {}, actorOf(req));
  }
}
