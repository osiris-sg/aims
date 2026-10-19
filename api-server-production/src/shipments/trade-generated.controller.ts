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
    return this.gen.list(orgIdOf(req), { shipmentId: q.shipmentId, contractId: q.contractId, orderId: q.orderId });
  }

  /** Supplier spreadsheets on a shipment that can prefill a docType. */
  @Get('sources')
  @Permissions('shipments:read')
  sources(@Query() q: GeneratedSourcesQuery, @Req() req: TradeRequest) {
    return this.gen.sources(orgIdOf(req), q.shipmentId, q.docType);
  }

  /**
   * 請求書 payment due date for an issue date: the org's business-day count
   * (Invoice #1: docDefaults.invoiceDueBusinessDays, default 7; Invoice #2:
   * invoice2DueBusinessDays, default 6) of Japanese bank business days
   * (weekends, public holidays, 12/31–1/3 skipped).
   */
  @Get('due-date')
  @Permissions('shipments:read')
  dueDate(@Query('issueDate') issueDate: string, @Query('docType') docType: string | undefined, @Req() req: TradeRequest) {
    return this.gen.dueDateFor(orgIdOf(req), issueDate, docType);
  }

  /** Live-preview HTML (same template as the PDF). A POST that only reads. */
  @Post('preview')
  @Permissions('shipments:read')
  @Header('Content-Type', 'application/json')
  async preview(@Body() dto: PreviewGeneratedDocDto, @Req() req: TradeRequest) {
    const kind = GENERATED_TEMPLATES[dto.docType]?.kind;
    const seal = kind === 'invoice' || kind === 'single' ? await this.gen.sealFor(orgIdOf(req)) : null;
    return { html: await this.gen.previewHtml(dto.docType, dto.header, dto.columns, dto.rows, dto.draft ?? true, seal, orgIdOf(req)) };
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

  /** Download PDF: the stored PDF when final, else rendered now (no watermark). */
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

  /** Open credits (negative Invoice #2s not yet offset), for Invoice #1's "Apply open credit". */
  @Get('credits')
  @Permissions('shipments:read')
  credits(@Query('customerId') customerId: string | undefined, @Query('status') status: string | undefined, @Query('forDocId') forDocId: string | undefined, @Req() req: TradeRequest) {
    return this.gen.credits(orgIdOf(req), { customerId, status, forDocId });
  }

  /** Add a 前回差額充当 line using an open credit to an Invoice #1 draft. */
  @Post(':id/apply-credit')
  @Permissions('shipments:update')
  applyCredit(@Param('id', ParseUUIDPipe) id: string, @Body('creditId', ParseUUIDPipe) creditId: string, @Req() req: TradeRequest) {
    return this.gen.applyCredit(orgIdOf(req), id, creditId);
  }

  /** 出庫・納入依頼書: mark a delivery row delivered / not (works on a final SI too). */
  @Post(':id/delivered')
  @Permissions('shipments:update')
  delivered(@Param('id', ParseUUIDPipe) id: string, @Body('rowIndex') rowIndex: number, @Body('delivered') delivered: boolean, @Req() req: TradeRequest) {
    return this.gen.setDelivered(orgIdOf(req), id, Number(rowIndex), delivered === true);
  }

  /** Estimated cost lines vs the step 12 actuals of an Invoice #2 / single invoice. */
  @Get(':id/cost-variance')
  @Permissions('shipments:read')
  costVariance(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.gen.costVarianceOf(orgIdOf(req), id);
  }

  /** "Issue adjustment": a new Invoice #2 draft for the cost variance. */
  @Post(':id/adjustment')
  @Permissions('shipments:create')
  adjustment(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.gen.issueAdjustment(orgIdOf(req), id, actorOf(req));
  }

  @Get(':id')
  @Permissions('shipments:read')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.gen.get(orgIdOf(req), id);
  }

  /** Invoice #2 / single invoice: the estimator's cost lines for the covered shipments (JPY, and USD at the FX). Never applied server-side. */
  @Get(':id/cost-suggestion')
  @Permissions('shipments:read')
  costSuggestion(@Param('id', ParseUUIDPipe) id: string, @Query('fxRate') fxRate: string | undefined, @Req() req: TradeRequest) {
    const fx = fxRate !== undefined && fxRate !== '' && Number.isFinite(Number(fxRate)) ? Number(fxRate) : null;
    return this.gen.costSuggestion(orgIdOf(req), id, fx);
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
