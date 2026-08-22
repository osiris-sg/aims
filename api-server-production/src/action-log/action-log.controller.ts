import { Controller, Get, Query, Req } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { UserOrganization } from '../auth/decorators/user-organization.decorator';
import { ActionLogService } from './action-log.service';

@Controller('action-log')
export class ActionLogController {
  constructor(private readonly actionLog: ActionLogService) {}

  @Get()
  @Permissions('audit:read')
  async list(
    @Query('actorType') actorType?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('resourceId') resourceId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
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
      limit: Math.min(limit ? parseInt(limit) : 25, 100),
    };
    if (actorType) filters.actorType = actorType;
    if (actorId) filters.actorId = actorId;
    if (action) filters.action = action;
    if (resource) filters.resource = resource;
    if (resourceId) filters.resourceId = resourceId;
    if (status) filters.status = status;
    if (search) filters.search = search;
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);

    // Org scoping: osirisadmin may query any org (or all); everyone else is
    // pinned to their effective org.
    if (req?.isOsirisAdmin) {
      if (organizationId) filters.organizationId = organizationId;
      else if (userOrg?.id) filters.organizationId = userOrg.id;
    } else {
      filters.organizationId = userOrg?.id;
    }

    return this.actionLog.query(filters);
  }
}
