import { Body, Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { orgIdOf, TradeRequest } from './shipments.request';
import { UpdateTradeSettingsDto } from './dto/trade-settings.dto';
import { TradeConfigService } from './trade-config.service';

@Controller('trade-config')
@UseGuards(ClerkAuthGuard)
export class TradeConfigController {
  constructor(private readonly config: TradeConfigService) {}

  @Get('doc-types')
  @Permissions('shipments:read')
  docTypes(@Req() req: TradeRequest) {
    return this.config.listDocTypes(orgIdOf(req));
  }

  @Get('step-templates')
  @Permissions('shipments:read')
  stepTemplates(@Query('scope') scope: string | undefined, @Req() req: TradeRequest) {
    return this.config.listStepTemplates(orgIdOf(req), scope);
  }

  /** Org trade defaults (B/L instruction texts used to prefill new contracts). */
  @Get('settings')
  @Permissions('shipments:read')
  settings(@Req() req: TradeRequest) {
    return this.config.getSettings(orgIdOf(req));
  }

  @Patch('settings')
  @Permissions('shipments:update')
  updateSettings(@Body() dto: UpdateTradeSettingsDto, @Req() req: TradeRequest) {
    return this.config.updateSettings(orgIdOf(req), dto);
  }
}
