import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { JobFieldsService } from './job-fields.service';

/** Custom job fields (enableJobFields): the org admin's Settings → Job fields. */
@Controller('job-fields')
@UseGuards(ClerkAuthGuard)
export class JobFieldsController {
  constructor(private readonly service: JobFieldsService) {}

  @Get()
  @Permissions('maintenance-reports:read')
  list(@UserOrganization() org: { id: string }) {
    return this.service.list(org.id);
  }

  @Post()
  @Permissions('organizations:update')
  create(@UserOrganization() org: { id: string }, @Body() body: any) {
    return this.service.create(org.id, body || {});
  }

  @Put(':id')
  @Permissions('organizations:update')
  update(@UserOrganization() org: { id: string }, @Param('id') id: string, @Body() body: any) {
    return this.service.update(org.id, id, body || {});
  }

  @Delete(':id')
  @Permissions('organizations:update')
  remove(@UserOrganization() org: { id: string }, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }
}
