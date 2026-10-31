import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { decodeUploadName, resolveTradeFileMime, TRADE_FILE_EXTENSIONS, TRADE_FILE_MAX_BYTES } from './shipments.rules';
import { ClientsService } from './clients.service';

/** Round AM — Clients (Customers · Suppliers) for SHIPMENTS orgs: lists, profiles, per-customer document formats. */
@RequiresModule('SHIPMENTS')
@Controller('trade-clients')
@UseGuards(ClerkAuthGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get('customers')
  @Permissions('shipments:read')
  customers(@Req() req: TradeRequest) {
    return this.clients.customers(orgIdOf(req));
  }

  @Get('customers/:id')
  @Permissions('shipments:read')
  customer(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.clients.customer(orgIdOf(req), id);
  }

  @Get('suppliers')
  @Permissions('shipments:read')
  suppliers(@Req() req: TradeRequest) {
    return this.clients.suppliers(orgIdOf(req));
  }

  @Get('suppliers/:id')
  @Permissions('shipments:read')
  supplier(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.clients.supplier(orgIdOf(req), id);
  }

  /** Round AY: what a process change would do to the customer's open orders / shipments (read-only). */
  @Post('customers/:id/process/preview')
  @Permissions('shipments:read')
  processPreview(@Param('id', ParseUUIDPipe) id: string, @Body() body: { skipSteps?: string[] }, @Req() req: TradeRequest) {
    return this.clients.processImpact(orgIdOf(req), id, body?.skipSteps ?? []);
  }

  /** Round AY: save which steps are part of the customer's process. */
  @Patch('customers/:id/process')
  @Permissions('shipments:update')
  async updateProcess(@Param('id', ParseUUIDPipe) id: string, @Body() body: { skipSteps?: string[] }, @Req() req: TradeRequest) {
    const res = await this.clients.updateProcess(orgIdOf(req), id, body?.skipSteps ?? []);
    (req as any).actionLogResult = { skipSteps: res.impact.skipSteps, hidden: res.impact.hidden.length, shown: res.impact.shown.length, completes: res.impact.completes };
    return res;
  }

  /** Document formats: generator (Customer COA / PL), language, 宛先, note — saved on the customer profile. */
  @Patch('customers/:id/formats/:docType')
  @Permissions('shipments:update')
  updateFormat(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @Body() body: { generator?: string | null; language?: string | null; addressee?: string | null; notes?: string | null }, @Req() req: TradeRequest) {
    return this.clients.updateFormat(orgIdOf(req), id, docType, body ?? {});
  }

  /** Multipart "file": a sample / template the customer gave for this document. */
  @Post('customers/:id/formats/:docType/samples')
  @Permissions('shipments:update')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: TRADE_FILE_MAX_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (!resolveTradeFileMime(decodeUploadName(file.originalname), file.mimetype)) return callback(new BadRequestException(`File type not allowed. Allowed: ${TRADE_FILE_EXTENSIONS.join(', ')}`), false);
        callback(null, true);
      },
    }),
  )
  addSample(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @UploadedFile() file: Express.Multer.File, @Req() req: TradeRequest) {
    return this.clients.addSample(orgIdOf(req), id, docType, file, actorOf(req));
  }

  /** Hide a sample (kept, never deleted). */
  @Patch('customers/:id/formats/:docType/samples/:sampleId/hide')
  @Permissions('shipments:update')
  hideSample(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @Param('sampleId', ParseUUIDPipe) sampleId: string, @Req() req: TradeRequest) {
    return this.clients.hideSample(orgIdOf(req), id, docType, sampleId);
  }

  @Get('customers/:id/formats/:docType/samples/:sampleId/url')
  @Permissions('shipments:read')
  sampleUrl(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @Param('sampleId', ParseUUIDPipe) sampleId: string, @Req() req: TradeRequest) {
    return this.clients.sampleUrl(orgIdOf(req), id, docType, sampleId);
  }

  @Get('customers/:id/preview-shipments')
  @Permissions('shipments:read')
  previewShipments(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.clients.previewShipments(orgIdOf(req), id);
  }

  /** Read-only: the document of a real shipment in this format (PDF, and SUS's .xlsx) — logged as a VIEW. */
  @Post('customers/:id/formats/:docType/preview')
  @Permissions('shipments:read')
  preview(@Param('id', ParseUUIDPipe) id: string, @Param('docType') docType: string, @Body() body: { shipmentId?: string; generator?: string | null }, @Req() req: TradeRequest) {
    return this.clients.preview(orgIdOf(req), id, docType, body ?? {});
  }
}
