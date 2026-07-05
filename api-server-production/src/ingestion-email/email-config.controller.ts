import { Body, Controller, ForbiddenException, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PrismaService } from '../common/prisma.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  isOsirisAdmin?: boolean;
}

// Admin surface for email ingestion: per-org config, ingest logs, and the
// org's inbound address. Endpoints take :orgId (the admin pages operate on a
// selected org) but non-platform-admins may only touch their own org.
@ApiTags('email-ingest')
@ApiBearerAuth()
@Controller('email-ingest')
@UseGuards(ClerkAuthGuard)
export class EmailConfigController {
  constructor(private readonly prisma: PrismaService) {}

  /** osirisadmin: any org. Everyone else: own membership org only. */
  private assertOrgAccess(req: RequestWithOrganization, orgId: string) {
    if (req.isOsirisAdmin) return;
    if (req.userOrganization?.id !== orgId) {
      throw new ForbiddenException('Cannot manage email ingestion for another organization');
    }
  }

  @Get('config/:orgId')
  @Permissions('organizations:read')
  @ApiOperation({ summary: 'Email ingest config for an org (creates the disabled default row if missing).' })
  async getConfig(@Param('orgId') orgId: string, @Req() req: RequestWithOrganization) {
    this.assertOrgAccess(req, orgId);
    return this.prisma.emailIngestConfig.upsert({
      where: { organizationId: orgId },
      update: {},
      create: { organizationId: orgId }, // all defaults: disabled, AI routing, DRAFT
    });
  }

  @Put('config/:orgId')
  @Permissions('organizations:update')
  @ApiOperation({ summary: 'Update email ingest config (enabled, watchedSenders, routingMode, defaultDocType, createMode).' })
  async updateConfig(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      enabled?: boolean;
      watchedSenders?: string[];
      routingMode?: string;
      defaultDocType?: string | null;
      createMode?: string;
    },
    @Req() req: RequestWithOrganization,
  ) {
    this.assertOrgAccess(req, orgId);
    const data: Record<string, any> = {};
    if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
    if (body.watchedSenders !== undefined) {
      data.watchedSenders = (Array.isArray(body.watchedSenders) ? body.watchedSenders : [])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
    if (body.routingMode !== undefined) data.routingMode = body.routingMode === 'FIXED' ? 'FIXED' : 'AI';
    if (body.defaultDocType !== undefined) {
      data.defaultDocType = body.defaultDocType === 'BILL' || body.defaultDocType === 'INVOICE' ? body.defaultDocType : null;
    }
    if (body.createMode !== undefined) data.createMode = 'DRAFT'; // only mode supported today

    return this.prisma.emailIngestConfig.upsert({
      where: { organizationId: orgId },
      update: data,
      create: { organizationId: orgId, ...data },
    });
  }

  @Get('logs/:orgId')
  @Permissions('organizations:read')
  @ApiOperation({ summary: 'Recent email ingest log rows for an org, newest first.' })
  @ApiQuery({ name: 'limit', required: false })
  async getLogs(
    @Param('orgId') orgId: string,
    @Query('limit') limit: string | undefined,
    @Req() req: RequestWithOrganization,
  ) {
    this.assertOrgAccess(req, orgId);
    const take = Math.min(Math.max(parseInt(limit ?? '', 10) || 50, 1), 200);
    return this.prisma.emailIngestLog.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  @Get('address/:orgId')
  @Permissions('organizations:read')
  @ApiOperation({ summary: "The org's inbound ingestion address (docs+{orgId}@EMAIL_INGEST_DOMAIN)." })
  async getAddress(@Param('orgId') orgId: string, @Req() req: RequestWithOrganization) {
    this.assertOrgAccess(req, orgId);
    const domain = process.env.EMAIL_INGEST_DOMAIN;
    if (!domain) return { address: null, note: 'EMAIL_INGEST_DOMAIN is not configured' };
    return { address: `docs+${orgId}@${domain}` };
  }
}
