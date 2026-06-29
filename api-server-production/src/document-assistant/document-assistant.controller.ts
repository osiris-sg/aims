import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ChatRequest, DocumentAssistantService } from './document-assistant.service';

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
}
