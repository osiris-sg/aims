import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { Field, FieldAreaGuard, FieldRoute } from '../common/field-area.guard';
import { fieldAudit } from '../common/field-audit';
import { FieldCtx } from '../common/field-context.service';
import { FieldLeaveService } from './leave.service';

/** Field > Leave (FIELD_PLAN.md phase 5; area flag enableFieldLeave + enableFieldModule). */
@ApiTags('field')
@ApiBearerAuth()
@Controller('field/leave')
@UseGuards(ClerkAuthGuard, FieldAreaGuard)
export class FieldLeaveController {
  constructor(private readonly svc: FieldLeaveService) {}

  @Get('types')
  @FieldRoute('leave', 'view')
  types(@Field() ctx: FieldCtx, @Query('all') all?: string) {
    return this.svc.types(ctx, all);
  }

  @Post('types')
  @FieldRoute('leave', 'approve')
  async createType(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.createType(ctx, body);
    fieldAudit(req, 'LEAVE_TYPE_CREATE', { entity: 'LeaveType', entityId: out.type.id });
    return out;
  }

  @Patch('types/:id')
  @FieldRoute('leave', 'approve')
  async updateType(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.updateType(ctx, id, body);
    fieldAudit(req, 'LEAVE_TYPE_UPDATE', { entity: 'LeaveType', entityId: id, before: out.before, after: out.type });
    return { type: out.type };
  }

  @Delete('types/:id')
  @FieldRoute('leave', 'approve')
  async deleteType(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const { action, before, ...out } = await this.svc.deleteType(ctx, id);
    fieldAudit(req, action, { entity: 'LeaveType', entityId: id, before });
    return out;
  }

  @Post('types/:id/restore')
  @FieldRoute('leave', 'approve')
  async restoreType(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.restoreType(ctx, id);
    fieldAudit(req, 'LEAVE_TYPE_RESTORE', { entity: 'LeaveType', entityId: id });
    return out;
  }

  @Get('balances')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('leave', 'view')
  balances(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.balances(ctx, q);
  }

  @Put('entitlements/:workerId')
  @FieldRoute('leave', 'approve')
  async entitlements(@Field() ctx: FieldCtx, @Param('workerId') workerId: string, @Body() body: any, @Req() req: any) {
    const { before, ...out } = await this.svc.setEntitlements(ctx, workerId, body);
    fieldAudit(req, 'LEAVE_ENTITLEMENT_SET', { entity: 'Worker', entityId: workerId, before, after: body?.entitlements });
    return out;
  }

  @Get('requests')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('leave', 'view')
  requests(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.requests(ctx, q);
  }

  @Post('requests/record')
  @FieldRoute('leave', 'approve')
  async record(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.record(ctx, body);
    fieldAudit(req, 'LEAVE_RECORDED', { entity: 'LeaveRequest', entityId: out.request.id });
    return out;
  }

  @Post('requests/:id/approve')
  @FieldRoute('leave', 'approve')
  async approve(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.decide(ctx, id, 'APPROVED');
    fieldAudit(req, 'LEAVE_APPROVED', { entity: 'LeaveRequest', entityId: id, after: { status: 'APPROVED', overBy: out.overBy } });
    return out;
  }

  @Post('requests/:id/reject')
  @FieldRoute('leave', 'approve')
  async reject(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.decide(ctx, id, 'REJECTED');
    fieldAudit(req, 'LEAVE_REJECTED', { entity: 'LeaveRequest', entityId: id });
    return out;
  }

  @Post('requests/:id/cancel')
  @FieldRoute('leave', 'approve')
  async cancel(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.cancel(ctx, id);
    fieldAudit(req, 'LEAVE_CANCELLED_BY_ADMIN', { entity: 'LeaveRequest', entityId: id, before: out.before, after: { status: 'CANCELLED' } });
    return { request: out.request };
  }

  @Get('calendar')
  @FieldRoute('leave', 'view')
  calendar(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.calendar(ctx, q);
  }
}
