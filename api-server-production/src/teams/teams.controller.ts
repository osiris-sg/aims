import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TeamsService } from './teams.service';

interface RequestWithOrganization {
  userOrganization?: { id: string };
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

// Managed from User Management (users:* perms → Master tier only, same as the
// rest of that screen).
@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
@UseGuards(ClerkAuthGuard)
export class TeamsController {
  constructor(private readonly service: TeamsService) {}

  @Get()
  @Permissions('users:read')
  list(@Req() req: RequestWithOrganization) {
    return this.service.list(orgId(req));
  }

  @Post()
  @Permissions('users:update')
  create(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.create(orgId(req), body || {});
  }

  @Patch(':id')
  @Permissions('users:update')
  update(@Param('id') id: string, @Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.update(id, orgId(req), body || {});
  }

  @Delete(':id')
  @Permissions('users:update')
  remove(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.remove(id, orgId(req));
  }

  @Post(':id/members')
  @Permissions('users:update')
  setMembers(@Param('id') id: string, @Req() req: RequestWithOrganization, @Body() body: { userIds: string[] }) {
    return this.service.setMembers(id, orgId(req), body?.userIds || []);
  }
}
