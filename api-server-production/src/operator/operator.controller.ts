import { Body, Controller, Headers, Logger, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { OperatorService } from './operator.service';
import { OperatorAuthService } from './operator-auth.service';
import { TelegramAdapter } from './adapters/telegram.adapter';

interface RequestWithUser extends Request {
  user?: { id: string; firstName?: string; lastName?: string; emailAddresses?: Array<{ emailAddress: string }> };
}

@ApiTags('operator')
@Controller('operator')
export class OperatorController {
  private readonly logger = new Logger(OperatorController.name);

  constructor(
    private readonly operator: OperatorService,
    private readonly auth: OperatorAuthService,
    private readonly telegram: TelegramAdapter,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Telegram webhook. Public (Telegram's servers call it), authenticated by the
   * secret token Telegram echoes on every request. Acks immediately — Telegram
   * retries aggressively on slow or non-200 responses.
   */
  @Public()
  @Post('telegram/webhook')
  @ApiOperation({ summary: 'Telegram bot webhook (secret-token gated)' })
  async telegramWebhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    const expected = this.configService.get<string>('TELEGRAM.WEBHOOK_SECRET');
    if (!expected || secret !== expected) {
      this.logger.warn('Telegram webhook rejected: bad secret token');
      return res.status(401).send('Invalid secret token');
    }
    // Ack first, then process — never make Telegram wait on the agent.
    res.status(200).send('OK');
    try {
      const msg = this.telegram.parse(body);
      if (msg) await this.operator.handleInbound(msg);
    } catch (e) {
      this.logger.error(`Operator processing failed: ${(e as Error).message}`);
    }
  }

  /**
   * Portal: mint a one-time code the signed-in user texts to the bot to link
   * their chat account. Clerk-guarded (no @Public) — the code is bound to the
   * caller's own Clerk id, so a sender can never claim someone else's account.
   */
  @Post('link-code')
  @ApiOperation({ summary: 'Generate a one-time code to link a chat account to the current AIMS user' })
  async createLinkCode(@Req() req: RequestWithUser) {
    const clerkUserId = req.user?.id;
    if (!clerkUserId) return { error: 'Not authenticated' };
    const { code, expiresAt } = await this.auth.createLinkCode(clerkUserId);
    return { code, expiresAt, instructions: `Send "/link ${code}" to the AIMS bot on Telegram.` };
  }
}
