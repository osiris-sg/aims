import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';
import { SubmitTempSignatureDto } from './dto/submit-temp-signature.dto';
import { TempSignatureService } from './temp-signature.service';

/**
 * TEMPORARY standalone signature capture. ONE @Public() handler, no auth, no
 * token — the rate limiter and the validation in the service are the only
 * gate. Remove this module once the backfill is done.
 */
@ApiTags('temp-signature')
@Controller('public/temp-signature')
export class TempSignatureController {
  constructor(private readonly service: TempSignatureService) {}

  /** Best-effort client IP — used for the rate limiter AND the sidecar. */
  private clientIp(req: Request): string {
    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    return fwd || req.ip || (req.socket && req.socket.remoteAddress) || '';
  }

  @Public()
  @Post()
  @ApiOperation({ summary: 'PUBLIC: submit a standalone name + signature (+ optional comment)' })
  submit(@Body() dto: SubmitTempSignatureDto, @Req() req: Request) {
    const ip = this.clientIp(req);
    this.service.rateGate(ip);
    return this.service.submit(dto, { ip, userAgent: (req.headers['user-agent'] as string) || '' });
  }
}
