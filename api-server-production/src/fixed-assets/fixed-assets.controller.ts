import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { FixedAssetsService } from './fixed-assets.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('fixed-assets')
@ApiBearerAuth()
@Controller('fixed-assets')
@UseGuards(ClerkAuthGuard)
export class FixedAssetsController {
  constructor(private readonly service: FixedAssetsService) {}

  @Get()
  @Permissions('accounting:read')
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  list(@Req() req: RequestWithOrganization, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(requireOrgId(req), includeInactive === 'true');
  }

  @Get(':id')
  @Permissions('accounting:read')
  findOne(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.findOne(requireOrgId(req), id);
  }

  @Post()
  @Permissions('accounting:create')
  create(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.create(requireOrgId(req), req.auth?.userId, body);
  }

  @Patch(':id')
  @Permissions('accounting:update')
  update(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body: any) {
    return this.service.update(requireOrgId(req), id, body);
  }

  @Delete(':id')
  @Permissions('accounting:delete')
  dispose(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body?: { proceeds?: number; disposedAt?: string }) {
    return this.service.dispose(requireOrgId(req), id, body?.proceeds, body?.disposedAt);
  }

  @Post('post-period')
  @Permissions('journal:post')
  @ApiOperation({ summary: 'Run depreciation for a single period (called by Close Wizard, also exposed for manual run)' })
  postPeriod(@Req() req: RequestWithOrganization, @Body() body: { periodDate: string }) {
    return this.service.postPeriod(requireOrgId(req), new Date(body.periodDate), req.auth?.userId);
  }
}
