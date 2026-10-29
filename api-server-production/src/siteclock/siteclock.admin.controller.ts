import { Body, Controller, ForbiddenException, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { SiteClockLinkService } from './siteclock-link.service';

// Admin → organisation → SiteClock tab. OsirisAdmin only, same pattern as the
// API-keys tab; the org comes from the path. The key is write-only: reads
// return its last 4 characters.
interface AdminRequest extends Request {
  isOsirisAdmin?: boolean;
}

@ApiTags('admin siteclock')
@ApiBearerAuth()
@Controller('admin/organizations/:orgId/siteclock')
@UseGuards(ClerkAuthGuard)
export class SiteClockAdminController {
  constructor(private readonly link: SiteClockLinkService) {}

  private assertOsirisAdmin(req: AdminRequest) {
    if (!req.isOsirisAdmin) throw new ForbiddenException('Access denied. Only OsirisAdmin can manage the SiteClock link.');
  }

  @Get()
  @ApiOperation({ summary: "The org's SiteClock connection (no key, last 4 only)." })
  get(@Req() req: AdminRequest, @Param('orgId') orgId: string) {
    this.assertOsirisAdmin(req);
    return this.link.getConnection(orgId);
  }

  @Put()
  @ApiOperation({ summary: 'Create or update the SiteClock connection. apiKey is optional on update (blank = keep).' })
  save(@Req() req: AdminRequest, @Param('orgId') orgId: string, @Body() body: { baseUrl?: string; siteclockCompanyId?: string; apiKey?: string; enabled?: boolean; defaultDurationMin?: number }) {
    this.assertOsirisAdmin(req);
    return this.link.saveConnection(orgId, body || {});
  }

  @Get('test')
  @ApiOperation({ summary: 'Test the stored key with one read call to SiteClock.' })
  test(@Req() req: AdminRequest, @Param('orgId') orgId: string) {
    this.assertOsirisAdmin(req);
    return this.link.testConnection(orgId);
  }
}
