import { Body, Controller, Get, Post, Param, Req, HttpException, HttpStatus } from '@nestjs/common';
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
 * The /public handlers are @Public() (bypass the global ClerkAuthGuard) and take
 * ZERO user context. They were GET-ONLY until 2026-09; there is now exactly ONE
 * mutating route — the customer signing an UNSIGNED DO — and it is deliberately
 * the narrowest possible write: signature fields on the run's DO_ACK rows, once,
 * with nothing addressable coming from the body. The office routes are
 * authenticated + permissioned.
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
   * PUBLIC — the customer signs an UNSIGNED DO behind the token.
   *
   * The ONLY mutating route on this surface. Guarded like the reads (revocation
   * + per token+IP rate limit) but on a much tighter bucket, since signing is a
   * once-ever action rather than a browse.
   *
   * The body carries name, signature and the typed date and NOTHING ELSE — no
   * document, delivery or report id — so it cannot be aimed at another record.
   * The IP and user agent are read from the request here and recorded as
   * provenance; they are never accepted from the client.
   */
  @Public()
  @Post('public/document/:token/sign')
  async publicSign(
    @Param('token') token: string,
    @Body() body: { name?: string; signature?: string; signedDate?: string },
    @Req() req: Request,
  ) {
    const ip = this.clientIp(req);
    this.service.publicSignRateGate(token, ip);
    return this.service.publicSign(token, body ?? {}, {
      ip,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
    });
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
