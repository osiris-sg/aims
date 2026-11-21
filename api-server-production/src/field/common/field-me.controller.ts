import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { FIELD_AREAS, fieldAreaOn } from './field-flags';
import { Field, FieldAreaGuard, FieldRoute } from './field-area.guard';
import { FieldCtx } from './field-context.service';

/** GET /field/me: the areas that are on and the caller's access (the portal builds the Field nav from it). 404 when the module is off. */
@ApiTags('field')
@ApiBearerAuth()
@Controller('field')
@UseGuards(ClerkAuthGuard, FieldAreaGuard)
export class FieldMeController {
  @Get('me')
  @Header('Cache-Control', 'no-store')
  @FieldRoute('any', 'view')
  me(@Field() ctx: FieldCtx) {
    return {
      areas: FIELD_AREAS.filter((a) => fieldAreaOn(ctx.features, a)),
      access: ctx.access,
      workerId: ctx.workerId,
      timezone: ctx.timezone,
      supervisedSiteIds: ctx.supervisedSiteIds,
      supervisedWorkerIds: ctx.supervisedWorkerIds,
    };
  }
}
