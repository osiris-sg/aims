import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { OrgRulesService } from './org-rules.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
  user?: { id?: string };
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

/** Settings → Business rules. Directors (master tier) only, enforced in the service. */
@ApiTags('org-rules')
@ApiBearerAuth()
@Controller('org-rules')
@UseGuards(ClerkAuthGuard)
export class OrgRulesController {
  constructor(private readonly service: OrgRulesService) {}

  @Get()
  @ApiOperation({ summary: 'Business rules for this org (Directors only): payment milestone ladder, engagement fee, commission/rebate/design-fee defaults. Returns {rules, defaults}.' })
  @Permissions('documents:read')
  get(@Req() req: RequestWithOrganization) {
    return this.service.getForEdit(orgId(req), req.user?.id);
  }

  @Get('quote-defaults')
  @ApiOperation({ summary: 'Quotation defaults for new quotes (any member): payment-terms lines, T&C clauses, design fee %, margin guideline/floor %.' })
  @Permissions('documents:read')
  quoteDefaults(@Req() req: RequestWithOrganization) {
    return this.service.quoteDefaults(orgId(req));
  }

  @Patch()
  @ApiOperation({ summary: 'Update business rules (Directors only). Body: partial {payments:{milestones[{label,pct,dueTrigger}],engagementFee,firstPaymentAltPct},commissionPct,rebatePct,designFeePct}. Milestone pcts must sum to 100. New rules seed NEW projects/quotes only.' })
  @Permissions('documents:read')
  update(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.update(orgId(req), req.user?.id, body || {});
  }
}
