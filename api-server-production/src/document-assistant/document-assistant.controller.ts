import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ChatRequest, DocumentAssistantService, StreamEvent } from './document-assistant.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('document-assistant')
@ApiBearerAuth()
@Controller('document-assistant')
@UseGuards(ClerkAuthGuard)
export class DocumentAssistantController {
  constructor(private readonly service: DocumentAssistantService) {}

  @Post('chat')
  // Inline editor feature — reuses the documents:read permission every user
  // editing documents already has, so there's no new-permission rollout.
  @Permissions('documents:read')
  @ApiOperation({
    summary: 'Document-filling AI chat — returns an answer plus an optional field proposal',
  })
  chat(@Req() req: RequestWithOrganization, @Body() body: ChatRequest) {
    return this.service.chat(requireOrgId(req), body);
  }

  @Post('chat/stream')
  @Permissions('documents:read')
  @ApiOperation({
    summary: 'Streaming variant of chat — Server-Sent Events (text deltas, tool status, proposal)',
  })
  async chatStream(
    @Req() req: RequestWithOrganization,
    @Res() res: Response,
    @Body() body: ChatRequest,
  ): Promise<void> {
    const orgId = requireOrgId(req);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Disable proxy buffering (nginx / Render) so events flush immediately.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    const emit = (e: StreamEvent) => {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch {
        closed = true;
      }
    };

    await this.service.chatStream(orgId, body, emit);
    res.end();
  }
}
