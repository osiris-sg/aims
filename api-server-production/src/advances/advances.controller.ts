import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AdvancesService } from './advances.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
  user?: { id?: string };
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}
function actorName(req: RequestWithOrganization): string | null {
  const u: any = req.user || {};
  return u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || null;
}

/**
 * Designer advance requests. Rides on the projects permissions (designers who
 * work projects can request; the senior/master gate for deciding is enforced
 * by tier inside the service) so no new permission rollout is needed.
 */
@ApiTags('advances')
@ApiBearerAuth()
@Controller('advances')
@UseGuards(ClerkAuthGuard)
export class AdvancesController {
  constructor(private readonly service: AdvancesService) {}

  @Get()
  @Permissions('projects:read')
  list(@Req() req: RequestWithOrganization, @Query('status') status?: string) {
    return this.service.list(orgId(req), req.user?.id, status);
  }

  @Post()
  @Permissions('projects:read')
  create(@Req() req: RequestWithOrganization, @Body() dto: { amount: number; projectId?: string | null; reason?: string | null }) {
    return this.service.create(orgId(req), req.user!.id!, actorName(req), dto);
  }

  @Patch(':id/decide')
  @Permissions('projects:update')
  decide(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() dto: { approve: boolean; note?: string | null }) {
    return this.service.decide(orgId(req), req.user?.id, actorName(req), id, dto);
  }

  @Patch(':id/paid')
  @Permissions('projects:update')
  markPaid(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.markPaid(orgId(req), req.user?.id, id);
  }
}
