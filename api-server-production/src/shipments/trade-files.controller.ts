import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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

  @Get(':id/url')
  @Permissions('shipments:read')
  getUrl(@Param('id', ParseUUIDPipe) id: string, @Req() req: TradeRequest) {
    return this.files.getUrl(orgIdOf(req), id);
  }

  @Post(':id/links')
  @Permissions('shipments:update')
  addLinks(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTradeFileLinksDto, @Req() req: TradeRequest) {
    return this.files.addLinks(orgIdOf(req), id, dto);
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
