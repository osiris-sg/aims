import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UploadedFile,
  UseInterceptors,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { Public } from '../decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { PublicDeliveryService } from './public-delivery.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
}

/**
 * Guest delivery surface. NO @Controller prefix — each handler declares its own
 * full path so the authenticated generate route can live under /documents while
 * the guest routes live under /public.
 *
 * The three /public handlers are @Public() (bypass the global ClerkAuthGuard);
 * they take ZERO user context — scope is resolved entirely from the URL token
 * inside the service. The generate handler is authenticated + permissioned.
 */
@Controller()
export class PublicDeliveryController {
  constructor(private readonly publicDeliveryService: PublicDeliveryService) {}

  /** AUTHENTICATED (office) — mint/reuse a guest link for a delivery order. */
  @Post('documents/:id/delivery-share-link')
  @Permissions('documents:update')
  async generate(
    @Param('id') documentId: string,
    @Req() req: RequestWithOrganization,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    }
    return this.publicDeliveryService.generateForDocument(documentId, organizationId);
  }

  /** PUBLIC — view the single DO behind the token. */
  @Public()
  @Get('public/delivery/:token')
  async view(@Param('token') token: string) {
    return this.publicDeliveryService.getGuestView(token);
  }

  /** PUBLIC — advance one item on the token's DO. */
  @Public()
  @Post('public/delivery/:token/advance')
  async advance(
    @Param('token') token: string,
    @Body() body: { itemId?: string; inventoryId?: string; action: 'start' | 'ack' | 'install' | 'skip' },
  ) {
    const identifier = body?.itemId || body?.inventoryId || '';
    return this.publicDeliveryService.advance(token, identifier, body?.action);
  }

  /** PUBLIC — proof-of-delivery photo upload, scoped to the token's DO. */
  @Public()
  @Post('public/delivery/:token/photo')
  @UseInterceptors(FileInterceptor('file'))
  async photo(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.publicDeliveryService.uploadPhoto(token, file);
  }

  /**
   * PUBLIC — create a delivery MSR (DO_START / DO_ACK / DO_INSTALL) on the
   * token's DO. Org/doc/asset are resolved from the token in the service; the
   * body carries only kind + the scanned unit + proof fields.
   */
  @Public()
  @Post('public/delivery/:token/report')
  async createReport(
    @Param('token') token: string,
    @Body()
    body: {
      kind?: string;
      inventoryId?: string;
      description?: string;
      photos?: string[];
      signature?: string;
      signedByName?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    return this.publicDeliveryService.createReport(token, body);
  }

  /** PUBLIC — sign (complete) a delivery MSR that belongs to the token's DO. */
  @Public()
  @Post('public/delivery/:token/report/:reportId/sign')
  async signReport(
    @Param('token') token: string,
    @Param('reportId') reportId: string,
    @Body() body: { signature?: string; signedByName?: string },
  ) {
    return this.publicDeliveryService.signReport(token, reportId, body);
  }
}
