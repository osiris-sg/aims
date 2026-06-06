import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
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
}
