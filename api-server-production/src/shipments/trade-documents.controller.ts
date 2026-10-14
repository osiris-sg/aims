import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { LinkTradeDocumentDto, SearchInvoicesQuery } from './dto/trade-document.dto';
import { orgIdOf, TradeRequest } from './shipments.request';
import { TradeDocumentsService } from './trade-documents.service';

@Controller('trade-documents')
@UseGuards(ClerkAuthGuard)
export class TradeDocumentsController {
  constructor(private readonly docs: TradeDocumentsService) {}

  /** Link an in-app Sales Document (invoice) to contracts/shipments as a trade doc type. */
  @Post('links')
  @Permissions('shipments:update')
  link(@Body() dto: LinkTradeDocumentDto, @Req() req: TradeRequest) {
    return this.docs.link(orgIdOf(req), dto);
  }

  @Delete('links/:id')
  @Permissions('shipments:delete')
  unlink(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.docs.unlink(orgIdOf(req), id);
  }

  @Get('invoices')
  @Permissions('shipments:read')
  searchInvoices(@Query() query: SearchInvoicesQuery, @Req() req: TradeRequest) {
    return this.docs.searchInvoices(orgIdOf(req), query.q);
  }
}
