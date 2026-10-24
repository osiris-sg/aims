import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { orgIdOf, TradeRequest } from './shipments.request';
import { MonthlyListService, MonthlyQuery } from './monthly-list.service';

/** Round AG — Sales › Monthly list (ADH's spreadsheet layout): the rows, the export (.xlsx / CSV). */
@RequiresModule('SHIPMENTS')
@Controller('trade-monthly-list')
@UseGuards(ClerkAuthGuard)
export class MonthlyListController {
  constructor(private readonly list: MonthlyListService) {}

  @Get()
  @Permissions('shipments:read')
  rows(@Query() q: MonthlyQuery, @Req() req: TradeRequest) {
    return this.list.list(orgIdOf(req), q);
  }

  /** The file as base64 (the portal's request helper speaks JSON): their layout, .xlsx or CSV. */
  @Get('export')
  @Permissions('shipments:read')
  async export(@Query() q: MonthlyQuery & { format?: string }, @Req() req: TradeRequest) {
    const r = await this.list.export(orgIdOf(req), q, q.format === 'csv' ? 'csv' : 'xlsx');
    return { fileName: r.fileName, contentType: r.contentType, base64: r.buffer.toString('base64') };
  }
}
