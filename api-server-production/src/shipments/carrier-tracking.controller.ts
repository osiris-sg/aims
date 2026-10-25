import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { actorOf, orgIdOf, TradeRequest } from './shipments.request';
import { CarrierTrackingService } from './carrier-tracking.service';

/** Round AL — "Paste tracking" on a shipment: a screenshot or the pasted tracking page → AIMS → tracking → Confirm. */
@RequiresModule('SHIPMENTS')
@Controller('shipment-tracking')
@UseGuards(ClerkAuthGuard)
export class CarrierTrackingController {
  constructor(private readonly tracking: CarrierTrackingService) {}

  @Get(':shipmentId')
  @Permissions('shipments:read')
  list(@Param('shipmentId', ParseUUIDPipe) shipmentId: string, @Req() req: TradeRequest) {
    return this.tracking.list(orgIdOf(req), shipmentId);
  }

  /** multipart: "image" (a screenshot) and/or "text" (the pasted page). Reads and compares; writes nothing on the shipment. */
  @Post(':shipmentId/read-tracking')
  @Permissions('shipments:update')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  read(@Param('shipmentId', ParseUUIDPipe) shipmentId: string, @UploadedFile() image: Express.Multer.File | undefined, @Body() body: { text?: string }, @Req() req: TradeRequest) {
    const text = typeof body?.text === 'string' ? body.text.slice(0, 20000) : '';
    if (!image && !text.trim()) throw new BadRequestException('Paste the tracking page text or attach a screenshot');
    return this.tracking.read(orgIdOf(req), { shipmentId, text, image: image ? { buffer: image.buffer, mimetype: image.mimetype } : null, source: image ? 'SCREENSHOT' : 'PASTE' }, actorOf(req));
  }

  /** Confirm: write the ticked fields (re-compared against the shipment as it is now). */
  @Post('reads/:trackingId/apply-tracking')
  @Permissions('shipments:update')
  apply(@Param('trackingId', ParseUUIDPipe) trackingId: string, @Body() body: { fields?: string[] }, @Req() req: TradeRequest) {
    if (!Array.isArray(body?.fields) || !body.fields.length) throw new BadRequestException('Pick at least one field to apply');
    return this.tracking.apply(orgIdOf(req), trackingId, body.fields.map(String).slice(0, 20), actorOf(req));
  }
}
