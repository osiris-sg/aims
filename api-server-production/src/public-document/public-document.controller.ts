import { Controller, Get, Post, Param, Req, HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { PublicDocumentService } from './public-document.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
}

/**
 * View-only document link surface. NO @Controller prefix — each handler declares
 * its full path so the authenticated office routes live under /documents while
 * the guest route lives under /public.
 *
 * The /public handler is @Public() (bypasses the global ClerkAuthGuard), takes
 * ZERO user context, and is GET-ONLY — there is NO mutating public route behind
 * the token. The office routes are authenticated + permissioned.
 */
@Controller()
export class PublicDocumentController {
  constructor(private readonly service: PublicDocumentService) {}

  // Best-effort client IP for the per-token+IP rate limiter.
  private clientIp(req: Request): string {
    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    return fwd || req.ip || (req.socket && req.socket.remoteAddress) || '';
  }

  /** AUTHENTICATED (office) — mint/reuse a view-only link for a DO. */
  @Post('documents/:id/share-link')
  @Permissions('documents:update')
  async generate(@Param('id') documentId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    }
    return this.service.generateForDocument(documentId, organizationId);
  }

  /** AUTHENTICATED (office) — revoke every active view-only link on the document. */
  @Post('documents/:id/share-link/revoke')
  @Permissions('documents:update')
  async revoke(@Param('id') documentId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    }
    return this.service.revokeForDocument(documentId, organizationId);
  }

  /** PUBLIC — read-only render payload for the document behind the token. */
  @Public()
  @Get('public/document/:token')
  async view(@Param('token') token: string, @Req() req: Request) {
    this.service.publicRateGate(token, this.clientIp(req));
    return this.service.getPublicView(token);
  }

  /**
   * PUBLIC — GPS route (lat/lng/timestamp only) for a DO_START report that
   * belongs to the token's document. Token-scoped, not report-id-scoped.
   */
  @Public()
  @Get('public/document/:token/route/:reportId')
  async routeTrack(@Param('token') token: string, @Param('reportId') reportId: string, @Req() req: Request) {
    this.service.publicRateGate(token, this.clientIp(req));
    return this.service.getPublicRouteTrack(token, reportId);
  }
}
