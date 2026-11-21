import { Body, Controller, Delete, Get, Header, HttpException, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { syncLogResult, WorkersTeamsService } from './workers-teams.service';

/**
 * Workers & Teams (WCT 2026-11-20, flag enableWorkersTeams): Settings > Workers & Teams. Reads need organizations:read
 * (Org Settings view), changes and the SiteClock sync organizations:update (Org Settings edit, Admins). The job forms'
 * picker needs documents:read (the jobs / calendar / orders screens). Activity Log: the interceptor's rows (hide = HIDE,
 * unhide = UNHIDE, POST siteclock-sync = SYNC with the counts as its result).
 */
@ApiTags('workers-teams')
@ApiBearerAuth()
@Controller('workers-teams')
@UseGuards(ClerkAuthGuard)
export class WorkersTeamsController {
  constructor(private readonly svc: WorkersTeamsService) {}

  private org(req: any): string {
    const id = req.userOrganization?.id;
    if (!id) throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    return id;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @Permissions('organizations:read')
  @ApiOperation({ summary: 'Every worker and team (hidden too), membership and the logins a worker can be linked to' })
  list(@Req() req: any) {
    return this.svc.list(this.org(req));
  }

  @Get('picker')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Active teams and workers (names) for the job forms\' Team / crew picker' })
  picker(@Req() req: any) {
    return this.svc.picker(this.org(req));
  }

  @Get('siteclock-sync')
  @Permissions('organizations:update')
  @ApiOperation({ summary: 'Dry run of the SiteClock sync: what it would create / update / link; nothing is written' })
  preview(@Req() req: any) {
    return this.svc.preview(this.org(req));
  }

  @Post('siteclock-sync')
  @Permissions('organizations:update')
  @ApiOperation({ summary: 'Apply the SiteClock sync (re-runnable; never overwrites a value changed in AIMS)' })
  async apply(@Req() req: any) {
    const out = await this.svc.apply(this.org(req));
    req.actionLogResult = syncLogResult(out);
    return out;
  }

  @Post('workers')
  @Permissions('organizations:update')
  createWorker(@Req() req: any, @Body() body: any) {
    return this.svc.createWorker(this.org(req), body);
  }

  @Patch('workers/:id')
  @Permissions('organizations:update')
  updateWorker(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateWorker(this.org(req), id, body);
  }

  @Post('workers/:id/hide')
  @Permissions('organizations:update')
  hideWorker(@Req() req: any, @Param('id') id: string) {
    return this.svc.setWorkerActive(this.org(req), id, false);
  }

  @Post('workers/:id/unhide')
  @Permissions('organizations:update')
  unhideWorker(@Req() req: any, @Param('id') id: string) {
    return this.svc.setWorkerActive(this.org(req), id, true);
  }

  @Post('teams')
  @Permissions('organizations:update')
  createTeam(@Req() req: any, @Body() body: any) {
    return this.svc.createTeam(this.org(req), body);
  }

  @Patch('teams/:id')
  @Permissions('organizations:update')
  updateTeam(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateTeam(this.org(req), id, body);
  }

  @Post('teams/:id/hide')
  @Permissions('organizations:update')
  hideTeam(@Req() req: any, @Param('id') id: string) {
    return this.svc.setTeamActive(this.org(req), id, false);
  }

  @Post('teams/:id/unhide')
  @Permissions('organizations:update')
  unhideTeam(@Req() req: any, @Param('id') id: string) {
    return this.svc.setTeamActive(this.org(req), id, true);
  }

  @Post('teams/:id/members')
  @Permissions('organizations:update')
  addMember(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.addMember(this.org(req), id, body?.workerId);
  }

  @Delete('teams/:id/members/:workerId')
  @Permissions('organizations:update')
  removeMember(@Req() req: any, @Param('id') id: string, @Param('workerId') workerId: string) {
    return this.svc.removeMember(this.org(req), id, workerId);
  }
}
