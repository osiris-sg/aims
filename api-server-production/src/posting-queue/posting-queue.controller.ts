import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PostingQueueService } from './posting-queue.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('posting-queue')
@ApiBearerAuth()
@Controller('posting-queue')
@UseGuards(ClerkAuthGuard)
export class PostingQueueController {
  constructor(private readonly service: PostingQueueService) {}

  @Get()
  @Permissions('journal:read')
  @ApiOperation({ summary: 'List invoices created but not yet posted to the GL (pending posting)' })
  list(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.list(requireOrgId(req), {
      search: q.search,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Get(':id/preview')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'AI/learned Dr-Cr preview for a queued invoice (does not post)' })
  preview(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.previewOne(requireOrgId(req), id);
  }

  @Post('post-batch')
  @Permissions('journal:post')
  @ApiOperation({ summary: 'Post many queued invoices to the GL (per-line JE); partial failures reported' })
  postBatch(@Req() req: RequestWithOrganization, @Body() body: { documentIds: string[] }) {
    return this.service.postBatch(requireOrgId(req), body?.documentIds, req.auth?.userId);
  }

  @Post(':id/accounts')
  @Permissions('journal:post')
  @ApiOperation({ summary: 'Persist accountant-reviewed accounts onto the invoice lines before posting' })
  applyAccounts(
    @Req() req: RequestWithOrganization,
    @Param('id') id: string,
    @Body() body: { picks: Array<{ lineIndex: number; accountCode: string | null }> },
  ) {
    return this.service.applyAccounts(requireOrgId(req), id, body?.picks || []);
  }

  @Post(':id/reject')
  @Permissions('journal:post')
  @ApiOperation({ summary: 'Reject/hold a queued invoice (removes from active queue, keeps audit trail)' })
  reject(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.service.reject(requireOrgId(req), id, body?.reason || '', req.auth?.userId);
  }
}
