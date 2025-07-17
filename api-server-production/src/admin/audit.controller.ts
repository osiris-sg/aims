import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { UserOrganization } from '../auth/decorators/user-organization.decorator';
import { Request } from 'express';

@Controller('admin/audit')
@UseGuards(ClerkAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @Permissions('audit:read')
  async getAuditLogs(
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('organizationId') organizationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @UserOrganization() userOrg?: any,
    @Req() req?: any,
  ) {
    const filters: any = {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20, // Reduced from 50 to 20 for better performance
    };

    if (userId) filters.userId = userId;
    if (action) filters.action = action;
    if (resource) filters.resource = resource;
    if (organizationId) filters.organizationId = organizationId;
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);

    // If user is not OsirisAdmin, only show logs for their organization
    if (!req.isOsirisAdmin && userOrg) {
      filters.organizationId = userOrg.id;
    }

    const result = await this.auditService.getAuditLogs(filters);
    console.log("Audit Logs", result);

    return {
      success: true,
      data: result,
    };
  }

  @Get('summary')
  @Permissions('audit:read')
  async getAuditSummary(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @UserOrganization() userOrg?: any, @Req() req?: any) {
    return {
      success: true,
      data: {
        totalActions: 0,
        topUsers: [],
        topActions: [],
        topResources: [],
      },
    };
  }
}
