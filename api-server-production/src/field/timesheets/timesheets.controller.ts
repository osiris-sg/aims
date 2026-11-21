import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { Field, FieldAreaGuard, FieldRoute } from '../common/field-area.guard';
import { fieldAudit } from '../common/field-audit';
import { FieldCtx } from '../common/field-context.service';
import { FieldTimesheetsService } from './timesheets.service';

/** Field > Timesheets (FIELD_PLAN.md phase 4; area flag enableFieldTimesheets + enableFieldModule). */
@ApiTags('field')
@ApiBearerAuth()
@Controller('field/timesheets')
@UseGuards(ClerkAuthGuard, FieldAreaGuard)
export class FieldTimesheetsController {
  constructor(private readonly svc: FieldTimesheetsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @FieldRoute('timesheets', 'view')
  list(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.list(ctx, q);
  }

  @Get('export')
  @FieldRoute('timesheets', 'view')
  exportRows(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.exportRows(ctx, q);
  }

  @Get('linked')
  @FieldRoute('timesheets', 'view')
  linked(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.linkedHours(ctx, q);
  }

  @Get('entries/:id')
  @FieldRoute('timesheets', 'view')
  detail(@Field() ctx: FieldCtx, @Param('id') id: string) {
    return this.svc.detail(ctx, id);
  }

  @Patch('entries/:id')
  @FieldRoute('timesheets', 'edit')
  async edit(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.edit(ctx, id, body);
    fieldAudit(req, 'ENTRY_EDIT', { entity: 'TimeEntry', entityId: id, before: out.before, after: { clockInAt: body?.clockInAt, clockOutAt: body?.clockOutAt, note: body?.note, nlb: body?.nlb } });
    return { entry: out.entry };
  }

  @Post('entries')
  @FieldRoute('timesheets', 'edit')
  async manual(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.manual(ctx, body);
    fieldAudit(req, 'ENTRY_MANUAL_CREATE', { entity: 'TimeEntry', entityId: out.entry.id });
    return out;
  }

  @Post('entries/:id/approve')
  @FieldRoute('timesheets', 'approve')
  async approve(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.decide(ctx, id, 'APPROVED');
    fieldAudit(req, 'ENTRY_APPROVED', { entity: 'TimeEntry', entityId: id, before: out.before, after: { status: 'APPROVED' } });
    return { entry: out.entry };
  }

  @Post('entries/:id/reject')
  @FieldRoute('timesheets', 'approve')
  async reject(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.decide(ctx, id, 'REJECTED');
    fieldAudit(req, 'ENTRY_REJECTED', { entity: 'TimeEntry', entityId: id, before: out.before, after: { status: 'REJECTED' } });
    return { entry: out.entry };
  }

  @Post('approve-bulk')
  @FieldRoute('timesheets', 'approve')
  async bulk(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.approveBulk(ctx, body);
    fieldAudit(req, 'ENTRY_APPROVED', { entity: 'TimeEntry', after: out.counts });
    return out;
  }

  @Post('entries/:id/reopen')
  @FieldRoute('timesheets', 'edit')
  async reopen(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.reopen(ctx, id);
    fieldAudit(req, 'ENTRY_REOPEN', { entity: 'TimeEntry', entityId: id, before: out.before, after: { status: 'OPEN' } });
    return { entry: out.entry };
  }

  @Delete('entries/:id')
  @FieldRoute('timesheets', 'edit')
  async remove(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.remove(ctx, id);
    fieldAudit(req, 'ENTRY_DELETE', { entity: 'TimeEntry', entityId: id, before: out.before });
    return { ok: true };
  }
}
