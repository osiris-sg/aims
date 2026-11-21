import { Body, Controller, Get, Header, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { Field, FieldAreaGuard, FieldRoute } from '../common/field-area.guard';
import { fieldAudit } from '../common/field-audit';
import { FieldCtx } from '../common/field-context.service';
import { FieldReportsService } from './reports.service';

/** Field > Overview, Reports, Rules, Terms, Audit (FIELD_PLAN.md phase 7; area flag enableFieldReports + enableFieldModule). */
@ApiTags('field')
@ApiBearerAuth()
@Controller('field/reports')
@UseGuards(ClerkAuthGuard, FieldAreaGuard)
export class FieldReportsController {
  constructor(private readonly svc: FieldReportsService) {}

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('reports', 'view')
  overview(@Field() ctx: FieldCtx) {
    return this.svc.overview(ctx);
  }

  @Get('attendance')
  @FieldRoute('reports', 'view')
  attendance(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.attendance(ctx, q);
  }

  @Get('summary')
  @FieldRoute('reports', 'view')
  summary(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.summary(ctx, q);
  }

  @Get('fraud')
  @FieldRoute('reports', 'view')
  fraud(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.fraud(ctx, q);
  }

  @Get('rules')
  @FieldRoute('reports', 'view')
  rules(@Field() ctx: FieldCtx) {
    return this.svc.rules(ctx);
  }

  @Put('rules/overtime')
  @FieldRoute('reports', 'view')
  async overtime(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.setOvertime(ctx, body);
    fieldAudit(req, 'OT_RULE_SET', { entity: 'OvertimeRule', entityId: out.rule.id, before: out.before, after: out.rule });
    return { rule: out.rule };
  }

  @Put('rules/breaks')
  @FieldRoute('reports', 'view')
  async breaks(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.setBreaks(ctx, body);
    fieldAudit(req, 'BREAK_RULE_SET', { entity: 'BreakRule', entityId: out.rule.id, before: out.before, after: out.rule });
    return { rule: out.rule };
  }

  @Put('rules/punch')
  @FieldRoute('reports', 'view')
  async punch(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.setPunchRules(ctx, body);
    fieldAudit(req, 'PUNCH_RULE_SET', { entity: 'Company', before: out.before, after: body });
    return { punch: out.punch };
  }

  @Get('terms')
  @FieldRoute('reports', 'view')
  terms(@Field() ctx: FieldCtx) {
    return this.svc.terms(ctx);
  }

  @Put('terms')
  @FieldRoute('reports', 'view')
  async setTerms(@Field() ctx: FieldCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.setTerms(ctx, body);
    fieldAudit(req, 'TERMS_UPDATE', { entity: 'Company', after: out });
    return out;
  }

  @Get('audit')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('reports', 'view')
  audit(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.audit(ctx, q);
  }
}
