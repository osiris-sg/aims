import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AskService } from './ask.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('ask')
@ApiBearerAuth()
@Controller('ask')
@UseGuards(ClerkAuthGuard)
export class AskController {
  constructor(private readonly service: AskService) {}

  @Post()
  @Permissions('journal:read')
  @ApiOperation({ summary: 'Conversational accounting query — returns answer + structured attachments' })
  ask(
    @Req() req: RequestWithOrganization,
    @Body() body: { question: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> },
  ) {
    return this.service.ask(requireOrgId(req), body.question, body.history);
  }

  // Streaming variant (Server-Sent Events): live status ("Reading receivables…"),
  // answer text deltas, and KPI/table/link attachments. Powers the side-drawer chat.
  @Post('stream')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'Streaming conversational accounting query (SSE)' })
  async askStream(
    @Req() req: RequestWithOrganization,
    @Res() res: Response,
    @Body()
    body: {
      question: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      // Uploaded PDFs/images (base64) the assistant should read alongside the ledger.
      attachments?: Array<{ name?: string; mediaType: string; base64: string }>;
    },
  ): Promise<void> {
    const orgId = requireOrgId(req);
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

    await this.service.askStream(orgId, body.question, body.history, emit, body.attachments);
    res.end();
  }
}
