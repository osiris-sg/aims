import { Body, Controller, Delete, ForbiddenException, Get, Header, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { Field, FieldAreaGuard, FieldRoute } from '../common/field-area.guard';
import { fieldAudit } from '../common/field-audit';
import { FieldCtx } from '../common/field-context.service';
import { FieldPeopleService } from './people.service';

/**
 * Field > Workers, Teams, Sites, Trades, Invites, Photos, Linked orgs (FIELD_PLAN.md phase 1).
 * Area flag enableFieldPeople (+ enableFieldModule): off = every route 404s (FieldAreaGuard).
 * Activity Log: the interceptor's row per request, with the ported SiteClock audit action in its result.
 */
@ApiTags('field')
@ApiBearerAuth()
@Controller('field/people')
@UseGuards(ClerkAuthGuard, FieldAreaGuard)
export class FieldPeopleController {
  constructor(private readonly svc: FieldPeopleService) {}

  // Workers
  @Get('workers')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('people', 'view')
  workers(@Field() ctx: FieldCtx) {
    return this.svc.listWorkers(ctx);
  }

  @Get('directory')
  @FieldRoute('people', 'view')
  directory(@Field() ctx: FieldCtx) {
    return this.svc.directory(ctx);
  }

  @Post('workers')
  @FieldRoute('people', 'edit')
  async createWorker(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.createWorker(ctx, body);
    fieldAudit(req, 'WORKER_CREATE', { entity: 'Worker', entityId: out.worker.id });
    return out;
  }

  @Patch('workers/:id')
  @FieldRoute('people', 'edit')
  async updateWorker(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.updateWorker(ctx, id, body);
    fieldAudit(req, 'WORKER_UPDATE', { entity: 'Worker', entityId: id });
    return { worker: out.worker };
  }

  @Post('workers/:id/change-phone')
  @FieldRoute('people', 'edit')
  async changePhone(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.changePhone(ctx, id, body);
    fieldAudit(req, 'WORKER_PHONE_CHANGE', { entity: 'Worker', entityId: id, before: out.before, after: out.after });
    return { worker: out.worker };
  }

  @Post('workers/:id/reset-device')
  @FieldRoute('people', 'edit')
  async resetDevice(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.resetDevice(ctx, id);
    fieldAudit(req, 'DEVICE_RESET', { entity: 'Worker', entityId: id, before: out.before, after: { deviceId: null } });
    return { ok: true };
  }

  @Post('workers/:id/request-verification')
  @FieldRoute('people', 'view')
  async requestVerification(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.requestVerification(ctx, id);
    fieldAudit(req, 'VERIFY_REQUEST', { entity: 'Worker', entityId: id });
    return out;
  }

  @Put('workers/:id/trades')
  @FieldRoute('people', 'edit')
  setTrades(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any) {
    return this.svc.setTrades(ctx, id, body);
  }

  // Teams
  @Get('teams')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('people', 'view')
  teams(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.listTeams(ctx, q);
  }

  @Get('teams/:id/history')
  @FieldRoute('people', 'view')
  history(@Field() ctx: FieldCtx, @Param('id') id: string) {
    return this.svc.teamHistory(ctx, id);
  }

  @Post('teams')
  @FieldRoute('people', 'edit')
  async createTeam(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.createTeam(ctx, body);
    fieldAudit(req, 'TEAM_CREATE', { entity: 'Team', entityId: out.team.id, after: out.after });
    return { team: out.team };
  }

  @Put('teams/:id/supervisors')
  @FieldRoute('people', 'edit')
  async setSupervisors(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.setSupervisors(ctx, id, body);
    fieldAudit(req, 'TEAM_SUPERVISORS', { entity: 'Team', entityId: id, before: { workerIds: out.before }, after: { workerIds: out.supervisorIds } });
    return { supervisorIds: out.supervisorIds };
  }

  @Patch('teams/:id')
  @FieldRoute('people', 'edit')
  async updateTeam(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.updateTeam(ctx, id, body);
    fieldAudit(req, 'TEAM_UPDATE', { entity: 'Team', entityId: id, before: { name: out.before.name, active: out.before.active }, after: { name: out.team.name, active: out.team.active } });
    return { team: out.team };
  }

  @Post('teams/:id/members')
  @FieldRoute('people', 'edit')
  async addMembers(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.addTeamMembers(ctx, id, body);
    fieldAudit(req, 'TEAM_MEMBERS_ADD', { entity: 'Team', entityId: id, after: { workerIds: body?.workerIds, startDate: out.startDate } });
    return out;
  }

  @Post('teams/:id/members/:workerId/remove')
  @FieldRoute('people', 'edit')
  async removeMember(@Field() ctx: FieldCtx, @Param('id') id: string, @Param('workerId') workerId: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.removeTeamMember(ctx, id, workerId, body);
    fieldAudit(req, 'TEAM_MEMBER_REMOVE', { entity: 'Team', entityId: id, before: out.before, after: { workerId, lastDay: out.lastDay, discarded: out.discarded } });
    return { ok: true, lastDay: out.lastDay, discarded: out.discarded };
  }

  @Patch('stints/:id')
  @FieldRoute('people', 'edit')
  async editStint(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.editStint(ctx, id, body);
    fieldAudit(req, 'TEAM_MEMBERSHIP_EDIT', { entity: 'TeamMembership', entityId: id, before: out.before, after: out.stint });
    return { stint: out.stint };
  }

  @Delete('stints/:id')
  @FieldRoute('people', 'edit')
  async deleteStint(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.deleteStint(ctx, id);
    fieldAudit(req, 'TEAM_MEMBERSHIP_DELETE', { entity: 'TeamMembership', entityId: id, before: out.before });
    return { ok: true };
  }

  // Sites
  @Get('sites')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('people', 'view')
  sites(@Field() ctx: FieldCtx, @Query('kind') kind?: string) {
    return this.svc.listSites(ctx, { kind });
  }

  @Get('sites/geocode')
  @FieldRoute('people', 'view')
  geocode(@Query('q') q: string) {
    return this.svc.geocode(q);
  }

  @Post('sites')
  @FieldRoute('people', 'edit')
  async createSite(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.createSite(ctx, body);
    fieldAudit(req, 'SITE_CREATE', { entity: 'Site', entityId: out.site.id, after: out.site });
    return out;
  }

  @Patch('sites/:id')
  @FieldRoute('people', 'edit')
  async updateSite(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.updateSite(ctx, id, body);
    fieldAudit(req, 'SITE_UPDATE', { entity: 'Site', entityId: id, before: out.before, after: out.site });
    return { site: out.site };
  }

  @Put('sites/:id/assignments')
  @FieldRoute('people', 'edit')
  async setAssignments(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.setSiteAssignments(ctx, id, body);
    fieldAudit(req, 'SITE_ASSIGNMENTS_SET', { entity: 'Site', entityId: id, before: out.before, after: body?.assignments });
    return { ok: true };
  }

  // Trades
  @Get('trades')
  @FieldRoute('people', 'view')
  trades(@Field() ctx: FieldCtx) {
    return this.svc.listTrades(ctx);
  }

  @Post('trades')
  @FieldRoute('people', 'edit')
  async createTrade(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.createTrade(ctx, body);
    fieldAudit(req, 'TRADE_CREATE', { entity: 'Trade', entityId: out.trade.id });
    return out;
  }

  @Delete('trades/:id')
  @FieldRoute('people', 'edit')
  async deleteTrade(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.deleteTrade(ctx, id);
    fieldAudit(req, 'TRADE_DELETE', { entity: 'Trade', entityId: id, before: out.before });
    return { ok: true };
  }

  // Invites + join requests
  @Get('invites')
  @FieldRoute('people', 'view')
  invites(@Field() ctx: FieldCtx) {
    return this.svc.listInvites(ctx);
  }

  @Post('invites')
  @FieldRoute('people', 'edit')
  async createInvite(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.createInvite(ctx, body);
    fieldAudit(req, 'INVITE_CREATE', { entity: 'InviteLink', entityId: out.invite.id });
    return out;
  }

  @Patch('invites/:id')
  @FieldRoute('people', 'edit')
  async updateInvite(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.updateInvite(ctx, id, body);
    fieldAudit(req, 'INVITE_UPDATE', { entity: 'InviteLink', entityId: id });
    return { invite: out.invite };
  }

  @Delete('invites/:id')
  @FieldRoute('people', 'edit')
  async deleteInvite(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.deleteInvite(ctx, id);
    fieldAudit(req, 'INVITE_DELETE', { entity: 'InviteLink', entityId: id, before: out.before });
    return { ok: true };
  }

  @Get('registrations')
  @FieldRoute('people', 'view')
  registrations(@Field() ctx: FieldCtx, @Query('status') status?: string) {
    return this.svc.listRegistrations(ctx, status);
  }

  @Post('registrations/:id/approve')
  @FieldRoute('people', 'edit')
  async approveRegistration(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.approveRegistration(ctx, id);
    fieldAudit(req, 'REGISTRATION_APPROVE', { entity: 'Worker', entityId: out.worker.id, after: out.after });
    return { worker: out.worker };
  }

  @Post('registrations/:id/reject')
  @FieldRoute('people', 'edit')
  async rejectRegistration(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.rejectRegistration(ctx, id);
    fieldAudit(req, 'REGISTRATION_REJECT', { entity: 'RegistrationRequest', entityId: id });
    return out;
  }

  // Photos on record
  @Get('photo-updates')
  @FieldRoute('people', 'view')
  photoUpdates(@Field() ctx: FieldCtx) {
    return this.svc.listPhotoUpdates(ctx);
  }

  @Post('photo-updates/request/:workerId')
  @FieldRoute('people', 'edit')
  async requestPhoto(@Field() ctx: FieldCtx, @Param('workerId') workerId: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.requestPhoto(ctx, workerId, body);
    fieldAudit(req, 'PHOTO_REQUEST', { entity: 'Worker', entityId: workerId });
    return out;
  }

  @Delete('photo-updates/request/:workerId')
  @FieldRoute('people', 'edit')
  async cancelPhotoRequest(@Field() ctx: FieldCtx, @Param('workerId') workerId: string, @Req() req: any) {
    const out = await this.svc.cancelPhotoRequest(ctx, workerId);
    fieldAudit(req, 'PHOTO_REQUEST_CANCEL', { entity: 'Worker', entityId: workerId });
    return out;
  }

  @Post('photo-updates/:id/approve')
  @FieldRoute('people', 'edit')
  async approvePhoto(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.approvePhoto(ctx, id);
    fieldAudit(req, 'PHOTO_APPROVE', { entity: 'PhotoUpdate', entityId: id });
    return out;
  }

  @Post('photo-updates/:id/reject')
  @FieldRoute('people', 'edit')
  async rejectPhoto(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.rejectPhoto(ctx, id, body);
    fieldAudit(req, 'PHOTO_REJECT', { entity: 'PhotoUpdate', entityId: id });
    return out;
  }

  // Linked orgs + access
  @Get('links')
  @FieldRoute('people', 'view')
  links(@Field() ctx: FieldCtx) {
    return this.svc.links(ctx);
  }

  @Get('shared-workers')
  @FieldRoute('people', 'view')
  sharedWorkers(@Field() ctx: FieldCtx) {
    return this.svc.sharedWorkers(ctx);
  }

  @Post('links/:orgId')
  @FieldRoute('people', 'edit')
  async link(@Field() ctx: FieldCtx, @Param('orgId') orgId: string, @Req() req: any) {
    const out = await this.svc.link(ctx, orgId, req.isOsirisAdmin === true);
    fieldAudit(req, 'COMPANY_LINK', { entity: 'Organization', entityId: orgId });
    return out;
  }

  @Delete('links/:orgId')
  @FieldRoute('people', 'edit')
  async unlink(@Field() ctx: FieldCtx, @Param('orgId') orgId: string, @Req() req: any) {
    const out = await this.svc.unlink(ctx, orgId, req.isOsirisAdmin === true);
    fieldAudit(req, 'COMPANY_UNLINK', { entity: 'Organization', entityId: orgId });
    return out;
  }

  @Put('share-workers')
  @FieldRoute('people', 'edit')
  async shareWorkers(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    if (!ctx.access.admin) throw new ForbiddenException('Only admins change sharing');
    const out = await this.svc.setShareWorkers(ctx, body);
    fieldAudit(req, 'PUNCH_RULE_SET', { entity: 'Company', before: { shareWorkers: out.before }, after: { shareWorkers: out.shareWorkers } });
    return { shareWorkers: out.shareWorkers };
  }
}
