import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ServiceReportSignService } from './service-report-sign.service';

interface AuthedRequest extends Request {
  userOrganization?: { id: string };
  user?: { id?: string };
}

/**
 * Remote customer signature for SERVICE reports. No @Controller prefix (same
 * layout as public-document): the authenticated mint/revoke routes live under
 * /maintenance-reports, the token routes under /public/service-report.
 */
@ApiTags('service-report-sign')
@Controller()
export class ServiceReportSignController {
  constructor(private readonly service: ServiceReportSignService) {}

  private orgId(req: AuthedRequest): string {
    const id = req.userOrganization?.id;
    if (!id) throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    return id;
  }
  private ip(req: Request): string {
    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    return fwd || req.ip || (req.socket && req.socket.remoteAddress) || '';
  }

  /** AUTHENTICATED — mint (or reuse) a sign link for 1..N unsigned reports of one customer. */
  @Post('maintenance-reports/sign-link')
  @Permissions('maintenance-reports:sign')
  mint(@Body() body: { reportIds?: string[]; techSignatureKey?: string }, @Req() req: AuthedRequest) {
    return this.service.mint(this.orgId(req), body ?? {}, req.user?.id);
  }

  /** AUTHENTICATED — the report's active sign link, or null. */
  @Get('maintenance-reports/:id/sign-link')
  @Permissions('maintenance-reports:read')
  active(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.activeForReport(this.orgId(req), id);
  }

  /** AUTHENTICATED — revoke every open sign link covering the report. */
  @Post('maintenance-reports/:id/sign-link/revoke')
  @Permissions('maintenance-reports:sign')
  revoke(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.service.revokeForReport(this.orgId(req), id);
  }

  /** PUBLIC — summary of the reports behind the token, with its state. */
  @Public()
  @Get('public/service-report/:token')
  view(@Param('token') token: string, @Req() req: Request) {
    this.service.readGate(token, this.ip(req));
    return this.service.view(token);
  }

  /** PUBLIC — PDF of one of the token's reports. */
  @Public()
  @Get('public/service-report/:token/pdf/:reportId')
  async pdf(@Param('token') token: string, @Param('reportId') reportId: string, @Req() req: Request, @Res() res: Response) {
    this.service.readGate(token, this.ip(req));
    const { buffer, filename } = await this.service.pdf(token, reportId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'no-store' });
    res.end(buffer);
  }

  /** PUBLIC — the customer signs. Body: name + PNG data URL, nothing addressable. */
  @Public()
  @Post('public/service-report/:token/sign')
  sign(@Param('token') token: string, @Body() body: { name?: string; signature?: string }, @Req() req: Request) {
    const ip = this.ip(req);
    this.service.signGate(token, ip);
    return this.service.sign(token, body ?? {}, { ip, userAgent: (req.headers['user-agent'] as string | undefined) ?? '' });
  }
}
