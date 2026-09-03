import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../decorators/public.decorator';
import { ProjectCostingService } from './project-costing.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
  user?: { id?: string; firstName?: string; lastName?: string; email?: string; name?: string };
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}
function actorName(req: RequestWithOrganization): string | undefined {
  const u: any = req.user || {};
  return u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || undefined;
}

/** PUBLIC (no auth): the client-facing live schedule, by unguessable token. */
@ApiTags('project-costing')
@Controller()
export class PublicScheduleController {
  constructor(private readonly service: ProjectCostingService) {}

  @Public()
  @Get('public/schedule/:token')
  publicSchedule(@Param('token') token: string) {
    return this.service.publicScheduleByToken(token);
  }
}

/**
 * ID projects LIST. Lives on its own prefix because ProjectsController's
 * `GET /projects/:id` is registered first and would swallow `/projects/<anything>`.
 */
@ApiTags('project-costing')
@ApiBearerAuth()
@Controller('id-projects')
@UseGuards(ClerkAuthGuard)
export class IdProjectsListController {
  constructor(private readonly service: ProjectCostingService) {}

  @Get()
  @Permissions('projects:read')
  list(@Req() req: RequestWithOrganization, @Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string, @Query('stage') stage?: string, @Query('designer') designer?: string) {
    return this.service.list(orgId(req), { page: Number(page) || 1, limit: Number(limit) || 20, search, stage, designer, callerUserId: req.user?.id });
  }

  // Designer dashboard (CIEL 09-01): own stats for pure Designers, all
  // designers for management.
  @Get('dashboard')
  @Permissions('projects:read')
  dashboard(@Req() req: RequestWithOrganization) {
    return this.service.idDashboard(orgId(req), req.user?.id);
  }

  // Lead → Project → Quotation (CIEL 09-01): create a project from an
  // assigned lead, a referral, or the designer's own client — before any
  // quotation exists.
  @Post()
  @Permissions('projects:create')
  create(@Body() body: any, @Req() req: RequestWithOrganization) {
    return this.service.createIdProject(orgId(req), body || {});
  }
}

/**
 * Interior-design project costing: the live "Costing Summary" (costs ledger,
 * progressive payments, contract, P&L, schedule). Mounted under /projects/* —
 * every route here has ≥2 path segments after /projects so it never collides
 * with ProjectsController's single-segment `:id` routes.
 */
@ApiTags('project-costing')
@ApiBearerAuth()
@Controller('projects')
@UseGuards(ClerkAuthGuard)
export class ProjectCostingController {
  constructor(private readonly service: ProjectCostingService) {}

  @Get(':id/costing')
  @Permissions('projects:read')
  summary(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.summary(id, orgId(req));
  }

  // Variation Orders — one main quotation per project; changes after signing
  // are VO documents (CIEL 09-01).
  @Post(':id/vo')
  @Permissions('projects:update')
  createVo(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.createVo(id, orgId(req));
  }

  @Post('vo/:docId/confirm')
  @Permissions('projects:update')
  confirmVo(@Param('docId') docId: string, @Req() req: RequestWithOrganization) {
    return this.service.confirmVo(docId, orgId(req));
  }

  @Patch(':id/id-fields')
  @Permissions('projects:update')
  updateFields(@Param('id') id: string, @Body() body: any, @Req() req: RequestWithOrganization) {
    return this.service.updateProjectFields(id, orgId(req), body || {});
  }

  // costs
  @Post(':id/costs')
  @Permissions('projects:update')
  addCost(@Param('id') id: string, @Body() body: any, @Req() req: RequestWithOrganization) {
    return this.service.addCost(id, orgId(req), body, actorName(req));
  }

  @Post(':id/costs/extract')
  @Permissions('projects:update')
  extractCost(@Param('id') id: string, @Body() body: { file: string; filename?: string }, @Req() req: RequestWithOrganization) {
    return this.service.extractCost(id, orgId(req), body?.file, body?.filename);
  }

  @Patch('costs/:costId')
  @Permissions('projects:update')
  updateCost(@Param('costId') costId: string, @Body() body: any, @Req() req: RequestWithOrganization) {
    return this.service.updateCost(costId, orgId(req), body || {});
  }

  @Delete('costs/:costId')
  @Permissions('projects:update')
  removeCost(@Param('costId') costId: string, @Req() req: RequestWithOrganization) {
    return this.service.removeCost(costId, orgId(req));
  }

  // schedule (weekly calendar)
  @Get(':id/schedule')
  @Permissions('projects:read')
  schedule(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.getSchedule(id, orgId(req));
  }

  @Get(':id/schedule/html')
  @Permissions('projects:read')
  scheduleHtml(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.scheduleHtml(id, orgId(req));
  }

  @Post(':id/schedule')
  @Permissions('projects:update')
  addSchedule(@Param('id') id: string, @Body() body: { items: any[] }, @Req() req: RequestWithOrganization) {
    return this.service.addScheduleItems(id, orgId(req), body?.items || []);
  }

  @Post(':id/schedule/share-link')
  @Permissions('projects:update')
  scheduleLink(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.createScheduleLink(id, orgId(req));
  }

  @Post(':id/schedule/share-link/revoke')
  @Permissions('projects:update')
  revokeScheduleLink(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.revokeScheduleLink(id, orgId(req));
  }

  @Post(':id/schedule/shift')
  @Permissions('projects:update')
  shiftSchedule(@Param('id') id: string, @Body() body: { days: number; fromDate?: string }, @Req() req: RequestWithOrganization) {
    return this.service.shiftSchedule(id, orgId(req), body?.days, body?.fromDate);
  }

  @Patch('schedule/:itemId')
  @Permissions('projects:update')
  updateSchedule(@Param('itemId') itemId: string, @Body() body: any, @Req() req: RequestWithOrganization) {
    return this.service.updateScheduleItem(itemId, orgId(req), body || {});
  }

  @Delete('schedule/:itemId')
  @Permissions('projects:update')
  removeSchedule(@Param('itemId') itemId: string, @Req() req: RequestWithOrganization) {
    return this.service.removeScheduleItem(itemId, orgId(req));
  }

  // milestones / collections
  @Post(':id/milestones')
  @Permissions('projects:update')
  addMilestone(@Param('id') id: string, @Body() body: any, @Req() req: RequestWithOrganization) {
    return this.service.addMilestone(id, orgId(req), body || {});
  }

  @Patch(':id/deposit-mode')
  @Permissions('projects:update')
  depositMode(@Param('id') id: string, @Body() body: { mode: 'engagement' | 'percent'; engagementFee?: number; pct?: number }, @Req() req: RequestWithOrganization) {
    return this.service.setDepositMode(id, orgId(req), body);
  }

  @Post('milestones/:milestoneId/invoice')
  @Permissions('documents:create-basic')
  milestoneInvoice(@Param('milestoneId') milestoneId: string, @Req() req: RequestWithOrganization) {
    return this.service.createMilestoneInvoice(milestoneId, orgId(req), actorName(req));
  }

  @Post(':id/milestones/recalc')
  @Permissions('projects:update')
  recalc(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.recalcMilestones(id, orgId(req));
  }

  @Patch('milestones/:milestoneId')
  @Permissions('projects:update')
  updateMilestone(@Param('milestoneId') milestoneId: string, @Body() body: any, @Req() req: RequestWithOrganization) {
    return this.service.updateMilestone(milestoneId, orgId(req), body || {});
  }

  @Delete('milestones/:milestoneId')
  @Permissions('projects:update')
  removeMilestone(@Param('milestoneId') milestoneId: string, @Req() req: RequestWithOrganization) {
    return this.service.removeMilestone(milestoneId, orgId(req));
  }
}
