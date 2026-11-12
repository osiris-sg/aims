import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { VehiclesService } from './vehicles.service';

interface ClerkRequest extends Request {
  user?: { id?: string };
}

/**
 * WCT Vehicles (enableWctVehicles). vehicles:read views, vehicles:update keeps
 * the register and the usage log (WCT Admin, Operations, superadmin),
 * vehicles:approve approves a repair and unlocks an approved one (Admin,
 * superadmin). Every route takes the record id as :id so the Activity Log
 * stamps it; the verb segments (start / end / approve / unlock / archive)
 * give each row its action.
 */
@ApiTags('vehicles')
@Controller('vehicles')
@UseGuards(ClerkAuthGuard)
export class VehiclesController {
  constructor(private readonly service: VehiclesService) {}

  @Get()
  @Permissions('vehicles:read')
  list(@UserOrganization() org: { id: string }, @Query('archived') archived?: string) {
    return this.service.list(org.id, archived === '1' || archived === 'true');
  }

  /** Declared before :id so "drivers" is not read as an id. */
  @Get('drivers')
  @Permissions('vehicles:read')
  drivers(@UserOrganization() org: { id: string }) {
    return this.service.drivers(org.id);
  }

  @Post()
  @Permissions('vehicles:update')
  create(@Body() body: any, @UserOrganization() org: { id: string }, @Req() req: ClerkRequest) {
    return this.service.create(body ?? {}, org.id, { id: req.user?.id });
  }

  // ---- usage rows (declared before the :id vehicle routes)

  @Post('usages/:id/end')
  @Permissions('vehicles:update')
  endUsage(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }) {
    return this.service.endUsage(id, body ?? {}, org.id);
  }

  @Patch('usages/:id')
  @Permissions('vehicles:update')
  editUsage(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }) {
    return this.service.editUsage(id, body ?? {}, org.id);
  }

  @Put('usages/:id/repair')
  @Permissions('vehicles:update')
  logRepair(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }) {
    return this.service.logRepair(id, body ?? {}, org.id);
  }

  @Post('usages/:id/approve')
  @Permissions('vehicles:approve')
  approveRepair(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }, @Req() req: ClerkRequest) {
    return this.service.approveRepair(id, body ?? {}, org.id, { id: req.user?.id });
  }

  /** Body { reason } (required): recorded on the row and, as the request body, in the Activity Log. */
  @Post('usages/:id/unlock')
  @Permissions('vehicles:approve')
  unlockRepair(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }, @Req() req: ClerkRequest) {
    return this.service.unlockRepair(id, body ?? {}, org.id, { id: req.user?.id });
  }

  // ---- one vehicle

  @Get(':id')
  @Permissions('vehicles:read')
  get(@Param('id') id: string, @UserOrganization() org: { id: string }) {
    return this.service.get(id, org.id);
  }

  @Patch(':id')
  @Permissions('vehicles:update')
  update(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }) {
    return this.service.update(id, body ?? {}, org.id);
  }

  @Post(':id/archive')
  @Permissions('vehicles:update')
  archive(@Param('id') id: string, @Body() body: { archived?: boolean }, @UserOrganization() org: { id: string }) {
    return this.service.setArchived(id, body?.archived !== false, org.id);
  }

  @Post(':id/usages/start')
  @Permissions('vehicles:update')
  startUsage(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }, @Req() req: ClerkRequest) {
    return this.service.startUsage(id, body ?? {}, org.id, { id: req.user?.id });
  }

  /** The usage log as the paper "Vehicle / Lorry Usage & Repair Form" (A4 landscape PDF). */
  @Get(':id/log-pdf')
  @Permissions('vehicles:read')
  async logPdf(@Param('id') id: string, @UserOrganization() org: { id: string }, @Res() res: Response) {
    const { buffer, filename } = await this.service.logPdf(id, org.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  }
}
