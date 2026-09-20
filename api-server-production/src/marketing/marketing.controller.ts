import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { MarketingService } from './marketing.service';

interface RequestWithOrganization {
  userOrganization?: { id: string };
  user?: { id?: string };
}
function orgOf(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

// Rides on the whatsapp:* permissions — this is the same Meta-integration
// surface (already granted to the management roles that should see ad spend);
// the service additionally 404s designer/junior tiers.
@ApiTags('marketing')
@ApiBearerAuth()
@Controller('marketing/ads')
@UseGuards(ClerkAuthGuard)
export class MarketingController {
  constructor(private readonly service: MarketingService) {}

  @Get('connection')
  @Permissions('whatsapp:read')
  connection(@Req() req: RequestWithOrganization) {
    return this.service.getConnection(orgOf(req), req.user?.id);
  }

  @Post('connect')
  @Permissions('whatsapp:manage')
  connect(@Req() req: RequestWithOrganization, @Body() body: { adAccountId?: string; accessToken?: string }) {
    return this.service.connect(orgOf(req), body || {}, req.user?.id);
  }

  @Post('disconnect')
  @Permissions('whatsapp:manage')
  disconnect(@Req() req: RequestWithOrganization) {
    return this.service.disconnect(orgOf(req), req.user?.id);
  }

  @Post('sync')
  @Permissions('whatsapp:manage')
  sync(@Req() req: RequestWithOrganization, @Body() body: { days?: number }) {
    return this.service.syncNow(orgOf(req), body?.days, req.user?.id);
  }

  @Get('overview')
  @Permissions('whatsapp:read')
  overview(@Req() req: RequestWithOrganization, @Query('months') months?: string) {
    return this.service.overview(orgOf(req), months ? Number(months) : undefined, req.user?.id);
  }
}
