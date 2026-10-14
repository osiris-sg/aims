import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CreateBlankGeneratedDocDto, CreateGeneratedDocDto, GeneratedSourcesQuery, HubQueryDto, ListGeneratedQuery, PreviewGeneratedDocDto, UpdateGeneratedDocDto } from './dto/trade-generated.dto';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { GENERATED_TEMPLATES, TradeGeneratedService } from './trade-generated.service';
import { TradeHubService } from './trade-hub.service';

/** In-app generated trade documents (Customer PL / COA, ADH 請求書, SG→JP IV/PL, Shipping Instructions). */
@Controller('trade-generated')
@UseGuards(ClerkAuthGuard)
export class TradeGeneratedController {
  constructor(private readonly gen: TradeGeneratedService) {}

  @Get()
  @Permissions('shipments:read')
  list(@Query() q: ListGeneratedQuery, @Req() req: TradeRequest) {
    return this.gen.list(orgIdOf(req), { shipmentId: q.shipmentId, contractId: q.contractId });
  }

  /** Supplier spreadsheets on a shipment that can prefill a docType. */
  @Get('sources')
  @Permissions('shipments:read')
  sources(@Query() q: GeneratedSourcesQuery, @Req() req: TradeRequest) {
    return this.gen.sources(orgIdOf(req), q.shipmentId, q.docType);
  }

  /**
   * 請求書 payment due date for an issue date: the org's business-day count
   * (docDefaults.invoiceDueBusinessDays, default 7) of Japanese bank business
   * days (weekends, public holidays, 12/31–1/3 skipped).
   */
  @Get('due-date')
  @Permissions('shipments:read')
  dueDate(@Query('issueDate') issueDate: string, @Req() req: TradeRequest) {
    return this.gen.dueDateFor(orgIdOf(req), issueDate);
  }

  /** Live-preview HTML (same template as the PDF). A POST that only reads. */
  @Post('preview')
  @Permissions('shipments:read')
  @Header('Content-Type', 'application/json')
  async preview(@Body() dto: PreviewGeneratedDocDto, @Req() req: TradeRequest) {
    const seal = GENERATED_TEMPLATES[dto.docType]?.kind === 'invoice' ? await this.gen.sealFor(orgIdOf(req)) : null;
    return { html: this.gen.previewHtml(dto.docType, dto.header, dto.columns, dto.rows, dto.draft ?? true, seal) };
  }

  @Post()
  @Permissions('shipments:create')
  create(@Body() dto: CreateGeneratedDocDto, @Req() req: TradeRequest) {
    return this.gen.createFromSource(orgIdOf(req), dto.shipmentId, dto.docType, dto.sourceFileId, actorOf(req));
  }

  /** A blank document of any template, prefilled from its contract / shipment. */
  @Post('blank')
  @Permissions('shipments:create')
  createBlank(@Body() dto: CreateBlankGeneratedDocDto, @Req() req: TradeRequest) {
    return this.gen.createBlank(orgIdOf(req), dto, actorOf(req));
  }

  /** Download PDF: the stored PDF when final, else rendered now with a DRAFT watermark. */
  @Get(':id/pdf')
  @Permissions('shipments:read')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest, @Res() res: Response) {
    const { buffer, fileName } = await this.gen.pdfFor(orgIdOf(req), id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    // The portal is on another origin: let it read the file name.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /** The in-app 請求書 behind a Sales invoice (Invoices tab → View), with the contracts / shipments it bills. */
  @Get('by-document/:documentId')
  @Permissions('shipments:read')
  byDocument(@Param('documentId', ParseUUIDPipe) documentId: string, @Req() req: TradeRequest) {
    return this.gen.byDocument(orgIdOf(req), documentId);
  }

  @Get(':id')
  @Permissions('shipments:read')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.gen.get(orgIdOf(req), id);
  }

  @Patch(':id')
  @Permissions('shipments:update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGeneratedDocDto, @Req() req: TradeRequest) {
    return this.gen.update(orgIdOf(req), id, dto);
  }

  @Post(':id/finalize')
  @Permissions('shipments:update')
  finalize(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.gen.finalize(orgIdOf(req), id, actorOf(req));
  }

  /** "Edit again": FINAL → DRAFT, deleting its PDF (refused while a DONE step needs it). */
  @Post(':id/revert')
  @Permissions('shipments:update')
  revert(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.gen.revert(orgIdOf(req), id);
  }

  @Delete(':id')
  @Permissions('shipments:delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.gen.remove(orgIdOf(req), id);
  }
}

/** The trade Documents hub: uploads + linked invoices + generated docs in one list. */
@Controller('trade-hub')
@UseGuards(ClerkAuthGuard)
export class TradeHubController {
  constructor(private readonly hub: TradeHubService) {}

  @Get()
  @Permissions('shipments:read')
  list(@Query() q: HubQueryDto, @Req() req: TradeRequest) {
    return this.hub.list(orgIdOf(req), q);
  }
}
