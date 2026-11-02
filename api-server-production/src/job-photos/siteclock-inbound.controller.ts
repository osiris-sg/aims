import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { SiteClockInboundGuard } from './siteclock-inbound.guard';
import { JobPhotosService } from './job-photos.service';
import { MAX_PHOTO_BYTES, parsePhotoFields } from './job-photos';

/**
 * SiteClock → AIMS (WCT job photos, 2026-11-02). The contract SiteClock builds
 * against; keep it exactly. @Public() skips the Clerk guard; the org's inbound
 * key (SiteClockInboundGuard) is the auth and the org. Success bodies are sent
 * bare through @Res() (not the app's { success, data } envelope), so SiteClock
 * gets exactly { photoId } / { url, expiresAt } / { ok }. Errors keep the app's
 * usual shape; their status codes are the contract.
 */
@ApiTags('integrations siteclock')
@Controller('integrations/siteclock')
@Public()
@UseGuards(SiteClockInboundGuard)
export class SiteClockInboundController {
  constructor(private readonly photos: JobPhotosService) {}

  @Post('photos')
  @ApiOperation({ summary: 'Receive a job photo (multipart). 201 { photoId }; the same siteclockPhotoId again → 200 with the same photoId.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  async receive(@Req() req: any, @Body() body: Record<string, any>, @UploadedFile() file: Express.Multer.File, @Headers('idempotency-key') idempotencyKey: string | undefined, @Res() res: Response) {
    const fields = parsePhotoFields(body, idempotencyKey);
    if (typeof fields === 'string') throw new BadRequestException(fields);
    const r = await this.photos.receive(req.userOrganization.id, fields, file);
    res.status(r.created ? 201 : 200).json({ photoId: r.photoId });
  }

  @Get('photos/:photoId/url')
  @ApiOperation({ summary: 'A presigned URL (15 min) for the photo or its thumbnail.' })
  async url(@Req() req: any, @Param('photoId', ParseUUIDPipe) photoId: string, @Res() res: Response, @Query('size') size?: string) {
    res.status(200).json(await this.photos.urlFor(req.userOrganization.id, photoId, size === 'thumb' ? 'thumb' : 'full'));
  }

  @Delete('photos/:photoId')
  @ApiOperation({ summary: 'Soft delete: hidden in AIMS, the file is kept.' })
  async remove(@Req() req: any, @Param('photoId', ParseUUIDPipe) photoId: string, @Res() res: Response) {
    res.status(200).json(await this.photos.deleteFromSiteClock(req.userOrganization.id, photoId));
  }
}
