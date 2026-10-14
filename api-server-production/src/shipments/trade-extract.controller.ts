import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ExtractBlDraftDto, ExtractPiDto } from './dto/trade-extract.dto';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { decodeUploadName, TRADE_FILE_MAX_BYTES } from './shipments.rules';
import { TradeExtractService } from './trade-extract.service';

const pdfOrImage = FileInterceptor('file', {
  limits: { fileSize: TRADE_FILE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const name = decodeUploadName(file.originalname).toLowerCase();
    if (!/\.(pdf|png|jpe?g|webp)$/.test(name)) return callback(new BadRequestException('Upload the PI / B/L draft as a PDF (or a PNG / JPG scan)'), false);
    callback(null, true);
  },
});

/** AI reading of trade PDFs: PI → contract draft, B/L draft → shipment draft + checks. */
@Controller('trade-extract')
@UseGuards(ClerkAuthGuard)
export class TradeExtractController {
  constructor(private readonly extract: TradeExtractService) {}

  @Post('pi')
  @Permissions('shipments:create')
  @UseInterceptors(pdfOrImage)
  pi(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: ExtractPiDto, @Req() req: TradeRequest) {
    return this.extract.extract(orgIdOf(req), 'PI', { file, fileId: dto.fileId }, actorOf(req));
  }

  @Post('bl-draft')
  @Permissions('shipments:create')
  @UseInterceptors(pdfOrImage)
  blDraft(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: ExtractBlDraftDto, @Req() req: TradeRequest) {
    return this.extract.extract(orgIdOf(req), 'BL_DRAFT', { file, fileId: dto.fileId, shipmentId: dto.shipmentId, contractId: dto.contractId }, actorOf(req));
  }

  @Get(':id')
  @Permissions('shipments:read')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.extract.get(orgIdOf(req), id);
  }

  /** Cancelled Fill from PI / B/L draft: remove the unsaved source PDF (+ its extraction rows, S3 object). */
  @Delete('source/:fileId')
  @Permissions('shipments:create')
  discard(@Param('fileId', ParseUUIDPipe) fileId: string, @Req() req: TradeRequest) {
    return this.extract.discardSource(orgIdOf(req), fileId, actorOf(req));
  }

  @Post(':id/acknowledge')
  @Permissions('shipments:update')
  acknowledge(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.extract.acknowledge(orgIdOf(req), id, actorOf(req));
  }
}
