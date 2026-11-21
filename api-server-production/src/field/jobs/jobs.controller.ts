import { Body, Controller, Delete, ForbiddenException, Get, Header, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { Field, FieldAreaGuard, FieldRoute } from '../common/field-area.guard';
import { fieldAudit } from '../common/field-audit';
import { FieldCtx } from '../common/field-context.service';
import { FieldJobsService } from './jobs.service';
import { FieldSchedulesService } from './schedules.service';

/**
 * Field > Plan and Working hours (FIELD_PLAN.md phase 2; area flag enableFieldJobs + enableFieldModule).
 * Activity Log: the interceptor's row per request with the ported SiteClock audit action.
 */
@ApiTags('field')
@ApiBearerAuth()
@Controller('field/jobs')
@UseGuards(ClerkAuthGuard, FieldAreaGuard)
export class FieldJobsController {
  constructor(private readonly jobs: FieldJobsService, private readonly schedules: FieldSchedulesService) {}

  @Get('day')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('jobs', 'view')
  day(@Field() ctx: FieldCtx, @Query('date') date: string) {
    return this.jobs.day(ctx, date);
  }

  @Get('attendance')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('jobs', 'view')
  attendance(@Field() ctx: FieldCtx, @Query('date') date: string) {
    return this.jobs.attendance(ctx, date);
  }

  @Put('settings')
  @FieldRoute('jobs', 'edit')
  async save(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.jobs.saveJob(ctx, body);
    fieldAudit(req, out.created ? 'JOB_CREATE' : 'JOB_UPDATE', { entity: 'Job', entityId: out.job.id });
    return out;
  }

  @Post(':id/qr')
  @FieldRoute('jobs', 'edit')
  async qr(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.jobs.rotateQr(ctx, id);
    fieldAudit(req, 'JOB_QR_ROTATE', { entity: 'Job', entityId: id });
    return out;
  }

  @Post('notify')
  @FieldRoute('jobs', 'edit')
  async notify(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.jobs.notify(ctx, body);
    fieldAudit(req, 'JOBS_NOTIFY', { entity: 'Job', after: { date: body?.date, ...out } });
    return out;
  }

  @Put('notes/:date')
  @FieldRoute('jobs', 'edit')
  async note(@Field() ctx: FieldCtx, @Param('date') date: string, @Body() body: any, @Req() req: any) {
    const out = await this.jobs.setDayNote(ctx, date, body);
    fieldAudit(req, 'DAY_NOTE_SET', { entity: 'DayNote', entityId: date });
    return out;
  }

  @Post('copy-day')
  @FieldRoute('jobs', 'edit')
  async copyDay(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.jobs.copyDay(ctx, body?.fromDate, body?.toDate);
    fieldAudit(req, 'ROSTER_COPY', { entity: 'Roster', after: { fromDate: body?.fromDate, toDate: body?.toDate, ...out } });
    return out;
  }

  @Post('copy-week')
  @FieldRoute('jobs', 'edit')
  async copyWeek(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.jobs.copyWeek(ctx, body?.fromMonday, body?.toMonday);
    fieldAudit(req, 'ROSTER_COPY_WEEK', { entity: 'Roster', after: { fromMonday: body?.fromMonday, toMonday: body?.toMonday, ...out } });
    return out;
  }

  @Get('presets')
  @FieldRoute('jobs', 'view')
  presets(@Field() ctx: FieldCtx) {
    return this.jobs.presets(ctx);
  }

  @Put('presets')
  @FieldRoute('jobs', 'edit')
  async savePreset(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.jobs.savePreset(ctx, body);
    fieldAudit(req, 'MANNING_PRESET_SET', { entity: 'ManningPreset', entityId: out.preset.id });
    return out;
  }

  @Delete('presets/:id')
  @FieldRoute('jobs', 'edit')
  deletePreset(@Field() ctx: FieldCtx, @Param('id') id: string) {
    return this.jobs.deletePreset(ctx, id);
  }

  // Working hours
  @Get('templates')
  @FieldRoute('jobs', 'view')
  templates(@Field() ctx: FieldCtx) {
    return this.schedules.templates(ctx);
  }

  @Post('templates')
  @FieldRoute('jobs', 'edit')
  async createTemplate(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.schedules.createTemplate(ctx, body);
    fieldAudit(req, 'TEMPLATE_CREATE', { entity: 'ShiftTemplate', entityId: out.template.id });
    return out;
  }

  @Patch('templates/:id')
  @FieldRoute('jobs', 'edit')
  async updateTemplate(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.schedules.updateTemplate(ctx, id, body);
    fieldAudit(req, 'TEMPLATE_UPDATE', { entity: 'ShiftTemplate', entityId: id });
    return { template: out.template };
  }

  @Delete('templates/:id')
  @FieldRoute('jobs', 'edit')
  async deleteTemplate(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.schedules.deleteTemplate(ctx, id);
    fieldAudit(req, 'TEMPLATE_DELETE', { entity: 'ShiftTemplate', entityId: id, before: out.before });
    return { deleted: true };
  }

  @Get('assignments')
  @FieldRoute('jobs', 'view')
  assignments(@Field() ctx: FieldCtx) {
    return this.schedules.assignments(ctx);
  }

  @Post('assignments')
  @FieldRoute('jobs', 'view')
  async assign(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    if (!ctx.access.scoped.jobs && ctx.access.levels.jobs === 'view') throw new ForbiddenException('You can view working hours only');
    const out = await this.schedules.assign(ctx, body);
    fieldAudit(req, 'SHIFT_ASSIGN', { entity: 'ShiftAssignment', entityId: out.assignment.id });
    return out;
  }

  @Delete('assignments/:id')
  @FieldRoute('jobs', 'view')
  async unassign(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    if (!ctx.access.scoped.jobs && ctx.access.levels.jobs === 'view') throw new ForbiddenException('You can view working hours only');
    const out = await this.schedules.unassign(ctx, id);
    fieldAudit(req, 'SHIFT_UNASSIGN', { entity: 'ShiftAssignment', entityId: id, before: out.before });
    return { ok: true };
  }

  @Get('exceptions')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('jobs', 'view')
  exceptions(@Field() ctx: FieldCtx, @Query('siteId') siteId: string, @Query('date') date: string) {
    return this.schedules.exceptions(ctx, siteId, date);
  }
}
