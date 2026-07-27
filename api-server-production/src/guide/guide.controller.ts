import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { GuideChatContext, GuideService } from './guide.service';

// No @Permissions decorator: navigation help is available to every
// authenticated user regardless of role (the guard passes when a route
// declares no required permissions).
@ApiTags('guide')
@ApiBearerAuth()
@Controller('guide')
@UseGuards(ClerkAuthGuard)
export class GuideController {
  constructor(private readonly service: GuideService) {}

  // Streaming (Server-Sent Events): answer text deltas + navigate/start_guide
  // actions. Powers the bottom-right "AIMS Guide" chat widget.
  @Post('stream')
  @ApiOperation({ summary: 'In-app guide assistant chat (SSE) — answers + navigation/tour actions' })
  async stream(
    @Req() req: Request,
    @Res() res: Response,
    @Body()
    body: {
      question: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      context?: GuideChatContext;
    },
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    req.on('close', () => { closed = true; });
    const emit = (e: any) => {
      if (closed) return;
      try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch { closed = true; }
    };

    await this.service.chatStream(body.question, body.history, body.context, emit);
    res.end();
  }
}
