import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../decorators/public.decorator';
import { CustomerInfoService } from './customer-info.service';
import { SubmitCustomerInfoDto } from './dto/customer-info.dto';

/**
 * Public (no-login) Customer Information surface. Both handlers are @Public()
 * (bypass the global ClerkAuthGuard); scope is resolved SOLELY from the URL
 * token inside the service, which binds a token to EXACTLY ONE request. Each is
 * rate-limited per (token + client IP). The URL is the only credential and is
 * only ever sent to the customer.
 */
@Controller('public/customer-info')
export class PublicCustomerInfoController {
  constructor(private readonly service: CustomerInfoService) {}

  // Best-effort client IP for the per-token+IP rate limiter.
  private clientIp(req: Request): string {
    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    return fwd || req.ip || (req.socket && req.socket.remoteAddress) || '';
  }

  /** PUBLIC: read-only view (customer + project + current contacts) + state. */
  @Public()
  @Get(':token')
  view(@Param('token') token: string, @Req() req: Request) {
    this.service.publicRateGate(token, this.clientIp(req));
    return this.service.getPublicView(token);
  }

  /** PUBLIC: submit (or resubmit) the two contact groups. */
  @Public()
  @Post(':token/submit')
  submit(@Param('token') token: string, @Body() dto: SubmitCustomerInfoDto, @Req() req: Request) {
    this.service.publicRateGate(token, this.clientIp(req));
    return this.service.submit(token, dto);
  }
}
