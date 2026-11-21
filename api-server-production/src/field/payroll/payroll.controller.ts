import { Body, Controller, Delete, Get, Header, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { Field, FieldAreaGuard, FieldRoute } from '../common/field-area.guard';
import { fieldAudit } from '../common/field-audit';
import { FieldCtx } from '../common/field-context.service';
import { FieldPayrollService } from './payroll.service';

/** Field > Payroll (FIELD_PLAN.md phase 6; area flag enableFieldPayroll + enableFieldModule). Supervisors never see pay. */
@ApiTags('field')
@ApiBearerAuth()
@Controller('field/payroll')
@UseGuards(ClerkAuthGuard, FieldAreaGuard)
export class FieldPayrollController {
  constructor(private readonly svc: FieldPayrollService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @FieldRoute('payroll', 'view')
  month(@Field() ctx: FieldCtx, @Query('month') month: string) {
    return this.svc.month_(ctx, month);
  }

  @Get('export')
  @FieldRoute('payroll', 'view')
  exportRows(@Field() ctx: FieldCtx, @Query('month') month: string) {
    return this.svc.exportRows(ctx, month);
  }

  @Get('payslip/:workerId')
  @FieldRoute('payroll', 'view')
  payslip(@Field() ctx: FieldCtx, @Param('workerId') workerId: string, @Query('month') month: string) {
    return this.svc.payslip(ctx, workerId, month);
  }

  @Get('profiles/:workerId')
  @FieldRoute('payroll', 'view')
  profile(@Field() ctx: FieldCtx, @Param('workerId') workerId: string) {
    return this.svc.profile(ctx, workerId);
  }

  @Put('profiles/:workerId')
  @FieldRoute('payroll', 'edit')
  async setProfile(@Field() ctx: FieldCtx, @Param('workerId') workerId: string, @Body() body: any, @Req() req: any) {
    const { before, ...out } = await this.svc.setProfile(ctx, workerId, body);
    fieldAudit(req, 'PAY_PROFILE_SET', { entity: 'PayProfile', entityId: out.profile.id, before: before ?? undefined, after: out.profile });
    return out;
  }

  @Get('holidays')
  @FieldRoute('payroll', 'view')
  holidays(@Field() ctx: FieldCtx, @Query('year') year?: string) {
    return this.svc.holidays(ctx, year);
  }

  @Post('holidays')
  @FieldRoute('payroll', 'edit')
  async addHoliday(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.addHoliday(ctx, body);
    fieldAudit(req, 'HOLIDAY_SET', { entity: 'PublicHoliday', entityId: out.holiday.id });
    return out;
  }

  @Delete('holidays/:id')
  @FieldRoute('payroll', 'edit')
  async deleteHoliday(@Field() ctx: FieldCtx, @Param('id') id: string, @Req() req: any) {
    const out = await this.svc.deleteHoliday(ctx, id);
    fieldAudit(req, 'HOLIDAY_DELETE', { entity: 'PublicHoliday', entityId: id });
    return out;
  }
}
