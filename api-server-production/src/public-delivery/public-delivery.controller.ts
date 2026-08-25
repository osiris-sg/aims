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
 * Run-scoped guest delivery surface. NO @Controller prefix — each handler
 * declares its full path so the authenticated office routes live under
 * /documents while the guest routes live under /public.
 *
 * The /public handlers are @Public() (bypass the global ClerkAuthGuard); they
 * take ZERO user context — scope is resolved entirely from the URL token inside
 * the service, which binds a token to EXACTLY ONE outbound run. Each is
 * rate-limited per (token + client IP). The office routes are authenticated +
 * permissioned.
 */
@Controller()
export class PublicDeliveryController {
  constructor(private readonly publicDeliveryService: PublicDeliveryService) {}

  // Best-effort client IP for the per-token+IP rate limiter.
  private clientIp(req: Request): string {
    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    return fwd || req.ip || (req.socket && req.socket.remoteAddress) || '';
  }

  /** AUTHENTICATED (office) — mint/reuse a run-scoped guest link for a DO. */
  @Post('documents/:id/delivery-share-link')
  @Permissions('documents:update')
  async generate(@Param('id') documentId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    }
    return this.publicDeliveryService.generateForDocument(documentId, organizationId);
  }

  /** AUTHENTICATED (office) — revoke every active guest link on the DO's run. */
  @Post('documents/:id/delivery-share-link/revoke')
  @Permissions('documents:update')
  async revoke(@Param('id') documentId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    }
    return this.publicDeliveryService.revokeForDocument(documentId, organizationId);
  }

  /** PUBLIC — read-only view of the run behind the token. */
  @Public()
  @Get('public/delivery/:token')
  async view(@Param('token') token: string, @Req() req: Request) {
    this.publicDeliveryService.publicRateGate(token, this.clientIp(req));
    return this.publicDeliveryService.getRunView(token);
  }

  /** PUBLIC — proof photo upload, scoped to the token's run. */
  @Public()
  @Post('public/delivery/:token/photo')
  @UseInterceptors(FileInterceptor('file'))
  async photo(@Param('token') token: string, @UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    this.publicDeliveryService.publicRateGate(token, this.clientIp(req));
    return this.publicDeliveryService.uploadPhoto(token, file);
  }

  /** PUBLIC — deliver one item on the run with its condition photos. */
  @Public()
  @Post('public/delivery/:token/items/:itemId/deliver')
  async deliver(
    @Param('token') token: string,
    @Param('itemId') itemId: string,
    @Body() body: { photos?: string[] },
    @Req() req: Request,
  ) {
    this.publicDeliveryService.publicRateGate(token, this.clientIp(req));
    return this.publicDeliveryService.deliverItem(token, itemId, body?.photos ?? []);
  }

  /** PUBLIC — finalize the run: install yes/no + one signature. */
  @Public()
  @Post('public/delivery/:token/finalize')
  async finalize(
    @Param('token') token: string,
    @Body() body: { signature?: string; signedByName?: string; installNeeded?: boolean; installPhotos?: string[] },
    @Req() req: Request,
  ) {
    this.publicDeliveryService.publicRateGate(token, this.clientIp(req));
    return this.publicDeliveryService.finalize(token, body);
  }
}
