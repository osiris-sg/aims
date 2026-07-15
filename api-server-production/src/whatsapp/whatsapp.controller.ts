import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../decorators/public.decorator';
import { OnboardDto, SendTemplateDto, SendTextDto } from './dto/whatsapp.dto';
import { WhatsAppService } from './whatsapp.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
  rawBody?: Buffer;
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('whatsapp')
@UseGuards(ClerkAuthGuard)
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly service: WhatsAppService,
    private readonly configService: ConfigService,
  ) {}

  @Get('status')
  @Permissions('whatsapp:read')
  @ApiOperation({ summary: "Current org's WhatsApp connection state (token/pin never included)" })
  status(@Req() req: RequestWithOrganization) {
    return this.service.getStatus(requireOrgId(req));
  }

  @Post('onboard')
  @Permissions('whatsapp:manage')
  @ApiOperation({ summary: 'Complete Embedded Signup: exchange code, subscribe WABA, register phone' })
  onboard(@Req() req: RequestWithOrganization, @Body() body: OnboardDto) {
    return this.service.onboard(requireOrgId(req), body);
  }

  @Post('disconnect')
  @Permissions('whatsapp:manage')
  @ApiOperation({ summary: 'Soft-disconnect the org WhatsApp connection' })
  disconnect(@Req() req: RequestWithOrganization) {
    return this.service.disconnect(requireOrgId(req));
  }

  @Post('send-template')
  @Permissions('whatsapp:send')
  @ApiOperation({ summary: 'Send an approved template message (business-initiated)' })
  sendTemplate(@Req() req: RequestWithOrganization, @Body() body: SendTemplateDto) {
    return this.service.sendTemplate(requireOrgId(req), body);
  }

  @Post('send-text')
  @Permissions('whatsapp:send')
  @ApiOperation({ summary: 'Send a free-form text (24h customer-service window only)' })
  sendText(@Req() req: RequestWithOrganization, @Body() body: SendTextDto) {
    return this.service.sendText(requireOrgId(req), body);
  }

  @Get('messages')
  @Permissions('whatsapp:read')
  @ApiOperation({ summary: 'Recent inbound/outbound WhatsApp message log for the org' })
  messages(@Req() req: RequestWithOrganization, @Query('limit') limit?: string) {
    return this.service.listMessages(requireOrgId(req), limit ? Number(limit) : undefined);
  }

  // ── Meta webhook (public — Meta's servers call this, not our users) ────────

  // Verification handshake. Uses @Res because Meta must receive the bare
  // challenge string — the global CustomResponseInterceptor's {success,data}
  // envelope would break verification.
  @Public()
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = this.configService.get<string>('WHATSAPP.WEBHOOK_VERIFY_TOKEN');
    if (expected && mode === 'subscribe' && token === expected) {
      return res.status(200).send(challenge);
    }
    this.logger.warn('Webhook verification failed (bad verify token or unconfigured)');
    return res.status(403).send('Forbidden');
  }

  @Public()
  @Post('webhook')
  async receiveWebhook(@Req() req: RequestWithOrganization, @Res() res: Response, @Body() body: any) {
    if (!this.isSignatureValid(req)) {
      this.logger.warn('Webhook rejected: invalid X-Hub-Signature-256');
      return res.status(401).send('Invalid signature');
    }
    // Ack fast — Meta retries aggressively on slow/non-200 responses.
    res.status(200).send('OK');
    try {
      await this.service.handleWebhook(body);
    } catch (e) {
      this.logger.error(`Webhook processing failed: ${(e as Error).message}`);
    }
  }

  /**
   * HMAC-SHA256 of the raw request body with the app secret must match the
   * X-Hub-Signature-256 header. If META_APP_SECRET is unset (local dev), the
   * check is skipped with a warning rather than dropping traffic.
   */
  private isSignatureValid(req: RequestWithOrganization): boolean {
    const secret = this.configService.get<string>('WHATSAPP.APP_SECRET');
    if (!secret) {
      this.logger.warn('META_APP_SECRET unset — accepting webhook without signature check');
      return true;
    }
    const header = req.headers['x-hub-signature-256'];
    if (typeof header !== 'string' || !req.rawBody) return false;
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
