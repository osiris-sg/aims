import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AddTradeFileLinksDto, ListTradeFilesQuery, UploadTradeFileDto } from './dto/trade-file.dto';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { decodeUploadName, resolveTradeFileMime, TRADE_FILE_EXTENSIONS, TRADE_FILE_MAX_BYTES } from './shipments.rules';
import { TradeFilesService } from './trade-files.service';

@Controller('trade-files')
@UseGuards(ClerkAuthGuard)
export class TradeFilesController {
  constructor(private readonly files: TradeFilesService) {}

  /** Multipart: file, docType, contractIds[]?, shipmentIds[]?, stepId?, notes?. */
  @Post()
  @Permissions('shipments:create')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: TRADE_FILE_MAX_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (!resolveTradeFileMime(decodeUploadName(file.originalname), file.mimetype)) {
          return callback(new BadRequestException(`File type not allowed. Allowed: ${TRADE_FILE_EXTENSIONS.join(', ')}`), false);
        }
        callback(null, true);
      },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadTradeFileDto, @Req() req: TradeRequest) {
    return this.files.upload(orgIdOf(req), file, dto, actorOf(req));
  }

  @Get()
  @Permissions('shipments:read')
  list(@Query() query: ListTradeFilesQuery, @Req() req: TradeRequest) {
    return this.files.list(orgIdOf(req), query);
  }

  /** "Download shipment folder (.zip)" — the shipment's files, named after ADH's folder convention. */
  @Get('shipment/:shipmentId/zip')
  @Permissions('shipments:read')
  async shipmentZip(@Param('shipmentId', ParseUUIDPipe) shipmentId: string, @Req() req: TradeRequest, @Res() res: Response) {
    const z = await this.files.shipmentZip(orgIdOf(req), shipmentId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(z.name)}`);
    res.setHeader('Content-Length', String(z.buffer.length));
    res.end(z.buffer);
  }

  @Get(':id/url')
  @Permissions('shipments:read')
  getUrl(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.files.getUrl(orgIdOf(req), id);
  }

  /** The file itself (the in-app viewer renders PDFs / images from these bytes). */
  @Get(':id/content')
  @Permissions('shipments:read')
  async content(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest, @Res() res: Response) {
    // Raw bytes (as trade-generated :id/pdf): bypasses the global {success,data} envelope.
    const f = await this.files.getContent(orgIdOf(req), id);
    res.setHeader('Content-Type', f.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
    res.setHeader('Content-Length', String(f.buffer.length));
    res.end(f.buffer);
  }

  /** Signed URL of the file's first-page / image thumbnail ({ url: null } when it has none). */
  @Get(':id/thumb')
  @Permissions('shipments:read')
  thumbUrl(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.files.thumbUrl(orgIdOf(req), id);
  }

  @Post(':id/links')
  @Permissions('shipments:update')
  addLinks(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTradeFileLinksDto, @Req() req: TradeRequest) {
    return this.files.addLinks(orgIdOf(req), id, dto, actorOf(req));
  }

  @Delete(':id/links/:linkId')
  @Permissions('shipments:delete')
  removeLink(@Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string, @Req() req: TradeRequest) {
    return this.files.removeLink(orgIdOf(req), id, linkId);
  }

  @Delete(':id')
  @Permissions('shipments:delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.files.remove(orgIdOf(req), id);
  }
}
