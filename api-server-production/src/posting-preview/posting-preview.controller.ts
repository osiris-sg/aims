import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PostingPreviewService, PreviewDto } from './posting-preview.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('posting-preview')
@ApiBearerAuth()
@Controller('posting-preview')
@UseGuards(ClerkAuthGuard)
export class PostingPreviewController {
  constructor(private readonly service: PostingPreviewService) {}

  // Dry-run: returns the AI-suggested journal entry for a draft document of the
  // given type WITHOUT posting. Powers the editable "Review posting" dialog.
  @Post()
  @Permissions('journal:read')
  @ApiOperation({ summary: 'AI-suggested journal-entry preview for a draft document (does not post)' })
  preview(@Req() req: RequestWithOrganization, @Body() body: PreviewDto) {
    return this.service.preview(requireOrgId(req), body);
  }
}
