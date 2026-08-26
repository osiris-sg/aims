import { Body, Controller, Get, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { Public } from '../decorators/public.decorator';
import { CustomerInfoService } from './customer-info.service';
import { SubmitCustomerInfoDto } from './dto/customer-info.dto';

// Multer options for the public PO upload: 10 MB cap + a declared-MIME allow
// list. The service ALSO magic-byte sniffs (the mimetype here is client-supplied).
const PO_UPLOAD_OPTS = {
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype);
    cb(null, ok);
  },
};

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

  /**
   * PUBLIC: upload the customer's Purchase Order. Creates a file-only PO document
   * on the request's project (see CustomerInfoService.uploadPo for the guardrails
   * that make this unauthenticated document-creation safe). Optional poReference
   * is the customer's own PO number.
   */
  @Public()
  @Post(':token/po')
  @UseInterceptors(FileInterceptor('file', PO_UPLOAD_OPTS))
  uploadPo(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('poReference') poReference: string | undefined,
    @Req() req: Request,
  ) {
    this.service.publicRateGate(token, this.clientIp(req));
    return this.service.uploadPo(token, file, poReference);
  }
}
