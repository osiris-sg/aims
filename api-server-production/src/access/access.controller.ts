import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserOrganization } from '../auth/decorators/user-organization.decorator';
import { actorOf } from '../auth/admin-scope';
import { AccessService } from './access.service';

/**
 * Custom access (WCT group 2026-11-19, features.enableCustomAccess). Org Settings > Roles and the
 * Add / Edit User "Custom access" switch. No @Permissions: AccessService checks that the org has the
 * setting on and the caller is Admin / superadmin (or the platform admin). Every change leaves a
 * summary on its Activity Log row (req.actionLogResult).
 */
@ApiTags('access')
@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get()
  overview(@UserOrganization() org: { id: string }, @Req() req: any) {
    return this.access.overview(org.id, actorOf(req, org.id));
  }

  @Get('roles')
  listRoles(@UserOrganization() org: { id: string }, @Req() req: any) {
    return this.access.listRoles(org.id, actorOf(req, org.id));
  }

  @Post('roles')
  async createRole(@UserOrganization() org: { id: string }, @Body() body: any, @Req() req: any) {
    const { log, ...res } = await this.access.createRole(org.id, body, actorOf(req, org.id));
    req.actionLogResult = log;
    return res;
  }

  @Patch('roles/:id')
  async updateRole(@UserOrganization() org: { id: string }, @Param('id') id: string, @Body() body: any, @Req() req: any) {
    const { log, ...res } = await this.access.updateRole(org.id, id, body, actorOf(req, org.id));
    req.actionLogResult = log;
    return res;
  }

  @Delete('roles/:id')
  async deleteRole(@UserOrganization() org: { id: string }, @Param('id') id: string, @Req() req: any) {
    const { log, ...res } = await this.access.deleteRole(org.id, id, actorOf(req, org.id));
    req.actionLogResult = log;
    return res;
  }

  // GET reads (VIEW); only the PUT carries the custom-access verb (SET_ACCESS) in the Activity Log.
  @Get('users/:userId')
  getUserAccess(@UserOrganization() org: { id: string }, @Param('userId') userId: string, @Req() req: any) {
    return this.access.getUserAccess(org.id, userId, actorOf(req, org.id));
  }

  @Put('users/:userId/custom-access')
  async setUserAccess(@UserOrganization() org: { id: string }, @Param('userId') userId: string, @Body() body: any, @Req() req: any) {
    const { log, ...res } = await this.access.setUserAccess(org.id, userId, body, actorOf(req, org.id));
    req.actionLogResult = log;
    return res;
  }
}
