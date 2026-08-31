import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { LeadsService } from './leads.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

/**
 * Sales leads (interior-design orgs). Uses the documents permissions so no
 * new permission rollout is needed — leads are sales artifacts and everyone
 * who can work quotations can work leads.
 */
@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ClerkAuthGuard)
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Get('stats')
  @Permissions('documents:read')
  stats(@Req() req: RequestWithOrganization) {
    return this.service.stats(orgId(req));
  }

  @Get()
  @Permissions('documents:read')
  list(
    @Req() req: RequestWithOrganization,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('assignedToUserId') assignedToUserId?: string,
  ) {
    return this.service.list(orgId(req), { page: Number(page) || 1, limit: Number(limit) || 20, search, status, source, assignedToUserId });
  }

  @Post()
  @Permissions('documents:create-basic')
  create(@Body() body: any, @Req() req: RequestWithOrganization) {
    return this.service.create(orgId(req), body || {});
  }

  @Patch(':id')
  @Permissions('documents:update')
  update(@Param('id') id: string, @Body() body: any, @Req() req: RequestWithOrganization) {
    return this.service.update(id, orgId(req), body || {});
  }

  // Mark dead WITH the mandatory no-reply proof (screenshot/PDF, base64).
  @Post(':id/dead-proof')
  @Permissions('documents:update')
  deadProof(@Param('id') id: string, @Body() body: { file: string; filename?: string }, @Req() req: RequestWithOrganization) {
    return this.service.uploadDeadProof(id, orgId(req), body?.file, body?.filename);
  }

  @Delete(':id')
  @Permissions('documents:update')
  remove(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.remove(id, orgId(req));
  }
}
