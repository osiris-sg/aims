import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { Field, FieldAreaGuard, FieldRoute } from '../common/field-area.guard';
import { fieldAudit } from '../common/field-audit';
import { FieldCtx } from '../common/field-context.service';
import { FieldPunchesService } from './punches.service';

/** Field > Clock-ins (FIELD_PLAN.md phase 3; area flag enableFieldPunches + enableFieldModule). */
@ApiTags('field')
@ApiBearerAuth()
@Controller('field/punches')
@UseGuards(ClerkAuthGuard, FieldAreaGuard)
export class FieldPunchesController {
  constructor(private readonly svc: FieldPunchesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @FieldRoute('punches', 'view')
  list(@Field() ctx: FieldCtx, @Query() q: any) {
    return this.svc.list(ctx, q);
  }

  @Get('flagged')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('punches', 'view')
  flagged(@Field() ctx: FieldCtx) {
    return this.svc.flagged(ctx);
  }

  @Get('marked')
  @FieldRoute('punches', 'view')
  marked(@Field() ctx: FieldCtx) {
    return this.svc.marked(ctx);
  }

  @Get('face-log')
  @FieldRoute('punches', 'view')
  faceLog(@Field() ctx: FieldCtx) {
    return this.svc.faceLog(ctx);
  }

  @Get('live')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('punches', 'view')
  live(@Field() ctx: FieldCtx) {
    return this.svc.live(ctx);
  }

  @Get(':id/photo')
  @FieldRoute('punches', 'view')
  photo(@Field() ctx: FieldCtx, @Param('id') id: string) {
    return this.svc.photo(ctx, id);
  }

  @Post(':id/approve')
  @FieldRoute('punches', 'approve')
  async approve(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.approve(ctx, id, body);
    fieldAudit(req, 'PUNCH_APPROVE', { entity: 'Punch', entityId: id, before: out.before, after: { clockInAt: body?.clockInAt, serverTime: body?.punchAt, entryId: out.entry?.id ?? null, events: out.events.map((e) => e.action) } });
    return { punch: out.punch, entry: out.entry };
  }

  @Post(':id/reject')
  @FieldRoute('punches', 'approve')
  async reject(@Field() ctx: FieldCtx, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const out = await this.svc.reject(ctx, id, body);
    fieldAudit(req, 'PUNCH_REJECT', { entity: 'Punch', entityId: id });
    return out;
  }
}
