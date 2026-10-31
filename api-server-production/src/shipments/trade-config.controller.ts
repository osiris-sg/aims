import { maskedSettings } from './clients-company';
import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { orgIdOf, TradeRequest } from './shipments.request';
import { UpdateTradeSettingsDto } from './dto/trade-settings.dto';
import { TradeConfigService } from './trade-config.service';
import { LmeFeedService } from './lme-feed.service';

@RequiresModule('SHIPMENTS')
@Controller('trade-config')
@UseGuards(ClerkAuthGuard)
export class TradeConfigController {
  constructor(
    private readonly config: TradeConfigService,
    private readonly lme: LmeFeedService,
  ) {}

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
  async settings(@Req() req: TradeRequest) {
    // Round AY: bank account numbers on the profiles are shown masked.
    return maskedSettings(await this.config.getSettings(orgIdOf(req)));
  }

  @Patch('settings')
  @Permissions('shipments:update')
  async updateSettings(@Body() dto: UpdateTradeSettingsDto, @Req() req: TradeRequest) {
    return maskedSettings(await this.config.updateSettings(orgIdOf(req), dto));
  }

  /** Round AK — Settings → Shipping → LME: source, last fetch, the month's daily values, monthly averages vs the table. */
  @Get('lme')
  @Permissions('shipments:read')
  async lmeStatus(@Query('month') month: string | undefined, @Req() req: TradeRequest) {
    const org = orgIdOf(req);
    return { ...(await this.lme.status(org, month)), switchedOn: (await this.lme.switchedOnOrgs()).includes(org) };
  }

  /** "Fetch now": with the org flag enableLmeFeed on it applies (empty months / the feed's own month only); off = preview. */
  @Post('lme/fetch')
  @Permissions('shipments:update')
  async lmeFetch(@Req() req: TradeRequest) {
    const org = orgIdOf(req);
    const on = (await this.lme.switchedOnOrgs()).includes(org);
    const r = await this.lme.run('MANUAL', { apply: on, onlyOrg: org });
    return { ...r, orgs: r.orgs.filter((o) => o.organizationId === org), preview: !on };
  }
}
