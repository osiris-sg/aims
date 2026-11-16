import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
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

  // ---- log entries (declared before the :id vehicle routes)

  @Patch('log/:id')
  @Permissions('vehicles:update')
  editEntry(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }) {
    return this.service.editEntry(id, body ?? {}, org.id);
  }

  /** Hides the entry (kept for the record); the request is the Activity Log row. */
  @Delete('log/:id')
  @Permissions('vehicles:update')
  deleteEntry(@Param('id') id: string, @UserOrganization() org: { id: string }, @Req() req: ClerkRequest) {
    return this.service.deleteEntry(id, org.id, { id: req.user?.id });
  }

  @Post('log/:id/approve')
  @Permissions('vehicles:approve')
  approveRepair(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }, @Req() req: ClerkRequest) {
    return this.service.approveRepair(id, body ?? {}, org.id, { id: req.user?.id });
  }

  /** Body { reason } (required): recorded on the entry and, as the request body, in the Activity Log. */
  @Post('log/:id/unlock')
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

  /** A log entry of any type (Driver assigned, Repair / servicing, Fuel, renewals, Parking / ERP / fines, Other). */
  @Post(':id/log')
  @Permissions('vehicles:update')
  addEntry(@Param('id') id: string, @Body() body: any, @UserOrganization() org: { id: string }, @Req() req: ClerkRequest) {
    return this.service.addEntry(id, body ?? {}, org.id, { id: req.user?.id });
  }

  /** The log book in the paper form's layout (A4 landscape PDF); ?type= &from= &to= follow the page's filters. */
  @Get(':id/log-pdf')
  @Permissions('vehicles:read')
  async logPdf(@Param('id') id: string, @UserOrganization() org: { id: string }, @Res() res: Response, @Query('type') type?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const { buffer, filename } = await this.service.logPdf(id, org.id, { type, from, to });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  }
}
